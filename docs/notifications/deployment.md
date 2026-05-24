# Notifications Deployment Runbook

> Deploy the 9 new notification types (4 reactive, 5 scheduled) to PikTag production Supabase.

This runbook is the canonical source-of-truth for shipping the notifications slice introduced on 2026-04-28. Follow every step in order. Do not skip the smoke tests — silent failures here surface days later as missing pushes, which is hard to debug retroactively.

---

## What you'll deploy

| Slug | File | Kind | Trigger / Schedule | Edge fn? |
|---|---|---|---|---|
| `follow` | `20260428q_notification_follow.sql` | reactive | `AFTER INSERT` on `piktag_followers` | no |
| `friend` | `20260428r_notification_friend.sql` | reactive | `AFTER INSERT` on `piktag_connections` | no |
| `tag_added` | `20260428s_notification_tag_added.sql` | reactive | `AFTER INSERT` on `piktag_user_tags` | no |
| `recommendation` | `20260428t_notification_recommendation.sql` | scheduled | daily 09:30 UTC | yes |
| `tag_trending` | `20260428u_notification_tag_trending.sql` | scheduled | daily 00:15 UTC | yes |
| `biolink_click` | `20260428v_notification_biolink_click.sql` | reactive | `AFTER INSERT` on `piktag_biolink_clicks` | no |
| `birthday` | `20260428w_notification_birthday.sql` | scheduled | daily 08:00 UTC | yes |
| `anniversary` | `20260428x_notification_anniversary.sql` | scheduled | daily 08:05 UTC | yes |
| `contract_expiry` | `20260428y_notification_contract_expiry.sql` | scheduled | daily 08:10 UTC | yes |

**Project ref**: `kbwfdskulxnhjckdvghj` (already linked via `mobile/supabase/.temp/project-ref`).

**Auth chain for scheduled types**: `pg_cron` → SQL helper (`enqueue_*_notifications()`) → `net.http_post` → edge function. Edge functions accept `Authorization: Bearer <token>` where `<token>` is **either** the `CRON_SECRET` env var **or** the auto-injected `SUPABASE_SERVICE_ROLE_KEY`. The helpers in this slice send the service-role key fetched from `vault.secrets.piktag_service_role_key`.

---

## 1. Pre-flight checklist

Run from a clean shell on the deploy machine.

```bash
# 1.1 — Confirm Supabase CLI is installed and recent (>= 1.180)
supabase --version

# 1.2 — Authenticate (interactive; opens a browser tab)
supabase login

# 1.3 — Confirm linked project ref matches what we expect
cat mobile/supabase/.temp/project-ref
# expected output: kbwfdskulxnhjckdvghj

# 1.4 — Re-link defensively (no-op if already linked correctly)
cd mobile
supabase link --project-ref kbwfdskulxnhjckdvghj

# 1.5 — Verify clean working tree (no uncommitted changes)
git status
# expected: "nothing to commit, working tree clean"

# 1.6 — Verify on main at the deploy commit
git rev-parse --abbrev-ref HEAD       # expected: main
git rev-parse --short HEAD            # expected: 15544052 (or newer if hot-fix landed)

# 1.7 — Verify all 9 migrations are present locally
ls supabase/migrations/20260428{q,r,s,t,u,v,w,x,y}_notification_*.sql | wc -l
# expected: 9

# 1.8 — Verify all 5 edge function dirs are present
ls -d supabase/functions/notification-{recommendation,tag-trending,birthday,anniversary,contract-expiry}
# expected: 5 paths printed
```

If any check fails, **stop**. Don't proceed to the destructive steps until the working tree is correct.

---

## 2. One-time `CRON_SECRET` setup

The 5 scheduled edge functions accept either `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`. The helpers in `vault.secrets` send the service-role key, so this would technically work without `CRON_SECRET` — **but** `CRON_SECRET` is required for the smoke tests in §6 (we don't want curl scripts to ever carry the service role key).

### 2.1 — Generate

```bash
openssl rand -hex 32
```

This prints a 64-char hex string. Copy it.

### 2.2 — Store the value securely

Paste the value into:

- **1Password vault**: `PikTag / Engineering / Supabase / CRON_SECRET (prod)`
- Tag it `notifications-2026-04-28` so it's findable from the rotation log.
- **Do not** paste it into Slack, GitHub issues, this runbook, or any other repo file.

### 2.3 — Push to Supabase

```bash
supabase secrets set CRON_SECRET=<paste-value-here> --project-ref kbwfdskulxnhjckdvghj
```

Then **immediately** clear your shell history line for that command:

```bash
history -d $(history 1)   # bash
# or for zsh, exit and reopen the shell — zsh doesn't expose -d easily
```

### 2.4 — Confirm

```bash
supabase secrets list --project-ref kbwfdskulxnhjckdvghj | grep CRON_SECRET
# expected: a row with name=CRON_SECRET and a digest hash (the value itself is never displayed)
```

> **Skip this section if** `CRON_SECRET` is already set on this project (e.g. it was set during an earlier slice). In that case, just retrieve the existing value from 1Password for §6.

---

## 3. Vault setup verification

The SQL helpers read two Vault secrets to build the http_post call:

- `piktag_service_role_key` — used as the Bearer token to the edge function
- `piktag_supabase_url` — used as the base URL (`https://<ref>.functions.supabase.co`)

Both were seeded by `20260422_chat_push_trigger_vault.sql`. **Confirm before deploying**, because if these are missing the helpers will silently swallow the http_post inside an `EXCEPTION WHEN OTHERS` block — your inserts will succeed but no pushes will fire.

### 3.1 — Open the SQL editor

[Open SQL editor for kbwfdskulxnhjckdvghj](https://supabase.com/dashboard/project/kbwfdskulxnhjckdvghj/sql/new)

### 3.2 — Run

```sql
SELECT name FROM vault.secrets WHERE name LIKE 'piktag_%' ORDER BY name;
```

**Expected output:**

```
piktag_service_role_key
piktag_supabase_url
```

If either row is missing, **stop** and re-seed via `20260422_chat_push_trigger_vault.sql` before proceeding.

### 3.3 — Spot-check the URL value

```sql
SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url';
```

**Expected:** `https://kbwfdskulxnhjckdvghj.supabase.co` (no trailing slash). If a different ref appears here, the helpers will POST to the wrong project — fix before deploying.

---

## 4. Deploy edge functions

Only the 5 **scheduled** types need an edge function. The 4 reactive types (`follow`, `friend`, `tag_added`, `biolink_click`) do all their work in the Postgres trigger and call `exp.host` directly via `pg_net` — no edge function involved.

The other deploy agent has already patched `mobile/supabase/config.toml` to set `verify_jwt=false` for these 5 functions (cron calls don't carry an end-user JWT). Verify before deploy:

```bash
grep -A1 "notification-" mobile/supabase/config.toml | grep -B1 verify_jwt
# expected: 5 verify_jwt = false rows, one per function
```

Deploy each function individually so a failure on function N doesn't leave functions 1..N-1 in an unknown state:

```bash
cd mobile

supabase functions deploy notification-recommendation  --project-ref kbwfdskulxnhjckdvghj
supabase functions deploy notification-tag-trending    --project-ref kbwfdskulxnhjckdvghj
supabase functions deploy notification-birthday        --project-ref kbwfdskulxnhjckdvghj
supabase functions deploy notification-anniversary     --project-ref kbwfdskulxnhjckdvghj
supabase functions deploy notification-contract-expiry --project-ref kbwfdskulxnhjckdvghj
```

**Expected per deploy:** `Deployed Function <name> on project kbwfdskulxnhjckdvghj` and a function URL.

### 4.1 — Recovery if a single deploy fails

- Re-running `supabase functions deploy <name>` is **idempotent** — Supabase replaces the running version atomically. Just re-run.
- If the deploy fails with `bundling`, check that the function's `index.ts` imports resolve locally: `deno check supabase/functions/<name>/index.ts`.
- If it fails with `unauthorized`, your `supabase login` token expired — re-login and retry.

---

## 5. Apply migrations

```bash
cd mobile
supabase db push --project-ref kbwfdskulxnhjckdvghj
```

**Expected output:** the CLI prints a list of pending migrations, prompts for confirmation, then applies. After confirming, look for:

```
Applying migration 20260428q_notification_follow.sql...
Applying migration 20260428r_notification_friend.sql...
Applying migration 20260428s_notification_tag_added.sql...
Applying migration 20260428t_notification_recommendation.sql...
Applying migration 20260428u_notification_tag_trending.sql...
Applying migration 20260428v_notification_biolink_click.sql...
Applying migration 20260428w_notification_birthday.sql...
Applying migration 20260428x_notification_anniversary.sql...
Applying migration 20260428y_notification_contract_expiry.sql...
Finished supabase db push.
```

= **9 new migrations applied**.

### 5.1 — Recovery if a single migration fails

Each migration is **idempotent**:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- `DROP TRIGGER IF EXISTS` followed by `CREATE TRIGGER`
- `cron.unschedule(name)` wrapped in a `DO` block tolerant of the "not found" exception, followed by `cron.schedule(name, ...)`

So if `db push` fails partway through:

1. Read the error. The most common cause is a missing `pg_net` / `pg_cron` extension (already present in this project) or a missing Vault secret (see §3).
2. Fix the underlying issue.
3. Re-run `supabase db push`. Already-applied migrations are skipped (Supabase tracks them in `supabase_migrations.schema_migrations`); the failed one re-runs cleanly.

**Do not** manually mark a failed migration as applied unless you have a separate audit trail. Better to delete the schema_migrations row and re-run.

---

## 6. Smoke test each edge function

For each of the 5 scheduled functions, fire a manual POST with the `CRON_SECRET` Bearer token. The functions are designed to be safe to call any time of day — they re-evaluate today's candidate set and dedup against the last N days of `piktag_notifications`, so calling them outside their cron window will simply return `processed_count: 0` if no candidates exist today.

Set the secret in your shell (don't write it to a file):

```bash
export CRON_SECRET=<paste-value-from-1password>
```

Then run each:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-recommendation
echo

curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-tag-trending
echo

curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-birthday
echo

curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-anniversary
echo

curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-contract-expiry
echo
```

**Expected (per function):** HTTP 200 and a JSON body shaped like:

```json
{ "processed_count": 0, "errors": [] }
```

If `processed_count > 0`, that's also fine — it means today happens to be someone's birthday / anniversary / etc. and the function did its job.

### 6.1 — Negative test (auth must reject anonymous calls)

```bash
curl -i -X POST https://kbwfdskulxnhjckdvghj.functions.supabase.co/notification-birthday
# expected: HTTP 401 or 403, NOT 200
```

If this returns 200, the function is open to the internet — **roll back immediately** and audit the function source.

### 6.2 — Failure modes

| Symptom | Diagnosis |
|---|---|
| `401 unauthorized` from the smoke test | `CRON_SECRET` mismatch between local export and supabase secrets — re-run §2.4 |
| `502 bad gateway` | Function deploy didn't finish or crashed at boot; check `supabase functions logs <name>` |
| `500 internal server error` with `vault.secrets does not exist` | Vault secrets missing — re-do §3 |
| Function returns 200 but no rows in `piktag_notifications` | Either the candidate query genuinely returned 0 today, or the helper isn't reaching the function. Check `pg_net._http_response` for non-200s on recent `request_id`s. |

---

## 7. Verify pg_cron registration

[Open SQL editor](https://supabase.com/dashboard/project/kbwfdskulxnhjckdvghj/sql/new) and run:

```sql
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'notification-%'
ORDER BY jobname;
```

**Expected: 5 rows**, all with `active = true`:

| jobname | schedule |
|---|---|
| `notification-anniversary-daily` | `5 8 * * *` |
| `notification-birthday-daily` | `0 8 * * *` |
| `notification-contract-expiry-daily` | `10 8 * * *` |
| `notification-recommendation-daily` | `30 9 * * *` |
| `notification-tag-trending-daily` | `15 0 * * *` |

If any row is missing, the corresponding migration's `cron.schedule()` call didn't run — re-apply that migration. If a row shows `active = false`, the previous deploy disabled it; re-enable with:

```sql
UPDATE cron.job SET active = true WHERE jobname = '<name>';
```

---

## 8. Verify reactive triggers

```sql
SELECT tgname, tgrelid::regclass AS on_table
FROM pg_trigger
WHERE tgname LIKE 'trg_notify_%'
  AND NOT tgisinternal
ORDER BY tgname;
```

**Expected: 4 rows**:

| tgname | on_table |
|---|---|
| `trg_notify_biolink_click` | `piktag_biolink_clicks` |
| `trg_notify_follow` | `piktag_followers` |
| `trg_notify_friend` | `piktag_connections` |
| `trg_notify_tag_added` | `piktag_user_tags` |

If any are missing, re-run the corresponding migration (q/r/s/v).

---

## 9. Manual fire-test for each reactive type

Pick **two real test accounts** you own — call them `$A` and `$B`. Get their `auth.users.id` values via:

```sql
SELECT id, email FROM auth.users WHERE email IN ('test-a@piktag.app', 'test-b@piktag.app');
```

Set:

```sql
-- replace with real UUIDs from above
\set A 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set B 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
```

For each test below, the pattern is:

1. Note `count(*) FROM piktag_notifications WHERE user_id = <recipient> AND type = '<type>'` **before**.
2. Insert the test row.
3. Confirm count went up by 1, and that the new row's `data` JSONB contains the expected keys.
4. Delete the test row to leave the db clean.

### 9.1 — `follow`

```sql
-- before
SELECT count(*) FROM piktag_notifications WHERE user_id = :'B' AND type = 'follow';

-- fire
INSERT INTO piktag_followers (follower_id, following_id) VALUES (:'A', :'B');

-- verify
SELECT id, body, data FROM piktag_notifications
WHERE user_id = :'B' AND type = 'follow'
ORDER BY created_at DESC LIMIT 1;
-- expected: data->>'actor_user_id' = A, body contains A's username

-- cleanup
DELETE FROM piktag_followers WHERE follower_id = :'A' AND following_id = :'B';
```

### 9.2 — `friend`

The friend type fires only when the bidirectional handshake completes — `A → B` then `B → A`.

```sql
-- pre-clean any leftover from prior runs
DELETE FROM piktag_connections WHERE (user_id = :'A' AND friend_id = :'B') OR (user_id = :'B' AND friend_id = :'A');

-- 1st direction (no notification yet)
INSERT INTO piktag_connections (user_id, friend_id) VALUES (:'A', :'B');
-- expected: 0 new piktag_notifications rows of type='friend'

-- 2nd direction (handshake completes — both sides should get a notification)
INSERT INTO piktag_connections (user_id, friend_id) VALUES (:'B', :'A');

-- verify (both sides)
SELECT user_id, body FROM piktag_notifications
WHERE type = 'friend' AND user_id IN (:'A', :'B')
  AND created_at > now() - interval '1 minute';
-- expected: 2 rows, one for A, one for B

-- cleanup
DELETE FROM piktag_connections WHERE (user_id = :'A' AND friend_id = :'B') OR (user_id = :'B' AND friend_id = :'A');
```

### 9.3 — `tag_added`

You need a real `tag_id` from `piktag_tags` and an `added_by` user different from the tag owner.

```sql
-- pick any tag that B owns
SELECT id FROM piktag_tags WHERE owner_id = :'B' LIMIT 1;
-- assign result to :T below

-- fire (A adds B's tag — wait, semantics are reversed: actor adds tag for recipient)
-- consult docs/notifications/tag_added.md §"trigger payload" if unsure
INSERT INTO piktag_user_tags (user_id, tag_id, added_by) VALUES (:'B', :'T', :'A');

-- verify
SELECT body, data FROM piktag_notifications
WHERE user_id = :'B' AND type = 'tag_added'
ORDER BY created_at DESC LIMIT 1;
-- expected: data->>'tag_id' = T, data->>'actor_user_id' = A

-- cleanup
DELETE FROM piktag_user_tags WHERE user_id = :'B' AND tag_id = :'T' AND added_by = :'A';
```

### 9.4 — `biolink_click`

```sql
-- pick any biolink that B owns
SELECT id FROM piktag_biolinks WHERE owner_id = :'B' LIMIT 1;
-- assign result to :L

-- fire (A clicks B's biolink)
INSERT INTO piktag_biolink_clicks (biolink_id, clicked_by) VALUES (:'L', :'A');

-- verify
SELECT body, data FROM piktag_notifications
WHERE user_id = :'B' AND type = 'biolink_click'
ORDER BY created_at DESC LIMIT 1;
-- expected: data->>'biolink_id' = L

-- cleanup
DELETE FROM piktag_biolink_clicks WHERE biolink_id = :'L' AND clicked_by = :'A' AND created_at > now() - interval '1 minute';
```

> **Push delivery:** if `$B` has an Expo push token registered, you should also see the notification on B's physical device within ~5s. If the row appears in `piktag_notifications` but no push lands, check `pg_net._http_response` for the most recent `request_id` — most likely cause is an expired or missing push token, which the trigger correctly logs and ignores.

---

## 10. Rollback plan

The migrations don't ship with `DROP` sections (they're forward-only), so rollback is **manual**. Have these snippets ready before the deploy starts.

### 10.1 — Disable a single scheduled type without dropping anything

The cheapest, fastest mitigation. The cron job stops firing immediately; the helper function and edge function stay in place so you can re-enable later with one query.

```sql
-- find the jobid
SELECT jobid, jobname FROM cron.job WHERE jobname = 'notification-<slug>-daily';

-- unschedule by id (preferred — survives jobname rename)
SELECT cron.unschedule(<jobid>);

-- OR unschedule by name
SELECT cron.unschedule('notification-<slug>-daily');
```

To re-enable later, re-run the relevant migration (each `cron.schedule` call is idempotent thanks to the `DO` block that unschedules first).

### 10.2 — Disable a single reactive type

Drop the trigger but keep the function (cheap to re-create):

```sql
DROP TRIGGER IF EXISTS trg_notify_follow         ON piktag_followers;
DROP TRIGGER IF EXISTS trg_notify_friend         ON piktag_connections;
DROP TRIGGER IF EXISTS trg_notify_tag_added      ON piktag_user_tags;
DROP TRIGGER IF EXISTS trg_notify_biolink_click  ON piktag_biolink_clicks;
```

### 10.3 — Full revert of all 9 migrations

Run in this order — children before parents:

```sql
-- 10.3.1 — unschedule all 5 cron jobs
SELECT cron.unschedule('notification-recommendation-daily');
SELECT cron.unschedule('notification-tag-trending-daily');
SELECT cron.unschedule('notification-birthday-daily');
SELECT cron.unschedule('notification-anniversary-daily');
SELECT cron.unschedule('notification-contract-expiry-daily');

-- 10.3.2 — drop all 4 reactive triggers
DROP TRIGGER IF EXISTS trg_notify_follow         ON piktag_followers;
DROP TRIGGER IF EXISTS trg_notify_friend         ON piktag_connections;
DROP TRIGGER IF EXISTS trg_notify_tag_added      ON piktag_user_tags;
DROP TRIGGER IF EXISTS trg_notify_biolink_click  ON piktag_biolink_clicks;

-- 10.3.3 — drop the helper functions
DROP FUNCTION IF EXISTS public.notify_follow();
DROP FUNCTION IF EXISTS public.notify_friend();
DROP FUNCTION IF EXISTS public.notify_tag_added();
DROP FUNCTION IF EXISTS public.notify_biolink_click();
DROP FUNCTION IF EXISTS public.enqueue_recommendation_notifications();
DROP FUNCTION IF EXISTS public.enqueue_tag_trending_notifications();
DROP FUNCTION IF EXISTS public.enqueue_birthday_notifications();
DROP FUNCTION IF EXISTS public.enqueue_anniversary_notifications();
DROP FUNCTION IF EXISTS public.enqueue_contract_expiry_notifications();

-- 10.3.4 — undeploy the edge functions
-- (run from a shell, not SQL)
-- supabase functions delete notification-recommendation  --project-ref kbwfdskulxnhjckdvghj
-- supabase functions delete notification-tag-trending    --project-ref kbwfdskulxnhjckdvghj
-- supabase functions delete notification-birthday        --project-ref kbwfdskulxnhjckdvghj
-- supabase functions delete notification-anniversary     --project-ref kbwfdskulxnhjckdvghj
-- supabase functions delete notification-contract-expiry --project-ref kbwfdskulxnhjckdvghj

-- 10.3.5 — drop new base tables (DESTRUCTIVE — only do this if you genuinely
-- want to wipe the data; biolink_clicks may have analytics value)
-- DROP TABLE IF EXISTS public.piktag_followers;
-- DROP TABLE IF EXISTS public.piktag_biolink_clicks;

-- 10.3.6 — remove migration rows so future db push doesn't no-op
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN (
  '20260428q','20260428r','20260428s','20260428t','20260428u',
  '20260428v','20260428w','20260428x','20260428y'
);
```

> The migrations themselves do **not** contain DROP sections — that's deliberate (forward-only schema), but it means the rollback is your responsibility to keep current. If you add a new object to one of these migrations later, add a matching DROP here.

### 10.4 — When to use each rollback

| Scenario | Action |
|---|---|
| One scheduled type is generating bad notifications | §10.1 — unschedule, fix, re-enable |
| One reactive type is firing incorrectly under load | §10.2 — drop trigger; investigate offline |
| Whole feature is broken / push spam at scale | §10.3 — full revert; communicate ETA |

---

## 11. Post-deploy monitoring (first 24 hours)

### 11.1 — Volume per type (run hourly for first 6 hours)

```sql
SELECT
  type,
  count(*)                       AS sent,
  count(DISTINCT user_id)        AS unique_recipients,
  min(created_at)                AS first,
  max(created_at)                AS last
FROM piktag_notifications
WHERE created_at > now() - interval '1 hour'
  AND type IN ('follow','friend','tag_added','recommendation',
               'tag_trending','biolink_click','birthday',
               'anniversary','contract_expiry')
GROUP BY type
ORDER BY sent DESC;
```

**Sanity ranges (rough, adjust to your real DAU):**

| type | expected/hour | red flag |
|---|---|---|
| `follow` | 10–500 | > 5,000 (loop?) |
| `friend` | 5–100 | > 2,000 |
| `tag_added` | 5–500 | > 5,000 |
| `biolink_click` | 50–2000 | > 20,000 (bot?) |
| `recommendation` | spike at 09:30 UTC, then 0 | > 1× DAU at the spike |
| `tag_trending` | spike at 00:15 UTC, then 0 | > 1× DAU at the spike |
| `birthday` / `anniversary` / `contract_expiry` | small spike at their hour | > 100× normal |

### 11.2 — Dedup-failure watch

If dedup is broken, you'll see the same `(user_id, type, data->>'actor_user_id')` triple appearing repeatedly within the dedup window. Run:

```sql
SELECT
  user_id,
  type,
  data->>'actor_user_id' AS actor,
  count(*)               AS dup_count,
  max(created_at)        AS most_recent
FROM piktag_notifications
WHERE created_at > now() - interval '24 hours'
  AND type IN ('follow','friend','tag_added','biolink_click')
GROUP BY user_id, type, data->>'actor_user_id'
HAVING count(*) > 1
ORDER BY dup_count DESC
LIMIT 50;
```

**Expected: zero rows** for `follow`/`friend`/`tag_added` within a 24h dedup window. A few rows for `biolink_click` are acceptable because its dedup window is shorter — cross-check against the spec card before alerting.

### 11.3 — pg_net error rate

```sql
SELECT
  status_code,
  count(*) AS n,
  max(created) AS most_recent
FROM net._http_response
WHERE created > now() - interval '1 hour'
GROUP BY status_code
ORDER BY n DESC;
```

Most rows should be `200`. A small fraction of `400`/`410` is normal (expired Expo tokens). A spike of `5xx` is a problem — most likely the edge function is crashing; pull logs:

```bash
supabase functions logs notification-<name> --project-ref kbwfdskulxnhjckdvghj --tail
```

### 11.4 — Edge function invocation count

In the [Supabase Dashboard → Functions](https://supabase.com/dashboard/project/kbwfdskulxnhjckdvghj/functions) view, each scheduled function should show:

- Exactly **1 invocation per day** at its scheduled hour, for the first week.
- 200 status code on every invocation.
- Duration consistently under 5s (anything above means a candidate query is slow — investigate).

### 11.5 — Soft alerts to wire (follow-up task)

Out of scope for this deploy, but file follow-up tickets to wire these into your alerting:

- `pg_net._http_response.status_code >= 500` rate > 1% over 5 min
- Notification volume per type departs > 5σ from rolling 7-day baseline
- Any cron job in `cron.job_run_details` with `status='failed'` for any of the 5 new jobnames

---

## Sign-off checklist

Before declaring the deploy done, confirm:

- [ ] §1 — Pre-flight all green
- [ ] §2 — `CRON_SECRET` set on project; value stored in 1Password
- [ ] §3 — `piktag_service_role_key` and `piktag_supabase_url` confirmed in Vault
- [ ] §4 — All 5 edge functions deployed; `verify_jwt=false` confirmed in config.toml
- [ ] §5 — `supabase db push` printed "9 migrations applied"
- [ ] §6 — All 5 smoke tests returned 200 with `processed_count: 0` (or a small count)
- [ ] §6.1 — Anonymous curl returned 401/403 (auth gate works)
- [ ] §7 — `cron.job` shows 5 active rows
- [ ] §8 — `pg_trigger` shows 4 `trg_notify_*` rows
- [ ] §9 — All 4 reactive types fired correctly under manual test, then cleaned up
- [ ] §11 — First-hour monitoring query shows expected volumes; no dedup duplicates

If any check fails, **do not** mark this deploy as complete in the deploy log — open a ticket, link it from the deploy log, and follow up before announcing the feature.

---

## Appendix A — Files touched by this slice

```
mobile/supabase/migrations/20260428q_notification_follow.sql
mobile/supabase/migrations/20260428r_notification_friend.sql
mobile/supabase/migrations/20260428s_notification_tag_added.sql
mobile/supabase/migrations/20260428t_notification_recommendation.sql
mobile/supabase/migrations/20260428u_notification_tag_trending.sql
mobile/supabase/migrations/20260428v_notification_biolink_click.sql
mobile/supabase/migrations/20260428w_notification_birthday.sql
mobile/supabase/migrations/20260428x_notification_anniversary.sql
mobile/supabase/migrations/20260428y_notification_contract_expiry.sql

mobile/supabase/functions/notification-recommendation/index.ts
mobile/supabase/functions/notification-tag-trending/index.ts
mobile/supabase/functions/notification-birthday/index.ts
mobile/supabase/functions/notification-anniversary/index.ts
mobile/supabase/functions/notification-contract-expiry/index.ts

mobile/supabase/config.toml         (verify_jwt=false for the 5 fns above)
```

## Appendix B — Cron schedule reference

| jobname | UTC | local (UTC+8) | helper |
|---|---|---|---|
| `notification-tag-trending-daily` | 00:15 | 08:15 | `enqueue_tag_trending_notifications()` |
| `notification-birthday-daily` | 08:00 | 16:00 | `enqueue_birthday_notifications()` |
| `notification-anniversary-daily` | 08:05 | 16:05 | `enqueue_anniversary_notifications()` |
| `notification-contract-expiry-daily` | 08:10 | 16:10 | `enqueue_contract_expiry_notifications()` |
| `notification-recommendation-daily` | 09:30 | 17:30 | `enqueue_recommendation_notifications()` |

If a deployment region needs a different local hour, adjust the cron expression in the migration before it ships — `pg_cron` on managed Supabase honors UTC only.
