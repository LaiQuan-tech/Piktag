# QA Checklist — `contract_expiry` notification (scheduled, reminders tab)

Spec source: `/Users/aimand/.gemini/File/PikTag-mobile/docs/notification-types-spec.md` §2.9
Migration owned: `mobile/supabase/migrations/20260428y_notification_contract_expiry.sql`
Edge function owned: `mobile/supabase/functions/notification-contract-expiry/index.ts`

---

## 1. Schema verification

- [ ] `piktag_connections.contract_expiry` column exists and is type `date` (nullable):
  ```sql
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'piktag_connections' AND column_name = 'contract_expiry';
  -- expect: contract_expiry | date | YES
  ```
- [ ] Helper function `public.enqueue_contract_expiry_notifications()` exists and returns `void`:
  ```sql
  SELECT proname, prorettype::regtype, prosecdef
    FROM pg_proc
   WHERE proname = 'enqueue_contract_expiry_notifications';
  -- expect: 1 row, void, prosecdef = true
  ```
- [ ] `pg_cron` job `notification-contract-expiry-daily` is registered at 08:10 UTC daily:
  ```sql
  SELECT jobname, schedule, command, active
    FROM cron.job
   WHERE jobname = 'notification-contract-expiry-daily';
  -- expect: schedule = '10 8 * * *', active = true,
  --        command containing public.enqueue_contract_expiry_notifications()
  ```
- [ ] Supporting index exists to make the daily scan cheap:
  ```sql
  SELECT indexname FROM pg_indexes
   WHERE tablename = 'piktag_connections'
     AND indexdef ILIKE '%contract_expiry%';
  -- expect at least one partial/btree index covering contract_expiry
  ```
- [ ] `piktag_notifications` accepts `type='contract_expiry'` (no CHECK constraint blocks it):
  ```sql
  INSERT INTO piktag_notifications (user_id, type, title, body, data)
  VALUES ('00000000-0000-0000-0000-000000000000','contract_expiry','','probe','{}'::jsonb);
  -- expect: success (then ROLLBACK in a tx)
  ```

## 2. Helper function `enqueue_contract_expiry_notifications()` syntax + GRANTs

- [ ] Function compiles cleanly under `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`:
  ```sql
  \df+ public.enqueue_contract_expiry_notifications
  -- expect: Security = definer, Config = search_path=public
  ```
- [ ] `PUBLIC` cannot execute it; only `postgres` and `service_role` can:
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_name = 'enqueue_contract_expiry_notifications';
  -- expect rows for postgres + service_role only; no PUBLIC, no anon, no authenticated
  ```
- [ ] Body iterates `days_until ∈ {30, 7, 1, 0}` exactly (per spec §2.9):
  ```sql
  SELECT pg_get_functiondef('public.enqueue_contract_expiry_notifications'::regproc);
  -- grep result for ARRAY[30,7,1,0] or equivalent CASE / IN clause
  ```
- [ ] Manual smoke run as `service_role`:
  ```sql
  SET ROLE service_role;
  SELECT public.enqueue_contract_expiry_notifications();
  RESET ROLE;
  -- expect: void return, no error
  ```
- [ ] Manual smoke run as `anon` is rejected:
  ```sql
  SET ROLE anon;
  SELECT public.enqueue_contract_expiry_notifications();
  -- expect: ERROR: permission denied for function
  RESET ROLE;
  ```

## 3. Functional tests (≥3 happy + ≥2 edge)

Setup helper for all cases:
```sql
-- Use a tx so each test rolls back:
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@test'),
  ('22222222-2222-2222-2222-222222222222','holder@test');
INSERT INTO piktag_profiles (id, username, full_name, avatar_url, push_token)
VALUES
  ('11111111-1111-1111-1111-111111111111','owner','Owner',null,'ExponentPushToken[OWNER]'),
  ('22222222-2222-2222-2222-222222222222','holder','Holder','https://x/h.png',null);
```

- [ ] **Happy 1 — 30-day milestone**:
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, contract_expiry)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (current_date + 30));
  SELECT public.enqueue_contract_expiry_notifications();
  SELECT data->>'days_until', body FROM piktag_notifications
   WHERE user_id='11111111-1111-1111-1111-111111111111' AND type='contract_expiry';
  -- expect: 1 row, days_until='30', body contains 'expires in 30 days'
  ```
- [ ] **Happy 2 — 7-day milestone**: same as Happy 1 with `current_date + 7` → `days_until='7'`.
- [ ] **Happy 3 — 1-day milestone**: same as Happy 1 with `current_date + 1` → `days_until='1'`.
- [ ] **Happy 4 — day-of (0)**: `current_date + 0` →
  ```sql
  -- expect body matches the 'expires today' string per spec §2.9
  SELECT body FROM piktag_notifications WHERE data->>'days_until' = '0';
  ```
- [ ] **Edge A — already-expired contract** (`current_date - 5`):
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, contract_expiry)
  VALUES (gen_random_uuid(),
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (current_date - 5));
  SELECT public.enqueue_contract_expiry_notifications();
  -- expect: 0 new rows for this connection (negative days do not match {30,7,1,0})
  ```
- [ ] **Edge B — `contract_expiry IS NULL`**:
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, contract_expiry)
  VALUES (gen_random_uuid(),
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          NULL);
  SELECT public.enqueue_contract_expiry_notifications();
  -- expect: 0 new rows; null rows are skipped by the WHERE clause
  ```
- [ ] **Edge C — `contract_expiry > 30 days away`** (e.g. +45):
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, contract_expiry)
  VALUES (gen_random_uuid(),
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (current_date + 45));
  SELECT public.enqueue_contract_expiry_notifications();
  -- expect: 0 new rows; 45 is not in {30,7,1,0}
  ```
- [ ] **Shape assertions** for each happy row:
  ```sql
  SELECT
    title = ''                                                    AS title_empty,
    is_read = false                                               AS unread,
    data ? 'connected_user_id'                                    AS has_connected_user_id,
    data ? 'connection_id'                                        AS has_connection_id,
    data ? 'username'                                             AS has_username,
    data ? 'avatar_url'                                           AS has_avatar_url,
    data ? 'contract_expiry'                                      AS has_contract_expiry,
    data ? 'days_until'                                           AS has_days_until
  FROM piktag_notifications WHERE type='contract_expiry';
  -- expect all booleans true
  ```
- [ ] Cleanup: `ROLLBACK;`

## 4. Dedup test (run helper twice → 0 new rows on the second run)

- [ ] Per spec §2.9 the dedup key is
  `(user_id, type='contract_expiry', data->>'connection_id', data->>'days_until')` and the lead-time window is **ever** (each milestone fires once per contract for all time). Verify no `created_at` time filter is present in the NOT EXISTS clause.
  ```sql
  BEGIN;
  -- seed Happy 1 rows from §3
  INSERT INTO piktag_connections (id, user_id, connected_user_id, contract_expiry)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (current_date + 7));

  SELECT public.enqueue_contract_expiry_notifications();
  SELECT count(*) AS first_run FROM piktag_notifications
   WHERE type='contract_expiry'
     AND data->>'connection_id' = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  -- expect: first_run = 1

  SELECT public.enqueue_contract_expiry_notifications();   -- second invocation, same day
  SELECT count(*) AS second_run FROM piktag_notifications
   WHERE type='contract_expiry'
     AND data->>'connection_id' = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  -- expect: second_run = 1 (NO new row inserted)
  ROLLBACK;
  ```
- [ ] Distinct milestones for the same connection do **not** dedup against each other:
  ```sql
  -- After a 7-day row exists, fast-forward simulation: change contract_expiry to
  -- current_date + 1 and rerun → a new row with days_until='1' must be inserted
  -- because the dedup key includes days_until.
  ```

## 5. Edge function auth gate test

Function path: `mobile/supabase/functions/notification-contract-expiry/index.ts`.

- [ ] No `Authorization` header → **403 Forbidden**:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-contract-expiry"
  # expect: HTTP/2 403, body: Forbidden
  ```
- [ ] Wrong bearer token → **403**:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-contract-expiry" \
       -H "Authorization: Bearer not-the-secret"
  # expect: 403
  ```
- [ ] Correct `CRON_SECRET` → **200** with `{ ok: true, inserted: <n> }`:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-contract-expiry" \
       -H "Authorization: Bearer $CRON_SECRET"
  # expect: 200, JSON body with ok:true and inserted >= 0
  ```
- [ ] CORS preflight OPTIONS → **200 'ok'** with CORS headers:
  ```bash
  curl -i -X OPTIONS "$SUPABASE_URL/functions/v1/notification-contract-expiry"
  # expect: 200, Access-Control-Allow-Origin: *
  ```
- [ ] Constant-time compare path: edit the secret to differ in length and confirm 403 (not a crash).

## 6. Push notification test

- [ ] Recipient with non-null `push_token` receives an Expo push:
  ```sql
  -- with seed from §3 (owner has push_token = 'ExponentPushToken[OWNER]')
  -- after enqueue_*_notifications + edge function run, inspect Expo receipts:
  -- POST https://exp.host/--/api/v2/push/send returned status 'ok' for ExponentPushToken[OWNER]
  ```
- [ ] Push payload shape matches §1.9:
  ```json
  {
    "to": "ExponentPushToken[OWNER]",
    "title": "Holder",
    "body":  "your contract with Holder expires in 7 days",
    "data":  { "type": "contract_expiry",
               "connected_user_id": "22222222-2222-2222-2222-222222222222",
               "connection_id":     "<uuid>",
               "days_until": 7 },
    "sound": "default",
    "priority": "high"
  }
  ```
- [ ] Recipient with `push_token IS NULL` is silently skipped (DB row still inserted, no push attempt logged as failure).
- [ ] Push fetch is wrapped in `.catch(() => {})` — simulate Expo 5xx and confirm the DB row still committed and the function still returns `200 ok`.
- [ ] On-device verification: tapping the push opens `NotificationsScreen` reminders tab (see §7).

## 7. Mobile UI test (reminders tab; tap → UserDetail/FriendDetail)

- [ ] Insert a `contract_expiry` row for a logged-in test user; pull-to-refresh `NotificationsScreen`:
  - [ ] Notification appears under the **Reminders** tab (not Social).
  - [ ] Avatar = `data.avatar_url`; primary text = `data.username`; secondary text = rendered `body` (e.g. "your contract with Holder expires in 7 days").
  - [ ] Unread dot is visible (`is_read=false`).
- [ ] Tap behavior — routing key resolution:
  - [ ] If `data.connected_user_id` matches an existing `piktag_connections` row for the viewer → navigate to **FriendDetail** (the contract holder's connection page).
  - [ ] Otherwise (no connection record) → navigate to **UserDetail** for `data.connected_user_id`.
  - [ ] After tap, the row flips to `is_read = true`.
- [ ] i18n parity:
  - [ ] `notifications.types.contract_expiry.title`, `.body`, `.bodyToday`, `.push.title`, `.push.body` exist in `en.json`, `zh-TW.json`, `zh-CN.json`.
  - [ ] Switching device language to zh-TW renders the localized body with `{{username}}` and `{{days_until}}` interpolated.
- [ ] `days_until=0` row uses the **`bodyToday`** copy ("expires today" / "今天到期"), not the days-remaining copy.
- [ ] Realtime: insert a row via SQL while the screen is open → it appears without manual refresh (postgres_changes filter on `user_id`).

## 8. Performance test

- [ ] Seed 100k `piktag_connections` rows with random `contract_expiry` dates spread across ±365 days; run helper:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT public.enqueue_contract_expiry_notifications();
  -- target: < 2s wall time on staging; index scan on contract_expiry, no Seq Scan over connections
  ```
- [ ] Verify the inner candidate-selection query uses an index for `contract_expiry IN (today+30, today+7, today+1, today)`:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT id FROM piktag_connections
   WHERE contract_expiry IN (current_date, current_date+1, current_date+7, current_date+30);
  -- expect: Index Scan or Bitmap Index Scan, not Seq Scan
  ```
- [ ] Dedup NOT EXISTS subquery uses an index on `piktag_notifications (user_id, type)` (or expression index over `data->>'connection_id'`); confirm no Seq Scan in plan even at 1M notifications.
- [ ] Edge function cold-start + execution under 10s for a 1k-candidate day (Supabase Functions logs).
- [ ] No N+1 push fan-out: the edge function batches/awaits push in `Promise.allSettled` chunks of ≤100, not one-at-a-time blocking.

## 9. Rollback plan

If the migration or edge function misbehaves in production:

- [ ] **Immediate kill switch** — disable the cron job (keeps the DB schema intact, stops new notifications):
  ```sql
  UPDATE cron.job SET active = false WHERE jobname = 'notification-contract-expiry-daily';
  ```
- [ ] **Disable the edge function** in the Supabase dashboard (Functions → notification-contract-expiry → Disable) so any stragglers cannot fire.
- [ ] **Purge any bad notifications already created** (only if confirmed wrong):
  ```sql
  DELETE FROM piktag_notifications
   WHERE type = 'contract_expiry'
     AND created_at >= '<incident_start_ts>';
  ```
- [ ] **Full rollback migration** (only if the helper itself is broken — file would land as `20260428z_*` is reserved, so use the next free suffix on a later date):
  ```sql
  SELECT cron.unschedule('notification-contract-expiry-daily');
  DROP FUNCTION IF EXISTS public.enqueue_contract_expiry_notifications();
  ```
  Notes:
  - Do **not** drop `piktag_connections.contract_expiry` — it is part of base schema and used independently of notifications.
  - Do **not** delete the edge function source; redeploying with the auth gate disabled would be worse than leaving it dormant. Disable in dashboard instead.
- [ ] **Verify rollback**:
  ```sql
  SELECT count(*) FROM cron.job  WHERE jobname='notification-contract-expiry-daily'; -- 0 (or active=false)
  SELECT count(*) FROM pg_proc   WHERE proname='enqueue_contract_expiry_notifications'; -- 0 if dropped
  ```
- [ ] Communicate: post in #eng-mobile with incident summary, affected user count (`SELECT count(DISTINCT user_id) FROM piktag_notifications WHERE type='contract_expiry' AND created_at >= '<ts>'`), and ETA for re-enable.
