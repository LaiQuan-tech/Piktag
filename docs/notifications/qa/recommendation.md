# QA Plan — `recommendation` (scheduled)

Migration: `20260428t_notification_recommendation.sql`
Helper: `public.enqueue_recommendation_notifications()`
Edge function: `notification-recommendation`
Dedup window: 14 days on `(user_id, type='recommendation', data->>'recommended_user_id')`
Schedule: daily at 09:30 (local), recommends up to 3 candidates per recipient.

---

## 1. Schema verification

- [ ] Migration `20260428t_notification_recommendation.sql` is present in `mobile/supabase/migrations/` and applied:
  ```sql
  SELECT name FROM supabase_migrations.schema_migrations
   WHERE name LIKE '20260428t_%';
  -- expect: 1 row, '20260428t_notification_recommendation'
  ```
- [ ] Helper function exists with correct signature:
  ```sql
  SELECT proname, pronargs, prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_recommendation_notifications';
  -- expect: 1 row, pronargs=0, prosecdef=true
  ```
- [ ] `pg_cron` extension available and schedule registered:
  ```sql
  SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
  -- expect: 1 row.
  SELECT jobname, schedule, command, active
    FROM cron.job
   WHERE jobname = 'notification-recommendation-daily';
  -- expect: 1 row, active=true, schedule='30 9 * * *' (or UTC equivalent),
  --         command references public.enqueue_recommendation_notifications()
  --         OR a net.http_post call to the edge function.
  ```
- [ ] No collision with adjacent suffixes:
  ```sql
  SELECT name FROM supabase_migrations.schema_migrations
   WHERE name LIKE '20260428%' ORDER BY name;
  -- expect: q,r,s,t,u,v,w,x,y all present, no duplicates.
  ```
- [ ] `piktag_notifications.type` column accepts `'recommendation'` (no enum/CHECK rejection):
  ```sql
  INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read)
  VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'recommendation', '', 'smoke', '{}'::jsonb, false
  );
  -- expect: 1 row inserted (then DELETE it).
  ```

## 2. Helper function `enqueue_recommendation_notifications()` syntax + GRANTs + search_path

- [ ] Language is `plpgsql`, return type is `void`:
  ```sql
  SELECT l.lanname, t.typname AS rettype
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_type t ON t.oid = p.prorettype
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_recommendation_notifications';
  -- expect: lanname='plpgsql', rettype='void'
  ```
- [ ] `SECURITY DEFINER` is set:
  ```sql
  SELECT prosecdef FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='enqueue_recommendation_notifications';
  -- expect: true
  ```
- [ ] `SET search_path = public` is configured on the function:
  ```sql
  SELECT proconfig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='enqueue_recommendation_notifications';
  -- expect: array contains 'search_path=public'
  ```
- [ ] EXECUTE granted only to `postgres` and `service_role`; revoked from `PUBLIC`:
  ```sql
  SELECT grantee, privilege_type
    FROM information_schema.role_routine_grants
   WHERE specific_schema='public'
     AND routine_name='enqueue_recommendation_notifications';
  -- expect: rows for postgres and service_role only; no PUBLIC, anon, authenticated.
  ```
- [ ] Function body parses cleanly (no syntax error on CREATE OR REPLACE re-apply):
  ```sql
  -- Re-run the migration's CREATE OR REPLACE block; expect: CREATE FUNCTION (no error).
  ```
- [ ] Calling helper as `service_role` succeeds; calling as `anon`/`authenticated` is denied:
  ```sql
  SET LOCAL ROLE service_role;
  SELECT public.enqueue_recommendation_notifications();  -- expect: void, success.
  SET LOCAL ROLE anon;
  SELECT public.enqueue_recommendation_notifications();  -- expect: permission denied.
  ```

## 3. Functional tests (3+ happy, 2+ edge)

Setup fixtures (run in a transaction; ROLLBACK at end of each test):
```sql
-- Users A,B,C,D,E
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a@test'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b@test'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','c@test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','d@test'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','e@test');
INSERT INTO piktag_profiles (id, username, full_name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','alice','Alice'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','bob','Bob'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','carol','Carol'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','dave','Dave'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','eve','Eve');
INSERT INTO piktag_tags (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111','design'),
  ('22222222-2222-2222-2222-222222222222','climbing'),
  ('33333333-3333-3333-3333-333333333333','coffee');
```

### Happy 1 — single recipient, single candidate with 2 mutual tags
- [ ] Setup: Alice has tags {design, climbing}; Bob has tags {design, climbing, coffee}; no connection between them.
  ```sql
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES
   ('aaaa...','1111...'),('aaaa...','2222...'),
   ('bbbb...','1111...'),('bbbb...','2222...'),('bbbb...','3333...');
  SELECT public.enqueue_recommendation_notifications();
  SELECT user_id, type, data->>'recommended_user_id' AS rec, data->>'mutual_tag_count' AS cnt
    FROM piktag_notifications
   WHERE user_id IN ('aaaa...','bbbb...') AND type='recommendation';
  -- expect: 2 rows (mutual recs both directions), each with mutual_tag_count >= 2.
  ```

### Happy 2 — multiple candidates, capped at 3 per recipient
- [ ] Setup: Alice has 5 candidates each with ≥2 mutual tags.
  ```sql
  -- ... seed Alice + 5 others sharing 2+ tags ...
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='aaaa...' AND type='recommendation';
  -- expect: count = 3 (capped).
  -- expect: top 3 ordered by mutual_tag_count DESC are chosen.
  ```

### Happy 3 — `data` JSONB shape and routing key correctness
- [ ] After running helper:
  ```sql
  SELECT data
    FROM piktag_notifications
   WHERE type='recommendation' AND user_id='aaaa...'
   LIMIT 1;
  -- expect keys: recommended_user_id, username, avatar_url, mutual_tag_count, mutual_tag_ids (jsonb array)
  -- expect: data->>'recommended_user_id' is a UUID string of an existing user
  -- expect: title='' and body matches "you might know <username> — <n> mutual tags"
  ```

### Edge 1 — no candidates → no error, no rows
- [ ] Setup: Alice has unique tags nobody else shares.
  ```sql
  INSERT INTO piktag_user_tags (user_id, tag_id) VALUES ('aaaa...','1111...');
  -- nobody else has tag 1111...
  SELECT public.enqueue_recommendation_notifications();
  -- expect: completes without error.
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='aaaa...' AND type='recommendation';
  -- expect: 0
  ```

### Edge 2 — recipient already has a recommendation within 14d → skip
- [ ] Pre-insert a stale notification within the dedup window:
  ```sql
  INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
  VALUES (
    'aaaa...', 'recommendation', '', 'pre-seed',
    jsonb_build_object('recommended_user_id','bbbb...','username','bob','avatar_url',null,'mutual_tag_count',2,'mutual_tag_ids','[]'::jsonb),
    false, now() - interval '3 days'
  );
  -- Seed Alice/Bob with 2 mutual tags as in Happy 1.
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='aaaa...' AND type='recommendation' AND data->>'recommended_user_id'='bbbb...';
  -- expect: 1 (no second insert; dedup honored).
  ```

### Edge 3 — existing connection or block excludes candidate
- [ ] Setup: Alice and Carol share 3 tags but a connection row exists OR a block row exists.
  ```sql
  INSERT INTO piktag_connections (user_id, connected_user_id) VALUES ('aaaa...','cccc...');
  -- (or) INSERT INTO piktag_blocks (blocker_id, blocked_id) VALUES ('aaaa...','cccc...');
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='aaaa...' AND data->>'recommended_user_id'='cccc...';
  -- expect: 0
  ```

### Edge 4 — candidate with only 1 mutual tag is excluded
- [ ] Setup: Alice & Dave share exactly 1 tag.
  ```sql
  -- expect: no notification for recommended_user_id='dddd...'.
  ```

## 4. Dedup test (run helper twice in window → 0 new rows second run)

- [ ] Seed 3 valid candidates for Alice. First run:
  ```sql
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) AS first_run_count
    FROM piktag_notifications
   WHERE user_id='aaaa...' AND type='recommendation';
  -- expect: first_run_count = 3
  ```
- [ ] Second run with no time advance:
  ```sql
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) AS second_run_count
    FROM piktag_notifications
   WHERE user_id='aaaa...' AND type='recommendation';
  -- expect: second_run_count = 3 (no new rows; delta = 0).
  ```
- [ ] Advance one row past the 14-day window and re-run; that single recommendation may re-fire:
  ```sql
  UPDATE piktag_notifications
     SET created_at = now() - interval '15 days'
   WHERE user_id='aaaa...' AND data->>'recommended_user_id'='bbbb...';
  SELECT public.enqueue_recommendation_notifications();
  SELECT count(*) FROM piktag_notifications
   WHERE user_id='aaaa...' AND data->>'recommended_user_id'='bbbb...';
  -- expect: 2 (original aged row + new fresh row).
  ```

## 5. Edge function (`notification-recommendation`) auth gate test (wrong CRON_SECRET → 401)

Note: spec §1.7 returns **403** on bad secret; if implementer chose 401 either is acceptable. Test asserts ≥400 unauthorized response.

- [ ] Missing Authorization header:
  ```bash
  curl -i -X POST \
    "$SUPABASE_URL/functions/v1/notification-recommendation"
  # expect: HTTP/1.1 401 or 403; body 'Forbidden' or similar.
  ```
- [ ] Wrong bearer:
  ```bash
  curl -i -X POST \
    -H "Authorization: Bearer wrong-secret" \
    "$SUPABASE_URL/functions/v1/notification-recommendation"
  # expect: HTTP/1.1 401 or 403; no DB writes.
  ```
- [ ] Empty CRON_SECRET on server is also denied (defense-in-depth):
  ```bash
  # With CRON_SECRET unset on the function, any request must be denied.
  # expect: 401/403 (never 200).
  ```
- [ ] Correct bearer succeeds:
  ```bash
  curl -i -X POST \
    -H "Authorization: Bearer $CRON_SECRET" \
    "$SUPABASE_URL/functions/v1/notification-recommendation"
  # expect: HTTP/1.1 200; body { ok: true, inserted: <int> }.
  ```
- [ ] Constant-time compare (no early-exit length leak): different-length secret returns the same status code as a same-length wrong secret:
  ```bash
  curl -i -X POST -H "Authorization: Bearer x" "$URL"; \
  curl -i -X POST -H "Authorization: Bearer $(printf 'y%.0s' {1..64})" "$URL";
  # expect: identical status (401/403) for both.
  ```

## 6. Push notification test

- [ ] Recipient with non-null `push_token` receives Expo POST:
  ```sql
  UPDATE piktag_profiles SET push_token='ExponentPushToken[TEST_ALICE]'
   WHERE id='aaaa...';
  ```
  Trigger helper / edge function and capture outbound HTTP via mock or staging Expo receipt:
  - [ ] Exactly **one** push per recipient per run (first candidate only — see spec §2.4).
  - [ ] Payload shape:
    ```json
    {
      "to": "ExponentPushToken[TEST_ALICE]",
      "title": "<candidate username>",
      "body":  "you might know <candidate username> — <n> mutual tags",
      "data":  { "type": "recommendation", "recommended_user_id": "<uuid>" },
      "sound": "default",
      "priority": "high"
    }
    ```
- [ ] Recipient with `push_token=NULL` → no Expo POST, but in-app row still inserted.
- [ ] Expo returns non-2xx → notification row still inserted (push failure swallowed by try/catch).
- [ ] Verify Expo receipts in staging:
  ```bash
  curl -X POST https://exp.host/--/api/v2/push/getReceipts \
    -H 'Content-Type: application/json' \
    -d '{"ids":["<receipt_id_from_send>"]}'
  # expect: status 'ok' for the test token.
  ```
- [ ] No duplicate push when helper run twice within dedup window (matches §4 dedup).

## 7. Mobile UI test (social tab, tap → UserDetail of recommended user)

- [ ] In the Notifications screen, switch to the **social** tab — recommendation row appears with:
  - [ ] Avatar = `data.avatar_url` (fallback initials if null).
  - [ ] Title text = `data.username` (renderer reads from `data`, not the empty `title` column).
  - [ ] Body text = `you might know <username> — <n> mutual tags` (en) / `你可能認識 <username> — <n> 個共同標籤` (zh-TW).
- [ ] Realtime arrival: insert a row server-side and confirm it appears within ~2s without pull-to-refresh (postgres_changes filter on `user_id`).
- [ ] Tap the row → navigates to `UserDetailScreen` with `userId === data.recommended_user_id`. Verify via:
  ```ts
  // jest / detox
  await element(by.id('notif-row-recommendation-0')).tap();
  await expect(element(by.id('user-detail-screen'))).toBeVisible();
  await expect(element(by.id('user-detail-id'))).toHaveText(recommendedUserId);
  ```
- [ ] Tapping marks the row read (`is_read` flips to true). Verify next mount shows the row de-emphasized (no unread dot).
- [ ] Locale switch (en ↔ zh-TW ↔ zh-CN): body re-renders from i18n key with `{{username}}` and `{{count}}` interpolation; no raw `{{...}}` braces visible.
- [ ] Recommended user has been deleted → row renders gracefully (placeholder name, no crash); tapping shows a 'user not found' state instead of crashing.

## 8. Performance test

- [ ] Seed scale dataset:
  - 50,000 users
  - 200,000 user-tag rows (avg 4 tags/user)
  - 30,000 connections (excluded from candidates)
  - 1,000 block rows
- [ ] Helper end-to-end runtime:
  ```sql
  EXPLAIN (ANALYZE, BUFFERS) SELECT public.enqueue_recommendation_notifications();
  -- expect: total time < 30s on staging hardware.
  -- expect: candidate-selection scan uses indexes on piktag_user_tags(tag_id),
  --         piktag_user_tags(user_id), piktag_connections(user_id, connected_user_id).
  ```
- [ ] No sequential scan on `piktag_notifications` for the dedup check:
  ```sql
  EXPLAIN ANALYZE
  SELECT 1 FROM piktag_notifications
   WHERE user_id=$1 AND type='recommendation'
     AND data->>'recommended_user_id'=$2
     AND created_at > now() - interval '14 days';
  -- expect: Index Scan / Bitmap Index Scan, not Seq Scan.
  -- If Seq Scan: add a partial index, e.g.
  --   CREATE INDEX idx_notif_recommendation_dedup
  --     ON piktag_notifications (user_id, (data->>'recommended_user_id'), created_at DESC)
  --     WHERE type='recommendation';
  ```
- [ ] Notification insert volume per run is bounded: `≤ 3 × active_recipients`. Confirm via:
  ```sql
  SELECT count(*) FROM piktag_notifications
   WHERE type='recommendation' AND created_at > now() - interval '5 minutes';
  -- expect: ≤ 3 × distinct user_id count.
  ```
- [ ] Edge function p95 latency in staging (10 runs) < 60s; memory < 256MB.
- [ ] No connection-pool exhaustion: helper completes inside a single transaction; no long-held advisory locks.

## 9. Rollback plan

If the recommendation notifications cause incidents (spam, perf regression, wrong recipients), roll back in this order:

1. **Stop new notifications immediately** (disable the cron job; no schema change):
   ```sql
   UPDATE cron.job SET active = false
    WHERE jobname = 'notification-recommendation-daily';
   ```
2. **Disable the edge function** (Supabase dashboard → Functions → `notification-recommendation` → Disable, or):
   ```bash
   supabase functions delete notification-recommendation --project-ref "$PROJECT_REF"
   ```
3. **Purge bad rows** (only the bad batch, not historical user data):
   ```sql
   DELETE FROM piktag_notifications
    WHERE type='recommendation'
      AND created_at > '<incident_start_timestamp>'::timestamptz;
   ```
4. **Drop the schedule and helper** (full revert of `20260428t_notification_recommendation.sql`):
   ```sql
   SELECT cron.unschedule('notification-recommendation-daily');
   DROP FUNCTION IF EXISTS public.enqueue_recommendation_notifications();
   ```
   Note: this does NOT alter `piktag_notifications` schema (no columns added); existing rows of other types are unaffected.
5. **Mark migration reverted** so it will not re-apply:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
    WHERE name = '20260428t_notification_recommendation';
   ```
6. **Mobile**: no client rollback required — the social tab silently shows zero recommendation rows once data is purged. If a hotfix is desired, ship a release that hides the recommendation row type behind a feature flag.
7. **Verification after rollback**:
   - [ ] `SELECT * FROM cron.job WHERE jobname LIKE 'notification-recommendation%';` returns 0 rows.
   - [ ] `SELECT count(*) FROM piktag_notifications WHERE type='recommendation' AND created_at > '<incident_start>';` returns 0.
   - [ ] Edge function URL returns 404.
   - [ ] No errors in Supabase function logs for 30 minutes.
8. **Post-mortem**: capture root cause (candidate query bug, dedup window too short, push spam), then re-deploy a fixed migration as `20260428z_…` only after fix verified in staging — note: suffix `z` is reserved per spec §3.1, so allocate the next dated suffix instead (e.g. `20260429a_…`).
