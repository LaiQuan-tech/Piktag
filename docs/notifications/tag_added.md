# `tag_added` Notification

## 1. Overview

- **Type name:** `tag_added`
- **Tab:** social
- **Trigger model:** reactive (Postgres trigger on `piktag_user_tags` AFTER INSERT)
- **Migration file:** `mobile/supabase/migrations/20260428s_notification_tag_added.sql`
- **Trigger function:** `public.notify_tag_added()`
- **Edge function:** none — trigger only

The `tag_added` notification fires when another user attaches a tag to *your* profile (e.g., someone tags you as `#designer`). It tells the profile owner who tagged them and which tag was applied, so they can review or remove the tag from their profile.

---

## 2. Trigger Condition

A row is inserted into `piktag_user_tags` where the inserter is **not** the profile owner.

The actor (the person who placed the tag) is captured inside the trigger via:

```sql
current_setting('request.jwt.claim.sub', true)::uuid
```

This is the standard Supabase pattern for resolving `auth.uid()` inside a `SECURITY DEFINER` trigger. The trigger MUST short-circuit and return `NEW` without inserting a notification when:

- The actor cannot be resolved (returns `NULL` — typically a `service_role` insert).
- The actor equals `NEW.user_id` (a user tagging their own profile is not a notification event).
- `NEW.user_id` is `NULL`.

---

## 3. `data` JSONB Shape

Every `piktag_notifications` row of type `tag_added` MUST set its `data` column to:

```json
{
  "actor_user_id": "<auth.uid() of inserter>",
  "username":      "<actor username or full_name>",
  "avatar_url":    "<actor avatar_url or null>",
  "tag_id":        "<NEW.tag_id>",
  "tag_name":      "<piktag_tags.name>",
  "user_tag_id":   "<NEW.id>"
}
```

Mobile routing keys consumed by `NotificationsScreen.tsx`: `actor_user_id`, `tag_id`, `tag_name`. The `username` and `avatar_url` keys are required by the master spec for every notification row (§3.9).

`title` is `''`. `body` is the rendered en string `tagged you as #<tag_name>` with `<tag_name>` substituted at trigger time.

---

## 4. Dedup Window

Skip the insert if a row with the same recipient, type, actor, and tag already exists within the last **24 hours**:

```sql
SELECT 1 FROM piktag_notifications
 WHERE user_id   = <NEW.user_id>
   AND type      = 'tag_added'
   AND data->>'actor_user_id' = <actor>::text
   AND data->>'tag_id'        = <NEW.tag_id>::text
   AND created_at > now() - interval '24 hours'
LIMIT 1;
```

Rationale: prevents spam if the actor removes and re-adds the same tag within the same day (common during edit flows).

---

## 5. Manual Test: Fire the Trigger

The trigger relies on `request.jwt.claim.sub` to resolve the actor. To simulate an authenticated insert from psql, set the JWT claim manually before inserting. Replace the UUIDs first:

- `<RECIPIENT>` — the profile owner being tagged (must exist in `auth.users` and `piktag_profiles`).
- `<ACTOR>` — the user placing the tag (must exist in `auth.users` and `piktag_profiles`, must differ from `<RECIPIENT>`).
- `<TAG>` — an existing row in `piktag_tags`.

```sql
-- Run as service_role / postgres in the Supabase SQL editor.
BEGIN;

-- 1. Spoof the JWT subject so notify_tag_added() resolves the actor.
SELECT set_config(
  'request.jwt.claim.sub',
  '<ACTOR>',
  true
);

-- 2. Insert a tag against the recipient's profile.
INSERT INTO piktag_user_tags (user_id, tag_id, position, weight, is_private, is_pinned, created_at)
VALUES (
  '<RECIPIENT>',
  '<TAG>',
  0,
  1.0,
  false,
  false,
  now()
);

-- 3. Verify the notification landed.
SELECT id, user_id, type, body, data, created_at
  FROM piktag_notifications
 WHERE user_id = '<RECIPIENT>'
   AND type    = 'tag_added'
 ORDER BY created_at DESC
 LIMIT 1;

ROLLBACK;  -- Use COMMIT to keep the test rows.
```

Expected result: one new `piktag_notifications` row whose `data->>'actor_user_id'` equals `<ACTOR>` and `data->>'tag_id'` equals `<TAG>`. Re-running the same insert within 24h MUST NOT produce a second notification row.

---

## 6. Push Notification Templates

`tag_added` pushes via Expo (`https://exp.host/--/api/v2/push/send`). Push delivery is best-effort and wrapped in a try/catch — failures must never block the notification insert.

| Field | Value |
|-------|-------|
| `to` | `piktag_profiles.push_token` for the recipient (`NEW.user_id`); skip if `NULL`. |
| `title` (en) | `{{username}}` (the actor's display name) |
| `title` (zh-TW) | `{{username}}` |
| `body` (en) | `tagged you as #{{tag_name}}` |
| `body` (zh-TW) | `把你標記為 #{{tag_name}}` |
| `data` | `{ "type": "tag_added", "actor_user_id": "<actor>", "tag_id": "<tag_id>", "tag_name": "<tag_name>" }` |
| `sound` | `"default"` |
| `priority` | `"high"` |

i18n keys to add to `en.json`, `zh-TW.json`, and `zh-CN.json`:

```
notifications.types.tag_added.title
notifications.types.tag_added.body
notifications.types.tag_added.push.title
notifications.types.tag_added.push.body
```

The `body` and `push.body` strings use `{{tag_name}}` interpolation. `push.title` uses `{{username}}`.

---

## 7. Monitoring SQL

Daily volume, dedup-skip rate, and most-tagged users for the last 24 hours:

```sql
-- 7.1 Volume by hour for the last 24h.
SELECT date_trunc('hour', created_at) AS hour,
       count(*)                       AS notifications
  FROM piktag_notifications
 WHERE type       = 'tag_added'
   AND created_at > now() - interval '24 hours'
 GROUP BY 1
 ORDER BY 1 DESC;

-- 7.2 Top recipients (potential tag-spam targets) over 7 days.
SELECT user_id,
       count(*)                                AS notif_count,
       count(DISTINCT data->>'actor_user_id')  AS unique_actors,
       count(DISTINCT data->>'tag_id')         AS unique_tags
  FROM piktag_notifications
 WHERE type       = 'tag_added'
   AND created_at > now() - interval '7 days'
 GROUP BY user_id
 ORDER BY notif_count DESC
 LIMIT 20;

-- 7.3 Dedup health — same (recipient, actor, tag) inserted multiple times in
-- the dedup window. Should always return zero rows.
SELECT user_id,
       data->>'actor_user_id' AS actor,
       data->>'tag_id'        AS tag,
       count(*)               AS dup_count
  FROM piktag_notifications
 WHERE type       = 'tag_added'
   AND created_at > now() - interval '24 hours'
 GROUP BY 1, 2, 3
HAVING count(*) > 1;

-- 7.4 Trigger sanity — tags inserted in the last hour vs. notifications fired.
WITH tags AS (
  SELECT count(*) AS inserted
    FROM piktag_user_tags
   WHERE created_at > now() - interval '1 hour'
), notifs AS (
  SELECT count(*) AS fired
    FROM piktag_notifications
   WHERE type       = 'tag_added'
     AND created_at > now() - interval '1 hour'
)
SELECT tags.inserted, notifs.fired FROM tags, notifs;
```

---

## 8. Edge Cases & Rollback

### Edge cases the trigger MUST handle

- **Self-tag:** `auth.uid() = NEW.user_id` — return `NEW` without inserting.
- **Service-role insert:** `current_setting('request.jwt.claim.sub', true)` is `NULL` — return `NEW` without inserting. Backfills, admin tools, and seed scripts therefore never produce notifications.
- **Missing actor profile:** if the actor's `piktag_profiles` row is missing or the `username`/`full_name` are both `NULL`, store `''` in `data.username` and `NULL` in `data.avatar_url`. Mobile renders a fallback display.
- **Missing tag row:** if `piktag_tags` has no row for `NEW.tag_id` (should not happen because of FK), do not raise — fall back to `data.tag_name = ''` and let mobile fail gracefully.
- **Blocked relationships:** the trigger does **not** consult `piktag_blocks`. If product wants to suppress notifications across blocks, add the check inside `notify_tag_added()` as a future iteration; do not silently fold it into this slice.
- **Re-tag spam within 24h:** suppressed by the dedup `SELECT` (§4).
- **Bulk import of tags:** if a user tags many profiles in one transaction, each row fires the trigger independently. The 24h dedup is per `(recipient, actor, tag)` so distinct recipients still each get one notification.
- **Push token absent:** skip the Expo POST entirely; the in-app notification row still inserts.

### Rollback

To disable `tag_added` without losing historical notifications:

```sql
DROP TRIGGER IF EXISTS trg_notify_tag_added ON piktag_user_tags;
-- Optional, only if fully reverting:
DROP FUNCTION IF EXISTS public.notify_tag_added();
```

Existing `piktag_notifications` rows of `type = 'tag_added'` remain visible to recipients — do not delete them as part of rollback. If the migration must be reverted entirely, ship a follow-up migration rather than mutating the original `20260428s_notification_tag_added.sql`. Suffix `z` is reserved per the master spec, so use the next available date suffix.
