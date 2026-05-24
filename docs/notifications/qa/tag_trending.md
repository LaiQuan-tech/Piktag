# QA Checklist — `tag_trending` notification

Type: `tag_trending` · Tab: social · Model: scheduled (daily cron → edge fn)
Migration: `20260428u_notification_tag_trending.sql`
Edge function: `mobile/supabase/functions/notification-tag-trending/index.ts`
Spec: `docs/notification-types-spec.md` §2.5

---

## 1. Schema verification (helper + `piktag_tag_snapshots` + pg_cron)

- [ ] Confirm migration `20260428u_notification_tag_trending.sql` exists in `mobile/supabase/migrations/` and lands AFTER `20260428p_search_init_rpc.sql` lexicographically.
  ```sql
  SELECT version, name FROM supabase_migrations.schema_migrations
   WHERE name LIKE '%tag_trending%' ORDER BY version;
  ```
- [ ] Verify `piktag_tag_snapshots` table exists with required shape (per spec §10 / line 866):
  ```sql
  SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'piktag_tag_snapshots'
   ORDER BY ordinal_position;
  -- Expect: id (uuid), tag_id (uuid NOT NULL), usage_count (integer NOT NULL),
  --         snapshot_date (date NOT NULL), created_at (timestamptz)
  ```
- [ ] Confirm `UNIQUE (tag_id, snapshot_date)` constraint:
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid = 'public.piktag_tag_snapshots'::regclass
     AND contype = 'u';
  ```
- [ ] Confirm FK `tag_id → piktag_tags(id) ON DELETE CASCADE`:
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid = 'public.piktag_tag_snapshots'::regclass
     AND contype = 'f';
  ```
- [ ] Verify supporting indexes (e.g. `idx_tag_snapshots_tag_date (tag_id, snapshot_date DESC)`):
  ```sql
  SELECT indexname, indexdef FROM pg_indexes
   WHERE tablename = 'piktag_tag_snapshots';
  ```
- [ ] Verify RLS on `piktag_tag_snapshots` (no `authenticated` writes; service_role only):
  ```sql
  SELECT relrowsecurity FROM pg_class WHERE relname = 'piktag_tag_snapshots';
  SELECT polname, polroles::regrole[], polcmd FROM pg_policy
   WHERE polrelid = 'public.piktag_tag_snapshots'::regclass;
  ```
- [ ] Verify `piktag_notifications` accepts `type='tag_trending'` (no CHECK constraint blocks it):
  ```sql
  INSERT INTO piktag_notifications (user_id, type, title, body, data)
  VALUES ('<uuid>', 'tag_trending', '', 'test', '{"tag_id":"x"}'::jsonb)
  RETURNING id;  -- then DELETE
  ```
- [ ] Confirm pg_cron extension is installed and a daily schedule is registered:
  ```sql
  SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
  SELECT jobid, schedule, command, active FROM cron.job
   WHERE command ILIKE '%tag_trending%' OR command ILIKE '%enqueue_tag_trending%';
  -- Expect: 1 row, schedule e.g. '5 0 * * *' (daily ~midnight), active=true
  ```
- [ ] Confirm cron job invokes either the helper OR the edge function (not both):
  ```sql
  SELECT command FROM cron.job WHERE jobname ILIKE '%tag_trending%';
  ```

## 2. Helper function `enqueue_tag_trending_notifications()` syntax + GRANTs

- [ ] Function exists with `SECURITY DEFINER` and stable owner:
  ```sql
  SELECT proname, prosecdef, proowner::regrole, pg_get_function_identity_arguments(oid)
    FROM pg_proc
   WHERE proname = 'enqueue_tag_trending_notifications';
  -- Expect: prosecdef = true
  ```
- [ ] Function body parses cleanly (re-run migration in a clean DB or `\sf`):
  ```sql
  \sf public.enqueue_tag_trending_notifications
  ```
- [ ] EXECUTE grant audit (must NOT be granted to `anon` or `authenticated`):
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
   WHERE routine_name = 'enqueue_tag_trending_notifications';
  -- Expect: postgres / service_role only.
  ```
- [ ] `REVOKE EXECUTE ... FROM PUBLIC` is present in the migration:
  ```sql
  -- Inspect migration source for: REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;
  ```
- [ ] Smoke-call the helper as `service_role`; expect zero errors and an integer return (or void) without side-effects on an empty snapshot table:
  ```sql
  SET ROLE service_role;
  SELECT public.enqueue_tag_trending_notifications();
  RESET ROLE;
  ```
- [ ] `search_path` is pinned (`SET search_path = public, pg_temp`) to prevent hijack:
  ```sql
  SELECT proconfig FROM pg_proc
   WHERE proname = 'enqueue_tag_trending_notifications';
  ```

## 3. Functional tests — happy + edge

### Happy paths
- [ ] **H1 — single trending tag, single owner.** Seed a tag with 7-day rolling avg = 10 and today usage_count = 60 (growth = 6.0). One user owns it.
  ```sql
  -- seed: ensure 7 prior daily snapshots avg=10 and one today=60 in piktag_tag_snapshots
  INSERT INTO piktag_tags (id, name, usage_count) VALUES ('<tag1>', 'gym', 60)
    ON CONFLICT (id) DO UPDATE SET usage_count = 60;
  INSERT INTO piktag_tag_snapshots (tag_id, usage_count, snapshot_date)
  SELECT '<tag1>', 10, (CURRENT_DATE - g) FROM generate_series(1,7) g;
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('<u1>', '<tag1>');
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<u1>' AND type='tag_trending'
     AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '5 minutes';
  -- Expect: 1
  ```
- [ ] **H2 — multiple owners of the same trending tag** (3 users own `<tag1>`):
  ```sql
  INSERT INTO piktag_user_tags (user_id, tag_id)
  VALUES ('<u1>','<tag1>'),('<u2>','<tag1>'),('<u3>','<tag1>');
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE type='tag_trending' AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '5 minutes';
  -- Expect: 3
  ```
- [ ] **H3 — payload shape matches spec**:
  ```sql
  SELECT data ? 'tag_id', data ? 'tag_name', data ? 'usage_count',
         data ? 'growth_factor', data ? 'rank',
         (data->>'usage_count')::int, (data->>'growth_factor')::numeric,
         (data->>'rank')::int, title, body
    FROM piktag_notifications
   WHERE type='tag_trending' AND user_id='<u1>'
   ORDER BY created_at DESC LIMIT 1;
  -- Expect: all 5 keys = true; title='' ; body contains '#gym'
  ```
- [ ] **H4 — top-N ranking is stable.** Seed 3 trending tags with growth factors 8.0, 6.5, 5.2; assert `rank` 1,2,3 in output rows.

### Edge cases
- [ ] **E1 — no trending tag → no rows inserted.** Seed flat usage (today=11, prior avg=10, growth=1.1, below 5×):
  ```sql
  -- truncate today's notifications first
  DELETE FROM piktag_notifications WHERE type='tag_trending' AND created_at > CURRENT_DATE;
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE type='tag_trending' AND created_at > CURRENT_DATE;
  -- Expect: 0
  ```
- [ ] **E2 — tag trending but only some users own it.** Seed `<u1>` owns `<tag1>` (trending), `<u2>` owns `<tagX>` (not trending). Only `<u1>` receives:
  ```sql
  SELECT user_id FROM piktag_notifications
   WHERE type='tag_trending' AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '5 minutes';
  -- Expect: only '<u1>' ; '<u2>' absent
  ```
- [ ] **E3 — user owning multiple trending tags** receives 1 notification per tag (push gated separately, see §6); confirm no UNIQUE-collision panic.
- [ ] **E4 — tag with <7 days of snapshots** (cold start). Helper must treat insufficient history as "not trending" (no division-by-zero, no false positive):
  ```sql
  DELETE FROM piktag_tag_snapshots WHERE tag_id='<tag1>';
  INSERT INTO piktag_tag_snapshots (tag_id, usage_count, snapshot_date)
  VALUES ('<tag1>', 5, CURRENT_DATE - 1);  -- only 1 day of history
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE type='tag_trending' AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '5 minutes';
  -- Expect: 0
  ```
- [ ] **E5 — tag deleted between snapshot and enqueue.** Delete `<tag1>`; helper completes without error and emits no rows for it.

## 4. Dedup test (7-day window per spec §2.5)

- [ ] **D1 — same tag trending two consecutive days → only 1 notification per recipient per 7-day window**:
  ```sql
  -- Day 1
  SELECT public.enqueue_tag_trending_notifications();
  -- Simulate Day 2 by re-seeding snapshots so the same tag is still trending
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<u1>' AND type='tag_trending'
     AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '7 days';
  -- Expect: 1
  ```
- [ ] **D2 — after 7 days a second notification is allowed**:
  ```sql
  UPDATE piktag_notifications
     SET created_at = now() - interval '8 days'
   WHERE user_id='<u1>' AND type='tag_trending' AND data->>'tag_id'='<tag1>';
  SELECT public.enqueue_tag_trending_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='<u1>' AND type='tag_trending'
     AND data->>'tag_id'='<tag1>'
     AND created_at > now() - interval '5 minutes';
  -- Expect: 1 (the new row)
  ```
- [ ] **D3 — dedup is per-tag**, not global: a user gets a row for `<tag1>` and a separate row for `<tag2>` on the same run.

## 5. Edge function auth gate test

- [ ] Anonymous (no header) call returns 401:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-tag-trending"
  # Expect: HTTP/1.1 401
  ```
- [ ] `authenticated` user JWT (anon-tier) returns 401/403:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-tag-trending" \
    -H "Authorization: Bearer $USER_JWT"
  # Expect: 401 or 403
  ```
- [ ] `service_role` key succeeds with 200 and JSON `{ inserted: <int> }`:
  ```bash
  curl -i -X POST "$SUPABASE_URL/functions/v1/notification-tag-trending" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  # Expect: 200
  ```
- [ ] Wrong HTTP method (GET) returns 405.
- [ ] Function logs do not leak service_role key or PII (`supabase functions logs notification-tag-trending`).
- [ ] CORS: function does not echo `Access-Control-Allow-Origin: *` for service-only endpoint.

## 6. Push notification test

- [ ] **Rank=1 only push rule (spec §2.5):** when a user owns multiple trending tags, only the rank-1 tag triggers an Expo push.
  ```sql
  -- Seed user '<u1>' owning <tag1> rank=1 and <tag2> rank=2
  -- Run helper, then inspect a push log table or capture via Expo receipts
  ```
- [ ] Expo push payload uses i18n keys `notifications.types.tag_trending.push.title` / `.push.body`, with `{{tag_name}}` interpolated correctly (en + zh-TW).
- [ ] User with `piktag_profiles.push_token IS NULL` receives an in-app row but no push send is attempted (no error in logs).
- [ ] Push deep link payload includes `{ type: 'tag_trending', tag_id, tag_name }` so the app routes to TagDetail on tap.
- [ ] Failed Expo push (invalid token / DeviceNotRegistered) does NOT roll back the in-app `piktag_notifications` insert.

## 7. Mobile UI test (social tab → TagDetail)

- [ ] Notification appears in the **social** tab of `NotificationsScreen` (filter by `type='tag_trending'`).
- [ ] Row renders `body` text "your tag #{{tag_name}} is trending today" (en) and the zh-TW string when device locale is zh-TW.
- [ ] Tapping the row navigates to `TagDetail` with route params `{ tagId: data.tag_id, tagName: data.tag_name }`. Verify via Detox/Maestro:
  ```
  navigation.navigate('TagDetail', { tagId, tagName })
  ```
- [ ] Realtime: with the screen open, inserting a new `tag_trending` row in DB causes the row to appear without pull-to-refresh (postgres_changes filtered on `user_id`).
- [ ] `is_read` flips to `true` after tap; badge count decrements.
- [ ] Missing `data.tag_id` (corrupted row) does NOT crash; row is rendered but tap is a no-op or shows toast.
- [ ] zh-TW locale formatting: tag name with non-ASCII chars renders correctly (no mojibake).

## 8. Performance test

- [ ] Helper finishes in <5s for 100k tags × 10k owners on staging:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS)
    SELECT public.enqueue_tag_trending_notifications();
  ```
- [ ] No seq-scan on `piktag_tag_snapshots` for the 7-day window query — confirm `idx_tag_snapshots_tag_date` is used.
- [ ] Dedup lookup uses an index on `piktag_notifications (user_id, type, (data->>'tag_id'))` (or equivalent partial). If absent, raise as blocker.
- [ ] Notification fan-out uses batched `INSERT ... SELECT` (single statement) rather than row-by-row insert. Verify in helper source.
- [ ] Cron run does not hold long locks on `piktag_notifications` (>1s blocking) — check `pg_stat_activity` during execution on staging.
- [ ] Edge function cold-start + execution under 30s (Supabase function timeout default 60s).

## 9. Rollback plan

- [ ] **Trigger / immediate disable** (no migration revert needed):
  ```sql
  UPDATE cron.job SET active = false WHERE jobname ILIKE '%tag_trending%';
  ```
- [ ] **Edge function disable**: `supabase functions delete notification-tag-trending` (or unset its secret to force 401s).
- [ ] **Drop helper** if buggy (keeps snapshots table intact for retry):
  ```sql
  DROP FUNCTION IF EXISTS public.enqueue_tag_trending_notifications();
  ```
- [ ] **Full migration revert SQL** (run as `postgres`):
  ```sql
  BEGIN;
  DELETE FROM cron.job WHERE jobname ILIKE '%tag_trending%';
  DROP FUNCTION IF EXISTS public.enqueue_tag_trending_notifications();
  -- Only drop snapshots table if it was created in THIS migration AND no
  -- other feature reads it (verify with: \d+ piktag_tag_snapshots)
  -- DROP TABLE IF EXISTS public.piktag_tag_snapshots;
  DELETE FROM supabase_migrations.schema_migrations
   WHERE name = '20260428u_notification_tag_trending';
  COMMIT;
  ```
- [ ] **Data cleanup** of already-sent notifications (optional — usually keep for history):
  ```sql
  DELETE FROM piktag_notifications
   WHERE type = 'tag_trending'
     AND created_at > '2026-04-28 00:00:00+00';
  ```
- [ ] Verify mobile client tolerates an unknown/legacy `tag_trending` row if rolled back partially (no crash on render).
- [ ] Post-rollback sanity:
  ```sql
  SELECT count(*) FROM cron.job WHERE jobname ILIKE '%tag_trending%';      -- 0
  SELECT count(*) FROM pg_proc WHERE proname='enqueue_tag_trending_notifications'; -- 0
  ```
- [ ] Document the rollback in the incident channel and re-open the migration ticket.
