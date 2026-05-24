# PikTag Notification Types — Master Implementation Spec

**Audience:** 27 downstream agents implementing 9 notification types in parallel.
**Goal:** zero collisions in migration filenames, identical conventions, identical `data` JSONB shapes.

Read this whole document before touching any file. If your slice contradicts something here, escalate — do not improvise.

---

## 0. TL;DR coordination table

| # | Type             | Tab       | Trigger model | Migration filename                              | Edge function dir                  | Needs new table? |
|---|------------------|-----------|---------------|-------------------------------------------------|------------------------------------|------------------|
| 1 | `follow`         | social    | reactive      | `20260428q_notification_follow.sql`             | n/a (trigger only)                 | YES — `piktag_followers` (in same migration) |
| 2 | `friend`         | social    | reactive      | `20260428r_notification_friend.sql`             | n/a (trigger only)                 | no               |
| 3 | `tag_added`      | social    | reactive      | `20260428s_notification_tag_added.sql`          | n/a (trigger only)                 | no               |
| 4 | `recommendation` | social    | scheduled     | `20260428t_notification_recommendation.sql`     | `notification-recommendation`      | no (uses RPC)    |
| 5 | `tag_trending`   | social    | scheduled     | `20260428u_notification_tag_trending.sql`       | `notification-tag-trending`        | no (uses tag_snapshots) |
| 6 | `biolink_click`  | reminders | reactive      | `20260428v_notification_biolink_click.sql`      | n/a (trigger only)                 | YES — `piktag_biolink_clicks` (in same migration) |
| 7 | `birthday`       | reminders | scheduled     | `20260428w_notification_birthday.sql`           | `notification-birthday`            | no               |
| 8 | `anniversary`    | reminders | scheduled     | `20260428x_notification_anniversary.sql`        | `notification-anniversary`         | no               |
| 9 | `contract_expiry`| reminders | scheduled     | `20260428y_notification_contract_expiry.sql`    | `notification-contract-expiry`     | no               |

Total: **9 migrations**, **6 new edge functions**, **2 new base tables** (`piktag_followers`, `piktag_biolink_clicks`).

---

## 1. Schema audit

### 1.1 Migration directory current state

Path: `/Users/aimand/.gemini/File/PikTag-mobile/mobile/supabase/migrations/`

The directory contains 43 migrations dated `20260326` → `20260428p`. Filenames follow the pattern `YYYYMMDD[suffix]_<descriptive_snake_case>.sql`. When multiple migrations land on the same day, lowercase letter suffixes (`b`, `c`, …) are appended to enforce ordering (Supabase applies migrations in lexicographic order). The most recent file is `20260428p_search_init_rpc.sql`.

**The 9 new migrations claim suffixes `q` through `y` on date `20260428`** (today). Each agent owns exactly one suffix. Do not deviate.

### 1.2 `piktag_notifications` table — current shape

This table was created **before** the migration directory's earliest file (`20260326`). It is part of the base schema and is not (re)defined inside this folder. Inferred shape from production usage in `mobile/supabase/functions/daily-followup-check/index.ts` and `mobile/src/screens/NotificationsScreen.tsx`:

```sql
-- Inferred current schema (DO NOT re-create; ALTER only if needed):
piktag_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- recipient
  type        text NOT NULL,         -- 'reminder' | 'follow' | 'friend' | 'tag_added' | 'recommendation' | 'tag_trending' | 'biolink_click' | 'birthday' | 'anniversary' | 'contract_expiry'
  title       text NOT NULL,
  body        text,
  data        jsonb,                 -- per-type payload, see §2
  is_read     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Existing upsert conflict target** used by `daily-followup-check`: `(user_id, type, title)`. We will **NOT rely on that for new types** — the new dedup strategy is described in §3.7. If a unique index on `(user_id, type, title)` does not exist, agents should not assume it does.

**RLS:** Recipients select their own rows (`auth.uid() = user_id`), update `is_read` themselves. Inserts come from triggers / edge functions running as `service_role` or `SECURITY DEFINER`, never from `authenticated` directly. If your migration needs to add an RLS policy, scope it to `service_role`.

**Realtime:** The mobile client subscribes via `postgres_changes` filtered on `user_id`. Newly inserted rows must include `user_id` correctly so realtime fan-out works.

### 1.3 `piktag_connections` — bidirectional friendship rows

Inferred from `20260408_pending_connections.sql`, `20260401_connections_is_reviewed.sql`, and `mobile/src/types/index.ts`:

```sql
piktag_connections (
  id                uuid PK,
  user_id           uuid NOT NULL,           -- owner (the viewer)
  connected_user_id uuid NOT NULL,           -- the other person
  nickname          text,
  note              text,
  met_at            timestamptz,
  met_location      text,
  birthday          date,                    -- per-connection override
  anniversary       date,                    -- meeting anniversary date (separate from met_at)
  contract_expiry   date,
  scan_session_id   text,
  is_reviewed       boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz,
  UNIQUE (user_id, connected_user_id)
);
```

A "friend" relationship is **bidirectional**: rows exist for both directions (`(A,B)` and `(B,A)`). The `friend` notification type fires when both directions exist.

### 1.4 `piktag_profiles` — user profiles

Inferred shape:

```sql
piktag_profiles (
  id          uuid PK REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text UNIQUE,
  full_name   text,
  avatar_url  text,
  bio         text,
  birthday    date,                  -- profile owner's own birthday (used by 'birthday' type fallback)
  push_token  text,                  -- Expo push token, added in 20260402_push_token.sql
  language    text,
  is_verified boolean,
  is_public   boolean,
  ...
);
```

### 1.5 `piktag_tags`, `piktag_user_tags`, `piktag_connection_tags`

```sql
piktag_tags (
  id            uuid PK,
  name          text UNIQUE,
  semantic_type text,
  parent_tag_id uuid,
  usage_count   integer DEFAULT 0,
  ...
);

piktag_user_tags (        -- a tag attached to a profile
  id          uuid PK,
  user_id     uuid NOT NULL,
  tag_id      uuid NOT NULL,
  position    int,
  weight      numeric,
  is_private  boolean,
  is_pinned   boolean,
  created_at  timestamptz,
  UNIQUE (user_id, tag_id)
);

piktag_connection_tags (  -- private tags on a connection (not on the profile)
  id            uuid PK,
  connection_id uuid NOT NULL REFERENCES piktag_connections(id),
  tag_id        uuid NOT NULL REFERENCES piktag_tags(id),
  is_private    boolean,
  position      int,
  created_at    timestamptz
);
```

`tag_added` notification fires when a row is inserted into `piktag_user_tags` by another user (i.e., someone tags THIS user's profile). Note: in this codebase, `piktag_user_tags.user_id` is the *owner of the profile being tagged*, but the *actor* (who placed the tag) is not stored on this row directly — see §2.3 for handling.

### 1.6 `piktag_biolinks` — links on a profile

Inferred shape (from `20260330_biolink_visibility.sql` + `20260330_biolinks_display_mode.sql` + types):

```sql
piktag_biolinks (
  id           uuid PK,
  user_id      uuid NOT NULL,
  platform     text,
  url          text,
  label        text,
  position     int,
  is_active    boolean,
  display_mode text DEFAULT 'card',
  visibility   text DEFAULT 'public',
  icon_url     text,
  created_at   timestamptz
);
```

`piktag_biolink_clicks` does **not exist yet**. Migration `20260428v_notification_biolink_click.sql` creates it (see §2.6).

### 1.7 Existing edge function patterns — `daily-followup-check`

Path: `mobile/supabase/functions/daily-followup-check/index.ts`. Patterns to copy:

1. `serve()` from `https://deno.land/std@0.168.0/http/server.ts`.
2. `createClient` from `https://esm.sh/@supabase/supabase-js@2`.
3. CORS preflight: respond `'ok'` to `OPTIONS`.
4. **Auth gate**: require `Authorization: Bearer <CRON_SECRET>` header, constant-time compare. Return 403 on mismatch.
5. Read env: `Deno.env.get('SUPABASE_URL')!`, `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!`, `Deno.env.get('CRON_SECRET')!`.
6. Insert via `.upsert(..., { onConflict: 'user_id,type,title' })` with `.catch(() => {})` to swallow duplicates.
7. Push notification: read `push_token` from `piktag_profiles`, POST to `https://exp.host/--/api/v2/push/send` with `{ to, title, body, data: { type, ... }, sound: 'default' }`. Wrap in `.catch(() => {})`.
8. Return JSON `{ message, reminders_created }`. On error return 500 with `{ error: err.message }`.

The new edge functions in this spec follow the same shape, **except** they switch from "upsert with onConflict" to "explicit dedup SELECT" because dedup keys for the new types are inside `data` JSONB, not in `title` (see §3.7).

### 1.8 Existing edge function patterns — `send-chat-push`

Path: `mobile/supabase/functions/send-chat-push/index.ts`. Patterns to copy:

1. POST-only.
2. **Auth gate**: require `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (the trigger calls with the service role key from Vault). Constant-time compare.
3. Looks up the inserted row, computes recipient, fetches `push_token`, POSTs to Expo.
4. Block-list check: query `piktag_blocks` both directions, skip if either party blocked the other.
5. `MAX_BODY_CHARS = 200` truncation.

### 1.9 Mobile push-notification client expectations

Path: `mobile/src/lib/pushNotifications.ts`. The client just registers an Expo token and writes it to `piktag_profiles.push_token`. The server pushes via Expo's `https://exp.host/--/api/v2/push/send`.

The Expo payload shape the client expects:

```json
{
  "to": "<expo_push_token>",
  "title": "<short>",
  "body":  "<longer>",
  "data":  { "type": "<one of the 10 types>", "...": "type-specific routing keys" },
  "sound": "default",
  "priority": "high"
}
```

Routing keys inside `data` that the mobile screen reads (from `NotificationsScreen.tsx`):
`actor_user_id`, `connected_user_id`, `friend_user_id`, `recommended_user_id`, `clicker_user_id`, `user_id`, `tag_id`, `tag_name`. **You must populate at least one of these in your `data` JSONB so the deep-link works.**

---

## 2. Per-type spec cards

### 2.1 Type: `follow`

- **Tab**: social
- **Trigger model**: reactive (Postgres trigger on `piktag_followers` AFTER INSERT)
- **Trigger condition**: when row inserted into `piktag_followers` (a new follow relationship)
- **Source table**: `piktag_followers` (NEW — this migration creates it)
- **Recipient (`piktag_notifications.user_id`)**: `NEW.following_id` (the user being followed)
- **`data` JSONB shape**:
  ```json
  {
    "actor_user_id": "<NEW.follower_id>",
    "username":      "<follower's username or full_name>",
    "avatar_url":    "<follower's avatar_url or null>",
    "follow_id":     "<NEW.id>"
  }
  ```
- **`title` value**: `''` (empty — UI renders username from `data.username` + body)
- **`body` value**: `'started following you'` (en) / `'開始追蹤你'` (zh-TW) — the trigger writes the en string; mobile localizes via i18n keys, fall back to the stored body.
- **Dedup rule**: skip insert if `(user_id=following_id, type='follow', data->>'actor_user_id'=follower_id)` already exists within last 24h. (Re-follow within 24h is silent.)
- **Push notification?**: yes. Title: `<follower username>`. Body: `started following you`.
- **Migration file to create**: `mobile/supabase/migrations/20260428q_notification_follow.sql`. **In addition to the trigger**, this migration creates the `piktag_followers` table with: `id uuid PK`, `follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`, `created_at timestamptz DEFAULT now()`, `UNIQUE(follower_id, following_id)`, `CHECK (follower_id <> following_id)`. Indexes: `idx_followers_following (following_id, created_at DESC)`, `idx_followers_follower (follower_id, created_at DESC)`. RLS: select where `auth.uid() IN (follower_id, following_id)`, insert where `auth.uid() = follower_id`, delete where `auth.uid() = follower_id`.
- **Edge function to create**: N/A — trigger only.
- **Mobile i18n keys to add**:
  - `notifications.types.follow.title` → `''` (en), `''` (zh-TW)
  - `notifications.types.follow.body`  → `started following you` (en), `開始追蹤你` (zh-TW)
  - `notifications.types.follow.push.title` → `{{username}}` (both)
  - `notifications.types.follow.push.body`  → `started following you` (en), `開始追蹤你` (zh-TW)

---

### 2.2 Type: `friend`

- **Tab**: social
- **Trigger model**: reactive (trigger on `piktag_connections` AFTER INSERT)
- **Trigger condition**: a new row in `piktag_connections` whose **reverse** counterpart already exists (i.e., bidirectional now). Pseudocode: `IF EXISTS (SELECT 1 FROM piktag_connections WHERE user_id = NEW.connected_user_id AND connected_user_id = NEW.user_id) THEN <emit two notifications, one per side>`.
- **Source table**: `piktag_connections`
- **Recipient**: emit **two** notifications — one for `NEW.user_id` (recipient = NEW.user_id, actor = NEW.connected_user_id) and one for `NEW.connected_user_id` (recipient = NEW.connected_user_id, actor = NEW.user_id). Both rows independently dedup-checked.
- **`data` JSONB shape**:
  ```json
  {
    "actor_user_id":   "<other side>",
    "friend_user_id":  "<other side>",      // alias used by mobile router
    "connection_id":   "<NEW.id or reverse id>",
    "username":        "<other side username/full_name>",
    "avatar_url":      "<other side avatar>"
  }
  ```
- **`title` value**: `''`
- **`body` value**: `you are now friends` (en) / `你們成為朋友了` (zh-TW)
- **Dedup rule**: skip if same `(user_id, type='friend', data->>'friend_user_id')` exists within 7 days (this only fires once on bidirectional handshake; 7d guards against unfriend→refriend spam).
- **Push notification?**: yes. Title: friend's username. Body: `you are now friends`.
- **Migration file**: `20260428r_notification_friend.sql`
- **Edge function**: N/A — trigger only.
- **i18n keys**: `notifications.types.friend.{title,body,push.title,push.body}`

---

### 2.3 Type: `tag_added`

- **Tab**: social
- **Trigger model**: reactive (trigger on `piktag_user_tags` AFTER INSERT)
- **Trigger condition**: a row inserted into `piktag_user_tags` where the inserter (`auth.uid()`) is **not** `NEW.user_id`. The actor is `auth.uid()` captured inside the trigger via `current_setting('request.jwt.claim.sub', true)::uuid` (Supabase pattern — falls back to `NULL` for service-role inserts; in that case skip the notification).
- **Source table**: `piktag_user_tags`
- **Recipient**: `NEW.user_id` (the profile owner being tagged)
- **`data` JSONB shape**:
  ```json
  {
    "actor_user_id": "<auth.uid() of inserter>",
    "username":      "<actor username>",
    "avatar_url":    "<actor avatar>",
    "tag_id":        "<NEW.tag_id>",
    "tag_name":      "<piktag_tags.name>",
    "user_tag_id":   "<NEW.id>"
  }
  ```
- **`title` value**: `''`
- **`body` value**: `tagged you as #{{tag_name}}` (en) / `把你標記為 #{{tag_name}}` (zh-TW). Trigger writes the rendered en string with `tag_name` substituted.
- **Dedup rule**: skip if same `(user_id, type='tag_added', data->>'actor_user_id', data->>'tag_id')` exists within 24h.
- **Push notification?**: yes.
- **Migration file**: `20260428s_notification_tag_added.sql`
- **Edge function**: N/A — trigger only.
- **i18n keys**: `notifications.types.tag_added.{title,body,push.title,push.body}` — body uses `{{tag_name}}` interpolation.

---

### 2.4 Type: `recommendation`

- **Tab**: social
- **Trigger model**: scheduled (daily cron → edge function)
- **Trigger condition**: once a day at 09:30 local, recommend up to 3 candidate users per recipient. Candidate selection: users with ≥2 mutual tags AND no existing connection AND not blocked. Score by mutual_tag_count DESC.
- **Source**: edge function reads `piktag_user_tags`, `piktag_connections`, `piktag_blocks`, `piktag_profiles`.
- **Recipient**: each user with at least 1 candidate.
- **`data` JSONB shape**:
  ```json
  {
    "recommended_user_id": "<candidate user_id>",
    "username":            "<candidate username>",
    "avatar_url":          "<candidate avatar>",
    "mutual_tag_count":    3,
    "mutual_tag_ids":      ["<uuid>", "<uuid>", "<uuid>"]
  }
  ```
- **`title` value**: `''`
- **`body` value**: `you might know {{username}} — {{count}} mutual tags` (en) / `你可能認識 {{username}} — {{count}} 個共同標籤` (zh-TW)
- **Dedup rule**: skip if same `(user_id, type='recommendation', data->>'recommended_user_id')` exists within 14 days.
- **Push notification?**: yes (one push per recipient per day, batched — first candidate only).
- **Migration file**: `20260428t_notification_recommendation.sql` — defines `enqueue_recommendation_notifications()` SQL helper (see §4.2) and a `pg_cron` schedule that POSTs to the edge function with `CRON_SECRET`.
- **Edge function**: `mobile/supabase/functions/notification-recommendation/index.ts`
- **i18n keys**: `notifications.types.recommendation.{title,body,push.title,push.body}`

---

### 2.5 Type: `tag_trending`

- **Tab**: social
- **Trigger model**: scheduled (daily cron → edge function)
- **Trigger condition**: each midnight, compute trending tags = tags whose `usage_count` increased ≥5× over its 7-day rolling average. For each trending tag, notify all users where `piktag_user_tags.tag_id = trending_tag` (i.e., who own that tag).
- **Source**: edge function reads `piktag_tags`, `piktag_tag_snapshots` (assumed to exist — referenced in `mobile/src/types/index.ts` as `TagSnapshot`), `piktag_user_tags`.
- **Recipient**: each user owning a trending tag.
- **`data` JSONB shape**:
  ```json
  {
    "tag_id":          "<uuid>",
    "tag_name":        "<text>",
    "usage_count":     127,
    "growth_factor":   6.4,
    "rank":            1
  }
  ```
- **`title` value**: `''`
- **`body` value**: `your tag #{{tag_name}} is trending today` (en) / `你的標籤 #{{tag_name}} 今天爆紅了` (zh-TW)
- **Dedup rule**: skip if same `(user_id, type='tag_trending', data->>'tag_id')` exists within 7 days.
- **Push notification?**: yes (rank 1 only — don't spam users with multiple trending tags in one push).
- **Migration file**: `20260428u_notification_tag_trending.sql` — `enqueue_tag_trending_notifications()` + cron schedule.
- **Edge function**: `mobile/supabase/functions/notification-tag-trending/index.ts`
- **i18n keys**: `notifications.types.tag_trending.{title,body,push.title,push.body}`

---

### 2.6 Type: `biolink_click`

- **Tab**: reminders
- **Trigger model**: reactive (trigger on `piktag_biolink_clicks` AFTER INSERT)
- **Trigger condition**: a new click row. Skip if `clicker_user_id = biolink owner` (self-click).
- **Source table**: `piktag_biolink_clicks` (NEW — this migration creates it)
- **Recipient**: `piktag_biolinks.user_id` (the biolink owner) — joined from `NEW.biolink_id`.
- **`data` JSONB shape**:
  ```json
  {
    "clicker_user_id": "<NEW.clicker_user_id or null for anon>",
    "username":        "<clicker username or 'Someone'>",
    "avatar_url":      "<clicker avatar or null>",
    "biolink_id":      "<NEW.biolink_id>",
    "platform":        "<piktag_biolinks.platform>",
    "label":           "<piktag_biolinks.label or null>"
  }
  ```
- **`title` value**: `''`
- **`body` value**: `clicked your {{platform}} link` (en) / `點擊了你的 {{platform}} 連結` (zh-TW)
- **Dedup rule**: rate-limit — at most 1 notification per `(user_id, type='biolink_click', data->>'biolink_id')` per 60 minutes. (Hot links would spam otherwise.)
- **Push notification?**: NO (too noisy). In-app notification only.
- **Migration file**: `20260428v_notification_biolink_click.sql`. Creates `piktag_biolink_clicks`: `id uuid PK`, `biolink_id uuid NOT NULL REFERENCES piktag_biolinks(id) ON DELETE CASCADE`, `clicker_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` (nullable for anon clicks), `referer text`, `user_agent text`, `created_at timestamptz DEFAULT now()`. Indexes: `idx_biolink_clicks_biolink (biolink_id, created_at DESC)`, `idx_biolink_clicks_clicker (clicker_user_id) WHERE clicker_user_id IS NOT NULL`. RLS: insert allowed for `anon` and `authenticated` (clicks from public web), select restricted to biolink owner.
- **Edge function**: N/A — trigger only.
- **i18n keys**: `notifications.types.biolink_click.{title,body}` (no push subkeys).

---

### 2.7 Type: `birthday`

- **Tab**: reminders
- **Trigger model**: scheduled (daily cron → edge function, run at 08:00)
- **Trigger condition**: for each `piktag_connections` row where `birthday IS NOT NULL` and the month/day matches today's month/day, notify `user_id`. Falls back to `connected_user.birthday` (profile birthday) if `connection.birthday` is NULL.
- **Source**: edge function reads `piktag_connections` JOIN `piktag_profiles`.
- **Recipient**: `piktag_connections.user_id`.
- **`data` JSONB shape**:
  ```json
  {
    "connected_user_id": "<uuid>",
    "connection_id":     "<uuid>",
    "username":          "<connection nickname or full_name or username>",
    "avatar_url":        "<connected user's avatar>",
    "birthday":          "<MM-DD>",
    "age":               31                   // null if year unknown
  }
  ```
- **`title` value**: `''`
- **`body` value**: `it's {{username}}'s birthday today` (en) / `今天是 {{username}} 的生日` (zh-TW)
- **Dedup rule**: skip if same `(user_id, type='birthday', data->>'connected_user_id')` exists within last 300 days. (Once per year.)
- **Push notification?**: yes.
- **Migration file**: `20260428w_notification_birthday.sql` — `enqueue_birthday_notifications()` + cron schedule.
- **Edge function**: `mobile/supabase/functions/notification-birthday/index.ts`
- **i18n keys**: `notifications.types.birthday.{title,body,push.title,push.body}`

---

### 2.8 Type: `anniversary`

- **Tab**: reminders
- **Trigger model**: scheduled (daily cron → edge function, run at 08:05)
- **Trigger condition**: for each `piktag_connections` row, compute years-since-`met_at` (or `anniversary` column when present). If today's month/day matches `met_at` month/day AND years ≥ 1, notify.
- **Source**: edge function reads `piktag_connections` JOIN `piktag_profiles`.
- **Recipient**: `piktag_connections.user_id`.
- **`data` JSONB shape**:
  ```json
  {
    "connected_user_id": "<uuid>",
    "connection_id":     "<uuid>",
    "username":          "<other side display name>",
    "avatar_url":        "<other side avatar>",
    "years":             3,
    "met_at":            "<ISO date>"
  }
  ```
- **`title` value**: `''`
- **`body` value**: `{{years}} years ago today, you met {{username}}` (en) / `{{years}} 年前的今天，你認識了 {{username}}` (zh-TW)
- **Dedup rule**: skip if same `(user_id, type='anniversary', data->>'connection_id', data->>'years')` exists ever. (Each anniversary year fires once for all time.)
- **Push notification?**: yes.
- **Migration file**: `20260428x_notification_anniversary.sql`.
- **Edge function**: `mobile/supabase/functions/notification-anniversary/index.ts`.
- **NOTE**: `daily-followup-check` already implements an "On This Day" loop with similar semantics under `type='reminder'`. **Coordinator decision**: keep `daily-followup-check` as-is for now; the new `anniversary` type is the canonical version. Mobile will display both until a follow-up cleanup migration migrates legacy reminders. Do not delete `daily-followup-check` from this slice.
- **i18n keys**: `notifications.types.anniversary.{title,body,push.title,push.body}`

---

### 2.9 Type: `contract_expiry`

- **Tab**: reminders
- **Trigger model**: scheduled (daily cron → edge function, run at 08:10)
- **Trigger condition**: for each `piktag_connections` row where `contract_expiry IS NOT NULL`, fire when `contract_expiry - today` is exactly 30, 7, or 1 days, **and** also fire on the day-of (`= 0`).
- **Source**: edge function reads `piktag_connections` JOIN `piktag_profiles`.
- **Recipient**: `piktag_connections.user_id`.
- **`data` JSONB shape**:
  ```json
  {
    "connected_user_id": "<uuid>",
    "connection_id":     "<uuid>",
    "username":          "<other side display name>",
    "avatar_url":        "<other side avatar>",
    "contract_expiry":   "<ISO date>",
    "days_until":        7    // 30 | 7 | 1 | 0
  }
  ```
- **`title` value**: `''`
- **`body` value**: `your contract with {{username}} expires in {{days_until}} days` (en, plural-aware via i18n) / `你與 {{username}} 的合約還有 {{days_until}} 天到期` (zh-TW). When `days_until=0`: `your contract with {{username}} expires today` / `你與 {{username}} 的合約今天到期`.
- **Dedup rule**: skip if same `(user_id, type='contract_expiry', data->>'connection_id', data->>'days_until')` exists ever. (Each milestone fires once per contract.)
- **Push notification?**: yes (high signal, low frequency).
- **Migration file**: `20260428y_notification_contract_expiry.sql`.
- **Edge function**: `mobile/supabase/functions/notification-contract-expiry/index.ts`.
- **i18n keys**: `notifications.types.contract_expiry.{title,body,bodyToday,push.title,push.body}`

---

## 3. Cross-cutting conventions (every implementer reads this)

### 3.1 Migration filename numbering

Today's date is **2026-04-28**. The latest existing migration on disk is `20260428p_search_init_rpc.sql`. The 9 new migrations claim suffixes `q` through `y` consecutively:

```
20260428q_notification_follow.sql
20260428r_notification_friend.sql
20260428s_notification_tag_added.sql
20260428t_notification_recommendation.sql
20260428u_notification_tag_trending.sql
20260428v_notification_biolink_click.sql
20260428w_notification_birthday.sql
20260428x_notification_anniversary.sql
20260428y_notification_contract_expiry.sql
```

If a slice is split across multiple agents (e.g., one writes the table migration, another writes the trigger), the same filename is shared — the agents must coordinate to land a single SQL file. Suffix `z` is **reserved** and should not be used.

### 3.2 Trigger function naming

`public.notify_<type>()` returns trigger. Examples: `notify_follow()`, `notify_friend()`, `notify_tag_added()`, `notify_biolink_click()`. **Note: `notify_*` not `piktag_notify_*`** — distinct from the existing `piktag_notify_message_push` to avoid confusion.

### 3.3 SQL helper function naming for cron-driven types

`public.enqueue_<type>_notifications()` returns void. Examples: `enqueue_recommendation_notifications()`, `enqueue_tag_trending_notifications()`, `enqueue_birthday_notifications()`, `enqueue_anniversary_notifications()`, `enqueue_contract_expiry_notifications()`. The cron schedule calls `pg_net.http_post` to the edge function (which then calls back into Postgres if needed). Either pattern is acceptable — a simple helper that does it all in SQL is preferred when feasible.

### 3.4 Edge function naming

`notification-<type>` (kebab-case, dash separator), under `mobile/supabase/functions/`. The 5 cron edge functions:
- `notification-recommendation`
- `notification-tag-trending`
- `notification-birthday`
- `notification-anniversary`
- `notification-contract-expiry`

### 3.5 i18n root key

```
notifications.types.<type>.title
notifications.types.<type>.body
notifications.types.<type>.push.title    # only for types that push
notifications.types.<type>.push.body     # only for types that push
```

Add to **both** `mobile/src/i18n/locales/en.json` and `mobile/src/i18n/locales/zh-TW.json` (and `zh-CN.json` mirror of zh-TW). Use `{{username}}`, `{{tag_name}}`, `{{count}}`, `{{days_until}}`, `{{years}}` as interpolation variables. Plural forms in en use the i18next `_one` / `_other` suffix where applicable.

### 3.6 Required Supabase env vars in edge functions

```
SUPABASE_URL                  (auto-provided by Supabase runtime)
SUPABASE_SERVICE_ROLE_KEY     (auto-provided)
CRON_SECRET                   (operator-set, used to gate cron-triggered functions)
```

Reactive triggers run inside Postgres and read service role key from `vault.decrypted_secrets WHERE name = 'piktag_service_role_key'`. **Do not** add new Vault secrets per type — re-use the two seeded by `20260422_chat_push_trigger_vault.sql` (`piktag_service_role_key`, `piktag_supabase_url`).

### 3.7 Dedup strategy (canonical)

**Before** every `INSERT INTO piktag_notifications`, run:

```sql
SELECT 1 FROM piktag_notifications
 WHERE user_id   = <recipient>
   AND type      = '<type>'
   AND <key dedup checks against `data` JSONB, e.g. data->>'actor_user_id' = <actor>>
   AND created_at > now() - interval '<window from spec card>'
LIMIT 1;
```

If a row is found, skip the insert. Use this pattern in both reactive triggers (PL/pgSQL `IF EXISTS ... THEN RETURN NEW;`) and in edge functions (Supabase JS query then `if (data) skip`).

**Do NOT use `.upsert(..., { onConflict: 'user_id,type,title' })` for the new types** — title is empty so it would collapse all rows of the same type into one. The legacy `daily-followup-check` continues to use that pattern; new types use the explicit dedup-SELECT-then-INSERT pattern.

### 3.8 SECURITY DEFINER + search_path

All new trigger functions and helper functions:

```sql
CREATE OR REPLACE FUNCTION public.notify_<type>()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ ... $$;

REVOKE ALL ON FUNCTION public.notify_<type>() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_<type>() TO postgres, service_role;
```

Trigger creation:

```sql
DROP TRIGGER IF EXISTS trg_notify_<type> ON <source_table>;
CREATE TRIGGER trg_notify_<type>
AFTER INSERT ON <source_table>
FOR EACH ROW EXECUTE FUNCTION public.notify_<type>();
```

### 3.9 Notification row insert convention

All `piktag_notifications` rows MUST set:

```sql
INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
VALUES (
  <recipient_uuid>,
  '<type>',
  '',                 -- title: empty by convention; mobile renders from data.username + body
  '<en body string with interpolation already filled>',
  jsonb_build_object(
    'actor_user_id', <actor>,
    'username',      <actor_username>,
    'avatar_url',    <actor_avatar>,
    -- ...type-specific fields per spec card...
  ),
  false,
  now()
);
```

The mobile UI **always** reads `data.username` and `data.avatar_url`. Even for types with no human actor (`birthday`, `anniversary`, `contract_expiry`, `tag_trending`), populate `username` with the connected user's display name (or for `tag_trending`, the tag name).

### 3.10 Push notification convention

For types that push: after the `INSERT INTO piktag_notifications` succeeds, fetch `push_token` from the recipient's `piktag_profiles` row. If non-null, POST to `https://exp.host/--/api/v2/push/send` with the payload from §1.9. Wrap the call in a try/catch; never let push failure block the notification insert.

In Postgres triggers, push is dispatched by calling out to an edge function via `net.http_post` (mirroring the `piktag_notify_message_push` pattern) **OR** by inlining a plain Expo push call from the trigger. Inline is acceptable for low-volume reactive types (`follow`, `friend`, `tag_added`); use an edge function relay for higher-volume types if rate-limiting becomes a concern.

Cron edge functions push directly via `fetch()`.

---

## 4. Sample SQL templates

### 4.1 Canonical reactive trigger template (copy & replace `<TYPE>`, `<SOURCE_TABLE>`, etc.)

```sql
-- 20260428<SUFFIX>_notification_<TYPE>.sql
-- Reactive notification trigger: <plain English description>

CREATE OR REPLACE FUNCTION public.notify_<TYPE>()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient        uuid;
  v_actor            uuid;
  v_actor_profile    record;
  v_already_exists   boolean;
  v_dedup_window     interval := interval '24 hours';   -- override per type
  v_body             text;
BEGIN
  -- 1. Compute recipient and actor.
  v_recipient := <recipient_expression>;       -- e.g. NEW.following_id
  v_actor     := <actor_expression>;           -- e.g. NEW.follower_id

  -- 2. Defensive: never notify a user about their own action.
  IF v_recipient IS NULL OR v_actor IS NULL OR v_recipient = v_actor THEN
    RETURN NEW;
  END IF;

  -- 3. Dedup check.
  SELECT EXISTS (
    SELECT 1 FROM piktag_notifications
     WHERE user_id   = v_recipient
       AND type      = '<TYPE>'
       AND data->>'actor_user_id' = v_actor::text
       AND created_at > now() - v_dedup_window
  ) INTO v_already_exists;
  IF v_already_exists THEN RETURN NEW; END IF;

  -- 4. Resolve actor profile fields needed by mobile.
  SELECT id, username, full_name, avatar_url
    INTO v_actor_profile
    FROM piktag_profiles
   WHERE id = v_actor;

  v_body := '<en body template, with substitutions if needed>';

  -- 5. Insert.
  INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
  VALUES (
    v_recipient,
    '<TYPE>',
    '',
    v_body,
    jsonb_build_object(
      'actor_user_id', v_actor,
      'username',      COALESCE(v_actor_profile.username, v_actor_profile.full_name, ''),
      'avatar_url',    v_actor_profile.avatar_url
      -- + type-specific fields
    ),
    false,
    now()
  );

  -- 6. (Optional) fire push via net.http_post to a relay edge function.
  -- See §3.10. Wrap in BEGIN ... EXCEPTION WHEN OTHERS to never block.

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_<TYPE>() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_<TYPE>() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_<TYPE> ON <SOURCE_TABLE>;
CREATE TRIGGER trg_notify_<TYPE>
AFTER INSERT ON <SOURCE_TABLE>
FOR EACH ROW EXECUTE FUNCTION public.notify_<TYPE>();
```

### 4.2 Canonical cron helper function template (pure SQL, no edge function needed)

```sql
-- 20260428<SUFFIX>_notification_<TYPE>.sql
-- Scheduled notification helper: <plain English description>

CREATE OR REPLACE FUNCTION public.enqueue_<TYPE>_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT
      <recipient_id>     AS recipient,
      <key_for_dedup>    AS dedup_key,
      <other fields>
    FROM <source_join>
    WHERE <condition matching today>
      AND NOT EXISTS (
        SELECT 1 FROM piktag_notifications n
         WHERE n.user_id = <recipient_id>
           AND n.type    = '<TYPE>'
           AND n.data->><dedup_key_field> = <dedup_key>::text
           AND n.created_at > now() - interval '<dedup window>'
      )
  LOOP
    INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
    VALUES (
      v_row.recipient,
      '<TYPE>',
      '',
      <rendered body>,
      jsonb_build_object(/* per-type fields */),
      false,
      now()
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_<TYPE>_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_<TYPE>_notifications() TO postgres, service_role;

-- Schedule via pg_cron (08:00 UTC daily — adjust per type).
-- pg_cron is already enabled in this project (see daily-followup-check schedule).
SELECT cron.schedule(
  'notification-<TYPE>-daily',
  '0 8 * * *',
  $$ SELECT public.enqueue_<TYPE>_notifications(); $$
);
```

If push delivery is needed, the helper can additionally `PERFORM net.http_post(...)` to the matching edge function (pattern from `20260422_chat_push_trigger_vault.sql`).

---

## 5. Sample edge function template

`mobile/supabase/functions/notification-<TYPE>/index.ts`:

```ts
// notification-<TYPE> edge function
// Schedule: daily at <time> via pg_cron HTTP POST.
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TYPE = '<TYPE>';
const DEDUP_WINDOW_HOURS = 24;       // override per type per spec card

function timingSafeEqual(a: string, b: string): boolean {
  const ae = new TextEncoder().encode(a);
  const be = new TextEncoder().encode(b);
  if (ae.length !== be.length) return false;
  let diff = 0;
  for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i];
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('CRON_SECRET') ?? '';
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !provided || !timingSafeEqual(expected, provided)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1. Fetch candidates (recipients + per-row payload data).
    const { data: candidates, error } = await supabase.rpc('candidates_for_<TYPE>', {});
    if (error) throw error;

    let inserted = 0;
    const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600 * 1000).toISOString();

    for (const c of candidates ?? []) {
      // 2. Dedup against piktag_notifications.
      const { data: dup } = await supabase
        .from('piktag_notifications')
        .select('id')
        .eq('user_id', c.recipient_id)
        .eq('type', TYPE)
        .gt('created_at', since)
        .contains('data', { /* dedup key e.g. */ recommended_user_id: c.candidate_id })
        .limit(1)
        .maybeSingle();
      if (dup) continue;

      // 3. Insert notification.
      const body = `<rendered body — substitute {{...}} from c>`;
      const { error: insErr } = await supabase.from('piktag_notifications').insert({
        user_id: c.recipient_id,
        type: TYPE,
        title: '',
        body,
        data: {
          // type-specific fields per spec card
        },
        is_read: false,
      });
      if (insErr) { console.warn('insert failed:', insErr.message); continue; }
      inserted++;

      // 4. Push (if this type pushes).
      if (c.push_token) {
        await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: c.push_token,
            title: c.actor_username ?? 'PikTag',
            body,
            data: { type: TYPE, /* routing keys */ },
            sound: 'default',
            priority: 'high',
          }),
        }).catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({ ok: true, inserted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(`notification-${TYPE} error:`, err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
```

---

## 6. Prerequisite tables that must exist before downstream slices

Two tables do not exist in the current schema and **must be created in their own migration** (the migration file for the corresponding type). Agents implementing slices that read from these tables must wait until the creating migration lands.

| New table              | Created in migration                            | Owner type        |
|------------------------|-------------------------------------------------|-------------------|
| `piktag_followers`     | `20260428q_notification_follow.sql`             | `follow`          |
| `piktag_biolink_clicks`| `20260428v_notification_biolink_click.sql`      | `biolink_click`   |

`piktag_tag_snapshots` is referenced in mobile types as `TagSnapshot` but **may not yet exist** in the schema. Agents implementing `tag_trending` must verify before assuming. If absent, create it inside `20260428u_notification_tag_trending.sql` with the shape: `id uuid PK`, `tag_id uuid NOT NULL REFERENCES piktag_tags(id) ON DELETE CASCADE`, `usage_count integer NOT NULL`, `snapshot_date date NOT NULL`, `created_at timestamptz DEFAULT now()`, `UNIQUE (tag_id, snapshot_date)`.

---

## 7. Acceptance checklist (every implementer fills this in their PR)

- [ ] Migration file is named exactly per §0 table.
- [ ] Trigger function is named `notify_<type>`; helper named `enqueue_<type>_notifications`.
- [ ] All notification rows have `title=''` and rendered en body string.
- [ ] All notification rows have `data.username`, `data.avatar_url`, and at least one mobile routing key from §1.9.
- [ ] Dedup-SELECT-then-INSERT pattern used; window matches §2 spec card.
- [ ] `SECURITY DEFINER`, `SET search_path = public`, EXECUTE granted only to `postgres, service_role`.
- [ ] Push notification implemented if §2 spec card says yes; wrapped in try/catch.
- [ ] i18n keys added to `en.json`, `zh-TW.json`, `zh-CN.json`.
- [ ] If new table created, RLS policies match §1.6 / §2.1 / §2.6 patterns.
- [ ] No collision with another agent's migration filename.
