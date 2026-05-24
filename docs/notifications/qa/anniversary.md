# QA Plan — `anniversary` (scheduled, reminders tab)

Migration: `20260428x_notification_anniversary.sql`
Edge function: `mobile/supabase/functions/notification-anniversary/index.ts`
Schedule: daily at 08:05 (UTC)
Spec source: `docs/notification-types-spec.md` §2.8

---

## 1. Schema verification

- [ ] Confirm `piktag_connections.anniversary` column exists and is `date` type.
  ```sql
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'piktag_connections'
     AND column_name  = 'anniversary';
  -- Expect: data_type=date, is_nullable=YES
  ```
- [ ] Confirm `piktag_connections.met_at` column exists and is `timestamptz`.
  ```sql
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name='piktag_connections' AND column_name='met_at';
  ```
- [ ] Confirm helper `public.enqueue_anniversary_notifications()` exists with `SECURITY DEFINER` and `search_path=public`.
  ```sql
  SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_anniversary_notifications';
  -- Expect prosecdef=true, proconfig contains search_path=public
  ```
- [ ] Confirm pg_cron job `notification-anniversary-daily` is scheduled at 08:05.
  ```sql
  SELECT jobid, schedule, command, active
    FROM cron.job
   WHERE jobname = 'notification-anniversary-daily';
  -- Expect: schedule='5 8 * * *', active=true
  ```
- [ ] Confirm pg_net extension exists (used to POST to edge function if helper proxies push).
  ```sql
  SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');
  ```

## 2. Helper function `enqueue_anniversary_notifications()` syntax + GRANTs

- [ ] Function is `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public`.
- [ ] EXECUTE granted only to `postgres, service_role`; revoked from `PUBLIC`.
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_name = 'enqueue_anniversary_notifications';
  -- Expect grantees: postgres, service_role only.
  ```
- [ ] Calling as service_role succeeds (smoke test):
  ```sql
  SET ROLE service_role;
  SELECT public.enqueue_anniversary_notifications();
  RESET ROLE;
  ```
- [ ] Calling as anon/authenticated denied:
  ```sql
  SET ROLE anon;
  SELECT public.enqueue_anniversary_notifications();  -- expect: permission denied
  RESET ROLE;
  ```

## 3. Functional tests (3+ happy, 2+ edge)

Setup helpers (re-used below):
```sql
-- Fixture users U1 (recipient), U2 (other side); fixture connection rows.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','u1@test'),
  ('22222222-2222-2222-2222-222222222222','u2@test')
  ON CONFLICT DO NOTHING;
INSERT INTO piktag_profiles (id, username, full_name, avatar_url) VALUES
  ('11111111-1111-1111-1111-111111111111','u1','U One','a1.png'),
  ('22222222-2222-2222-2222-222222222222','u2','U Two','a2.png')
  ON CONFLICT (id) DO NOTHING;
```

### Happy path 1 — exactly 1 year since `met_at`, today's MM-DD matches
- [ ] Insert connection met exactly 1 year ago today.
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, met_at)
  VALUES ('aaaa1111-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (now() - interval '1 year'));
  SELECT public.enqueue_anniversary_notifications();
  SELECT type, body, data->>'years' AS years, data->>'connection_id' AS conn
    FROM piktag_notifications
   WHERE user_id='11111111-1111-1111-1111-111111111111' AND type='anniversary';
  -- Expect: 1 row, years='1', body contains 'U Two'.
  ```

### Happy path 2 — 3 years anniversary, uses `anniversary` column override
- [ ] When `anniversary` column is set, helper prefers it over `met_at`.
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, met_at, anniversary)
  VALUES ('aaaa1111-0000-0000-0000-000000000002',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (now() - interval '5 years'),
          (current_date - interval '3 years')::date);
  SELECT public.enqueue_anniversary_notifications();
  SELECT data->>'years' FROM piktag_notifications
   WHERE data->>'connection_id'='aaaa1111-0000-0000-0000-000000000002';
  -- Expect: years='3' (NOT '5').
  ```

### Happy path 3 — body string interpolation correct
- [ ] Body matches `{{years}} years ago today, you met {{username}}`.
  ```sql
  SELECT body FROM piktag_notifications
   WHERE user_id='11111111-1111-1111-1111-111111111111' AND type='anniversary'
   ORDER BY created_at DESC LIMIT 1;
  -- Expect: '1 years ago today, you met U Two' (or pluralization-aware variant).
  ```

### Edge 1 — Coexistence with legacy `daily-followup-check` "On This Day"
- [ ] Run BOTH legacy followup AND new anniversary helper for the same connection. Both rows must persist (intentional duplicate per spec §2.8).
  ```sql
  -- Pre-condition: connection met 2 years ago today.
  INSERT INTO piktag_connections (id, user_id, connected_user_id, met_at)
  VALUES ('aaaa1111-0000-0000-0000-000000000003',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          (now() - interval '2 years'));

  -- Invoke legacy "On This Day" path (simulate daily-followup-check insert).
  INSERT INTO piktag_notifications (user_id, type, title, body, data)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'reminder',
          'On This Day',
          'You met U Two 2 years ago today',
          jsonb_build_object('connection_id','aaaa1111-0000-0000-0000-000000000003'));

  -- Now invoke new helper.
  SELECT public.enqueue_anniversary_notifications();

  SELECT type, COUNT(*) FROM piktag_notifications
   WHERE user_id='11111111-1111-1111-1111-111111111111'
     AND data->>'connection_id'='aaaa1111-0000-0000-0000-000000000003'
   GROUP BY type;
  -- Expect TWO rows: type='reminder' (1), type='anniversary' (1).
  -- Critical: the new dedup-SELECT scopes to type='anniversary' ONLY,
  -- so it MUST NOT see the legacy 'reminder' row and skip.
  ```

### Edge 2 — Same MM-DD but years=0 (today is met_at) → must NOT fire
- [ ] Per spec, `years >= 1` required. Same-day connection skipped.
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, met_at)
  VALUES ('aaaa1111-0000-0000-0000-000000000004',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222', now());
  SELECT public.enqueue_anniversary_notifications();
  SELECT COUNT(*) FROM piktag_notifications
   WHERE data->>'connection_id'='aaaa1111-0000-0000-0000-000000000004'
     AND type='anniversary';
  -- Expect: 0.
  ```

### Edge 3 — Feb 29 leap-year met_at viewed on non-leap year
- [ ] Document expected behavior (skip on Feb 28 / Mar 1, fire only on next Feb 29). Verify helper uses `EXTRACT(MONTH/DAY)` exact match, not Feb 28 fallback.
  ```sql
  INSERT INTO piktag_connections (id, user_id, connected_user_id, met_at)
  VALUES ('aaaa1111-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111',
          '22222222-2222-2222-2222-222222222222',
          '2024-02-29 00:00:00+00');
  -- On 2026-02-28 / 2026-03-01 the helper must NOT fire.
  ```

## 4. Dedup test

- [ ] Re-running the helper twice on the same day for the same `(connection_id, years)` pair inserts ONE row only (dedup window = forever per spec §2.8).
  ```sql
  SELECT public.enqueue_anniversary_notifications();
  SELECT public.enqueue_anniversary_notifications();
  SELECT COUNT(*) FROM piktag_notifications
   WHERE type='anniversary'
     AND data->>'connection_id'='aaaa1111-0000-0000-0000-000000000001'
     AND data->>'years'='1';
  -- Expect: 1.
  ```
- [ ] Year-2 anniversary (next year) inserts a NEW row even though year-1 row exists.
  ```sql
  -- Simulate by manually inserting a year=1 anniversary, then advance time.
  -- Helper invoked next year for same connection must succeed (different years key).
  ```

## 5. Edge function auth gate test

- [ ] POST without Authorization header → 403.
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-anniversary"
  # Expect HTTP/1.1 403 Forbidden
  ```
- [ ] POST with wrong bearer → 403.
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-anniversary" \
       -H "Authorization: Bearer wrong-secret"
  # Expect 403
  ```
- [ ] POST with correct `CRON_SECRET` → 200, JSON `{ ok: true, inserted: <n> }`.
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-anniversary" \
       -H "Authorization: Bearer $CRON_SECRET"
  ```
- [ ] OPTIONS preflight → 200 with CORS headers.

## 6. Push notification test

- [ ] Recipient with non-null `push_token` receives Expo push within 30s of helper run.
  ```sql
  UPDATE piktag_profiles SET push_token='ExponentPushToken[TEST_TOKEN]'
   WHERE id='11111111-1111-1111-1111-111111111111';
  SELECT public.enqueue_anniversary_notifications();
  -- Verify Expo push log / device receipt.
  ```
- [ ] Push payload `data.type === 'anniversary'`, `data.connection_id`, `data.connected_user_id` set.
- [ ] Recipient with null `push_token` → notification row inserted, no push sent, no error logged.
- [ ] Expo push API failure (mock 500) → notification row still persists; push call swallows error (`.catch(() => {})`).

## 7. Mobile UI test (reminders tab)

- [ ] Open `NotificationsScreen` → switch to **reminders** tab → new `anniversary` notification appears.
- [ ] Row renders `data.username` (other side's display name) and `data.avatar_url`.
- [ ] Body text shows `{{years}} years ago today, you met {{username}}` with i18n interpolation (en + zh-TW).
- [ ] Tap row → navigates to connection profile via `data.connected_user_id`.
- [ ] Both legacy `reminder` "On This Day" row AND new `anniversary` row visible in the same list (intentional — see §10).
- [ ] Mark-as-read toggles `is_read=true` only for the tapped row.
- [ ] Realtime: insert via SQL → row appears in UI within 2s without refresh.

## 8. Performance test

- [ ] Seed 10,000 connections where 100 have today's anniversary date.
  ```sql
  INSERT INTO piktag_connections (user_id, connected_user_id, met_at)
  SELECT '11111111-1111-1111-1111-111111111111',
         gen_random_uuid(),
         (current_date - (1 + (random()*5)::int) * interval '1 year')
                          - (random()*364)::int * interval '1 day'
    FROM generate_series(1,10000);
  ```
- [ ] `EXPLAIN ANALYZE SELECT public.enqueue_anniversary_notifications();` completes < 2s.
- [ ] Query plan uses index on `piktag_connections (user_id)` and avoids full scan of `piktag_notifications` (consider partial index on `(user_id, type)` if scan time > 200ms).
- [ ] Helper is idempotent under concurrent invocation (two parallel calls → still 100 rows, no duplicates, no deadlock).

## 9. Rollback plan

- [ ] Disable cron job:
  ```sql
  SELECT cron.unschedule('notification-anniversary-daily');
  ```
- [ ] Drop helper function:
  ```sql
  DROP FUNCTION IF EXISTS public.enqueue_anniversary_notifications();
  ```
- [ ] Remove generated rows (preserve legacy `reminder` rows):
  ```sql
  DELETE FROM piktag_notifications WHERE type='anniversary';
  ```
- [ ] Disable edge function in Supabase dashboard (or `supabase functions delete notification-anniversary`).
- [ ] Mobile fallback: legacy `daily-followup-check` "On This Day" continues to deliver anniversary-equivalent reminders, so user-facing functionality is preserved.
- [ ] Migration `20260428x_notification_anniversary.sql` is additive only (no schema mutations to existing tables) — no down-migration needed beyond the steps above.

## 10. Coexistence note (legacy `reminder` "On This Day" + new `anniversary`)

Per spec §2.8, the legacy edge function `mobile/supabase/functions/daily-followup-check/index.ts` already emits an "On This Day" reminder under `type='reminder'` for the same connection-anniversary semantic. The Coordinator decision is to **leave the legacy path running** and ship the new `anniversary` type alongside it.

**Why dedup does NOT collapse them:**
- Legacy rows have `type='reminder'` and use the upsert key `(user_id, type, title)` with `title='On This Day'`.
- New rows have `type='anniversary'` and use the dedup-SELECT pattern scoped to `type='anniversary'` only.
- The two dedup checks never see each other's rows, so both fire on the same calendar day for the same connection.

**User-visible impact (intentional):**
- On the anniversary date, the recipient sees **two distinct notifications** in the reminders tab:
  1. Legacy: title=`On This Day`, body=`You met {name} {N} years ago today` (type=`reminder`).
  2. New: title=``, body=`{N} years ago today, you met {name}` (type=`anniversary`).
- They render as separate rows with separate avatars, separate timestamps (legacy fires at the `daily-followup-check` cron time; new fires at 08:05).
- Two push notifications may arrive (if push is enabled on both) — accepted noise during the transition window.
- A future cleanup migration (out of scope for this slice) will retire the legacy `reminder` "On This Day" path once `anniversary` is verified in production.

**Verification matrix:**

| Scenario                                  | Legacy `reminder` row | New `anniversary` row |
|-------------------------------------------|-----------------------|-----------------------|
| Connection met exactly 1 year ago today   | inserted              | inserted              |
| Re-run helper same day                    | upsert (no-op)        | dedup skip (no-op)    |
| `daily-followup-check` disabled           | not inserted          | inserted              |
| New `anniversary` helper disabled         | inserted              | not inserted          |
| Both disabled                             | not inserted          | not inserted          |

- [ ] All four matrix rows verified in staging before promoting to production.
