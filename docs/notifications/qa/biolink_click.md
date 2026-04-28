# QA Checklist — `biolink_click` (reactive)

Migration: `20260428v_notification_biolink_click.sql`
Trigger: `notify_biolink_click()` AFTER INSERT ON `piktag_biolink_clicks`
Push: NO (in-app only)
Tab: reminders

---

## 1. Schema verification (`piktag_biolink_clicks` table + RLS)

- [ ] Table `piktag_biolink_clicks` exists with columns: `id uuid PK`, `biolink_id uuid NOT NULL REFERENCES piktag_biolinks(id) ON DELETE CASCADE`, `clicker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` (nullable for anon), `referer text`, `user_agent text`, `created_at timestamptz DEFAULT now()`.
- [ ] Index `idx_biolink_clicks_biolink (biolink_id, created_at DESC)` present.
- [ ] Partial index `idx_biolink_clicks_clicker (clicker_user_id) WHERE clicker_user_id IS NOT NULL` present.
- [ ] RLS enabled on `piktag_biolink_clicks`.
- [ ] RLS policy: `INSERT` allowed for `anon` and `authenticated` (public web clicks).
- [ ] RLS policy: `SELECT` allowed only for biolink owner (`auth.uid() = (SELECT user_id FROM piktag_biolinks WHERE id = biolink_id)`).
- [ ] No `UPDATE`/`DELETE` policies for `authenticated` (immutable click log).
- [ ] FK on `biolink_id` cascades on biolink delete; FK on `clicker_user_id` sets NULL on user delete.
- [ ] Verify with:

```sql
\d+ piktag_biolink_clicks
SELECT polname, polcmd, polroles::regrole[]
  FROM pg_policy WHERE polrelid = 'piktag_biolink_clicks'::regclass;
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'piktag_biolink_clicks';
```

---

## 2. Trigger function `notify_biolink_click()` syntax + GRANTs

- [ ] Function `public.notify_biolink_click()` exists, returns `trigger`, `LANGUAGE plpgsql`, `SECURITY DEFINER`.
- [ ] Function joins `piktag_biolinks` to resolve recipient (`user_id`), `platform`, `label`.
- [ ] Function joins `piktag_profiles` (LEFT JOIN — anon click safe) to resolve `username`, `avatar_url`; defaults `username` to `'Someone'` when NULL.
- [ ] Self-click guard: `IF NEW.clicker_user_id = biolink_owner_id THEN RETURN NEW; END IF;`
- [ ] Dedup guard: `NOT EXISTS (SELECT 1 FROM piktag_notifications WHERE user_id = recipient AND type = 'biolink_click' AND data->>'biolink_id' = NEW.biolink_id::text AND created_at > now() - interval '60 minutes')`.
- [ ] Inserts into `piktag_notifications` with `type='biolink_click'`, `title=''`, body matching spec en/zh-TW, `data` JSONB matching §2.6 shape.
- [ ] Trigger `trg_notify_biolink_click AFTER INSERT ON piktag_biolink_clicks FOR EACH ROW EXECUTE FUNCTION notify_biolink_click()` is attached.
- [ ] `GRANT EXECUTE ON FUNCTION public.notify_biolink_click() TO authenticated, anon, service_role;` (anon needed because anon inserts into source table fire trigger).
- [ ] Function owner is `postgres` (so `SECURITY DEFINER` bypasses RLS for `piktag_notifications` insert).
- [ ] Verify with:

```sql
\df+ public.notify_biolink_click
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'piktag_biolink_clicks'::regclass;
SELECT has_function_privilege('anon', 'public.notify_biolink_click()', 'EXECUTE');
```

---

## 3. Functional tests — happy + edge

### Setup (run before each test)

```sql
-- Owner (recipient): u_owner. Clicker: u_clicker. Biolink: bl_test.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'clicker@test.local')
  ON CONFLICT DO NOTHING;
INSERT INTO piktag_profiles (id, username, avatar_url) VALUES
  ('00000000-0000-0000-0000-000000000001', 'theowner', null),
  ('00000000-0000-0000-0000-000000000002', 'theclicker', 'https://x/y.jpg')
  ON CONFLICT DO NOTHING;
INSERT INTO piktag_biolinks (id, user_id, platform, label, url) VALUES
  ('11111111-1111-1111-1111-111111111111',
   '00000000-0000-0000-0000-000000000001',
   'instagram', 'My IG', 'https://instagram.com/x')
  ON CONFLICT DO NOTHING;
```

### Happy paths

- [ ] **H1 — Authenticated clicker fires notification.**

```sql
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id, referer, user_agent)
VALUES ('11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000002',
        'https://piktag.app/u/theowner', 'Mozilla/5.0');

SELECT type, title, body, data
  FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click'
 ORDER BY created_at DESC LIMIT 1;
-- Expect: title='', body='clicked your instagram link',
-- data->>'clicker_user_id' = '...0002', data->>'username'='theclicker',
-- data->>'platform'='instagram', data->>'biolink_id'='1111...'.
```

- [ ] **H2 — Anonymous click (NULL clicker) fires notification with `username='Someone'`.**

```sql
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id, referer, user_agent)
VALUES ('11111111-1111-1111-1111-111111111111', NULL, 'https://google.com', 'curl/8.0');

SELECT data->>'username' AS u, data->>'clicker_user_id' AS c
  FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click'
 ORDER BY created_at DESC LIMIT 1;
-- Expect: u='Someone', c IS NULL.
```

- [ ] **H3 — Locale body (zh-TW) — verify mobile renders `點擊了你的 instagram 連結` when `i18n.locale='zh-TW'` (UI assertion; DB body remains English string per spec; mobile maps via `notifications.types.biolink_click.body` key).**

### Edge cases

- [ ] **E1 — Self-click MUST NOT notify.**

```sql
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id)
VALUES ('11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000001'); -- owner clicks own link

SELECT count(*) FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click'
   AND data->>'clicker_user_id' = '00000000-0000-0000-0000-000000000001';
-- Expect: 0.
```

- [ ] **E2 — Rapid same-clicker collapses to 1 within 60-min window.**

```sql
DO $$
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            '00000000-0000-0000-0000-000000000002');
  END LOOP;
END $$;

SELECT count(*) FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click'
   AND data->>'biolink_id' = '11111111-1111-1111-1111-111111111111'
   AND created_at > now() - interval '60 minutes';
-- Expect: 1.
```

- [ ] **E3 — Click on deleted biolink (FK cascade) inserts no orphan notification.**

```sql
DELETE FROM piktag_biolinks WHERE id = '22222222-2222-2222-2222-222222222222'; -- nonexistent
-- Insert against missing FK should fail with FK violation; no notification row created.
```

- [ ] **E4 — Click row with `clicker_user_id` referencing deleted user — `ON DELETE SET NULL` works; future inserts treated as anon.**

---

## 4. Dedup test (60-min collapse — fire 5 clicks, expect 1 notification)

- [ ] Truncate notifications for owner before test:

```sql
DELETE FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click';
```

- [ ] Fire 5 sequential clicks (mixed clickers, same biolink) within seconds:

```sql
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id) VALUES
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', NULL),
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', NULL);
```

- [ ] Expect exactly 1 notification row (dedup is per-`biolink_id`, not per-clicker):

```sql
SELECT count(*) FROM piktag_notifications
 WHERE user_id = '00000000-0000-0000-0000-000000000001'
   AND type = 'biolink_click'
   AND data->>'biolink_id' = '11111111-1111-1111-1111-111111111111'
   AND created_at > now() - interval '60 minutes';
-- Expect: 1.
```

- [ ] All 5 rows still present in `piktag_biolink_clicks` (analytics not lost):

```sql
SELECT count(*) FROM piktag_biolink_clicks
 WHERE biolink_id = '11111111-1111-1111-1111-111111111111';
-- Expect: >= 5.
```

- [ ] After 60 min (or `UPDATE piktag_notifications SET created_at = now() - interval '61 minutes' WHERE ...`), next click MUST create a new notification.

---

## 5. Push notification test

- [ ] Per spec §2.6: `biolink_click` is **in-app only — NO push**. No POST to `https://exp.host/--/api/v2/push/send` should occur.
- [ ] Verify by tailing edge-function logs / checking `notify_biolink_click()` source — it must not reference `push_token`, `exp.host`, or HTTP egress.
- [ ] On device: trigger a click, confirm:
  - [ ] No system push banner appears.
  - [ ] In-app reminders tab updates via realtime within ~2s.
- [ ] Realtime channel: confirm subscription on `piktag_notifications` filtered by `user_id` delivers the new row (browser/Flipper).

---

## 6. Mobile UI test (reminders tab, tap → UserDetail of clicker)

- [ ] Open app as owner; navigate to **Notifications → Reminders** tab.
- [ ] New `biolink_click` row appears at top with:
  - [ ] Avatar = `data.avatar_url` (fallback placeholder for anon).
  - [ ] Title text built from `username` + i18n body `clicked your {{platform}} link` (en) / `點擊了你的 {{platform}} 連結` (zh-TW).
  - [ ] Relative timestamp ("now", "2m").
  - [ ] Unread indicator (dot) shown; `is_read=false`.
- [ ] Tap notification: navigates to `UserDetail` screen for `data.clicker_user_id`.
  - [ ] If `clicker_user_id IS NULL` (anon), tap is a **no-op** (or shows toast "Anonymous visitor"); does NOT crash, does NOT navigate.
- [ ] After tap, `is_read` flips to `true`; row dot disappears on return.
- [ ] Pull-to-refresh re-fetches without duplicating.
- [ ] Long-press → delete removes row locally and from DB (RLS allows owner delete).
- [ ] Snapshot/visual regression test added for the reminder row component.

---

## 7. Performance test (10k clicks/min should not crash)

- [ ] Load generator (psql / k6 / pgbench) inserts 10,000 click rows in 60s against one biolink, mixing 100 distinct `clicker_user_id`s + 30% NULL.

```sql
-- pgbench-style script (clicks.sql):
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id)
VALUES ('11111111-1111-1111-1111-111111111111',
        CASE WHEN random() < 0.3 THEN NULL
             ELSE (SELECT id FROM auth.users ORDER BY random() LIMIT 1) END);
```

```bash
pgbench -n -f clicks.sql -c 20 -j 4 -T 60 "$DATABASE_URL"
# Target: >= 167 TPS sustained for 60s.
```

- [ ] Acceptance criteria:
  - [ ] DB CPU stays < 80% sustained.
  - [ ] No connection-pool exhaustion / no `too many clients` errors.
  - [ ] `piktag_notifications` grows by **exactly 1** row for the test biolink (dedup holds under load).
  - [ ] p95 INSERT latency on `piktag_biolink_clicks` < 50ms.
  - [ ] No deadlocks in `pg_stat_activity` / logs.
- [ ] Re-run with 10 distinct biolinks in parallel — expect ~10 notifications, click count ~100k.
- [ ] Verify `idx_biolink_clicks_biolink` is used by dedup `EXISTS` lookup:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT 1 FROM piktag_notifications
 WHERE user_id='00000000-0000-0000-0000-000000000001'
   AND type='biolink_click'
   AND data->>'biolink_id'='11111111-1111-1111-1111-111111111111'
   AND created_at > now() - interval '60 minutes';
-- Add functional index on (user_id, type, (data->>'biolink_id'), created_at DESC) if seq scan observed.
```

- [ ] Consider partitioning `piktag_biolink_clicks` by month if volume > 1M/day (out of scope for v1).

---

## 8. Rollback plan

- [ ] **Pre-deploy**: snapshot `piktag_notifications` row count and any rows where `type='biolink_click'` (should be 0 pre-deploy).
- [ ] **Detection**: on any of the following, roll back immediately:
  - Trigger raises errors visible in `pg_stat_database` / log.
  - Reminders tab shows malformed rows in production.
  - Click-write path latency regression > 2× baseline.
- [ ] **Rollback SQL** (single transaction):

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_notify_biolink_click ON piktag_biolink_clicks;
DROP FUNCTION IF EXISTS public.notify_biolink_click();
-- Optionally drop the table (only if no analytics consumer depends on it):
-- DROP TABLE IF EXISTS piktag_biolink_clicks CASCADE;
-- Cleanup notifications produced by this type:
DELETE FROM piktag_notifications WHERE type = 'biolink_click';
COMMIT;
```

- [ ] **Soft rollback (preferred — keep table, disable trigger only)**:

```sql
ALTER TABLE piktag_biolink_clicks DISABLE TRIGGER trg_notify_biolink_click;
```

This preserves click analytics while halting notification fan-out.

- [ ] **Migration revert**: create `20260428v_revert_notification_biolink_click.sql` mirroring the rollback SQL above; do NOT edit the original migration file.
- [ ] **Mobile client**: the reminders tab gracefully ignores unknown `type` values — no client release required for rollback.
- [ ] **Post-rollback verification**:

```sql
SELECT count(*) FROM pg_trigger WHERE tgname='trg_notify_biolink_click';   -- 0 (hard) or enabled='D' (soft)
SELECT count(*) FROM piktag_notifications WHERE type='biolink_click';     -- 0 after hard rollback
```

- [ ] **Comms**: post in `#piktag-eng` with timestamp, scope, root cause, and forward-fix ETA.
