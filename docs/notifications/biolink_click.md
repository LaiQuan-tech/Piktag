# Notification Type: `biolink_click`

## 1. Overview

- **Type name**: `biolink_click`
- **Tab**: `reminders`
- **Trigger model**: **Reactive** (Postgres `AFTER INSERT` trigger — not scheduled)
- **Purpose**: Notify a biolink owner when someone clicks one of their links, so they can follow up or measure interest. Push notifications are intentionally disabled for this type because clicks would otherwise be a noisy stream; in-app notifications only.

## 2. Trigger Condition

The trigger fires from a Postgres `AFTER INSERT` trigger on the `piktag_biolink_clicks` table.

- **Source table**: `piktag_biolink_clicks` (created in the same migration — `20260428v_notification_biolink_click.sql`)
- **Trigger function name**: `public.notify_biolink_click()`
- **Trigger name**: `trg_notify_biolink_click`
- **Recipient (`piktag_notifications.user_id`)**: the biolink owner — resolved by joining `NEW.biolink_id` to `piktag_biolinks.user_id`.
- **Self-click guard**: skip the notification when `NEW.clicker_user_id = piktag_biolinks.user_id` (the owner clicking their own link must not generate a notification).
- **Anonymous clicks**: `NEW.clicker_user_id` may be `NULL` (clicks from public web with no logged-in user). In that case proceed with the notification, populate `data.clicker_user_id = null`, and use a fallback display name (`'Someone'`).

## 3. `data` JSONB Shape

Every row inserted into `piktag_notifications` for this type uses the canonical shape below. The first three fields are the spec-card-required keys; the remaining fields supply mobile routing and rendering context.

```json
{
  "clicker_user_id": "<uuid or null for anon click>",
  "username":        "<clicker username/full_name, or 'Someone' for anon>",
  "avatar_url":      "<clicker avatar_url, or null>",
  "biolink_id":      "<NEW.biolink_id>",
  "platform":        "<piktag_biolinks.platform>",
  "label":           "<piktag_biolinks.label or null>"
}
```

Field notes:

| Field | Type | Required | Notes |
|---|---|---|---|
| `clicker_user_id` | `uuid \| null` | yes | `null` when click is anonymous. Mobile routes to clicker profile when non-null. |
| `username` | `string` | yes | Display name. Falls back to `'Someone'` for anon clicks. The mobile `NotificationsScreen` always reads `data.username`. |
| `avatar_url` | `string \| null` | yes | Falls back to `null` when the clicker has no avatar or is anon. |
| `biolink_id` | `uuid` | yes | Mobile uses this to route into the biolinks editor / analytics. Also the dedup key (see §4). |
| `platform` | `string` | yes | e.g. `'instagram'`, `'twitter'`. Used for body interpolation. |
| `label` | `string \| null` | optional | Free-form link label, surfaced in detail view. |

`title` is always `''` (per the cross-cutting convention in the master spec — UI renders header from `data.username`).

`body` is the rendered English string `clicked your {{platform}} link` with `{{platform}}` substituted at insert time.

## 4. Dedup Window — 60 minutes

Per the spec card, **at most one notification per `(user_id, type='biolink_click', data->>'biolink_id')` per 60 minutes**. Multiple clicks on the same biolink (regardless of clicker) collapse into a single notification within that window. This is a rate-limit, not just a duplicate-suppressor: hot links would otherwise flood the recipient.

Canonical dedup-SELECT (run before the INSERT, inside the trigger):

```sql
SELECT EXISTS (
  SELECT 1 FROM piktag_notifications
   WHERE user_id = v_recipient
     AND type    = 'biolink_click'
     AND data->>'biolink_id' = NEW.biolink_id::text
     AND created_at > now() - interval '60 minutes'
);
```

If the SELECT returns `true`, the trigger returns `NEW` without inserting. This matches §3.7 of `notification-types-spec.md`.

Notes on the dedup behaviour:

- **Per-recipient, per-biolink** — different biolinks owned by the same user dedup independently.
- **Clicker-agnostic** — two different clickers on the same biolink within 60 min still collapse into one notification (you only learn "someone clicked your Instagram link," not which two people).
- **Sliding window** — measured against `created_at` of the most recent matching row, not a fixed wall clock.

## 5. Manual Test — Copy-Pasteable SQL

Run in the Supabase SQL editor (service-role / `postgres` session). Replace the two UUIDs with real values from your environment.

```sql
-- 0. Pick a real biolink and a real clicker. Two SELECTs to grab IDs:
--    SELECT id, user_id, platform FROM piktag_biolinks LIMIT 5;
--    SELECT id, username FROM piktag_profiles WHERE id <> '<biolink_owner_id>' LIMIT 5;

-- 1. Snapshot the recipient's existing notifications for this type.
SELECT id, body, data, created_at
  FROM piktag_notifications
 WHERE user_id = '<biolink_owner_id>'
   AND type    = 'biolink_click'
 ORDER BY created_at DESC
 LIMIT 5;

-- 2. Fire the trigger by inserting a click row.
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id, referer, user_agent)
VALUES (
  '<biolink_id>',
  '<clicker_user_id>',         -- or NULL to simulate an anonymous click
  'https://piktag.app/u/test',
  'Mozilla/5.0 (manual-test)'
)
RETURNING id, created_at;

-- 3. Confirm a new notification row exists with the expected shape.
SELECT id, user_id, type, title, body, data, is_read, created_at
  FROM piktag_notifications
 WHERE user_id = '<biolink_owner_id>'
   AND type    = 'biolink_click'
 ORDER BY created_at DESC
 LIMIT 1;

-- 4. Verify dedup: insert a second click on the SAME biolink within 60 min.
--    The notifications row count for this biolink_id should remain 1.
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id)
VALUES ('<biolink_id>', '<clicker_user_id>');

SELECT count(*) AS notif_count_within_window
  FROM piktag_notifications
 WHERE user_id = '<biolink_owner_id>'
   AND type    = 'biolink_click'
   AND data->>'biolink_id' = '<biolink_id>'
   AND created_at > now() - interval '60 minutes';
-- Expected: 1
```

Self-click negative test:

```sql
-- Should NOT create a notification (clicker == biolink owner).
INSERT INTO piktag_biolink_clicks (biolink_id, clicker_user_id)
VALUES ('<biolink_id>', '<biolink_owner_id>');

SELECT count(*) FROM piktag_notifications
 WHERE user_id = '<biolink_owner_id>'
   AND type    = 'biolink_click'
   AND created_at > now() - interval '1 minute';
-- Expected: 0 new rows
```

## 6. Push Notification

**Push is disabled for this type.** Per the spec card, biolink_click is in-app only — clicks are too noisy to push. There is therefore no `push.title` / `push.body` template, and the trigger function does not call `net.http_post` to the Expo relay.

For completeness, the in-app notification text is:

| Locale | Template | Example (platform=`instagram`) |
|---|---|---|
| en | `clicked your {{platform}} link` | `clicked your instagram link` |
| zh-TW | `點擊了你的 {{platform}} 連結` | `點擊了你的 instagram 連結` |
| zh-CN | mirror of zh-TW | `点击了你的 instagram 链接` |

The `title` value stored on the notification row is `''` (empty); mobile renders the header from `data.username` and the body from the localized template above.

i18n keys (per master spec §3.5 — only `title` and `body`, no push subkeys):

```
notifications.types.biolink_click.title    = ""
notifications.types.biolink_click.body     = "clicked your {{platform}} link"   (en)
                                           = "點擊了你的 {{platform}} 連結"      (zh-TW)
                                           = "点击了你的 {{platform}} 链接"      (zh-CN)
```

## 7. Monitoring SQL

Quick health checks for ops / on-call. Run against the production DB.

**A. Volume in the last 24h, broken down by hour:**

```sql
SELECT date_trunc('hour', created_at) AS hour,
       count(*)                       AS notifications,
       count(DISTINCT user_id)        AS distinct_recipients
  FROM piktag_notifications
 WHERE type = 'biolink_click'
   AND created_at > now() - interval '24 hours'
 GROUP BY 1
 ORDER BY 1 DESC;
```

**B. Dedup effectiveness — clicks vs. notifications produced:**

```sql
WITH clicks AS (
  SELECT count(*) AS click_rows
    FROM piktag_biolink_clicks
   WHERE created_at > now() - interval '24 hours'
),
notifs AS (
  SELECT count(*) AS notif_rows
    FROM piktag_notifications
   WHERE type = 'biolink_click'
     AND created_at > now() - interval '24 hours'
)
SELECT clicks.click_rows,
       notifs.notif_rows,
       round(100.0 * notifs.notif_rows / NULLIF(clicks.click_rows, 0), 2)
         AS notif_per_click_pct
  FROM clicks, notifs;
-- Healthy range: notif_per_click_pct between 5% and 40% (60-min collapse working).
-- > 80% suggests dedup may be broken; 0% suggests trigger is silent.
```

**C. Top biolinks producing notifications (last 7d) — spot abuse / hot links:**

```sql
SELECT data->>'biolink_id'        AS biolink_id,
       data->>'platform'          AS platform,
       count(*)                   AS notifs,
       max(created_at)            AS last_fired
  FROM piktag_notifications
 WHERE type = 'biolink_click'
   AND created_at > now() - interval '7 days'
 GROUP BY 1, 2
 ORDER BY notifs DESC
 LIMIT 20;
```

**D. Trigger silent? (alarm query):**

```sql
-- Click rows exist but no notifications — likely a trigger / dedup bug.
SELECT (
  SELECT count(*) FROM piktag_biolink_clicks
   WHERE created_at > now() - interval '15 minutes'
) AS recent_clicks,
(
  SELECT count(*) FROM piktag_notifications
   WHERE type = 'biolink_click'
     AND created_at > now() - interval '15 minutes'
) AS recent_notifs;
-- Page on-call when recent_clicks > 50 AND recent_notifs = 0.
```

## 8. Edge Cases & Rollback

### Edge cases

1. **Anonymous clicker (`NEW.clicker_user_id IS NULL`)** — public web traffic with no signed-in user. Insert proceeds; `data.clicker_user_id = null`, `data.username = 'Someone'`, `data.avatar_url = null`. Mobile must render `'Someone clicked your Instagram link'` without crashing on the null avatar.
2. **Self-click (`clicker_user_id = biolink owner`)** — skipped silently. Click row still lands in `piktag_biolink_clicks` for analytics, but no notification.
3. **Deleted biolink between click and trigger fire** — the `ON DELETE CASCADE` on `piktag_biolink_clicks.biolink_id` means click rows are removed with the biolink, so this race is bounded. If somehow the JOIN to `piktag_biolinks` returns nothing inside the trigger, the function returns `NEW` without inserting.
4. **Deleted clicker user (`ON DELETE SET NULL`)** — historical click rows survive; the trigger treats them as anonymous on subsequent reads. Existing notification rows are unaffected (they only store `data->>'clicker_user_id'`, not a foreign key).
5. **Burst clicks within 60 min from many different users** — all collapse into one notification; the recipient sees only that *something* happened on that biolink. This is intentional. Aggregate counts are surfaced via analytics, not via the notifications stream.
6. **Notification recipient has `push_token` set** — irrelevant for this type because push is disabled. Even if `push_token` is present, no Expo POST is made.
7. **Click row inserted by `service_role`** — proceeds normally; the trigger uses `NEW.clicker_user_id` directly rather than `auth.uid()`, so server-side ingestion still produces notifications.
8. **High-volume biolink (e.g. viral link)** — the 60-min dedup keeps notification volume bounded to ≤ 24 rows/day per biolink per recipient. Click table itself is **not** rate-limited (analytics needs the raw events).

### Rollback

To disable the type without dropping the click table or losing analytics data:

```sql
DROP TRIGGER IF EXISTS trg_notify_biolink_click ON piktag_biolink_clicks;
DROP FUNCTION IF EXISTS public.notify_biolink_click();
```

This stops new notifications from being created. `piktag_biolink_clicks` rows continue to be written (clicks still tracked for analytics). Existing `piktag_notifications` rows of `type='biolink_click'` are left in place; if you want to purge them too:

```sql
DELETE FROM piktag_notifications WHERE type = 'biolink_click';
```

Full rollback (also drops the new table — destructive, removes click history):

```sql
DROP TRIGGER IF EXISTS trg_notify_biolink_click ON piktag_biolink_clicks;
DROP FUNCTION IF EXISTS public.notify_biolink_click();
DROP TABLE IF EXISTS piktag_biolink_clicks;
DELETE FROM piktag_notifications WHERE type = 'biolink_click';
```

Prefer the partial rollback (trigger + function only) in production — preserve the click table so the next forward-fix can replay missed events from the raw data.
