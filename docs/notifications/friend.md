# Notification type: `friend`

> Reactive notification fired when two users complete a bidirectional connection (mutual friendship).

## 1. Overview

| Field            | Value                                                |
|------------------|------------------------------------------------------|
| Type name        | `friend`                                             |
| Tab              | `social`                                             |
| Trigger model    | **reactive** (Postgres trigger on `piktag_connections` AFTER INSERT) |
| Migration file   | `mobile/supabase/migrations/20260428r_notification_friend.sql` |
| Trigger function | `public.notify_friend()`                             |
| Edge function    | N/A (trigger-only — no edge function needed)         |
| Pushes?          | Yes                                                  |

The `friend` type is a **mutual** social signal: it is emitted only at the moment a one-way connection becomes bidirectional, producing one notification for each side of the new friendship.

## 2. Trigger condition

**Source table**: `piktag_connections`
**Event**: `AFTER INSERT FOR EACH ROW`

The trigger fires for every new connection row, but only emits notifications when the **reverse** counterpart already exists — i.e., when both `(NEW.user_id, NEW.connected_user_id)` and `(NEW.connected_user_id, NEW.user_id)` rows are now present in `piktag_connections`.

Pseudocode:

```sql
IF EXISTS (
  SELECT 1 FROM piktag_connections
   WHERE user_id = NEW.connected_user_id
     AND connected_user_id = NEW.user_id
) THEN
  -- emit two notifications, one per side
END IF;
```

Two notifications are inserted on the handshake:

- Recipient = `NEW.user_id`,            actor = `NEW.connected_user_id`
- Recipient = `NEW.connected_user_id`,  actor = `NEW.user_id`

Each side is dedup-checked independently before insertion.

## 3. `data` JSONB shape

Exact keys and types written into `piktag_notifications.data`:

| Key                | Type            | Source                                                 |
|--------------------|-----------------|--------------------------------------------------------|
| `actor_user_id`    | `uuid` (string) | The other side's user id                               |
| `friend_user_id`   | `uuid` (string) | Alias of `actor_user_id`; used by mobile router        |
| `connection_id`    | `uuid` (string) | `NEW.id` (or the reverse row's id, depending on side)  |
| `username`         | `string`        | Other side's `username` or `full_name` from `piktag_profiles` |
| `avatar_url`       | `string \| null`| Other side's `avatar_url`                              |

```json
{
  "actor_user_id":  "11111111-2222-3333-4444-555555555555",
  "friend_user_id": "11111111-2222-3333-4444-555555555555",
  "connection_id":  "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "username":       "ada",
  "avatar_url":     "https://cdn.piktag.app/u/ada.png"
}
```

Row-level conventions:
- `title = ''` (empty by spec — UI renders from `data.username` + body)
- `body  = 'you are now friends'` (en) — mobile localizes via i18n key `notifications.types.friend.body`
- `is_read = false`
- `created_at = now()`

Mobile routing key: `friend_user_id` (and the redundant `actor_user_id`) — read by `NotificationsScreen.tsx`.

## 4. Dedup window

**7 days**, scoped to `(user_id, type='friend', data->>'friend_user_id')`.

```sql
SELECT 1 FROM piktag_notifications
 WHERE user_id   = <recipient>
   AND type      = 'friend'
   AND data->>'friend_user_id' = <other_user_id>::text
   AND created_at > now() - interval '7 days'
LIMIT 1;
```

A 7-day window guards against unfriend-then-refriend spam: in practice the bidirectional handshake fires once per relationship, but the window means a re-handshake within the same week is silent.

## 5. Manual test (copy-pasteable SQL)

The following snippet seeds two profiles, inserts the two halves of a connection, and verifies the trigger fired exactly twice. Run inside `supabase db remote sql` or psql against the dev DB.

```sql
-- 1. Pick two existing test users (replace with real uuids in your dev env).
DO $$
DECLARE
  u_a uuid := '11111111-1111-1111-1111-111111111111';   -- replace
  u_b uuid := '22222222-2222-2222-2222-222222222222';   -- replace
BEGIN
  -- 2. Clean prior fixtures so the test is repeatable.
  DELETE FROM piktag_notifications
   WHERE type = 'friend'
     AND user_id IN (u_a, u_b);
  DELETE FROM piktag_connections
   WHERE (user_id = u_a AND connected_user_id = u_b)
      OR (user_id = u_b AND connected_user_id = u_a);

  -- 3. First half of the connection (one-way). Trigger fires but reverse
  --    does not yet exist -> no notification rows produced.
  INSERT INTO piktag_connections (user_id, connected_user_id)
  VALUES (u_a, u_b);

  -- 4. Second half (the bidirectional handshake). Trigger should now insert
  --    one notification per side.
  INSERT INTO piktag_connections (user_id, connected_user_id)
  VALUES (u_b, u_a);
END $$;

-- 5. Verify: expect exactly two rows, one per recipient.
SELECT user_id, type, body,
       data->>'friend_user_id' AS friend_user_id,
       data->>'username'       AS username,
       created_at
  FROM piktag_notifications
 WHERE type = 'friend'
   AND user_id IN ('11111111-1111-1111-1111-111111111111',
                   '22222222-2222-2222-2222-222222222222')
 ORDER BY created_at DESC;
```

Expected result: 2 rows, each with `body = 'you are now friends'`, distinct `user_id`s, and `data->>'friend_user_id'` pointing at the other user.

## 6. Push notification

| Field   | Value                                                    |
|---------|----------------------------------------------------------|
| Send?   | Yes                                                      |
| Title   | `<other side username>` (from `data.username`)           |
| Body    | `you are now friends` (en) / `你們成為朋友了` (zh-TW)        |
| Data    | `{ type: 'friend', friend_user_id, actor_user_id, connection_id }` |
| Sound   | `default`                                                |
| Priority| `high`                                                   |

Push payload (Expo `https://exp.host/--/api/v2/push/send`):

```json
{
  "to":       "<recipient piktag_profiles.push_token>",
  "title":    "ada",
  "body":     "you are now friends",
  "data":     {
    "type":            "friend",
    "friend_user_id":  "11111111-2222-3333-4444-555555555555",
    "actor_user_id":   "11111111-2222-3333-4444-555555555555",
    "connection_id":   "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  },
  "sound":    "default",
  "priority": "high"
}
```

i18n keys:
- `notifications.types.friend.title` → `''`
- `notifications.types.friend.body`  → `you are now friends` / `你們成為朋友了`
- `notifications.types.friend.push.title` → `{{username}}`
- `notifications.types.friend.push.body`  → `you are now friends` / `你們成為朋友了`

The push call is wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL` (or a `try/catch` if dispatched via an edge relay) so push failure never blocks the in-app notification insert.

## 7. Monitoring

Count `friend` notifications produced in the last 24 hours:

```sql
SELECT count(*) AS friend_notifications_24h
  FROM piktag_notifications
 WHERE type = 'friend'
   AND created_at > now() - interval '24 hours';
```

Operational sanity-check (rows should always come in even pairs because both sides are notified on a handshake):

```sql
SELECT date_trunc('hour', created_at) AS hour,
       count(*)                       AS rows_inserted
  FROM piktag_notifications
 WHERE type = 'friend'
   AND created_at > now() - interval '24 hours'
 GROUP BY 1
 ORDER BY 1 DESC;
```

A persistent odd-count bucket indicates the trigger is firing for one side but the other was deduped (or skipped due to a missing profile row) — investigate.

## 8. Edge cases & rollback

### Bidirectional update arriving twice quickly
If both halves of `piktag_connections` are inserted in the same transaction, or in two transactions racing within milliseconds, each `AFTER INSERT` invocation independently re-checks `EXISTS (reverse)`. The first insert sees no reverse and produces no notifications; the second sees the reverse and emits two. The dedup-SELECT-then-INSERT pattern (§3.7 of the master spec) prevents double-emit if the trigger runs twice for the same handshake (e.g., due to a retry).

### Re-friending after an unfriend
If the pair unfriends (rows deleted) and re-friends within 7 days, the dedup window suppresses the second notification. This is intentional (anti-spam). After 7 days, a fresh handshake produces fresh notifications.

### Self-connection
The trigger guards against `NEW.user_id = NEW.connected_user_id` (no-op return). The `piktag_connections` `UNIQUE (user_id, connected_user_id)` constraint and any `CHECK` on self-rows further prevent this.

### Missing profile
If `piktag_profiles` is missing for the actor (rare race during signup), `username`/`avatar_url` fall back to empty/null. The notification still inserts so the recipient is not silently dropped; mobile renders a generic placeholder.

### Block list
Spec does not require a block-list check on `friend` (it requires a mutual connection to fire, which already implies prior consent). If a future requirement adds it, model after `send-chat-push` (`piktag_blocks` both directions).

### Rollback note
To revert this slice cleanly:

```sql
DROP TRIGGER  IF EXISTS trg_notify_friend ON piktag_connections;
DROP FUNCTION IF EXISTS public.notify_friend();
-- Optional cleanup of historical rows:
-- DELETE FROM piktag_notifications WHERE type = 'friend';
```

This rollback is safe: no new tables or columns are introduced by this slice, and removing the trigger does not affect existing `piktag_connections` data.
