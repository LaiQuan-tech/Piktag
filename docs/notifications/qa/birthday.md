# QA Checklist — `birthday` notification (scheduled)

Spec ref: `docs/notification-types-spec.md` § 2.7
Migration: `20260428w_notification_birthday.sql`
Edge function: `mobile/supabase/functions/notification-birthday/index.ts`
Cron run time: daily 08:00

---

## 1. Schema verification

- [ ] `piktag_connections.birthday` column exists with type `date`
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM   information_schema.columns
  WHERE  table_schema = 'public'
    AND  table_name   = 'piktag_connections'
    AND  column_name  = 'birthday';
  -- expect: birthday | date | YES
  ```
- [ ] `piktag_profiles.birthday` column exists (fallback source)
  ```sql
  SELECT column_name, data_type
  FROM   information_schema.columns
  WHERE  table_schema='public' AND table_name='piktag_profiles' AND column_name='birthday';
  ```
- [ ] Helper function `public.enqueue_birthday_notifications()` is registered
  ```sql
  SELECT proname, pg_get_function_result(oid) AS returns
  FROM   pg_proc
  WHERE  pronamespace = 'public'::regnamespace
    AND  proname      = 'enqueue_birthday_notifications';
  -- expect: 1 row, returns void
  ```
- [ ] `pg_cron` job registered for 08:00 UTC daily
  ```sql
  SELECT jobid, schedule, command, active
  FROM   cron.job
  WHERE  command ILIKE '%enqueue_birthday_notifications%';
  -- expect: schedule '0 8 * * *', active=true
  ```
- [ ] Index supports the (month, day) lookup on `piktag_connections.birthday`
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='piktag_connections' AND indexdef ILIKE '%birthday%';
  ```

## 2. Helper function `enqueue_birthday_notifications()` — syntax + GRANTs

- [ ] Function body parses cleanly (re-run migration in a scratch DB / `EXPLAIN`)
  ```sql
  EXPLAIN SELECT public.enqueue_birthday_notifications();
  ```
- [ ] Function is `SECURITY DEFINER` and owned by `postgres` (or service role)
  ```sql
  SELECT proname, prosecdef, pg_get_userbyid(proowner) AS owner
  FROM   pg_proc
  WHERE  proname='enqueue_birthday_notifications' AND pronamespace='public'::regnamespace;
  -- expect: prosecdef=t, owner=postgres
  ```
- [ ] EXECUTE granted to `service_role`; revoked from `anon` and `authenticated`
  ```sql
  SELECT grantee, privilege_type
  FROM   information_schema.routine_privileges
  WHERE  routine_schema='public' AND routine_name='enqueue_birthday_notifications';
  -- expect: service_role=EXECUTE; no anon/authenticated rows
  ```
- [ ] `search_path` is pinned (`SET search_path = public, pg_temp`) inside the function definition
  ```sql
  SELECT pg_get_functiondef('public.enqueue_birthday_notifications'::regproc);
  ```

## 3. Functional tests

### Happy paths

- [ ] **H1 — connection-level birthday matches today (MM-DD)**
  ```sql
  -- Seed
  INSERT INTO piktag_connections (id, user_id, connected_user_id, birthday)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          (to_char(now() AT TIME ZONE 'UTC','YYYY') || '-' ||
           to_char(now() AT TIME ZONE 'UTC','MM-DD'))::date);
  -- Run
  SELECT public.enqueue_birthday_notifications();
  -- Assert
  SELECT count(*) FROM piktag_notifications
  WHERE  type='birthday'
    AND  user_id='00000000-0000-0000-0000-000000000001'
    AND  data->>'connected_user_id'='00000000-0000-0000-0000-000000000002'
    AND  created_at::date = (now() AT TIME ZONE 'UTC')::date;
  -- expect: 1
  ```
- [ ] **H2 — fallback to `piktag_profiles.birthday` when `piktag_connections.birthday IS NULL`**
  ```sql
  UPDATE piktag_profiles SET birthday = (now()::date)
   WHERE id='00000000-0000-0000-0000-000000000003';
  INSERT INTO piktag_connections (id, user_id, connected_user_id, birthday)
  VALUES ('22222222-2222-2222-2222-222222222222',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000003',
          NULL);
  SELECT public.enqueue_birthday_notifications();
  SELECT data->>'birthday', data->>'username'
  FROM   piktag_notifications
  WHERE  type='birthday' AND data->>'connected_user_id'='00000000-0000-0000-0000-000000000003';
  -- expect: birthday=today's MM-DD, username populated
  ```
- [ ] **H3 — `data` JSONB shape conforms to spec (connected_user_id, connection_id, username, avatar_url, birthday MM-DD, age int|null)**
  ```sql
  SELECT jsonb_object_keys(data) FROM piktag_notifications
  WHERE  type='birthday' ORDER BY 1;
  -- expect keys: age, avatar_url, birthday, connected_user_id, connection_id, username
  ```
- [ ] **H4 — body i18n key resolves (`notifications.types.birthday.body`) with `username` interpolated** — verify in mobile UI render.
- [ ] **H5 — `age` is computed when birth year is known and NULL otherwise**
  ```sql
  -- year-known case
  SELECT data->>'age' FROM piktag_notifications WHERE id='<H1 id>';     -- expect numeric
  -- year-unknown case (set birthday year to 0001 sentinel or leave year null in profile)
  SELECT data->>'age' FROM piktag_notifications WHERE id='<no-year id>';-- expect null
  ```

### Edge cases

- [ ] **E1 — Feb-29 birthday on a non-leap year** notifies on Feb-28 OR Mar-1 (per implementation choice, must be deterministic and documented; verify exactly one notification fires per non-leap year).
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, birthday)
  VALUES ('33333333-3333-3333-3333-333333333333',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000004',
          DATE '2000-02-29');
  -- Simulate non-leap year run: SET LOCAL TIMEZONE='UTC'; pretend today=2027-02-28 then 2027-03-01
  -- expect: exactly one notification fires across the two adjacent dates
  ```
- [ ] **E2 — user with no birthday set** (connection.birthday NULL AND profile.birthday NULL) → 0 notifications
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, birthday)
  VALUES ('44444444-4444-4444-4444-444444444444',
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000005', NULL);
  UPDATE piktag_profiles SET birthday=NULL WHERE id='00000000-0000-0000-0000-000000000005';
  SELECT public.enqueue_birthday_notifications();
  SELECT count(*) FROM piktag_notifications
  WHERE  data->>'connected_user_id'='00000000-0000-0000-0000-000000000005';
  -- expect: 0
  ```
- [ ] **E3 — timezone / DST edge** — connection in US/Eastern with birthday today; cron runs at 08:00 UTC (= 03:00/04:00 EST/EDT). Verify that "today" is computed in a single canonical timezone (UTC) and does not double-fire on DST transition days (Mar 8, Nov 1 in 2026).
  ```sql
  -- Force two consecutive runs straddling DST boundary; assert second run inserts 0 rows
  ```
- [ ] **E4 — self-connection (`user_id = connected_user_id`)** → no self-notification
  ```sql
  SELECT count(*) FROM piktag_notifications
  WHERE  type='birthday' AND user_id::text = data->>'connected_user_id';
  -- expect: 0
  ```
- [ ] **E5 — soft-deleted / blocked connection** → no notification (verify whatever flag the schema uses, e.g. `deleted_at IS NULL`, `status='active'`).

## 4. Dedup test (300d window, idempotent re-run)

- [ ] Run helper twice on the same calendar day → second run inserts 0 new rows
  ```sql
  SELECT public.enqueue_birthday_notifications();
  SELECT count(*) AS first_run FROM piktag_notifications WHERE type='birthday';
  SELECT public.enqueue_birthday_notifications();
  SELECT count(*) AS second_run FROM piktag_notifications WHERE type='birthday';
  -- expect: first_run == second_run
  ```
- [ ] Dedup key is `(user_id, type='birthday', data->>'connected_user_id')` within 300 days
  ```sql
  SELECT user_id, data->>'connected_user_id' AS cuid, count(*)
  FROM   piktag_notifications
  WHERE  type='birthday' AND created_at > now() - interval '300 days'
  GROUP  BY 1,2 HAVING count(*) > 1;
  -- expect: 0 rows
  ```
- [ ] After 301 days a fresh notification is allowed
  ```sql
  -- Backdate an existing row and re-run
  UPDATE piktag_notifications SET created_at = now() - interval '301 days'
   WHERE id='<row id>';
  SELECT public.enqueue_birthday_notifications();
  -- expect: a new row for the same (user, connected_user) appears
  ```

## 5. Edge function auth gate

- [ ] Anonymous request → `401 Unauthorized`
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-birthday"
  # expect: HTTP/1.1 401
  ```
- [ ] `anon` JWT → `401/403`
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-birthday" \
       -H "Authorization: Bearer $SUPABASE_ANON_KEY"
  # expect: HTTP/1.1 401 or 403
  ```
- [ ] `service_role` key (or signed cron-internal header) → `200 OK` and helper executes
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-birthday" \
       -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  # expect: HTTP/1.1 200
  ```
- [ ] CORS origin is restricted (no `*`) and OPTIONS preflight returns expected allowed origins.

## 6. Push notification

- [ ] Push payload uses i18n keys `notifications.types.birthday.push.{title,body}` with `username` interpolated.
- [ ] Title is empty string per spec; body reads `it's {{username}}'s birthday today` (en) / `今天是 {{username}} 的生日` (zh-TW).
- [ ] Each recipient with a registered device token receives exactly one push per fire.
- [ ] Tapping the push deep-links to the reminders tab and opens the birthday person's profile (UserDetail or FriendDetail by `connected_user_id`).
- [ ] Recipients with push disabled in `piktag_user_settings` get the in-app notification but no push.
- [ ] FCM/APNs failure does not block the in-app row insert (verified via mocked transport returning 5xx).

## 7. Mobile UI

- [ ] Notification appears under the **Reminders** tab (not Activity).
- [ ] Row renders `avatar_url` + body string; title is hidden when empty.
- [ ] Tapping row navigates to `UserDetail` if `connected_user_id` is a piktag user, else `FriendDetail`.
- [ ] Unread badge increments on insert and clears on tap.
- [ ] Pull-to-refresh re-fetches without duplicating the row.
- [ ] Locale switch (en ↔ zh-TW) re-renders body correctly.
- [ ] Accessibility: avatar has alt text; row is reachable via VoiceOver / TalkBack with full sentence.

## 8. Performance (10k connections with birthday today)

- [ ] Seed 10,000 connections whose birthday MM-DD matches today across ~1,000 distinct `user_id`s.
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, birthday)
  SELECT gen_random_uuid(),
         ('00000000-0000-0000-0000-' || lpad((g % 1000)::text,12,'0'))::uuid,
         gen_random_uuid(),
         (to_char(now(),'YYYY-MM-DD'))::date
  FROM   generate_series(1,10000) g;
  ```
- [ ] `enqueue_birthday_notifications()` completes in **< 5s** on staging hardware
  ```sql
  \timing on
  SELECT public.enqueue_birthday_notifications();
  ```
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` shows index scan (not seq scan) on `piktag_connections.birthday` MM-DD predicate.
- [ ] Memory + WAL footprint acceptable: insert batch fits one statement; no long-held locks (`pg_locks` clean after).
- [ ] Subsequent same-day run completes in **< 500 ms** (dedup short-circuit).
- [ ] Edge function cold-start + execution **< 10s** end-to-end.

## 9. Rollback plan

- [ ] **Detection** — alert fires on >1% error rate from `notification-birthday` or anomalous insert volume in `piktag_notifications` where `type='birthday'`.
- [ ] **Step 1 — disable cron** (stops the bleed without touching data)
  ```sql
  UPDATE cron.job SET active=false
  WHERE  command ILIKE '%enqueue_birthday_notifications%';
  ```
- [ ] **Step 2 — disable edge function** in Supabase dashboard (or `supabase functions delete notification-birthday`).
- [ ] **Step 3 — purge bad rows** if a buggy run already inserted notifications today
  ```sql
  DELETE FROM piktag_notifications
  WHERE  type='birthday'
    AND  created_at >= (now() AT TIME ZONE 'UTC')::date;
  ```
- [ ] **Step 4 — revert migration** by running the down-migration:
  ```sql
  DROP FUNCTION IF EXISTS public.enqueue_birthday_notifications();
  -- cron.job row removed in step 1
  -- piktag_connections.birthday column is shared with anniversary/etc; do NOT drop blindly
  ```
- [ ] **Step 5 — redeploy previous edge function tag** (`supabase functions deploy notification-birthday --version <prev>`).
- [ ] **Step 6 — verification** — confirm no new rows for `type='birthday'` in the last hour and cron job is `active=false`.
- [ ] **Step 7 — comms** — post incident note in #eng-mobile; reminders tab will show stale data only until next deploy.
- [ ] **Re-enable** — only after fix lands, staging green on this checklist, and a dry-run on prod against a single seeded test user.
