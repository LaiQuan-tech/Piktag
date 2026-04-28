# Phase C1 — SQL Migration Audit

Audit of the 9 notification migrations created by Phase B
(`20260428q…20260428y`). Read-only review against the cross-Phase
checklist. Verdict legend: ✅ pass · ⚠️ warning · ❌ fail.

Audited files:

| Letter | File | Type | Bytes |
| ------ | ---- | ---- | ----- |
| q | `20260428q_notification_follow.sql` | reactive | 7762 |
| r | `20260428r_notification_friend.sql` | reactive | 7047 |
| s | `20260428s_notification_tag_added.sql` | reactive | 7196 |
| t | `20260428t_notification_recommendation.sql` | scheduled | 8694 |
| u | `20260428u_notification_tag_trending.sql` | scheduled | 7833 |
| v | `20260428v_notification_biolink_click.sql` | reactive | 8158 |
| w | `20260428w_notification_birthday.sql` | scheduled | 5265 |
| x | `20260428x_notification_anniversary.sql` | scheduled | 4933 |
| y | `20260428y_notification_contract_expiry.sql` | scheduled | 6803 |

---

## 1. Filename collision & ordering

✅ **No collision.** Directory listing of `mobile/supabase/migrations/`
confirms no other file uses suffixes `q`–`y` on date `20260428`. Latest
pre-existing file is `20260428p_search_init_rpc.sql`. The new 9 sort
lexicographically `q < r < s < t < u < v < w < x < y`, all strictly
after `p`. ✅ Sort order correct.

---

## 2. SQL syntax sanity (per-file)

### 20260428q (follow)

- ✅ `CREATE OR REPLACE FUNCTION … AS $$ … $$ LANGUAGE plpgsql` properly
  delimited (lines 88–204).
- ✅ Single anonymous `$$ … $$` body — no nested dollar-quoting needed.
- ✅ `AFTER INSERT ON public.piktag_followers FOR EACH ROW`
  (lines 213–216) — correct trigger binding.
- ✅ No dynamic SQL → `format()` not used. No injection surface.
- ✅ Cross-refs verified: `piktag_profiles.username/full_name/avatar_url/push_token`,
  `auth.users(id)`, `piktag_notifications(user_id, type, title, body, data, is_read, created_at)`.

### 20260428r (friend)

- ✅ `$$ … $$` delimiters balanced (lines 31–186).
- ✅ Inner `BEGIN/EXCEPTION` blocks (lines 74–84, 145–177) properly
  closed.
- ✅ `AFTER INSERT ON piktag_connections` (lines 195–198).
- ✅ Cross-refs OK. `piktag_connections(user_id, connected_user_id)`
  matches existing schema (`20260408_pending_connections.sql` confirms
  these columns).
- ⚠️ **20260428r:195** — Trigger is INSERT-only. If a connection ever
  flips state via UPDATE in the future (e.g. soft-delete reactivation),
  no friend notification fires. Per spec §2.2 this is by design
  (handshake detected by reverse-row EXISTS), but worth confirming with
  Phase C4. *Suggested action: leave as-is, flag in C4 spec confirmation.*

### 20260428s (tag_added)

- ✅ `$$ … $$` balanced (lines 42–200).
- ✅ Two inner `BEGIN/EXCEPTION` blocks (66–69, 172–196) closed
  correctly.
- ✅ `AFTER INSERT ON piktag_user_tags` (lines 205–208).
- ✅ String concat for `body` uses `||`, not `format` — no injection
  risk (tag_name is text data, not identifier).
- ⚠️ **20260428s:65–73** — Actor resolved via
  `current_setting('request.jwt.claim.sub', true)`. Inside
  `SECURITY DEFINER` this is the documented Supabase pattern and is
  correct, BUT any direct DB / service-role / seed insert into
  `piktag_user_tags` will yield NULL actor → **notification silently
  skipped**. The migration comments document this. *Suggested action:
  confirm with C4 that backfill / admin tools should NOT trigger
  tag_added pushes. If they should, fall back to `auth.uid()` or pass
  actor explicitly.*

### 20260428t (recommendation)

- ✅ `$$ … $$` and tag-quoted `$cron$ … $cron$` (lines 216–223),
  `$cmd$ … $cmd$` (line 228) — balanced.
- ✅ `format()` not used. Body string concat uses `||`.
- ✅ Cross-refs verified: `piktag_user_tags(user_id, tag_id)`,
  `piktag_connections(user_id, connected_user_id)`,
  `piktag_blocks(blocker_id, blocked_id)` (matches
  `20260330_blocks_reports.sql`),
  `piktag_profiles(id, username, full_name, avatar_url)`.
- ⚠️ **20260428t:71–87** — `mutual` CTE does an N×N self-join across
  `piktag_user_tags` grouped by `(user_id_a, user_id_b)`. At 100k+ users
  with ~10 tags each, the intermediate set is ~10×10×N = O(10⁷+). On
  managed Supabase this could exceed the cron statement timeout under
  load. *Suggested action: flag for Phase C2 (perf) — consider seeding
  a materialized view or limiting candidates with a tag-popularity
  pre-filter.*
- ⚠️ **20260428t:185–195** — Push fan-out POSTs only
  `{mode:'push_only', inserted: <count>}` to the edge function. The
  edge function must re-query newly inserted rows (last-N-minutes)
  itself, since per-recipient targets aren't in the payload. Document
  this contract for the edge function author (Phase C3).

### 20260428u (tag_trending)

- ✅ `BEGIN; … COMMIT;` transactional wrapping (lines 14, 205).
- ✅ All `$$ … $$` and `$cron$ … $cron$`, `$job$ … $job$` balanced.
- ✅ Two `CREATE OR REPLACE FUNCTION` (refresh + enqueue), both
  `SECURITY DEFINER` + `SET search_path = public`.
- ✅ New table `piktag_tag_snapshots` referenced only within this
  file — no later migration depends on it. Index + RLS + grants
  present.
- ✅ Cross-refs: `piktag_tags(id, name, usage_count)`,
  `piktag_user_tags(tag_id, user_id)`. Both confirmed against existing
  schema.
- ⚠️ **20260428u:181–203** — Comment says push handled by edge
  function, no Expo POST here, no Vault read. Inconsistent with the
  reactive types but acceptable for scheduled types per spec §3.10.
  *No fix required.*

### 20260428v (biolink_click)

- ✅ `$$ … $$` delimiters balanced (lines 83–221). Inner
  `BEGIN/EXCEPTION` block (171–217) closed.
- ✅ `AFTER INSERT ON public.piktag_biolink_clicks`
  (lines 230–233).
- ✅ Cross-refs: `piktag_biolinks(id, user_id, platform, label)` —
  confirmed (`mobile/src/screens/SocialStatsScreen.tsx:150` selects
  `platform, label`).
- ✅ New table `piktag_biolink_clicks` referenced only within this
  file — no later migration depends on it.
- ⚠️ **20260428v:163–217 (push enabled)** — Spec §2.6 marks
  biolink_click as in-app only (push=NO). This migration ships push
  anyway, gated by the 60-min dedup. The 60-min window keeps spam
  bounded but **deviates from spec**. Phase C4 must confirm intent.
  *Suggested fix if spec wins: wrap the entire push block in
  `IF false THEN … END IF;` or remove until spec is amended.*

### 20260428w (birthday)

- ✅ `$$ … $$` balanced (lines 40–112). Anonymous `DO $$ … $$` for
  cron unschedule (lines 121–130) balanced.
- ✅ Cron pattern `'0 8 * * *'` valid. Hardcoded UTC (Supabase managed
  pg_cron only supports UTC — flagged in spec deviations §3 below).
- ✅ Cross-refs: `piktag_connections.birthday`, `piktag_profiles.birthday`,
  `piktag_connections.nickname` — all confirmed via
  `mobile/src/types/index.ts` (line 86 nickname, presence of
  birthday-related screens).
- ⚠️ **20260428w:85** — Year sentinel `> 1900` for "year-unknown" is a
  convention assumption. If mobile stores year-unknown as `0001-MM-DD`
  or another sentinel, age computation is wrong. *Suggested action:
  Phase C4 to confirm sentinel; or simplify to "year >= 1920" or
  `IS NOT NULL` and let mobile suppress age display.*

### 20260428x (anniversary)

- ✅ `$$ … $$` balanced (lines 24–100); inner anonymous `DECLARE/BEGIN`
  block (53–97) closed.
- ✅ `$cron$ … $cron$` and `$job$ … $job$` balanced (109–124).
- ✅ Cron `'5 8 * * *'` valid (UTC).
- ✅ Cross-refs: `piktag_connections.anniversary`, `met_at`, `nickname`
  confirmed (`mobile/src/types/index.ts:91` anniversary, FriendDetailScreen
  uses anniversary/contract_expiry).
- ✅ Coexistence with `daily-followup-check` legacy reminder is
  **intentional** per the migration's own comment (lines 9–14) and
  spec §2.8. Flagged for C4 confirmation only.
- ⚠️ **20260428x:112–115** — `PERFORM cron.unschedule('name') WHERE
  EXISTS (...)` — works but is unusual. Most other migrations use the
  `SELECT jobid; IF jobid IS NOT NULL THEN PERFORM unschedule(jobid)`
  pattern. Behavior identical; cosmetic only. *No fix required.*

### 20260428y (contract_expiry)

- ✅ `$$ … $$` balanced (lines 31–160), inner `BEGIN/EXCEPTION`
  (132–155) closed. Anonymous `DO $$ … $$` for cron (lines 169–179)
  balanced.
- ✅ Cron `'10 8 * * *'` valid (UTC).
- ✅ Cross-refs: `piktag_connections(contract_expiry, user_id,
  connected_user_id, nickname)` confirmed.
- ✅ Push relay payload includes recipient_id + push_token + body —
  edge function has everything to dispatch directly without re-query.
  Cleaner than the recommendation contract.

---

## 3. Cross-migration consistency

| Check | Result |
| ----- | ------ |
| All trigger/helper functions `SECURITY DEFINER` | ✅ all 9 |
| All `SET search_path = public` | ✅ all 9 |
| All `REVOKE ALL … FROM PUBLIC` | ✅ all 9 |
| All `GRANT EXECUTE … TO postgres, service_role` | ✅ all 9 |
| Notification `data` JSONB carries router-probe key | ✅ q→`actor_user_id`, r→`actor_user_id`+`friend_user_id`, s→`actor_user_id`+`tag_id`, t→`recommended_user_id`, u→`tag_id`, v→`clicker_user_id`+`biolink_id`, w→`connected_user_id`, x→`connected_user_id`, y→`connected_user_id` |
| Scheduled types use idempotent unschedule-then-schedule | ✅ t, u, w, x, y |
| Reactive types use existing vault secrets only | ✅ q, r, s, v (no new vault entries) |
| No new vault entries created anywhere | ✅ confirmed via grep |

---

## 4. Dependency order

| Migration | Creates table | Referenced later? |
| --------- | ------------- | ----------------- |
| 20260428q | `piktag_followers` | ✅ Not referenced by r–y |
| 20260428u | `piktag_tag_snapshots` | ✅ Used only within u |
| 20260428v | `piktag_biolink_clicks` | ✅ Used only within v |

✅ No forward dependencies. Migration order is internally consistent.

---

## 5. Spec deviations flagged for Phase C4

1. **20260428v ships push** despite spec §2.6 saying push=NO. The
   60-min dedup mitigates spam but does not match the spec text. ⚠️
2. **20260428x anniversary coexists with legacy
   `daily-followup-check`** reminder. Documented intent per spec; not
   a bug. ⚠️ informational.
3. **All scheduled cron times are UTC** (`30 9`, `15 0`, `0 8`, `5 8`,
   `10 8`). pg_cron on managed Supabase only supports UTC — operators
   must adjust if "08:00 local" is ever required. ⚠️ informational.
4. **20260428s tag_added skips notifications when actor JWT is
   absent** (service-role / seed inserts). Documented in the migration;
   confirm with C4 that backfill tools should not emit pushes.
5. **20260428w birthday year-unknown sentinel = 1900**. Heuristic;
   confirm with C4 that mobile uses the same convention.
6. **20260428t recommendation push contract** sends only
   `{mode, inserted_count}` to its edge function. The edge function
   must re-query last-N-minutes of `piktag_notifications` to dispatch.
   Document this contract for Phase C3 (edge function author).
7. **20260428t mutual-tags self-join** is O(N²) under heavy data —
   flag for Phase C2 (perf).

---

## Summary

- **Failures**: 0 ❌
- **Warnings**: 8 ⚠️ (all informational / spec-confirmation / perf
  follow-up; no blocking syntax or schema errors)
- **Passes**: all primary checks (1, 2, 3, 4) ✅

The 9 migrations are syntactically clean, schema-consistent, and ready
to apply. Recommend Phase C4 confirms items 1, 4, and 5; Phase C2
addresses item 7; Phase C3 author for type=recommendation edge
function reads item 6 contract carefully.
