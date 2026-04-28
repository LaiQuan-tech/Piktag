# QA Checklist — Notification Type: `follow`

**Migration:** `mobile/supabase/migrations/20260428q_notification_follow.sql`
**Trigger:** `notify_follow()` on `piktag_followers AFTER INSERT`
**Recipient:** `NEW.following_id` · **Actor:** `NEW.follower_id`
**Dedup window:** 24h on `(user_id, type='follow', data->>'actor_user_id')`
**Push:** yes (inline from trigger or relay edge function)

---

## 1. Schema Verification — `piktag_followers` exists with correct columns + RLS

- [ ] Table exists:
  ```sql
  SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'piktag_followers';
  -- expect: 1 row
  ```
- [ ] Columns match spec (`id uuid PK`, `follower_id uuid NOT NULL`, `following_id uuid NOT NULL`, `created_at timestamptz`):
  ```sql
  SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='piktag_followers'
   ORDER BY ordinal_position;
  ```
- [ ] FKs to `auth.users(id) ON DELETE CASCADE` present on both `follower_id` and `following_id`:
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid = 'public.piktag_followers'::regclass
     AND contype = 'f';
  ```
- [ ] `UNIQUE(follower_id, following_id)` constraint exists (prevents duplicate follow rows).
- [ ] `CHECK (follower_id <> following_id)` exists (prevents self-follow).
- [ ] Indexes `idx_followers_following (following_id, created_at DESC)` and `idx_followers_follower (follower_id, created_at DESC)` exist:
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
   WHERE schemaname='public' AND tablename='piktag_followers';
  ```
- [ ] RLS is enabled on the table:
  ```sql
  SELECT relrowsecurity FROM pg_class WHERE oid = 'public.piktag_followers'::regclass;
  -- expect: t
  ```
- [ ] RLS policies present and scoped:
  - SELECT: `auth.uid() IN (follower_id, following_id)`
  - INSERT: `auth.uid() = follower_id`
  - DELETE: `auth.uid() = follower_id`
  ```sql
  SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
         pg_get_expr(polwithcheck, polrelid) AS with_check_expr
    FROM pg_policy WHERE polrelid='public.piktag_followers'::regclass;
  ```
- [ ] As anon, INSERT into `piktag_followers` is rejected (RLS forbids).
- [ ] As `authenticated` user A, `INSERT (follower_id=A, following_id=B)` succeeds; `INSERT (follower_id=B, ...)` while authed as A is rejected.

---

## 2. Trigger function `notify_follow()` — syntax, GRANTs, search_path

- [ ] Function exists, is `SECURITY DEFINER`, language `plpgsql`:
  ```sql
  SELECT proname, prosecdef, prolang::regprocedure, proconfig
    FROM pg_proc WHERE proname = 'notify_follow' AND pronamespace = 'public'::regnamespace;
  -- expect: prosecdef = t, proconfig contains 'search_path=public'
  ```
- [ ] `SET search_path = public` set on the function (verified via `proconfig` above).
- [ ] GRANTs correct — only `postgres, service_role` can EXECUTE; PUBLIC revoked:
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE specific_schema='public' AND routine_name='notify_follow';
  -- expect: postgres EXECUTE, service_role EXECUTE; no PUBLIC.
  ```
- [ ] Trigger `trg_notify_follow` is bound `AFTER INSERT FOR EACH ROW` on `piktag_followers`:
  ```sql
  SELECT tgname, tgtype, tgenabled, pg_get_triggerdef(oid)
    FROM pg_trigger
   WHERE tgrelid='public.piktag_followers'::regclass AND NOT tgisinternal;
  ```
- [ ] Function body parses — `pg_get_functiondef('public.notify_follow()'::regprocedure)` returns the source without errors.
- [ ] Function references `piktag_profiles`, `piktag_notifications` unqualified, and search_path forces them to `public` (no schema-injection risk).

---

## 3. Functional tests — happy paths + edge cases

### Happy paths

- [ ] **HP-1: User B follows User A → A gets one notification.**
  ```sql
  -- as B (authenticated)
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');

  -- verify (as service_role):
  SELECT id, type, body, data FROM piktag_notifications
   WHERE user_id = '<A>' AND type = 'follow'
   ORDER BY created_at DESC LIMIT 1;
  -- expect: 1 row, body='started following you', data->>'actor_user_id'='<B>',
  --         data->>'username' non-null, data->>'follow_id' = the new follower row id
  ```
- [ ] **HP-2: data JSONB has all required keys.**
  ```sql
  SELECT data ? 'actor_user_id', data ? 'username',
         data ? 'avatar_url',   data ? 'follow_id'
    FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' ORDER BY created_at DESC LIMIT 1;
  -- expect: t,t,t,t
  ```
- [ ] **HP-3: `is_read=false`, `title=''`, `created_at` populated, recipient is `following_id` not `follower_id`.**
  ```sql
  SELECT user_id='<A>' AS recipient_ok, title='' AS title_empty,
         is_read=false AS unread, created_at IS NOT NULL AS has_ts
    FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' ORDER BY created_at DESC LIMIT 1;
  ```

### Edge cases

- [ ] **EC-1: Self-follow is blocked at the table level (CHECK constraint), not even reaching the trigger.**
  ```sql
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<A>','<A>');
  -- expect: ERROR: violates check constraint
  -- AND: zero new rows in piktag_notifications for user_id='<A>' type='follow'
  ```
- [ ] **EC-2: Duplicate follow row blocked by UNIQUE (no second notification).**
  ```sql
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');  -- first ok
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');  -- ERROR unique
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' AND data->>'actor_user_id'='<B>';
  -- expect: 1
  ```
- [ ] **EC-3: Follower profile missing → trigger still inserts notification with null username/avatar (does not throw).**
  ```sql
  -- delete profile row but keep auth.users row (or use a user with no piktag_profiles row)
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<C_no_profile>','<A>');
  SELECT data->>'username', data->>'avatar_url' FROM piktag_notifications
   WHERE user_id='<A>' AND data->>'actor_user_id'='<C_no_profile>';
  -- expect: row exists; username may be '' and avatar_url null but no error
  ```

---

## 4. Dedup test — same follower→followed pair within window

- [ ] **D-1: Unfollow → re-follow within 24h emits only the first notification.**
  ```sql
  -- 1st follow
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');
  -- unfollow
  DELETE FROM piktag_followers WHERE follower_id='<B>' AND following_id='<A>';
  -- 2nd follow (same pair, within 24h)
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');

  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' AND data->>'actor_user_id'='<B>'
     AND created_at > now() - interval '24 hours';
  -- expect: 1 (dedup suppressed the second)
  ```
- [ ] **D-2: After 24h window elapses, dedup releases.**
  ```sql
  -- backdate the existing notification
  UPDATE piktag_notifications SET created_at = now() - interval '25 hours'
   WHERE user_id='<A>' AND type='follow' AND data->>'actor_user_id'='<B>';
  -- re-follow
  DELETE FROM piktag_followers WHERE follower_id='<B>' AND following_id='<A>';
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' AND data->>'actor_user_id'='<B>';
  -- expect: 2
  ```
- [ ] **D-3: Dedup is per-actor — different follower B' DOES notify A, even if B already did within 24h.**
  ```sql
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B_prime>','<A>');
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow' AND created_at > now() - interval '24 hours';
  -- expect: at least 2 (one per actor)
  ```

---

## 5. Push notification test — Expo fires + payload shape

- [ ] **P-1: Recipient with non-null `push_token` triggers an Expo POST.**
  - Set A's `piktag_profiles.push_token` to a known sandbox token (`ExponentPushToken[xxx]`).
  - Trigger a follow:
    ```sql
    INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B>','<A>');
    ```
  - Verify outbound HTTP POST to `https://exp.host/--/api/v2/push/send` (Postgres logs / `net.http_response` table / Expo dashboard).
  - Payload shape MUST match §1.9:
    ```json
    {
      "to": "ExponentPushToken[xxx]",
      "title": "<follower_username>",
      "body":  "started following you",
      "data":  { "type": "follow", "actor_user_id": "<B>" },
      "sound": "default",
      "priority": "high"
    }
    ```
- [ ] **P-2: Recipient with NULL `push_token` does not crash trigger.**
  ```sql
  UPDATE piktag_profiles SET push_token = NULL WHERE id = '<A>';
  INSERT INTO piktag_followers (follower_id, following_id) VALUES ('<B2>','<A>');
  -- expect: notification row inserted; no exception; no Expo POST attempted
  ```
- [ ] **P-3: Push failure (HTTP 5xx from Expo) does NOT roll back the notification insert.** Use a fake/invalid token (`ExponentPushToken[INVALID]`); verify the `piktag_notifications` row still exists.
- [ ] **P-4: `data.type='follow'` is present in push payload** (mobile router relies on it — confirms via push intercept).

---

## 6. Mobile UI test — social tab + UserDetail deep-link

- [ ] **M-1: After firing HP-1, open `NotificationsScreen` → `social` tab → the new notification appears at the top.**
  - Avatar = `data.avatar_url` (or placeholder if null).
  - Primary line shows `data.username`.
  - Secondary line shows body `started following you` (en) or `開始追蹤你` (zh-TW).
- [ ] **M-2: Tapping the row routes to `UserDetail` with `userId = data.actor_user_id` (= follower B's id).** Verify via React Navigation logs / breakpoint that the route param equals `<B>`.
- [ ] **M-3: Realtime fan-out** — with the screen open and subscribed via `postgres_changes` on `piktag_notifications` filtered by `user_id`, a new follow inserts a notification row that appears WITHOUT pull-to-refresh (within 2s).
- [ ] **M-4: Mark-as-read works** — tap → `is_read` flips to `true` for that row; the unread dot disappears.
- [ ] **M-5: i18n** — switch language to zh-TW; body renders `開始追蹤你`. Keys present in `en.json`, `zh-TW.json`, `zh-CN.json` under `notifications.types.follow.{title,body,push.title,push.body}`.

---

## 7. Performance test — 1k followers/sec without N+1

- [ ] **PERF-1: Bulk insert 1,000 followers in one statement; total trigger time + notifications insert time stays under target.**
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  INSERT INTO piktag_followers (follower_id, following_id)
  SELECT u.id, '<A>'
    FROM (SELECT id FROM auth.users WHERE id <> '<A>' LIMIT 1000) u;
  -- expect: < 5s end-to-end on a hot cache; per-row trigger < 5ms avg.
  ```
- [ ] **PERF-2: Verify dedup SELECT uses an index, not a seq scan.**
  ```sql
  EXPLAIN ANALYZE
  SELECT 1 FROM piktag_notifications
   WHERE user_id='<A>' AND type='follow'
     AND data->>'actor_user_id'='<B>'
     AND created_at > now() - interval '24 hours' LIMIT 1;
  -- expect: Index Scan on piktag_notifications (user_id, created_at) or similar;
  --         NO Seq Scan over the full table.
  ```
- [ ] **PERF-3: Profile lookup inside the trigger is O(1) per row** — `piktag_profiles.id` is the PK; no N+1 across the 1k batch (each trigger invocation = 1 PK lookup).
- [ ] **PERF-4: Push fan-out is fire-and-forget** — single `net.http_post` per row; no synchronous waits that serialize the batch. If volumes climb, switch to edge function relay (per §3.10).
- [ ] **PERF-5: After bulk run, count of new `piktag_notifications` rows = 1,000** (no dedup collisions when actors are all distinct, recipient single).

---

## 8. Rollback plan — clean DROP of the migration

Run in this exact order to fully reverse `20260428q_notification_follow.sql`:

```sql
BEGIN;

-- 1. Drop the trigger first (depends on the function).
DROP TRIGGER IF EXISTS trg_notify_follow ON public.piktag_followers;

-- 2. Drop the trigger function.
DROP FUNCTION IF EXISTS public.notify_follow();

-- 3. Drop RLS policies on the new table (CASCADE not needed; explicit is safer).
DROP POLICY IF EXISTS piktag_followers_select ON public.piktag_followers;
DROP POLICY IF EXISTS piktag_followers_insert ON public.piktag_followers;
DROP POLICY IF EXISTS piktag_followers_delete ON public.piktag_followers;

-- 4. Drop indexes (auto-dropped with the table, but explicit for clarity).
DROP INDEX IF EXISTS public.idx_followers_following;
DROP INDEX IF EXISTS public.idx_followers_follower;

-- 5. Drop the table.
DROP TABLE IF EXISTS public.piktag_followers;

-- 6. Purge orphaned notifications written by this trigger (optional but clean).
DELETE FROM public.piktag_notifications WHERE type = 'follow';

COMMIT;
```

- [ ] After rollback, `\d piktag_followers` returns "Did not find any relation".
- [ ] `SELECT proname FROM pg_proc WHERE proname='notify_follow';` returns 0 rows.
- [ ] `SELECT count(*) FROM piktag_notifications WHERE type='follow';` returns 0.
- [ ] No remaining triggers on any table reference `notify_follow`:
  ```sql
  SELECT tgname FROM pg_trigger WHERE tgname = 'trg_notify_follow';
  -- expect: 0 rows
  ```
- [ ] Mobile clients on the next launch do not crash — `social` tab simply shows zero `follow` rows.
- [ ] Re-applying the migration (`supabase db push`) succeeds idempotently because every statement uses `IF NOT EXISTS` / `CREATE OR REPLACE`.

---

**Sign-off:** all checkboxes above must be ticked before merging the `follow` slice to `main`.
