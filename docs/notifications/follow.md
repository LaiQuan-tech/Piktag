# Notification Type: `follow`

> Fires when a user gains a new follower. Notifies the followed user (recipient) so they can see who started following them.

## 1. Overview

| Field | Value |
|-------|-------|
| **Type identifier** | `follow` |
| **Tab** | `social` |
| **Trigger model** | **Reactive** (Postgres `AFTER INSERT` trigger) |
| **Source table** | `piktag_followers` (created by the same migration) |
| **Migration file** | `mobile/supabase/migrations/20260428q_notification_follow.sql` |
| **Edge function** | None — trigger only |
| **Push notification?** | Yes |

This type is part of the **social** tab in the mobile Notifications screen. Because it is reactive, it fires synchronously the moment a follow row is inserted into `piktag_followers`. There is no cron schedule, no edge function, and no batching — one follow insert produces (at most) one notification row.

---

## 2. Trigger Condition

The notification fires when:

- A new row is inserted into `piktag_followers`
- The trigger is `AFTER INSERT FOR EACH ROW` and calls `public.notify_follow()`
- The trigger function:
  1. Computes `v_recipient = NEW.following_id` and `v_actor = NEW.follower_id`
  2. Returns early if `v_recipient = v_actor` (self-follow guard, in addition to the table-level `CHECK (follower_id <> following_id)`)
  3. Runs the dedup check (see section 4)
  4. Resolves the actor's username/avatar from `piktag_profiles`
  5. Inserts a row into `piktag_notifications`
  6. Optionally fires a push notification

**Source event:** `INSERT INTO piktag_followers (follower_id, following_id) VALUES (...)`.

---

## 3. `data` JSONB Shape

Exact keys and types written into `piktag_notifications.data`:

| Key | Type | Source | Notes |
|-----|------|--------|-------|
| `actor_user_id` | `uuid` (string) | `NEW.follower_id` | The user who pressed "Follow". Routing key consumed by mobile. |
| `username` | `string` | `piktag_profiles.username` (fallback `full_name`, then empty string) | Rendered as the notification title in the UI. |
| `avatar_url` | `string \| null` | `piktag_profiles.avatar_url` | Avatar shown next to the notification. May be null. |
| `follow_id` | `uuid` (string) | `NEW.id` | The newly created `piktag_followers.id` — useful for "Undo" / debug. |

**Companion columns on the `piktag_notifications` row:**

- `user_id` = `NEW.following_id` (recipient — the user being followed)
- `type` = `'follow'`
- `title` = `''` (empty by convention; mobile renders title from `data.username`)
- `body` = `'started following you'` (en string written by the trigger; mobile localizes via i18n)
- `is_read` = `false`
- `created_at` = `now()`

---

## 4. Dedup Window

**Rule:** Skip the insert if a `follow` notification already exists for the same recipient and same actor within the last **24 hours**.

```sql
SELECT 1 FROM piktag_notifications
 WHERE user_id   = <NEW.following_id>
   AND type      = 'follow'
   AND data->>'actor_user_id' = <NEW.follower_id>::text
   AND created_at > now() - interval '24 hours'
LIMIT 1;
```

If a row is found, the trigger returns `NEW` without inserting. This makes a re-follow within 24 hours silent (e.g., user unfollows and refollows quickly while clicking around).

The table-level `UNIQUE (follower_id, following_id)` constraint on `piktag_followers` prevents a true duplicate row, but a delete-then-reinsert cycle would otherwise produce duplicate notifications — the 24h window catches that.

---

## 5. Manual Test (Supabase Studio)

Copy and paste the following into the **SQL Editor** in Supabase Studio. Replace `<RECIPIENT_USER_ID>` and `<ACTOR_USER_ID>` with two real `auth.users` UUIDs (the actor must have a `piktag_profiles` row, and the recipient should have a `push_token` if you want to verify the Expo push).

```sql
-- 0. Optional: capture before-state.
SELECT count(*) AS before_count
  FROM piktag_notifications
 WHERE user_id = '<RECIPIENT_USER_ID>'
   AND type    = 'follow';

-- 1. Fire the trigger by creating a follow row.
INSERT INTO piktag_followers (follower_id, following_id)
VALUES ('<ACTOR_USER_ID>', '<RECIPIENT_USER_ID>')
RETURNING id, created_at;

-- 2. Verify a piktag_notifications row was created (should appear within 1s).
SELECT id, user_id, type, title, body, data, created_at
  FROM piktag_notifications
 WHERE user_id = '<RECIPIENT_USER_ID>'
   AND type    = 'follow'
   AND data->>'actor_user_id' = '<ACTOR_USER_ID>'
 ORDER BY created_at DESC
 LIMIT 1;
-- Expect: title='', body='started following you',
-- data contains actor_user_id, username, avatar_url, follow_id.

-- 3. Verify dedup: the second insert below should return a row from
--    piktag_followers (because UNIQUE will block via ON CONFLICT)
--    OR if you delete + reinsert within 24h, NO new piktag_notifications row appears.
DELETE FROM piktag_followers
 WHERE follower_id = '<ACTOR_USER_ID>'
   AND following_id = '<RECIPIENT_USER_ID>';

INSERT INTO piktag_followers (follower_id, following_id)
VALUES ('<ACTOR_USER_ID>', '<RECIPIENT_USER_ID>');

-- 4. Confirm count did NOT increase by 2 — only the first insert produced a notification.
SELECT count(*) AS after_count
  FROM piktag_notifications
 WHERE user_id = '<RECIPIENT_USER_ID>'
   AND type    = 'follow';

-- 5. (Optional) Confirm push fired by checking the recipient's device, or by tailing
--    the edge function logs / Postgres logs for the net.http_post call.
--    If the recipient has piktag_profiles.push_token set, an Expo push should arrive
--    titled with the actor's username and body 'started following you'.

-- 6. Cleanup (run when done testing).
DELETE FROM piktag_followers
 WHERE follower_id = '<ACTOR_USER_ID>'
   AND following_id = '<RECIPIENT_USER_ID>';
DELETE FROM piktag_notifications
 WHERE user_id = '<RECIPIENT_USER_ID>'
   AND type    = 'follow'
   AND data->>'actor_user_id' = '<ACTOR_USER_ID>';
```

**Pass criteria:**

- Step 2 returns exactly one row with the expected `data` JSONB shape
- Step 4's `after_count` equals `before_count + 1` (NOT `+2`), proving the 24h dedup
- The recipient's device receives one Expo push notification (when `push_token` is configured)

---

## 6. Push Notification

The trigger dispatches an Expo push (via inline `net.http_post` to the relay edge function or directly to Expo). Templates:

| Field | Value (en) | Value (zh-TW) |
|-------|------------|----------------|
| `title` | `{{username}}` | `{{username}}` |
| `body` | `started following you` | `開始追蹤你` |
| `data.type` | `'follow'` | `'follow'` |
| `data.actor_user_id` | `<follower uuid>` | same |
| `sound` | `'default'` | `'default'` |
| `priority` | `'high'` | `'high'` |

**Notes:**

- `{{username}}` is interpolated from the actor's profile (`piktag_profiles.username`, falling back to `full_name`).
- The push is best-effort — wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL` so a push failure never rolls back the notification insert or the original follow.
- The recipient must have a non-null `piktag_profiles.push_token`; otherwise the push is silently skipped.
- i18n keys: `notifications.types.follow.push.title` and `notifications.types.follow.push.body`.

---

## 7. Monitoring

Run this in Supabase Studio (or via `psql`) to count `follow` notifications sent in the last 24 hours:

```sql
SELECT
  count(*)                                                                  AS total_sent_24h,
  count(*) FILTER (WHERE is_read)                                           AS read_count,
  count(*) FILTER (WHERE NOT is_read)                                       AS unread_count,
  count(DISTINCT user_id)                                                   AS unique_recipients,
  count(DISTINCT data->>'actor_user_id')                                    AS unique_actors
  FROM piktag_notifications
 WHERE type       = 'follow'
   AND created_at > now() - interval '24 hours';
```

**Recommended alert thresholds:**

- `total_sent_24h` collapses to `0` while followers were active that day → trigger may be broken
- `total_sent_24h / unique_recipients > 50` → likely follow/unfollow spam slipping past the 24h dedup window
- `read_count / total_sent_24h < 0.05` after 7 days running → UX issue; users not engaging with the notification

For a per-day trend (last 14 days):

```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*)                      AS follow_notifications
  FROM piktag_notifications
 WHERE type       = 'follow'
   AND created_at > now() - interval '14 days'
 GROUP BY 1
 ORDER BY 1 DESC;
```

---

## 8. Edge Cases, Known Issues, Rollback

### Edge cases the trigger handles

- **Self-follow:** Blocked by both `CHECK (follower_id <> following_id)` on the table and the `v_recipient = v_actor` early-return in `notify_follow()`.
- **Actor profile missing:** If `piktag_profiles` has no row for the actor, `username` falls back to `full_name`, then to empty string. `avatar_url` may be `null`. The notification still inserts.
- **No push token on recipient:** Push is skipped silently; the in-app notification still appears via realtime.
- **Re-follow within 24h:** Dedup-SELECT skips the second notification.
- **Service-role / admin inserts:** Plain `INSERT INTO piktag_followers` from the service role still triggers the function (no `auth.uid()` dependency in this type).

### Known issues / things to watch

- **Realtime fan-out depends on `user_id`:** Mobile subscribes to `postgres_changes` filtered by `user_id`. The trigger MUST set `user_id = NEW.following_id`. A bug where `user_id` is set to the actor would silently break delivery without raising errors.
- **Dedup window is 24h, not "until read":** A user who unfollows and refollows after 25h will get two notifications. Intentional, but worth noting if support tickets surface it.
- **Push relay coupling:** If the trigger uses `net.http_post` to a relay edge function (rather than inlining the Expo POST), an outage of that edge function could increase trigger latency. The `EXCEPTION WHEN OTHERS THEN NULL` guard prevents rollback but may produce silent push gaps.
- **No "unfollow" notification:** Out of scope for this type. Deleting from `piktag_followers` does NOT remove the existing `follow` notification row — that is intentional (notifications are an immutable log).

### Rollback

If this type misbehaves in production, the safest disable is to drop the trigger only — keep the table and existing notification rows intact:

```sql
-- Disable notifications without losing follow data.
DROP TRIGGER IF EXISTS trg_notify_follow ON piktag_followers;

-- (Optional, fully revert the type to a no-op without dropping the function.)
DROP FUNCTION IF EXISTS public.notify_follow();
```

To fully revert the migration (destructive — loses follow graph):

```sql
DROP TRIGGER IF EXISTS trg_notify_follow  ON piktag_followers;
DROP FUNCTION IF EXISTS public.notify_follow();
DROP TABLE   IF EXISTS piktag_followers;

-- Optional: clear historical notifications of this type.
DELETE FROM piktag_notifications WHERE type = 'follow';
```

After rollback, redeploy the corrected `20260428q_notification_follow.sql` migration. Do not edit the original file in place — write a follow-up migration with a later suffix.
