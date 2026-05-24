# Phase C2 — Edge Function Audit Punch-List

Static analysis (Deno CLI not available locally). Reference baseline:
- `mobile/supabase/functions/daily-followup-check/index.ts` (auth gate pattern)
- `mobile/supabase/functions/send-chat-push/index.ts` (push payload shape)

Legend: PASS / FAIL / WARN

---

## File 1: `mobile/supabase/functions/notification-recommendation/index.ts`

| # | Check | Result |
|---|---|---|
| 1 | Deno imports (`https://...`) | PASS — `std@0.168.0/http/server.ts`, `esm.sh/@supabase/supabase-js@2` (matches reference) |
| 2 | `serve()` handler exported | PASS — line 40 |
| 3 | Env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) | PASS — lines 46, 56, 57 |
| 4 | OPTIONS preflight returns 200 + CORS | PASS — lines 41-43 |
| 5 | Auth: Bearer + constant-time compare | PASS — lines 31-38, 47-50 (XOR loop) |
| 6 | 403 on auth mismatch (matches `daily-followup-check`) | PASS — line 49 |
| 7 | Service-role client `{auth: { autoRefreshToken: false, persistSession: false }}` | PASS — lines 58-60 |
| 8 | Push POSTs to `https://exp.host/--/api/v2/push/send` | PASS — line 24, 156 |
| 9 | Payload keys (to/title/body/data/sound/priority) | PASS — lines 159-166 |
| 10 | `data.type` routing key | PASS — line 110 (`type: TYPE` = `'recommendation'`) |
| 11 | Per-row failures collected, run continues | PASS — try/catch in loop lines 155-174 |
| 12 | Returns `{processed_count, errors}` | PASS — lines 178, 184-187 |
| 13 | LOOKBACK captured BEFORE RPC | PASS — `runStartedAt` snapshotted line 63, RPC line 64 |
| 14 | Idempotency (SQL helper dedup + auth gate) | PASS — comments lines 27-29 confirm |
| 15 | TypeScript types | PASS — `pushTargets` typed, `Record<string, unknown>` used; minor `as` casts but no `any` flood |
| 16 | Body length cap (≤200 chars w/ ellipsis) | **WARN** — line 108: `body: (r.body as string) ?? ''` is **not truncated**. Other functions truncate. **Fix:** apply a `truncate(s, 200)` helper before passing to push payload. |

---

## File 2: `mobile/supabase/functions/notification-tag-trending/index.ts`

| # | Check | Result |
|---|---|---|
| 1 | Deno imports | PASS — std + esm.sh |
| 2 | `serve()` handler | PASS — line 49 |
| 3 | Env vars | PASS — lines 55, 66, 67 |
| 4 | OPTIONS preflight | PASS — lines 50-52 |
| 5 | Auth Bearer + constant-time compare | PASS — lines 35-42, 56-59 |
| 6 | 403 on mismatch | PASS — line 58 |
| 7 | Service-role client opts | PASS — line 68 |
| 8 | Expo URL | PASS — line 28, 142 |
| 9 | Payload keys | PASS — lines 149-163 (includes optional `channelId: 'default'`) |
| 10 | `data.type` routing key | PASS — line 154 |
| 11 | Per-row failures collected | PASS — try/catch in loop lines 127-175 |
| 12 | Returns `{processed_count, errors}` | PASS — line 179 (note: snake_case `processed_count` correct) |
| 13 | LOOKBACK captured BEFORE RPC | PASS — `cutoffIso` line 72, RPC line 76 |
| 14 | Idempotency | PASS — comments §14, dedup in SQL |
| 15 | Body length cap | PASS — `truncate()` helper line 44, applied line 140 |
| 16 | TypeScript types | PASS — `Record<string, unknown>`, `Map<string, ...>` typed |

**WARN — line 81:** RPC failure is non-fatal (just logged to `errors[]`) and execution continues to read rows. This differs from `notification-recommendation` (line 67, throws) and `notification-anniversary` (throws). **Suggested fix:** Either document this divergence or align with the bail-on-rpc-fail pattern; current behavior is intentional per inline comment but inconsistent across the family.

---

## File 3: `mobile/supabase/functions/notification-birthday/index.ts`

| # | Check | Result |
|---|---|---|
| 1 | Deno imports | PASS |
| 2 | `serve()` handler | PASS — line 73 |
| 3 | Env vars | PASS — lines 79, 90, 91 |
| 4 | OPTIONS preflight | PASS — lines 74-76 |
| 5 | Auth + constant-time compare | PASS — lines 57-64, 79-83 |
| 6 | 403 on mismatch | PASS — line 83 |
| 7 | Service-role client opts | PASS — lines 99-101 |
| 8 | Expo URL | PASS — line 34, 199 |
| 9 | Payload keys | PASS — lines 183-196 (closest mirror of `send-chat-push`) |
| 10 | `data.type` routing key | PASS — line 188 |
| 11 | Per-row failures collected, run continues | PASS — try/catch lines 198-221 |
| 12 | Returns `{processed_count, errors}` | PASS — lines 139, 154, 226 |
| 13 | LOOKBACK captured BEFORE RPC | PASS — `cutoffIso` line 107, RPC line 111 |
| 14 | Idempotency | PASS — documented in header lines 11-23 |
| 15 | Body length cap | PASS — applied lines 178-181 |
| 16 | TypeScript types | PASS — `NotificationRow`, `ProfileRow` types declared lines 42-55 (best-typed of the five) |

No issues found.

---

## File 4: `mobile/supabase/functions/notification-anniversary/index.ts`

| # | Check | Result |
|---|---|---|
| 1 | Deno imports | PASS |
| 2 | `serve()` handler | PASS — line 50 |
| 3 | Env vars | PASS — lines 56, 67, 68 |
| 4 | OPTIONS preflight | PASS — lines 51-53 |
| 5 | Auth + constant-time compare | PASS — lines 36-43, 57-60 |
| 6 | 403 on mismatch | PASS — line 59 |
| 7 | Service-role client opts | PASS — line 69 |
| 8 | Expo URL | PASS — lines 29, 121 |
| 9 | Payload keys | PASS — lines 128-136 |
| 10 | `data.type` routing key | PASS — line 112 |
| 11 | Per-row failures collected | PASS — try/catch lines 120-154; structured `{stage, message, user_id}` errors (richer than peers) |
| 12 | Returns `{processed_count, errors}` | PASS — lines 158, 164-167 |
| 13 | LOOKBACK captured BEFORE RPC | PASS — `cutoffIso` line 74, RPC line 77 |
| 14 | Idempotency | PASS — header lines 16-21 |
| 15 | Body length cap | PASS — `truncate()` line 45, applied lines 107-108 |
| 16 | TypeScript types | PASS — but **WARN line 101**: `(row as any).recipient` defeats the type system. **Fix:** declare a `Row` type with embedded `recipient: { push_token: string | null } | null` and use `.returns<Row[]>()`. |

**WARN — embedded select uses join syntax `recipient:piktag_profiles!user_id(push_token)` (line 89):** This relies on a foreign-key relationship from `piktag_notifications.user_id` -> `piktag_profiles.id` being declared in PostgREST. If that FK is missing or named differently, the join silently returns null `recipient` and **every push will be skipped** (line 103 short-circuits). Verify the FK name with `\d piktag_notifications` before deploy. Other functions do a separate `.in('id', recipientIds)` lookup which is FK-independent and safer.

---

## File 5: `mobile/supabase/functions/notification-contract-expiry/index.ts`

| # | Check | Result |
|---|---|---|
| 1 | Deno imports | PASS |
| 2 | `serve()` handler | PASS — line 33 |
| 3 | Env vars | PASS — lines 39, 50, 51 |
| 4 | OPTIONS preflight | PASS — lines 34-36 |
| 5 | Auth + constant-time compare | PASS — lines 24-31, 40-43 |
| 6 | 403 on mismatch | PASS — line 42 |
| 7 | Service-role client opts | PASS — line 52 |
| 8 | Expo URL | PASS — lines 20, 112 |
| 9 | Payload keys | PASS — lines 119-132 |
| 10 | `data.type` routing key | PASS — line 124 |
| 11 | Per-row failures collected | PASS — try/catch lines 87-147 |
| 12 | Returns `{processed_count, errors}` | PASS — lines 151, 158 |
| 13 | LOOKBACK captured BEFORE RPC | **FAIL** — `since` is computed on line 69 (**after** the RPC call on line 57). This is the exact race the spec warns against: a slow RPC could let pre-existing rows fall inside the window and get re-pushed. **Fix:** move `const since = new Date(Date.now() - LOOKBACK_SECONDS * 1000).toISOString();` to before line 57, or capture a `cutoffIso` snapshot at top of try block (mirror what every sibling function does). |
| 14 | Idempotency | WARN — header comment line 9 acknowledges "re-invocations within that window may re-push" — combined with #13 above, this is a real duplicate-push risk. |
| 15 | Body length cap | **FAIL** — line 122 sends `body` raw with no truncation. Other functions truncate to 200 chars. **Fix:** add a `truncate()` helper and wrap `body`. |
| 16 | TypeScript types | **WARN** — heavy use of `(row as { ... }).field` casts (lines 88-90, 102, 105-108) instead of declaring a row type and using `.returns<Row[]>()`. Functional, but noisy and error-prone. **Fix:** mirror the `NotificationRow` pattern from `notification-birthday`. |
| 17 | Header casing | **WARN** — line 117: `'Accept-encoding'` (lowercase 'e') — HTTP headers are case-insensitive so this works, but is inconsistent with `'Accept-Encoding'` used in `send-chat-push` (line 217), `notification-birthday` (line 204), `notification-anniversary` (line 126). Cosmetic. |
| 18 | Per-row N+1 | **WARN** — lines 93-97 fetch `push_token` per row inside the loop, while peers (`recommendation`, `tag-trending`, `birthday`) batch with `.in('id', recipientIds)`. For a small daily batch this is fine, but inconsistent with the family. |

---

## Summary

| File | PASS | WARN | FAIL |
|---|---|---|---|
| notification-recommendation | 15 | 1 (no body truncate) | 0 |
| notification-tag-trending | 15 | 1 (rpc-fail not bailed) | 0 |
| notification-birthday | 16 | 0 | 0 |
| notification-anniversary | 14 | 2 (`as any`, FK-join risk) | 0 |
| notification-contract-expiry | 12 | 3 (header case, N+1, type casts) | 2 (LOOKBACK race, no body truncate) |

**Critical fixes (blockers):**
1. **`notification-contract-expiry` line 69** — move `since` computation **before** the `rpc('enqueue_contract_expiry_notifications')` call on line 57. Currently violates the "capture LOOKBACK before invoking SQL helper" rule and risks re-pushing pre-existing rows.
2. **`notification-contract-expiry` line 122** — truncate `body` to 200 chars + ellipsis.

**Recommended fixes (non-blocking):**
- `notification-recommendation` line 108 — truncate body to 200 chars.
- `notification-anniversary` line 89 — verify the `piktag_notifications.user_id -> piktag_profiles.id` FK is declared in PostgREST schema cache, otherwise the embedded select silently fails. Consider switching to the separate-lookup pattern used by peers.
- `notification-anniversary` line 101 — replace `(row as any)` with a typed row interface.
- `notification-contract-expiry` lines 88-108 — declare a row type and remove inline casts.
- `notification-tag-trending` line 81 — decide intentionally: bail on RPC fail, or document that partial-progress reads are intentional.

**Pattern consistency** — `notification-birthday` is the strongest mirror of `send-chat-push` (named `Row` types, named `jsonResponse` helper, batched profile lookup). Recommend it as the reference template for any future C2-family functions.

**Deno static-check** — CLI not available in this environment; recommend running `deno check` in CI before deploy. No top-level `await`, no missing imports, no unhandled-promise warnings spotted in static read.
