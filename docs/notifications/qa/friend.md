# QA Checklist — `friend` Notification (reactive)

Migration: `20260428r_notification_friend.sql`
Trigger: `public.notify_friend()` AFTER INSERT ON `piktag_connections`
Tab: social · Push: yes · Dedup window: 7 days on `(user_id, type='friend', data->>'friend_user_id')`

---

## 1. Schema Verification (`piktag_connections` columns + RLS already exist; verify trigger doesn't break existing flows)

- [ ] Confirm `piktag_connections` exists with required columns (`id`, `user_id`, `connected_user_id`, `nickname`, `note`, `met_at`, `met_location`, `birthday`, `anniversary`, `contract_expiry`, `scan_session_id`, `is_reviewed`, `created_at`, `updated_at`) and `UNIQUE (user_id, connected_user_id)`:
  ```sql
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='piktag_connections'
   ORDER BY ordinal_position;
  SELECT conname, contype, pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid = 'public.piktag_connections'::regclass;
  ```
- [ ] Confirm migration does NOT redefine or `ALTER` `piktag_connections` columns; only creates the trigger function and trigger.
- [ ] Confirm existing RLS policies on `piktag_connections` are untouched after migration:
  ```sql
  SELECT policyname, cmd, qual, with_check
    FROM pg_policies WHERE schemaname='public' AND tablename='piktag_connections';
  ```
- [ ] Confirm no other AFTER INSERT trigger on `piktag_connections` is dropped or replaced. Run before/after migration:
  ```sql
  SELECT tgname, tgenabled, pg_get_triggerdef(oid)
    FROM pg_trigger WHERE tgrelid = 'public.piktag_connections'::regclass AND NOT tgisinternal;
  ```
- [ ] Confirm existing flows still pass: insert connection (one-way) does NOT raise an exception and does NOT block the parent INSERT, even when reverse row is missing.
  ```sql
  -- as user A
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<B>') RETURNING id;
  -- expect: row inserted, no notification yet (no reverse).
  ```
- [ ] Confirm pending-connection flow (`is_reviewed=false`) and review flow still work: toggle `is_reviewed` does not re-fire trigger (trigger is AFTER INSERT only, not UPDATE).
- [ ] Confirm `ON DELETE CASCADE` from `auth.users` still cascades cleanly (delete a test auth user, ensure connection rows + any notifications referencing them remain consistent).

## 2. Trigger Function `notify_friend()` Syntax + GRANTs + search_path

- [ ] Function exists, is `SECURITY DEFINER`, owned by `postgres`, `search_path = public`:
  ```sql
  SELECT p.proname, p.prosecdef, r.rolname AS owner,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.proconfig
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'notify_friend';
  -- expect: prosecdef=true, proconfig contains 'search_path=public'
  ```
- [ ] GRANTs are correct (PUBLIC revoked, EXECUTE to `postgres`, `service_role`):
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='notify_friend';
  -- expect: postgres, service_role only.
  ```
- [ ] Trigger `trg_notify_friend` is `AFTER INSERT FOR EACH ROW` on `piktag_connections`:
  ```sql
  SELECT pg_get_triggerdef(oid) FROM pg_trigger
   WHERE tgname='trg_notify_friend' AND tgrelid='public.piktag_connections'::regclass;
  ```
- [ ] Function body uses `jsonb_build_object` populating `actor_user_id`, `friend_user_id`, `connection_id`, `username`, `avatar_url` exactly per spec §2.2.
- [ ] Function inserts `title=''` and rendered en body string `you are now friends`.
- [ ] Function emits TWO rows on bidirectional handshake: one for `NEW.user_id`, one for `NEW.connected_user_id` (reverse row's owner). Each side independently dedup-checked.
- [ ] Bidirectional check uses `EXISTS (SELECT 1 FROM piktag_connections WHERE user_id = NEW.connected_user_id AND connected_user_id = NEW.user_id)`; if false, function returns NEW without inserting.
- [ ] Re-run migration is idempotent (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`):
  ```sql
  -- apply migration twice in a transaction; expect no error, single trigger row.
  ```
- [ ] Verify `lint` via `EXPLAIN`/dry-run inserts surfaces no `permission denied for table piktag_notifications` (SECURITY DEFINER must let trigger insert despite RLS).

## 3. Functional Tests — 3+ Happy + 2+ Edge

Setup users A, B, C, D in `auth.users` and `piktag_profiles` with `username`, `avatar_url` set. Truncate `piktag_notifications` between tests where noted.

### Happy 1 — Standard bidirectional accept (A adds B, then B adds A)
- [ ] ```sql
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<B>');
  -- no notification yet
  SELECT count(*) FROM piktag_notifications WHERE type='friend' AND user_id IN ('<A>','<B>');
  -- expect: 0
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<B>','<A>');
  SELECT user_id, body, data->>'friend_user_id', data->>'username'
    FROM piktag_notifications WHERE type='friend' AND user_id IN ('<A>','<B>') ORDER BY user_id;
  -- expect: 2 rows, one for A (friend_user_id=B), one for B (friend_user_id=A); body='you are now friends'.
  ```

### Happy 2 — Both rows carry routing keys + display fields
- [ ] ```sql
  SELECT data ? 'actor_user_id' AND data ? 'friend_user_id' AND data ? 'connection_id'
         AND data ? 'username' AND data ? 'avatar_url' AS ok
    FROM piktag_notifications WHERE type='friend' AND user_id='<A>';
  -- expect: ok=true
  ```

### Happy 3 — Title empty, body rendered
- [ ] ```sql
  SELECT title, body FROM piktag_notifications WHERE type='friend' AND user_id='<A>';
  -- expect: title='', body='you are now friends'
  ```

### Edge 1 — Simultaneous bidirectional accept (race)
- [ ] Two concurrent transactions insert `(C,D)` and `(D,C)` at the same time:
  ```sql
  -- session 1
  BEGIN; INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<C>','<D>');
  -- session 2 (in parallel, before session 1 commits)
  BEGIN; INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<D>','<C>');
  COMMIT; -- session 2
  COMMIT; -- session 1
  ```
  - [ ] After both commit, `SELECT count(*) FROM piktag_notifications WHERE type='friend' AND user_id IN ('<C>','<D>');` returns **exactly 2** (not 0, not 4). The trigger fires on whichever side commits second; the dedup-SELECT-then-INSERT prevents over-insertion if both somehow see each other's row (read committed visibility).
  - [ ] If only 1 row appears (the second-committer side missed the first because of MVCC visibility), document mitigation: re-check via the dedup window when the missing side is later updated, or accept that one side sees the notification only after a manual refresh — confirm spec acceptance.

### Edge 2 — Self-friend blocked
- [ ] ```sql
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<A>');
  -- expect: either CHECK constraint blocks it OR trigger guards (recipient=actor) and inserts no notification.
  SELECT count(*) FROM piktag_notifications WHERE type='friend' AND data->>'friend_user_id'='<A>' AND user_id='<A>';
  -- expect: 0
  ```

### Edge 3 — Missing profile row for one side (orphan)
- [ ] Delete `piktag_profiles` row for B, then INSERT both directions. Expect trigger does not raise; `data.username` falls back to `''` and `data.avatar_url` is NULL. Notification still inserted.
  ```sql
  DELETE FROM piktag_profiles WHERE id='<B>';
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<B>');
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<B>','<A>');
  SELECT data->>'username', data->>'avatar_url' FROM piktag_notifications WHERE type='friend' AND user_id='<A>';
  ```

### Edge 4 — Reverse row inserted before forward (out-of-order)
- [ ] Same as Happy 1 but reversed insert order; verify result is identical (only second insert triggers the pair).

## 4. Dedup Test

- [ ] After Happy 1 produces 2 rows, immediately delete both directions and re-insert within 7 days:
  ```sql
  DELETE FROM piktag_connections WHERE (user_id,connected_user_id) IN (('<A>','<B>'),('<B>','<A>'));
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<B>');
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<B>','<A>');
  SELECT count(*) FROM piktag_notifications WHERE type='friend' AND user_id IN ('<A>','<B>');
  -- expect: still 2 (not 4) — dedup window blocked the new pair.
  ```
- [ ] Force the dedup window to expire and re-test:
  ```sql
  UPDATE piktag_notifications SET created_at = now() - interval '8 days'
   WHERE type='friend' AND user_id IN ('<A>','<B>');
  DELETE FROM piktag_connections WHERE (user_id,connected_user_id) IN (('<A>','<B>'),('<B>','<A>'));
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<A>','<B>');
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('<B>','<A>');
  SELECT count(*) FROM piktag_notifications WHERE type='friend' AND user_id IN ('<A>','<B>');
  -- expect: 4 (fresh pair created).
  ```
- [ ] Dedup key is `data->>'friend_user_id'` (NOT `actor_user_id` only) — verify SQL in trigger body matches spec §2.2.

## 5. Push Notification Test

- [ ] Set `push_token` to a valid Expo `ExponentPushToken[...]` for both A and B. Trigger Happy 1. Confirm:
  - [ ] HTTP POST sent to `https://exp.host/--/api/v2/push/send` (one per side).
  - [ ] Payload: `{ to, title=<other side username>, body='you are now friends', data:{ type:'friend', friend_user_id, actor_user_id, connection_id }, sound:'default', priority:'high' }`.
  - [ ] Push errors do NOT roll back the notification insert (push call wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL`).
  - [ ] Null/empty `push_token` skips the HTTP call gracefully (no error).
  - [ ] Verify via Expo receipts API the device received the message.
- [ ] Self-actor / blocked-user: if a `piktag_blocks` row exists either direction, push is suppressed (verify or document if not implemented for `friend`).

## 6. Mobile UI Test (social tab, route to UserDetail/FriendDetail per spec)

- [ ] Notification appears under the **social** tab in `NotificationsScreen.tsx`.
- [ ] Realtime subscription delivers the row instantly (no app restart needed) for both A and B.
- [ ] Renders `data.username` as primary text and `data.avatar_url` as the avatar; body shows localized `notifications.types.friend.body` (`you are now friends` / `你們成為朋友了`).
- [ ] Tapping the notification routes to **FriendDetail** (since the friendship is mutual and a connection row exists for the recipient) using `data.connection_id` — confirm the screen loads the correct connection.
- [ ] If no connection row visible to the viewer (edge case), fallback route is **UserDetail** with `data.friend_user_id`.
- [ ] zh-TW + zh-CN locales render correct strings; en fallback works when locale missing.
- [ ] `is_read=false` displays unread indicator; tapping marks `is_read=true` (RLS update path) and indicator clears.
- [ ] Push tap (cold start + warm start) deep-links into FriendDetail using `data.friend_user_id` / `data.connection_id`.

## 7. Performance Test

- [ ] Bulk-insert benchmark — 10k bidirectional pairs (20k rows) executed in batches of 500:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS) INSERT INTO piktag_connections (user_id, connected_user_id)
   SELECT a.id, b.id FROM <users a, users b sample> ...;
  ```
  - [ ] Trigger overhead < 5ms p95 per row; total runtime acceptable on staging.
- [ ] Verify supporting indexes used by dedup SELECT and bidirectional EXISTS:
  - [ ] `piktag_connections (user_id, connected_user_id)` UNIQUE index serves the EXISTS lookup.
  - [ ] `piktag_notifications` has an index on `(user_id, type, created_at DESC)` (or `(user_id, type)`) so the dedup SELECT is index-only or near-it. If missing, create one in the migration.
  ```sql
  EXPLAIN (ANALYZE)
  SELECT 1 FROM piktag_notifications
   WHERE user_id='<A>' AND type='friend' AND data->>'friend_user_id'='<B>'
     AND created_at > now() - interval '7 days' LIMIT 1;
  -- expect: Index Scan, rows=0..1, < 1ms.
  ```
- [ ] Confirm trigger does not lock `piktag_connections` for writers (no `LOCK TABLE`, no long transactions). Run two concurrent inserts of unrelated pairs and verify no blocking.
- [ ] Push HTTP latency does not block transaction commit (offloaded via `net.http_post` which is async, or wrapped with a short statement timeout).

## 8. Rollback Plan

- [ ] **Forward rollback (preferred)**: ship a follow-up migration that drops the trigger and function:
  ```sql
  -- 20260428r_rollback_notification_friend.sql
  DROP TRIGGER IF EXISTS trg_notify_friend ON public.piktag_connections;
  DROP FUNCTION IF EXISTS public.notify_friend();
  ```
- [ ] **Hot disable (no migration)**: in production, run as `postgres`:
  ```sql
  ALTER TABLE public.piktag_connections DISABLE TRIGGER trg_notify_friend;
  ```
  Re-enable with `ENABLE TRIGGER trg_notify_friend` once fixed.
- [ ] **Data cleanup** for spurious rows produced during the bad window:
  ```sql
  DELETE FROM piktag_notifications
   WHERE type='friend' AND created_at >= '<deploy_ts>' AND created_at < '<rollback_ts>';
  ```
- [ ] **Verification post-rollback**:
  ```sql
  SELECT count(*) FROM pg_trigger WHERE tgname='trg_notify_friend';   -- expect 0 (or disabled)
  SELECT count(*) FROM pg_proc WHERE proname='notify_friend';          -- expect 0 after DROP FUNCTION
  ```
- [ ] Insert a fresh `(user_id, connected_user_id)` pair in both directions; confirm NO `friend` notification rows are produced.
- [ ] Mobile clients tolerate absence of new notifications gracefully (existing rows still display from realtime cache).
- [ ] Document the rollback in the incident log along with affected user IDs (recipients of any erroneous rows that were force-deleted).
