# PikTag — Claude working memory

> Auto-loaded every session. Read this first. The North Star below is the
> lens for **every** product/UX/scope decision — when in doubt, optimize for it.

## Product North Star — set by the founder (remember this)

**The core of PikTag IS AI tag recommendation: in each context, recommend
the *right* tags.** Everything else serves this.

Why tags are the engine (not a feature — the whole thesis):
- Tags let a user **reactivate dormant connections** by searching tags
  (活化舊有人脈).
- Tags **match new friends** — semantic-concept matching that works across
  language/wording (媒合新朋友).

Therefore the priorities, in order:

1. **Optimize every friend-add opportunity to the extreme.** Every moment a
   connection could happen — QR scan, scan-a-card, search, Ask, contact
   import, share link — must be as frictionless and as likely-to-convert as
   possible. Treat each as precious.
2. **Get non-members in, and get good tag data built on them.** A non-member
   local contact with strong tags is future serendipity fuel. The flows to
   record them, to detect when a scanned person is *already* a member (→
   connect, don't file a dead contact), and to convert non-members to
   members must be excellent.

**How to apply (do this, don't just nod):** when weighing any trade-off,
prefer the option that (a) protects/strengthens AI-tag quality &
cross-language concept matching, (b) increases a real friend-add or
non-member-onboarding conversion, (c) reduces friction on the
`scan → tag → connect` and `search-tag → reactivate` loops. If a request
works *against* this, say so honestly (中肯) rather than just complying.

### What we DON'T learn from engagement-driven platforms

After studying Meta's Facebook ranking transparency page on
2026-05-30, two of their core signals are anti-patterns for
PikTag — importing them would optimize against our own thesis.
Lock these so a future session doesn't accidentally adopt them
while "borrowing best practice" from a Big Tech post-mortem.

1. **Never use dwell time / time-on-profile as a positive signal.**
   FB / TikTok reward long sessions because their ad business
   needs eyeballs. PikTag's success has the OPPOSITE shape:
   search → find the right person → message → leave. A user
   lingering on a profile usually means "not sure" / "lost" /
   "stalking" — not "engaged." If anything, dwell-without-action
   should be a weak NEGATIVE signal (the user looked and didn't
   message — that's a mismatch worth de-weighting next time).

**Sub-rule: no rubber-stamp social buttons on notifications.**
Don't ship "Confirm / Endorse / Approve" CTAs that ask the viewer
to validate a social claim someone ELSE made. Instances:
- "Armand 自標 #養貓 — 你也認同嗎？ [認同]" (removed 2026-05-30)
- Any "Confirm friendship", "Vouch for skill", "Co-sign" pattern.

Why these fail for PikTag specifically:
  * The button creates social pressure (peer-review under your
    own name). Tap = rubber-stamp regardless of true belief —
    principle #5 calibration will catch it as low-quality signal,
    but cleaner not to manufacture the signal in the first place.
  * No-tap doesn't mean "I disagree" — usually means "didn't feel
    like doing the work." We mis-read a non-action as endorsement
    of the negative.
  * Active prompting IS the engagement-driven platform pattern
    we explicitly rejected (see the two anti-patterns above).
    Principle #3 says "active-learning style endorsement prompts"
    — but the SURFACE is the friend's FriendDetail tag chips
    (organic, viewer-initiated), not a button inside a notification.

Correct pattern when you need to nudge a viewer to validate
something:
  * Notification surfaces the fact ("Armand 自標 #養貓")
  * Tap routes to the relevant detail screen
  * Detail screen shows the suggested tag/claim as a passive chip
    in the established tap-to-add flow
  * Viewer adds if they organically agree, ignores if not.
    No "Confirm" button, no "Approve" button, no anywhere.

**Sub-sub-rule: the COPY itself can't be a rubber-stamp ask either.**
After removing the "認同" button (commit 80a8568) the body still
read "Armand 自標 #養貓 — 你也認同嗎？" — same anti-pattern in
sentence form. Founder verbatim, 2026-05-30: *"我覺得這句話根本
不應該問使用者，這句話是找使用者麻煩"*. The notification body
states a FACT ("Armand 自標 #養貓"), it does not pose a QUESTION
("...你也認同嗎？" / "...do you agree?" / "...sei d'accordo?").
This applies to every locale — when adding push/in-app body text,
read it back: if it ends in a question mark asking the viewer to
validate a third party's claim, rewrite. Statement form only.
(Edited in 20260530070000 across 19 locale JSONs + SQL fallback.)

2. **Never conflate engagement with value.**
   Meta's transparency page literally says "sharing a post...can
   be an indication that you found that post to be valuable" —
   engagement IS their meaningfulness metric. For PikTag this
   directly contradicts the thesis:
   - Dormant connections have low recent engagement BY DEFINITION
     — they're who you're trying to reactivate. Engagement-as-value
     would bury them.
   - Cross-language tag matches have small audiences, hence low
     engagement — they're the unique-to-us product. Engagement-as-
     value would bury them.
   - Weak-tie / 2nd-degree discoveries have low overlap, hence low
     engagement — they're the IG-story serendipity layer.
     Engagement-as-value would bury them.
   The right anchor is principle #4 (temporal decay per source) —
   factual signals (self-claim, when-met) survive even when there's
   no recent engagement to "validate" them.

What we DO take from Meta's page: principle #6 negative-signal
collection (hide / snooze / unsubscribe → reduce distribution —
we already do this with `piktag_tag_removals` + new
`piktag_match_dismissals` 2026-05-30), and the multi-predictor
framework (post-launch deferred #1 — split search ranking into
p(click) / p(message) / p(endorse) once ≥500 events accrue).

### Adding a new ranking surface — the 3-point checklist

PikTag has multiple ranking surfaces (search, TagDetail explore,
Ask match sheet, recommendation cron, magic moments). Meta only
ranks one Feed; we have ~6. Easy to drift if not checked.

When you ship a NEW ranking surface (or substantially rework an
existing one):

1. **Connected vs Recommended — which is this?**
   - Connected = the user explicitly knows / chose the candidates
     (1st-degree friends, people you scanned).
   - Recommended = algorithmic discovery (2nd-degree, shared-tag,
     concept-match, Ask bridge).
   If BOTH are shown on the same surface, score them in SEPARATE
   pipelines and intersperse — do NOT cascade them through one
   formula (that's the trap where weak-tie 2nd-degree gets crushed
   by 1st-degree). Existing precedent: Ask Phase 1 sheet
   (Connected) + Phase 2 story row (Recommended). Both visible,
   never merged.

2. **Intent-driven or browse-driven — does sectioning help?**
   - Intent-driven (search box, "find me X"): NO sectioning —
     the user typed a query, just give them the answer ordered
     by relevance. A "From your network" / "Discover" split here
     is noise.
   - Browse-driven (tag-detail explore, recommendation feed,
     Ask story row): YES sectioning often helps — the user is
     exploring, so seeing source-tier breakdown ("3 friends
     match" / "+12 from your wider network") gives them mental
     handles. Don't be afraid to label sections.

3. **Which negative signals does this surface respect?**
   The `piktag_match_dismissals` table is the canonical "viewer
   X said no to candidate Y on surface Z" log. New surfaces MUST
   pick a surface name and read this table to avoid showing the
   same dismissed candidate again. Don't quietly skip this — a
   "Recommendation" that re-suggests a dismissed person is the
   single most user-trust-eroding bug in this space.

4. **Exclude non-person accounts.** Every ranking/matching/counting
   surface MUST filter `piktag_profiles.is_official = true` (helper:
   `is_official_user(uuid)`). Everyone auto-friends @piktag (2026-06-12),
   so a missed filter = FoF explosion + phantom mutual friends + the bot
   ranking as a person. 23 functions swept in 20260612010000 — copy one
   of those predicates. (v2 alt accounts will add `is_alt = false` here.)

### Tag-quality principles — the 7 from Google data-labeling, in PikTag terms

Adopted 2026-05-29 after a deep-dive on Google Cloud's data-labeling
guide. These are the lens through which we evaluate any change to the
tag system (search ranking, AI suggestion, Ask matching, interest
graph completeness). Numbered 1–7 so future sessions can think
"principle #N applies here."

**Tag sources to know.** Public tags come from FOUR distinct surfaces,
each carrying a *different* signal — algorithm must NOT mix them:
`self` (user tags themselves), `friend` (peer endorses a member),
`ask` (tags attached to an Ask — current intent), `event` (QR-context
tags from where you met). Private/hidden tags are owner-only and
**never enter the algorithm**. Local-contact tags on non-members are
also owner-only and out of algorithm scope.

1. **Multi-source provenance weighting.** Same tag from `self` vs
   `friend` vs `ask` vs `event` carries different reliability and
   different temporal validity. Algorithm must store source explicitly
   and weight per-source. (Implemented: `piktag_user_tags.source`.)
2. **Inter-source agreement = verified.** When self + ≥1 friend both
   tag the same person with the same concept → that tag earns a
   "verified" status: higher search weight, ✓ icon in UI, used as the
   "why this match" explanation.
3. **Active-learning style endorsement prompts.** App periodically
   nudges friends to confirm a member's self-tags — converts the
   passive "wait for friends to tag" loop into an active, low-friction
   採集 mechanism. Cap to ~1 prompt/month/user so it doesn't get
   noisy.
4. **Temporal decay per source.** `self` slow-decay (stable identity),
   `friend` medium-decay (peer perception evolves), `ask` fast-decay
   to ~0.2 after the Ask expires (still a historical signal, not zero),
   `event` no decay (when-met is factual).
5. **AI-suggestion confidence calibration.** Track high-confidence
   suggestions' actual accept rate; if 0.9-confidence suggestions only
   convert at 30%, the model is mis-calibrated — re-rank or re-prompt.
   Log every suggestion + accept/decline for the calibration curve.
6. **Negative signals are signals too.** A friend-tag the user REMOVES
   = strong anti-endorsement. A search→profile→back-out in <3s = weak
   negative match. Record these; AI shouldn't re-suggest a removed
   tag, search shouldn't keep ranking a repeatedly-rejected match.
7. **Interest-graph coverage as an INTERNAL metric.** Each user has
   a "tag-graph health score" combining: has-self-tags / has-friend-
   tags / has-ask-history / has-event-tags / concept-diversity. **Server-
   side only — do NOT surface to users as a bare number.** (Pill was
   shipped briefly 2026-05-29 then removed same day, see "Don't expose
   context-free scores" below.) RPC `get_tag_graph_health` stays for
   admin dashboards + post-launch analytics + targeting endorsement-
   request cron (#3). User-facing nudges go through the organic
   surfaces each formula component already has:
     - has_self → EditProfile completion hints
     - has_friend → endorsement-request cron (server-driven, no nag)
     - has_ask → AskStoryRow placeholder
     - has_event → QR / card-scan naturally accrues
     - distinct_concepts → exposing would cause tag spam, don't.

**Doesn't apply to PikTag** (rejected after honest review): Cohen's
kappa-style inter-annotator agreement (social tags have no ground-
truth), large review pipelines (no human reviewers), strict controlled
vocabulary at input (would kill the "use your own words" UX advantage).

### Tag ordering — rules vs weights, by surface

Pre-launch decision (founder, 2026-05-29) after shipping principles
#1–#7. **Rules serve user intent; weights serve algorithm decision.
They MUST NOT invade each other's surfaces.**

| Surface | Order by | Why |
|---|---|---|
| Own profile tag list | rules (`is_pinned` → `position` → `created_at`) | user-curated identity expression |
| Other person's profile | rules (same) | their identity, viewer should see consistent snapshot — not a per-viewer dynamic re-sort |
| Search results | **weights** (already shipped: 4-source priority cascade + endorser tiebreaker) | algorithm decision, no user intent to violate |
| TagDetail explore tab | `mutual_tag_count DESC, endorser_count DESC, id` (shipped) | weighted but mutual-first respects viewer-relevance over pure consensus |
| Popular tags list | rules (`usage_count` + `search_count`) | cold-start has 0 endorsers, weight component sleeps |
| AI suggestions (suggest-tags) | model-supplied order, calibration log accruing | post-launch re-rank decision pending data |

### Deferred tag-quality fine-tuning — revisit triggers

Post-launch follow-ups from the 2026-05-29 ordering discussion.
Don't ship before launch — these all need data the cold-start
network won't have for weeks. Remember to surface these to the
founder when the trigger condition lands:

1. **Search RPC coefficient tuning** (principles #1, #2 — `f38a8ac`
   `d4cbcd1`). Current weights: verified 30 / self 10 / friend 6 /
   ask 4 / event 3. **Trigger**: ≥3 months post-launch, ≥500
   completed searches in analytics. **Action**: pull `search_users`
   result clicks vs ranks; if top-3 conversion ~ position 7-10
   conversion, weights are noise — re-rank. Honest test: shuffle a
   small % of queries and compare CTR.

2. **TagDetail / explore sort upgrade to weighted sum** (principle
   #2 — `e9bef2b`). Current: `mutual_tag_count DESC, endorser_count
   DESC`. **Trigger**: average `endorser_count` per profile on
   tag pages ≥ 2 (cold-start = 0, no point tuning until there's
   spread). **Action**: switch to weighted sum, suggested formula
   `mutual_tag_count * 5 + endorser_count * 2`. Don't go higher
   on endorser without observing — gameable.

3. **Popular tags ranking add total-endorser dimension** (principle
   #2). Currently `usage_count + search_count`. **Trigger**: at
   least one tag has `total_endorser_count` (sum across all
   profiles) ≥ 50. **Action**: try `usage_count * 1.0 + search_count
   * 0.5 + total_endorser_count * 0.3` as a secondary tiebreaker.
   A/B test if mobile traffic warrants it.

4. **AI suggestion calibration analysis** (principle #5 — `a6ab9c8`).
   Schema already accumulating in `piktag_ai_tag_suggestions`.
   **Trigger**: ≥30 days of post-launch data AND ≥1000 logged
   suggestions. **Action**: SQL query shown in the `a6ab9c8`
   commit message — bucket by `position_in_list`, compute accept
   rate per bucket. If positions 0-2 vs 7-10 show flat accept
   rate, AI ordering is uninformative → upgrade suggest-tags edge
   fn to return real per-tag confidence, then re-prompt for
   confidence-aware ranking.

5. **Stale-self-tag refresh via endorsement prompts** (principle #3
   — `915ed55`). If post-launch monitoring shows profiles with
   self-tags that have 0 endorsements over months while OTHER
   tags on the same profile have high endorser counts, the user's
   self-description is drifting. **Trigger**: at the 1-year mark,
   pull profiles where `oldest_self_tag_with_zero_endorsers >
   90 days` AND `other_tags_on_profile_have_endorsements`. **Action**:
   ramp up endorsement_request cron frequency for these users
   specifically; do NOT auto-reorder their tags by algorithm —
   nudge them to refresh, source still > display.

6. **AI tag-suggestion dimension diversity in EditProfile** (founder
   2026-06-09, deferred from the search-category discussion — **founder
   explicitly asked to be reminded at the right time, so SURFACE this when
   the trigger lands**). Context: the browse category filter (興趣/身份/個性
   by `semantic_type`) was gated behind volume (`11ac503`) because slicing a
   cold-start tag list into sub-buckets is noise. The MORE valuable use of
   the dimension concept: when a user's self-tags are lopsided (all 興趣, no
   身份/個性), have the AI tag suggester recommend the MISSING dimensions in
   EditProfile / onboarding — organic, **NOT a score** (the tag-graph-health
   pill is the anti-pattern; see "Don't expose context-free scores"). **Why
   deferred, not a quick tweak**: suggest-tags' "person" prompt is SHARED by
   EditProfile AND card-scan; blanket-adding "include personality / span
   dimensions" would force bad personality tags onto business-card scans
   (you can't infer 個性 from a card) — and card-scan tag quality/latency is
   a STRATEGIC red line. Doing it right needs a `context:'self_profile'`
   flag → a dimension-diverse prompt VARIANT that leaves the card-scan path
   untouched, + an edge-fn redeploy + AI-output testing. Also depends on
   `semantic_type` classification being reliable (shaky at cold-start).
   **Trigger**: post-launch, once `semantic_type` is stable AND users are
   actively building profiles.

## How the founder works (keep doing this)

- **中肯 / trust-but-verify.** Give honest, balanced advice; push back with
  reasoning when something is wrong or disproportionate. Verify claims
  (incl. your own and agents') against the actual code/DB before asserting.
  The founder values honest correction over compliance.
- **NO emoji. Anywhere. Ever.** Founder, 2026-06-05 (visibly annoyed —
  *"不要emoji，你是聽不懂嗎？"*). This applies to BOTH:
    1. **User-facing app/web/edge content** — strings, components,
       notification copy, placeholders, labels. There was a whole
       `chore(strip-emoji)` pass (commit `b292714`); don't reintroduce
       any. Use lucide icon components when an icon is genuinely needed,
       never an emoji glyph. (The ⚡ BoltIcon in EditProfile's
       completion banner was a stray that slipped the strip pass —
       removed with the banner 2026-06-05.)
    2. **Chat replies to the founder** — no 👍 ✅ ⚠️ 🤖 etc. in
       responses either. Plain text only. The founder reads emoji as
       noise/unprofessional; repeatedly using them after being told is
       exactly the "聽不懂" failure to avoid.
    Sweep history: 2026-06-07 found + removed 👇 (onboarding aiPickHint),
    📣 (search askEmptyStateButton), ✓ (onboarding usernameAvailable) across
    19 locales + tsx defaultValues. **Two deliberate KEEPs — do NOT strip:**
    (a) the 50 country-flag emoji in the phone country-code picker
    (`mobile/src/lib/countryCodes.ts`) — founder call 2026-06-07, they're
    functional country identifiers with no lucide equivalent; (b) functional
    arrows like "A→Z" sort labels and swipe-hint ← → — typography, not emoji.
- **Don't reinvent; match existing patterns/design.** Reuse canonical
  components, RPCs, styles. Deviating "to be clever" is a defect here.
- **Input防呆 — prevent-or-feedback, NEVER silently drop.** Founder,
  2026-06-05, after the BirthdayInput review. The root failure to avoid:
  a field validates the input but then *silently discards* an invalid
  value (the user thinks they filled it; nothing saved, no warning). So
  any field that can be entered wrong must do ONE of two things:
    1. **Prevent the invalid value at entry** (smart mask / normalize-on-
       type), so the stored value is *always* valid. Models:
       `normalizeUsername` (帳號), `normalizeTagName` (標籤),
       `BirthdayInput`'s `consumePart` mask (生日: auto-zero-pads, clamps
       month≤12 / day≤daysInMonth, locale-orders MM/DD vs DD/MM).
    2. **Give immediate, explicit feedback** when it can't be masked
       (free-but-checkable values). Model: email (`isValidEmail` in
       `lib/validateEmail.ts`) → inline red hint on blur + gate the
       submit button. Used in Register + Login.
  Free text with no "wrong" state (name / bio / headline / address) needs
  neither — just trim + maxLength. When adding ANY new input, decide
  which bucket it's in; the one thing that's a defect is silent-drop.
- **Commodity features must feel instant — speed is a STRATEGIC red
  line, not a nice-to-have.** Founder, 2026-06-03, on card scan:
  *"我會選Path A是因為市面上已有太多掃描名片的app，我們不夠快，就會
  被誤認為爛app"*. For any feature that already exists in mature
  competitor apps (business-card scan being the canonical example —
  CamCard / 名片全能王 etc. have anchored users to "tap → result
  almost instantly"), the bar is NOT "faster than our last version"
  — it's "fast enough that nobody mistakes us for a bad app." That's
  a PERCEIVED-speed bar, not a stopwatch one. Implications that bind
  future sessions:
    * Never trade scan/commodity-flow latency for a feature on the
      CRITICAL path. The card-scan path was deliberately moved to
      on-device OCR → text-only structuring (Path A, commit fe42911)
      and `gemini-2.0-flash` primary; do NOT regress it — e.g. don't
      put bio_draft generation (or any generative/creative step) back
      into the synchronous scan call. Generation belongs off the
      critical path (lazy / async).
    * **Recognition latency is intolerable; recommendation latency is
      fine.** Founder, 2026-06-07: competitor scanners trained users that
      scan→result is INSTANT, so any wait on *recognition* (OCR→fields)
      reads as "broken app." But ChatGPT-era AI trained them that
      *recommendations* take a beat — so AI tag suggestions are allowed to
      lag. The pattern: scan → show the recognised fields IMMEDIATELY →
      fire `suggest-tags` async → the ≤3 tag picks pop in a second or
      two later, PRE-SELECTED into the tag list (opt-out — see the
      "AI-tag default state is asymmetric" rule below; founder
      2026-06-07 reversed the original gray opt-in here). NEVER block the
      field reveal on the suggestion call. (This is how the 3 AI tags
      dropped in the Path-A speed pass come back — async on
      EditLocalContact, source `card_scan`, not on
      the critical path.)
    * When actual latency can't go lower, buy PERCEIVED speed:
      optimistic UI, progressive field reveal (show the photo +
      skeleton immediately, fill fields as OCR→structuring returns),
      never a dead spinner. iOS Live Text is the reference — it isn't
      truly instant, it just always shows progress.
    * Applies to every commodity surface, not just scan: QR generate/
      scan, contact import, search-as-you-type. If a competitor does
      it instantly, "works but slow" reads as "broken" here.
- **Don't expose context-free scores to users.** A bare number with
  no actionable breakdown reads as judgment, not feedback —
  especially when the number is low because of things the user
  can't directly fix (e.g. "no friends endorsed me" → implicit
  blame). Founder verbatim, 2026-05-29 after seeing the
  "標籤健康度 25/100" pill: *"分數低大不了我刪除app，這是最極端
  悲劇的情況，萬不可以發生"*. Rule: if a metric can't be paired
  with a one-tap path to improvement that the user controls, keep
  it server-side. Profile-strength-style meters are OK only with
  a real breakdown panel + per-component CTA — never as a naked
  score. (Tag-graph health pill, principle #7, removed same day
  it shipped — RPC kept for admin/analytics.)
- **Account-deletion contract (privacy / "delete must mean delete").**
  Verified 2026-06-07 after a tester reported "刪除帳號後用同 email 重新
  註冊，資料都回來". Two load-bearing facts:
  1. **A user's OWN data is removed by CASCADE, not by the
     `delete-user` CLEANUPS list.** Every `piktag_*` table FKs
     `auth.users(id) ON DELETE CASCADE` (or `SET NULL` for
     attribution-only cols like `biolink_clicks.clicker_user_id`), so
     `auth.admin.deleteUser` wipes it all. The CLEANUPS array in
     `delete-user` is redundant defense-in-depth. **Therefore: any NEW
     table that stores user data MUST declare its user FK `ON DELETE
     CASCADE` to `auth.users`** — that, not the CLEANUPS list, is what
     actually deletes it. (Don't rely on remembering to extend
     CLEANUPS.)
  2. **The resurrection vector is OTHER users' rows, not yours.**
     `piktag_local_contacts` (owner = someone else) match you by
     email/phone and were promoted to a connection;
     `promoted_to_connection_id` is `ON DELETE SET NULL`, so deleting
     your connection RE-ARMS them, and re-registering the same
     email/phone re-fires `promote_local_contacts_for_profile` →
     recreates the connection + follow + re-applies their tags. Fix
     (founder call): `delete-user` SCRUBS the deleted user's
     email/phone out of others' local contacts (by email + by the
     promoted-connection link) BEFORE the cleanup loop, so they can
     never auto-re-match. The card (name/note/tags) survives as a
     manual entry. **If you add ANY new email/phone-keyed re-link
     surface, it must respect the same scrub** or the resurrection
     returns.
- **Adding a new notification type — the 4-point checklist.** When
  shipping a new `piktag_notifications.type` value, four spots
  MUST land in the same PR or the categorization quietly breaks:
  1. **`is_notification_category_enabled()`** in
     `supabase/migrations/20260530000000_notification_category_toggles.sql`
     (or its successor). Add the type → category mapping. Missing
     entries fail-open by design (so a forgotten type still
     delivers in-app) — but it ALSO means a user who opted out of
     the category will still see your new type, which is the bug.
  2. **`filterNotifications()`** switch in
     `src/screens/NotificationsScreen.tsx`. Add the type to the
     matching tab (`social` / `matches` / `memories`). A missing
     entry means the row inserts fine but doesn't show in ANY
     tab — invisible to the user.
  3. **`KNOWN_NOTIFICATION_TYPES`** in `src/lib/notificationTypes.ts`.
     `refreshBadgeFromServer` restricts the unread count to this
     list — without it, your new type counts toward the home-
     screen badge but the user can't see / dismiss the row from
     any tab (this is the @lpfrg "stuck badge at 1" bug 2026-05-30).
  4. **Type-specific i18n keys** under `notifications.types.<type>`
     in all 19 locale JSONs if the row's title/body is rendered
     client-side (the convention for newer types; check by
     looking at the trigger function — empty title/body strings
     in the INSERT means client-rendered). NotificationsScreen
     falls back to the DB body for unknown types, so this is
     warning-not-error level, but the row will read in whatever
     language the trigger author hardcoded otherwise.
  Quick sanity: grep your new type name in those four files
  before pushing. If it appears fewer than 4 times you've missed
  one.
- **Notification triggers MUST write a non-empty body. i18n is
  enrichment, not the load-bearing render path.** Discovered
  2026-05-30 via @lpfrg's blank vibe_shift rows. The original
  `notify_vibe_shift` (20260513030000) wrote `title=''` AND
  `body=''` and relied on the client rendering via
  `notifications.types.vibe_shift.body`. That i18n key was NEVER
  added to any of the 19 locale JSONs — net result: rows
  rendered as empty cards (bell icon + timestamp, nothing else)
  for two months until a TestFlight screenshot caught it.
  Three layers had to all fail for the bug to surface, but the
  root cause was relying on a client template that might not
  exist.

  Rule: if you're about to write `body, ''` (or `body, NULL`) in
  an INSERT into `piktag_notifications`, STOP. Either:
    1. Write a non-empty string (English fallback is fine —
       modern clients still prefer the localized
       `notifications.types.<type>.body` when present, falling
       back to your SQL body when not).
    2. OR commit the i18n template in all 19 locales in the
       same PR AND treat the i18n key's existence as a
       runtime contract (defensive grep before push).

  Default to (1). Locale files are too easy to forget across
  time — a refactor 6 months from now might rename / move /
  drop a key without realizing a trigger depended on it. SQL
  body lives in the same file as the INSERT and is grep-
  visible at the call site. Closer-to-the-INSERT wins.

  See migration 20260530080000 for the canonical pattern —
  v_body computed once, written to the INSERT, AND the data
  jsonb still carries the rich fields for clients that DO have
  the i18n template.
- **Match the control to the layer it actually owns.** An in-app
  toggle should govern in-app behavior; the OS owns OS behavior.
  Don't try to make one switch control both — the engineering cost
  scales with surfaces touched, and you usually end up forcing a
  worse mental model on the user just to keep symmetry. Founder
  call, 2026-05-30 (notification Phase-2 push gating):
  - Settings' 3 notification category toggles control the
    NotificationsScreen feed and the app-icon badge. That's it.
  - Lock-screen pushes still go out for every type the app sends
    — even from categories the user "turned off". Reason: the
    layer-correct switch for "stop interrupting me at all" is the
    OS-level per-app push permission, not an in-app Settings row.
  - Concretely: we did NOT wrap each of the ~8-10 trigger /
    edge-fn `net.http_post` calls with an
    `is_notification_category_enabled()` check. That would have
    meant a 100-200-line CREATE OR REPLACE per function, ~10
    migrations of mechanical SQL with real regression surface, to
    close a gap that's only observable for users who actively opt
    out of a category AND then notice the lock-screen vs feed
    mismatch. Cost-benefit is wrong pre-launch and arguably
    wrong post-launch too.
  - Generalize: when a request "make X control Y AND Z," ask
    whether Y and Z are owned by the same layer. If not, push
    back honestly rather than build the bridge.
- **Shared UI = ONE shared component, never per-screen style copies.**
  Per-screen drift (a chip/row/button slightly different on each screen)
  is a recurring defect the founder keeps catching. If a UI element
  exists on >1 screen, it must be a single component reused everywhere —
  fixing it by "aligning the style values" is a stopgap, extracting the
  component is the fix. Canonical shared elements so far:
  `components/TagChip.tsx` (the removable "#tag ×" chip — used by
  EditLocalContact / AddTag / EditProfile "我的標籤"); the AI-suggestion
  chip pattern (gray pill, no "+", purple press-flash, cap 3); the
  "尚未加入 PikTag" not-joined row in ConnectionsScreen (local
  contacts + pending scans). Before building any chip/row/pill, check
  if one of these (or an existing component) already covers it.
- **AI-suggestion cue = `components/BoltIcon.tsx` (lucide `Zap`,
  lightning), EVERYWHERE.** Founder, 2026-06-07. The lightning — NOT
  Sparkles, NOT an emoji — is the app-wide "this came from AI" symbol.
  Every AI-recommendation surface uses it: AddTag "AI 為你推薦",
  QrGroupDetail, ManageTags, EditProfile, AskStoryRow, the card-scan
  result note, and onboarding step-2 (the last `Sparkles` holdout was
  aligned to BoltIcon same day). Don't reintroduce Sparkles or a bare
  glyph for "AI"; reuse BoltIcon. It doubles as a speed/instant cue,
  which is on-brand.
- **AI-tag default state is asymmetric by surface — opt-OUT mid-event,
  opt-IN pre-event.** Founder, 2026-06-07. NOT a bug, NOT to be
  "made consistent":
    - **Card scan (EditLocalContactScreen) = PRE-SELECTED (opt-out).**
      A scan happens mid-event; speed wins. The ≤3 picks (capped like
      Ask) drop straight into `tags` as selected purple chips; the user
      removes any wrong one. A BoltIcon note ("AI 根據名片為你加上了
      標籤，不要的點掉就好") sits above so the auto-add never feels
      non-consensual. Calibration (principle #5) logs accept at SAVE
      for picks that SURVIVED (removed = soft decline) — keeps the
      accept signal honest despite default-selection.
    - **Event tags (AddTagScreen "建立 Tag") = OPT-IN (gray, tap-to-add),
      and recommends MORE than 3.** It's configured pre-event, no time
      pressure, so the user curates from a wider set. Leave it opt-in.
  The lens: opt-out only where a few high-precision picks meet real
  time pressure; opt-in where the user is planning at leisure.
- **Know the CTA of every screen — and protect its visual weight.**
  Each screen has ONE primary action that earns its existence; the
  rest of the layout serves that action. Treating the CTA as just
  "one more button in the scroll" is how it gets buried, narrowed,
  or out-shouted by a feature added later.

  **Visual contract for a primary CTA (locked):**
    - Solid `piktag500` fill, `#FFFFFF` text, `borderRadius: 14`,
      `paddingVertical: 15`, `fontWeight: '700'`, `fontSize: 16`.
    - Matches the canonical `saveBtn` token used across
      EditLocalContact / EditProfile / etc. Don't reinvent.
    - Secondary actions are outlined (`borderWidth: 1.5`,
      `borderColor: piktag500`, `color: piktag600`, transparent
      bg). Hierarchy MUST be readable across the room — if you
      can't tell which is primary from a glance, the visual tier
      is wrong.
    - When the same shared component is used as primary on screen A
      and secondary on screen B (the LocalContactShareButton case),
      add a `variant: 'primary' | 'secondary'` prop, default to
      `'secondary'` to keep unaudited call-sites safe, and have
      callers pass `'primary'` explicitly on the screen where the
      button IS the locked CTA.

  **3-tier button system + the gradient "signature" rule (locked,
  founder 2026-06-07).** The key reframe: **the brand gradient is NOT
  "a second/stronger CTA" — it is the colour of the "招牌 / signature"
  action**, the thing that IS PikTag's magic. Two SOLID-purple buttons
  on one screen is the confusing case (which is the CTA?); a solid
  commit + a gradient signature reads as two DIFFERENT ROLES and is
  fine. The tiers:
    1. **GRADIENT `['#ff5757','#c44dff','#8c52ff']` = signature action.**
       AI tag recommendation, generate-my-QR — the product's wow. White
       text/icon. AT MOST ONE per screen. Owned by the shared
       `components/GradientButton.tsx` (fixed brand colours, theme-
       agnostic — same doctrine as the splash/QR-sheet gradient). If the
       signature action is ALSO the page's only commit (產生 QR Code —
       no separate save), gradient IS the CTA. If the page has a mundane
       commit too (儲存 / 下一步 / 完成), that stays tier 2 and the
       gradient marks the signature feature.
    2. **SOLID `piktag500` + white = standard commit/continue** (the
       locked `saveBtn` token above). 儲存 / 下一步 / 完成 / 送出.
    3. **Outlined `piktag500` = secondary / optional.**
    - **The light-purple `piktag50`-fill button tier is RETIRED.**
      Anything that was a signature action (the old AI-suggest pills)
      moves up to tier 1 gradient. Don't reintroduce a `piktag50`-bg
      button.
    - Current tier-1 sites: AddTag 產生 QR Code; onboarding step-2
      「讓 AI 推薦標籤 / 再推薦一些」. NEVER let a screen show two
      gradients — before adding one, check the screen has no other
      GradientButton. (The AI sections on AddTag / EditProfile / Ask /
      ManageTags are *headers* — BoltIcon label + small refresh — NOT
      buttons, so they correctly stay as-is, not gradient.)

  When founder identifies a screen's CTA verbatim, lock it here so
  future sessions don't drift. Known locks (extend as new screens
  get a founder-identified CTA):
    - **LocalContactDetailScreen — CTA = "寄我的聯絡資料給他".**
      The North-Star install-funnel action: a saved non-member
      becomes a member via viewer → recipient → pikt.ag/{viewer} →
      install. Must sit pinned at screen bottom (small-hand thumb
      reach), visually separated from contact-info content (top
      border), and at FULL contact-info width (the inline-in-
      ScrollView version was 40px narrower from double-inset —
      don't regress). NEVER move it back into the scroll, never
      add a competing button next to it, never make it secondary
      to "編輯". Founder 2026-06-03: *"寄我的聯絡資料給他就是
      那頁的 CTA"*.
    - **EditLocalContactScreen — CTA = "儲存" (save).**
      A form screen's CTA is the commit. The scan accelerator was
      the primary CTA briefly and was demoted on purpose — re-scan
      from inside the edit form is a logic error (founder rule
      "scan-accelerator removed from edit"). Don't re-promote.
  Pattern when adding ANY new button to a screen with a known CTA:
  the new button MUST visually defer (secondary outline, smaller,
  or further from the thumb arc). If you can't add it without
  competing for primary-CTA weight, you don't add it — you redesign
  the surface or push the request back.
- **Biolink quick-pick is locale-aware — NA default + CJK variants.**
  The chip row a user sees first when adding a link lives in
  `mobile/src/lib/platforms.ts`. Use `getQuickPickKeys(i18n.language)`,
  NOT the raw `QUICK_PICK_KEYS` array (that const is only the NA /
  default order now). Founder direction 2026-06-04: *"依不同市場排序
  當然是最好,台灣不是主戰場"*. The model:
    - **`QUICK_PICK_KEYS` = NA / default.** WhatsApp/Reddit/Snapchat-
      led. This is correct not just for NA but for most of the world
      (LatAm, Europe, India, MENA, SEA are all WhatsApp-dominant), so
      every non-CJK locale falls through to it ON PURPOSE.
    - **`QUICK_PICK_BY_LANG` = East-Asia overrides** (zh-TW, zh-CN,
      ja, ko) — the only markets where the default is actively wrong:
      LINE leads in TW/JP, KakaoTalk in KR, WeChat+Alipay in mainland.
      **LINE must NOT lead in zh-CN** (blocked in mainland). So
      "LINE's absence from the NA quick-pick" is correct, AND "LINE
      leads the zh-TW/ja quick-pick" is correct — don't flag either.
    - **Payment rails:** PayPal (NA/intl, username handle, in the NA
      default) + Alipay (mainland/diaspora, paste-mode token link, in
      the CJK variants). Both are the USER's own link (biolink
      completeness, NOT PikTag monetization → v3 defer-monetization
      rule unaffected).
    - **LINE Pay was evaluated 2026-06-04 and REJECTED — do not add
      it.** Its personal receive flow is a QR *image* with no
      shareable public URL (verified), so it cannot be a tappable
      biolink; Japan also terminated LINE Pay. The real "pay me via
      LINE" path is the existing `line.me` friend link → transfer
      in-app. If a future session is asked to "add LINE Pay", point
      here.
- **Onboarding is a strictly linear, gated, type-only funnel — no
  branches.** Founder, 2026-06-05: *"註冊後直接去精靈，線性走完，不要有
  其他分支"*. The contract (lock it; don't let a future session add a
  "shortcut"):
    - **Register → straight into the wizard.** No "註冊成功" interstitial
      alert, no detour to Login. A brand-new account (no
      `piktag_profiles.onboarding_completed`) routes to the wizard via
      `AppNavigator.decideOnboarding`. New-account splash→wizard must
      have NO flash of the empty home (set `onboardingDecision='pending'`
      before the async check).
    - **Step 1 → 2 → 3, forward-gated, to completion.** Each step's
      next/finish is disabled until its requirement is met (identity
      filled / ≥3 tags / ≥3 links). The ONLY exit is finishing
      (`navigation.reset` → Main).
    - **No escape hatches**: no "skip all", no back-to-login, no
      close-to-home, no mid-wizard navigation to another screen.
    - **The ONLY skippable thing is the avatar field** (not the wizard).
    - **No card-scan accelerator in onboarding** (removed 2026-06-05).
      It was a camera detour + confirm-modal branch off the linear
      flow. The wizard is hand-typed only. (CardCamera still serves the
      friends-page "+人" scan — just not onboarding.) Inline helpers that
      DON'T leave the screen are fine (e.g. the AI tag-suggest button on
      step 2 — tap → gray chips appear in place; that's not a branch).
    - **`onboarding_completed` is the gate's source of truth**, set TRUE
      only at `handleComplete` (the true end). A user who bails after
      step 1 has username+full_name but NOT this flag → correctly
      re-prompted. Don't infer completion from profile-field presence.
    - The launch gate must **never block on the network** — the
      onboarding profile check is timeout-bounded + has a watchdog
      (a stalled query once bricked the splash; see AppNavigator).
- **Every change:** `tsc` clean → commit → push. i18n spans **19 locales**
  (`mobile/src/i18n/locales/*.json`) — keep all in sync (JSON round-trip
  into the right block; verify the key landed where intended).
- **In-house translations are FINAL — don't keep flagging native review.**
  All 19 locales are authored in-house, every PR. The founder has no
  native-speaker review resources and accepts the in-house translations
  as shipped (verbatim 2026-06-05: *"待母語者覆核，你就正常翻譯吧"*;
  earlier *"我沒資源找母語者，這是我要承擔的"*). So: translate carefully
  (especially ar / ur / hi / bn / th — RTL + Indic, easy to get subtly
  wrong) but DON'T append a "ar/ur/hi/bn/th pending native review"
  caveat to every turn or compile forwarding lists unasked. Ship the
  19, move on. Only surface a specific string if YOU have real doubt
  about its correctness.
- **DB migrations auto-apply** on push to `main` via
  `.github/workflows/supabase-deploy.yml` (the `db-push` job runs
  `supabase db push` against the linked project). DO NOT ask the
  founder to run SQL by hand — commit, push, watch CI. Files MUST
  use 14-digit `YYYYMMDDHHMMSS_name.sql` format (one row per file in
  `supabase_migrations.schema_migrations` keyed on the prefix —
  duplicate prefixes break the CLI; see 2026-05-27 8-digit incident).
  Keep migrations idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` /
  `ON CONFLICT DO NOTHING`) so CI re-runs and manual edits don't
  collide. Supabase ref `kbwfdskulxnhjckdvghj`.

  **The ONLY deployed migrations dir is `mobile/supabase/migrations/`.**
  The deploy workflow runs `db push` with `working-directory: mobile`, and
  its path trigger is `mobile/supabase/**` — so ANY DB migration MUST live
  in `mobile/supabase/migrations/`. The repo ALSO has a root
  `./supabase/migrations/` (and stray `Piktag/mobile/...` copies) — those
  are NOT deployed by any workflow; a migration dropped only there is
  silently never applied. This caused the 2026-06-24 drift: the
  `20260621*` social_analytics migrations were committed to the root dir
  only, so remote's history recorded them (applied out-of-band) while the
  workflow's `mobile/` dir lacked the files → `db push` errored "Remote
  migration versions not found in local migrations directory" and blocked
  every later migration. Fix (`44f63eb`): vendor the files INTO
  `mobile/supabase/migrations/` so the CLI's view matches remote. Rule:
  new migration → `mobile/supabase/migrations/`, full stop. If you ever
  see the "not found in local" error, the culprit is a version in remote's
  `schema_migrations` with no matching file under `mobile/` — add/restore
  the file there (don't `migration repair` blind; that just hides it).

  **Concurrent-session migration ordering (2026-05-30 incident).** If
  TWO sessions ship migrations on the same day with overlapping
  timestamp ranges, the LATER-pushed ones may apply to remote FIRST
  (CI queueing / cancel-in-progress is per-workflow, not per-session).
  When the EARLIER-numbered migration's CI then runs, `supabase db
  push` refuses with: *"Found local migration files to be inserted
  before the last migration on remote database. Rerun the command
  with --include-all flag to apply these migrations."* The CLI's
  strict-order check is deliberate. Two ways out:
  1. **Rename your migration to a higher timestamp** so it slots
     AFTER everything currently on remote. Content stays byte-
     identical. Update the file's leading `-- <filename>` comment
     to match. This is what we did for `vibe_shift_body_and_data`
     (`080000` → `160000`).
  2. Patch the workflow to run with `--include-all`. Riskier (loses
     the strict-order guard for future drift). Don't.
  Pre-empt: before writing the timestamp on a new migration, glance
  at `ls supabase/migrations/ | tail -3` for the actual latest
  prefix on disk — including any pulled from origin. Don't blindly
  guess `<today>080000`.
- **Repo layout:** real mobile app = `mobile/`; landing = `landing/`
  (Vercel, `dist` gitignored, rebuilt on push; meta in
  `landing/api/*` + `landing/public/*` + `src/main.tsx`). **The repo ROOT
  is the live `piktag-admin` Next.js 16 app** — `app/(admin)/*` (dashboard,
  users, reports, analytics, audit-log, mission-control, tags),
  `app/api/admin/*`, `components/admin/*`, `lib/supabase-admin.ts`
  (service-role), `middleware.ts` (ADMIN_EMAILS gate). Deploys to
  `piktag-admin.vercel.app` + `admin.pikt.ag`. Do NOT treat the root as
  stale (a 2026-06-07 session nearly re-built a dashboard that already
  existed): only the top-level `/src` (old RN web bundle) is the stale
  duplicate. Repo `LaiQuan-tech/Piktag`.
- **iOS TestFlight** builds on push to `mobile/**` (excl. supabase/scripts);
  `concurrency: cancel-in-progress` collapses bursts. Two Apple-side
  gotchas to know — both bite specifically when you ship many builds
  in a day; both surface as the same generic `exit code 70`:
  1. **Per-app daily upload cap** — a soft 24h wait after hitting it.
     Pre-empt by batching mobile commits.
  2. **Version-train closure** — Apple closes a `CFBundleShortVersionString`
     "train" (e.g. `1.0.0`) for new submissions after enough builds
     accumulate on it. The error message is explicit: `Invalid
     Pre-Release Train. The train version 'X.Y.Z' is closed for new
     build submissions`. Fix: bump `expo.version` in `app.json` to a
     higher number (e.g. `1.0.0` → `1.0.1`). This opens a new train.
     buildNumber auto-increments per push and is separate.
  Diagnose at the build log step "Export and Upload to TestFlight" —
  whichever of (1) or (2) is in the log tells you which to do.
  Founder hit (2) on 2026-05-30 after the 40-commit refactor day.
- **Dark mode is shipped.** Settings → toggle. Canonical pattern for
  any new theme-aware code (founder, 2026-05-23, after three full
  waves of mechanical migration across 80+ files):

  ```tsx
  import { useTheme } from '../context/ThemeContext';
  // ...
  function MyComponent() {
    const { colors, isDark } = useTheme();
    const styles = useMemo(() => makeStyles(colors), [colors]);
    // ...
    return <View style={styles.x}>...</View>;
  }
  function makeStyles(c: ColorPalette) {
    return StyleSheet.create({
      x: { backgroundColor: c.background, color: c.text },
      // ...
    });
  }
  ```

  **EVERY function component that uses `styles` needs its own hooks**
  — including file-scope `React.memo(...)` sub-components (e.g.
  ConnectionsScreen's `ConnectionItem`, the skeleton variants in
  `SkeletonLoader.tsx`). They can't capture `styles` / `colors`
  from a parent's closure. Same for plain helper functions that
  need colors — pass `colors: ColorPalette` as a parameter (see
  `getBiolinkIcon` in FriendDetailScreen).

  **`useCallback`/`useMemo` that builds themed JSX MUST list
  `styles` + `colors` in its deps** — `renderItem`, `listHeader`,
  memoized style arrays, etc. `styles` is a fresh object each theme
  switch; a callback that omits it from deps freezes on whatever
  theme rendered first (the symptom: black list rows on a white
  page, or vice-versa, after the launch theme settles). Plain
  inline `renderItem={() => …}` is safe (recreated each render);
  the trap is only the memoized form.

  StatusBar: `barStyle={isDark ? 'light-content' : 'dark-content'}`.

  NEVER reintroduce hardcoded `COLORS.X` in styles (`COLORS` is the
  light-mode constant only; use it ONLY for true brand-fixed colors
  like #FFFFFF on a piktag500-saturated CTA where the white is
  *intentionally* fixed regardless of theme).

  **Inverse trap: hardcoded WHITE bg + theme-aware FG = invisible
  text in dark mode.** When a surface deliberately keeps a fixed
  light background (e.g. white pill buttons on a brand gradient
  that's always vivid), the text/icon colour MUST also be
  hardcoded (#111827 or similar dark) — NOT `colors.gray900`,
  which flips near-white on dark theme and disappears against
  the white. Founder caught this 2026-05-31 ("這是dark mode的
  經典錯誤... 又錯了") on the personal-QR sheet's Copy/Share
  pills; the bug was inherited from the activity QR sheet
  (`AddTagScreen.renderQrMode`) which had the same flaw —
  fixed both in commit 05d2169's follow-up. Rule of thumb: a
  hardcoded bg colour pairs with hardcoded fg colours; a
  theme-aware bg pairs with theme-aware fg. Don't mix.

## Infra & ops — admin backend, auth emails, DNS (set 2026-06-07)

- **Ops/营运 data lives in the admin backend, NEVER the user app.** Founder
  verbatim: *"app 別做不關使用者的事情"* + *"所有營運的資料,你要顯示都顯示
  在後台"*. So:
    - The user app must NOT push internal telemetry. We REMOVED the
      concept-health digest, the linker-stall alert, AND the growth-pulse
      pushes (new-signup / first-friend triggers `notify_admin_new_signup`
      / `notify_admin_first_connection` were dropped). The
      `notify-admin-growth` edge fn + its `admin_alert` event are now
      dormant/unused — don't revive into the app.
    - Anything ops-facing goes in the **piktag-admin** Next.js app
      (`admin.pikt.ag`). Concept-graph health + GC merge candidates render
      on its **Tags page** (`app/(admin)/tags/page.tsx`) via read-only RPCs
      `admin_concept_graph_health()` + `admin_report_concept_merge_candidates()`
      (service-role; SECURITY DEFINER; 20260605060000).
- **Supabase Auth config is managed AS CODE**, not in the dashboard:
  `.github/workflows/supabase-auth-config.yml` PATCHes the Management API
  (`/v1/projects/<ref>/config/auth`) on push to `mobile/supabase/auth/**`.
  It sets `site_url`, **read-merge-writes** `uri_allow_list` (so existing
  OAuth/deep-link redirect URLs are never clobbered), the recovery email
  subject + template, and SMTP (when `SMTP_*` secrets exist). **NEVER use
  `supabase config push`** — it's declarative and would reset the
  dashboard-only Apple/Google OAuth providers.
- **Password reset uses the token_hash flow, NOT the PKCE ConfirmationURL.**
  Mobile is `flowType:'pkce'`, so a `{{ .ConfirmationURL }}` link
  (`/auth/v1/verify?token=pkce_…`) needs the code_verifier stored in the
  app's SecureStore — opening it in any browser fails ("invalid/expired")
  100% of the time. Fix: the recovery email links to
  `https://pikt.ag/reset-password?token_hash={{ .TokenHash }}&type=recovery`
  and `landing/src/pages/ResetPassword.tsx` calls
  `verifyOtp({type:'recovery', token_hash})` **at submit** (so email
  link-scanners can't pre-burn the one-time token). `recovery-email.html`
  is **English-only** (founder call — Supabase sends one template to all
  users regardless of app language; per-locale emails would need a custom
  edge-fn send pipeline, out of scope).
- **Branded sender via Resend custom SMTP** — `noreply@pikt.ag`, "PikTag".
  Secrets in GitHub Actions: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`,
  `SMTP_USER=resend`, `SMTP_PASS=<resend api key>`, `SMTP_SENDER_NAME=PikTag`,
  `SMTP_ADMIN_EMAIL=noreply@pikt.ag`. pikt.ag is verified in Resend (DKIM/
  SPF/MX/DMARC records live at Dynadot).
- **DNS facts.** `pikt.ag` is registered at **Dynadot**; DNS hosted on
  Dynadot's nameservers (`ns1/ns2.dyna-ns.net`) — **NOT** Vercel
  (`vercel domains inspect` shows the intended-NS ✘). So subdomain/email
  records (admin A 76.76.21.21, Resend DKIM/SPF/MX/DMARC on
  `resend._domainkey` + `send` + `_dmarc`) must be added **by hand in the
  Dynadot DNS panel** — browser automation of Dynadot does NOT work (its
  page never reaches `document_idle`, so every screenshot/read times out).
  Vercel CLI is authed as `lqtech2026`; the Vercel apex + a `*` wildcard
  ALIAS exist in Vercel's zone but are dormant until NS points at Vercel.
- **CI gotcha — pgvector `<=>` + search_path.** A `LANGUAGE sql` function
  using the `<=>` cosine operator MUST `SET search_path = public,
  extensions` (pgvector lives in `extensions`). A bare `search_path =
  public` throws 42883 at CREATE time, and because it's validated eagerly
  it FAILS the whole migration → `supabase db push` stops there and every
  later migration silently never applies. (This blocked the entire
  060000→140000 stack for hours on 2026-06-06.) plpgsql bodies are
  late-bound and don't hit this.
- **Gemini model ids — ONLY the 2.5 family is live (verified 2026-06-07
  by direct probe of the project key).** Google RETIRED
  `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.0-flash-001`,
  `gemini-1.5-flash`, `gemini-1.5-pro`, and the dated 2.5 previews — they
  return **404 "no longer available"**. The ONLY live chat models for this
  key are **`gemini-2.5-flash`** (quality) and **`gemini-2.5-flash-lite`**
  (the fast/cheap one — use it where speed matters: card-scan tagging,
  scan OCR-structuring). `gemini-flash-latest` also resolves but points at
  a thinking model (slower) — avoid. Embeddings stay `gemini-embedding-001`.
  Why this bit hard: every edge-fn model chain led with now-dead ids, so
  calls silently fell through to whatever live model was deeper in the
  chain — and suggest-tags' `fast` chain had NO live model at all →
  **503 on every card scan** (the "0 AI tags" bug, 2026-06-07). Two rules:
  (1) NEVER put a non-2.5 model id in a chain. (2) For 2.5 models, set
  `generationConfig.thinkingConfig.thinkingBudget = 0` on latency-
  sensitive calls (2.5 has thinking on by default; scan-business-card
  already does `if (model.startsWith('gemini-2.5'))`). When Google ships
  the next generation, re-probe before adding ids (a quick `{diag:true}`-
  style per-model status loop, then remove it).

## Matching surfaces — concept-awareness (audited 2026-06-06)

Cross-language 媒合 only works if a surface expands query/tags through
`concept_id` siblings. Audited all of them; made these concept-aware
(were literal `tag_id = tag_id`, so 養貓 never matched cat/ねこ there):
`notify_tag_convergence` (the real-time "N friends also tagged #X" moment),
`find_reconnect_suggestions`, `find_tag_combinations` — all now key by
`COALESCE(concept_id::text,'tag:'||id)` with `concept_id IS NOT NULL`
gating (unlinked tags still exact-match → no regression). Already
concept-aware: `search_users`, `match_ask_to_friends`,
`explore_users_for_tag`, the recommendation cron, `notify_ask_bridges`,
`fetch_ask_feed`. **Left literal on purpose:** `find_tag_similar_strangers`
(no longer called — the search redesign removed the recommendedUsers
surface; don't "fix" dead code). The "你可能認識" notification already
exists = the daily recommendation cron (`enqueue_recommendation_notifications`,
type `recommendation`, "你可能認識 X — N 個共同標籤") — don't build a
duplicate.

## Official account @piktag (2026-06-12)

Fixed UUID `00000000-0000-4000-a000-000000000001`, `is_official = true`,
never logs in. Every user auto-friends it at wizard completion
(trg_add_official_friend) + full backfill — it replaces the Friends-page
teaching cards (one quiet ListFooter hint line remains). Design facts:
connections BOTH directions (notify_friend handshake) but follow ONE way
(user→official; keeps notify_mutual_follow silent); the one
"成為好友" notification per user is deliberate (demos the bell tab);
official is excluded EVERYWHERE as candidate AND as broadcast actor
(20260612010000 sweep — see ranking-surface checklist #4). Its Asks /
tag-adds do NOT notify; official announcements would be a new deliberate
feature, not a side effect. Avatar still needs uploading (founder).
Content lives in normal piktag_* rows — edit via admin/SQL anytime.
`find_tag_similar_strangers` is dead code and was left unswept — add the
two-hop is_official predicates if ever revived.

## Concept GC — measured, deferred (2026-06-07)

The feared "248 fragments" did NOT materialise — the sync alias-resolver
trigger (20260530150000) + seed expansion (20260605050000: pets incl. the
North-Star `#養貓`, + high-freq interests/careers, cross-language) kept it
clean. The admin Tags page showed only **2 merge candidates ≥0.85, both
0-tag singletons** (創新↔創新產品, 插畫↔插畫家). Decision: do NOT run a
destructive GC merge yet — 0-tag means zero matching impact, and
創新↔創新產品 is arguably a wrong merge. Re-check post-launch when real
tags accrue; only merge "high-similarity + both sides have real tags". The
read-only inventory RPCs stay for monitoring (admin Tags page).

## Brand voice — locked phrases

- **Primary market is NORTH AMERICA, not Taiwan** (founder 2026-06-11,
  reinforcing the 2026-06-04 quick-pick call "台灣不是主戰場"). Concretely
  for COPY: in-copy examples (cities, names, scenarios) localize PER
  MARKET — the EN master uses US examples (Seattle, not Taipei); only the
  zh-TW locale keeps 台北. Never export Taiwan-centric examples into other
  locales' copy (store listing, landing, app strings). The reader must
  feel "this is about MY life", and the default reader is North American.

- **"Pick. Tag. Connect."** is the locked brand signature (founder
  approved 2026-06-09, replacing the prior **"PikTag to connect."**
  which was a grammatically-awkward subjectless fragment). Three clean
  imperatives that ALSO spell the brand phonetically (PikTag = Pick +
  Tag) and name the product flow. **English-everywhere — do NOT
  translate** (the Pick/Tag wordplay only works in English) and do NOT
  modify without explicit founder approval. It's the constant brand
  signature paired with the logo; the hook line is the rotating
  creative (it survived the "Tag the Vibe, Keep the Tribe" →
  "Tag yourself. Find anyone." swap). Lives IDENTICALLY across every
  surface — landing `hero.description` (all 19 locale JSONs carry the
  same English string, NOT localized), mobile SplashOverlay +
  QrGroupList header, and landing/public scan.html + download.html;
  when you touch one, touch all. (History: "PikTag to connect." was the
  locked signature 2026-05-30 → 2026-06-09.)
- **"Tag yourself. Find anyone."** is the current hook line
  (2026-05-30, replacing "Tag the Vibe, Keep the Tribe"). Mobile
  brandTagline is English-everywhere; landing hero.title1+title2
  is localized per locale (founder-approved zh-TW: "自己標自己，
  誰都找得到。"). See commit 107130a for the full 5-surface align.

## Nav change — Chat tab replaced event-QR tab (2026-06-24, SHIPPED)

Founder feedback 2026-06-24: the **活動 QR (event-group QR) tab is
unpopular/ignored**; **chat should be promoted** into that bottom-tab slot.
Approved after honest evaluation; **SHIPPED 2026-06-24** (plan below kept
as as-built reference). Tab order is now Home / Search / **Chat**
(MessageCircle) / Notifications / Profile. Event-QR (QrGroupList /
AddTagCreate / QrGroupDetail) lives in RootStack as full-screen pushes,
reached from the ConnectionsScreen header QrCode icon ("建立活動 QR") +
on_this_day deep links. Chat-unread badge moved to ChatTab; bell-header
ChatList button removed; ChatListScreen hides its back arrow when it's the
tab root; cold-start "互掃 QR" card now routes to CameraScan (scan a
person's QR). "Strengthen chat" (features) is still separate — not done.

Why sound: chat is the reactivation-loop endpoint (search→find→message; AI
icebreaker→reconnect — the North-Star activation engine) but is buried
under the bell-tab header's ChatList button. Event-QR is a rarely-used
*creation* tool eating a prime tab slot. **中肯 caveat: demote event-QR,
do NOT delete it** — "ignored" is likely a cold-start artifact (testers
aren't at live events) and the App Store copy explicitly sells the
conference/meetup case. Note the `#` tab is the EVENT-group QR creator, NOT
the personal 互掃 QR (that's on Profile) — so removing the tab doesn't
touch the North-Star friend-add loop.

Plan (file-level, verified against code 2026-06-24):
- `AppNavigator.tsx`: rename `AddTagTab`→`ChatTab`, component = new
  `ChatStackNavigator` (root ChatListScreen). Icon `Hash`→`MessageCircle`,
  a11y `tabs.chat`. Move `tabBarBadge: chatUnread` off NotificationsTab
  (~line 232) onto ChatTab. Delete `AddTagStackNavigator` + `AddTagStack`
  const + the getFocusedRouteNameFromRoute tab-bar-hide logic.
- Move event-QR's 3 screens (`AddTagMain`=QrGroupListScreen,
  `AddTagCreate`=AddTagScreen, `QrGroupDetail`) into **RootStack** as
  full-screen pushes (like FriendDetail) — no tab bar, no hide-logic,
  notificationRouter navigates them directly.
- `ChatThread`/`ChatCompose` stay in RootStack (cross-origin back-nav from
  profiles preserved). ChatListScreen becomes ChatTab root — **hide its
  ArrowLeft back button when `!navigation.canGoBack()`** (header ~382,
  handleBack ~276) so it reads as a root.
- Reroute: `ConnectionsScreen.tsx:925` cold-start "互掃 QR" card → PERSONAL
  QR share (not the event tab — fix it right); `OnboardingScreen.tsx:681`
  reset list `AddTagTab`→`ChatTab` (still lands index 0 = HomeTab);
  `notificationRouter.ts:84-94` QrGroupDetail deep-link → new RootStack
  location; `NotificationsScreen.tsx:824` bell-header `navigate('ChatList')`
  → remove (redundant once Chat is a tab).
- New event-QR entry: ConnectionsScreen header "+" area gets a
  "建立活動 QR" item → navigate to QrGroupList.
- i18n: add `tabs.chat` ×19; keep `tabs.addTag` for QrGroupList header a11y.
- Verify: tsc; chat tab opens; thread push+back works from BOTH a profile
  AND the inbox; badge correct; event-QR reachable+creatable; no dangling
  `AddTagTab`.

Separate, do NOT do blind: founder also said "strengthen chat" — that's
FEATURES, distinct from this (prominence). Get the specific asks first; the
"strengthen" may just be "couldn't find it."

## Unified scanner (`CameraScanScreen`) — QR auto + card one-tap (2026-06-25)

One screen does BOTH "scan a person" paths (founder unified card-scan +
QR-scan into a single screen, like the personal-QR share sheet — can scan,
or flip top-right to BE scanned). The split, and WHY it's split this way:

- **QR → continuous + automatic.** Barcode scanning makes NO sound; point
  at a PikTag QR → instant connect, zero taps. This is the magic path.
- **Card → ONE deliberate "拍名片" tap = ONE capture** → `EditLocalContact`
  runs the full, unchanged `scanCard` pipeline on mount (recognition red
  line untouched). One normal shutter click, like any photo.

**LOCK — do NOT rebuild the shutter-less auto-detect loop.** The original
2026-06-24 build did exactly what the founder asked ("不要快門，自動辨識"):
a loop that silently `takePictureAsync` every ~1.3s + on-device OCR to
decide QR-vs-card. KILLED 2026-06-25 — `takePictureAsync` fires the iOS
shutter SOUND every call (legally mandated + unmuteable in JP/KR & some
regions), so the loop machine-guns "click click click" (founder: "很吵").
`animateShutter={false}` silences the *animation*, NOT the sound. expo-camera
cannot OCR the live preview, so ANY auto-detect needs repeated captures =
repeated sound. The ONLY truly-silent live-OCR path is a camera-engine swap
to **react-native-vision-camera frame processors** — a big native change,
deferred. So: QR stays auto (silent), card is a single tap. If a future
session is asked again for "auto card, no tap", the answer is vision-camera
or nothing — don't reintroduce the capture loop.

## v2 plans — committed direction, not built yet

### Alt accounts ("小號" — IG-finsta model, decided 2026-05-30)

Founder direction for the next major version. Locked here so the
design doesn't drift over the next 1-2 months while we ship v1.

**The purpose is privacy-motivated audience segmentation, not
anonymity.** Founder framing 2026-05-30: *"其實就是不同的人，因為都
會有些癖好，不能給同事、普通朋友知道"*. Main = "the me my
coworkers and acquaintances know". Alt = "the me my close hobby
friends know". Same human, two curated faces. Every design choice
below flows from this — it's audience curation, not hiding the
person.

**Tier**: L1 — completely independent accounts. Each alt is its own
`auth.users` row with its own email/phone (NOT one auth-user with
multiple profiles — IG's actual model is multi-account on device,
not multi-persona on account). Switching accounts = real auth swap
(sign out current, sign in alt via stored Keychain credentials).

**Friend graphs are completely separate** at the storage layer — no
shared `piktag_connections` rows across an alt/main boundary.

**Asymmetric discovery — alt sees the world, the world doesn't see
alt.** This is the IG-finsta truth and it's simpler than the strict
"hard exclude main's friends from alt's results" rule the design
flirted with earlier. Specifically:

  * EVERY ranking RPC operating on someone OTHER than the alt's
    owner filters out alt accounts: `search_users`,
    `match_ask_to_friends`, `explore_users_for_tag`, the
    recommendation cron, `ask_bridge`, `reconnect_suggest`,
    `tag_combo`, `tag_convergence`. From the platform's perspective,
    alt accounts effectively don't exist for anyone but their owner.
    The "Adding a new ranking surface" CLAUDE.md checklist gains a
    4th bullet at v2 ship: "filter `WHERE p.is_alt = false`".

  * The alt OWNER, on the other hand, sees the WHOLE platform
    normally — including main's friends. Founder verbatim 2026-05-30:
    *"可以看到，但要不要加好友看使用者，我猜IG也是這樣設定"*.
    Adding / following a main-friend from alt is a deliberate
    choice with social consequences (they might recognize you), and
    PikTag does NOT prevent it. The user owns that judgement.

  * Consequence: there's NO need for a "hard cross-account exclude
    main's friends" filter inside alt's own queries. Single flag,
    asymmetric semantics — simpler schema, fewer joins, IG-faithful.

**Self-cross-DM is blocked.** Same way IG won't let your main DM
your finsta. `get_or_create_conversation` adds a reject-if-shared-
`alt_parent_user_id` check.

**Schema sketch** (for whenever v2 lands — adjust as needed):
  - `piktag_profiles.is_alt boolean DEFAULT false`
  - `piktag_profiles.alt_parent_user_id uuid NULL REFERENCES auth.users(id)`
    (only set when this row is an alt — points at the main).

**Pre-launch invariants that MUST be preserved for v2 to land
cleanly** — break any of these and v2 becomes a rewrite, not an
extension:
  1. `piktag_profiles.id = auth.users.id`. Don't decouple. If you
     add a new "profile owner" concept, it points HERE.
  2. Push token lives in `piktag_profiles.push_token`, NOT in a
     separate devices table. Per-account naturally works.
  3. Any user-specific AsyncStorage key SHOULD be namespaced by
     user id (e.g. `piktag_<userid>_lang` rather than `piktag_lang`).
     Pre-launch this is loose — v2 will sweep + namespace; until
     then, new keys you add: prefer the namespaced form.
  4. Realtime channel subscriptions must unsub cleanly on auth
     change (current AppNavigator behavior; don't regress).
  5. `i18n.language` is global per app install — that one DOESN'T
     need namespacing. UI language is a device preference, not an
     account preference; switching accounts should not switch UI
     language.

**NOT in v2 scope** (revisit in v2.1+ if data justifies):
  - Cross-account block list inheritance
  - "Switch to @alt to see X" push notifications across accounts
  - Shared media library across alts
  - Same-device biometric / Face ID quick-switch

## v3 vision — Tag-auction monetization ("Google for tags", not built)

Founder direction confirmed 2026-05-30: long-term monetization model
is an AdWords-style auction where businesses / verified users bid to
sponsor tags + concepts. When the sponsored tag is searched / matched
/ Ask-bridged, sponsors get priority placement. Revenue model: CPC /
CPM second-price auction with Quality Score gating.

**This section locks the principles + pre-launch primitives so a
future session doesn't accidentally land monetization that kills the
North Star.** No bid storage, no Ad Rank, no advertiser dashboard, no
billing rails exist today. None should be built pre-launch.

### The load-bearing principle: Sponsored ≠ Organic, NEVER interleave

The architecturally biggest risk isn't that monetization fails to
land — it's that monetization succeeds prematurely and silently
kills the thesis. Google Search 2010-2020 is the cautionary tale:
ads cannibalized organic, top of page became 4 sponsored / 2
organic, "find what you're looking for" decayed into "find what
advertisers pay for." Google could afford the decay (they were
already a verb). PikTag cannot — the dormant-connection
reactivation thesis structurally CANNOT compete with paid CTR in
a single ranking formula:

  - Dormant connections have near-zero recent engagement BY
    DEFINITION (they're who you're trying to reactivate). An
    engagement-weighted auction buries them.
  - Cross-language matches have small audiences (the unique-to-us
    product). An auction buries them too.

Therefore: **Sponsored placement MUST live in a SEPARATE pipeline
from organic results.** Different ranking function, different
storage, different render. Sponsored renders in its OWN section
ABOVE or BELOW organic results — never interleaved into the
organic ranking. This extends the existing "Connected vs
Recommended — separate pipelines" rule (see "Adding a new ranking
surface" §1) to Organic vs Sponsored. Lock this BEFORE bid storage
exists.

### Pre-launch must-ship primitives (the "data accrual" set)

Quality Score (Google's secret sauce that makes ad ranking honest)
requires 3-6 months of impressions × clicks × conversions ×
dismissals accruing per (concept_id, target_user) tuple. **Without
this data, the eventual Q4-2026 auction launch will land with no
Quality Score model and just `bid × verified_flag`** — the death
trap that turns search into spam.

Ship these BEFORE launch so the accrual starts day 1:

  1. **`piktag_search_impressions` table + SearchScreen instrumentation.**
     Columns: query, searcher_id, concept_id, target_user_id,
     rank_position, surface, shown_at. Batch INSERT after results
     render. ~80 lines + one migration. **CTR depends on impression
     counts, not just clicks.** A click in position 1 vs position 7
     are wildly different signals; without impressions, you can't
     tell them apart. (Current `piktag_search_learnings` from
     `20260527020000` logs clicks only.)
  2. **Wire `piktag_match_dismissals` + `piktag_tag_removals` into
     `search_users` ranking.** ~30 lines of SQL — one `NOT EXISTS`
     predicate. Currently enforced ONLY in `match_ask_to_friends`
     (`20260530050000`) and `enqueue_recommendation_notifications`
     (`20260530120000`); `search_users` ignores them. Sponsored
     placement that re-surfaces a dismissed candidate is the SINGLE
     most trust-eroding bug possible — this insurance must be in
     place BEFORE bid storage exists.
  3. **Synchronous alias-first resolver on tag insert.** Extract the
     resolve-alias-then-create logic from `auto-link-concepts` step
     3a into an RPC, call from a BEFORE INSERT trigger on
     `piktag_tags`. Closes the 5-min `concept_id IS NULL` window for
     ~80% of new tags (those that hit a known alias). The remaining
     20% (unknown new tags needing embedding) still wait for the
     5-min linker cron. Concept GC (deduping embedding-similar
     concepts >0.85) and `concept_id NOT NULL` constraint can wait
     until Q3 2026.

### Top 5 architectural changes BEFORE first paid sponsorship

In rough dependency order:

  1. **Concept identity unimpeachable.** Synchronous alias resolver
     (above) + concept GC (merge embedding-similar concepts >0.85,
     re-point `piktag_tags.concept_id` + `tag_aliases.concept_id` +
     `piktag_search_learnings`) + `piktag_tags.concept_id NOT NULL`
     constraint. Current state: linker admits ~248 concept fragments
     vs ~45 hand-seeded; not auction-safe.
  2. **Impression log live and accruing** (must-ship #1 above).
  3. **Rolled-up `concept_user_quality` materialized view** —
     daily refresh of (concept_id, user_id, impressions, clicks,
     conversions, removals, dismissals, ai_dismissed, CTR, conv_rate,
     neg_rate, quality_score). The four negative-signal tables today
     (`piktag_search_learnings`, `piktag_tag_removals`,
     `piktag_match_dismissals`, `piktag_ai_tag_suggestions`) need a
     single composable view before Quality Score can read them.
  4. **Negative signals into `search_users` ranking** (must-ship #2 above).
  5. **Advertiser identity model decision.** Three options, only one
     should ship:
       (a) Self-sponsorship only (any user bids to boost their own
           profile). Minimal schema. **Rejected** — invites
           #lawyer-bidding-wars on personal identity, rent-seeking
           on names.
       (b) **`piktag_business_profiles`** parallel to
           `piktag_profiles` — a new entity owned by a verified
           user, distinct from personal profile. **Recommended.**
           Aligns with Apple/Google ad-disclosure norms, future-
           proofs v2 alt-account (alts can't run ads, mains can,
           business is a third entity).
       (c) Verified-only sponsorship — conflates "PikTag verified
           the human" with "approved advertiser". **Rejected** —
           two meanings on one flag is technical debt waiting.
     Recommend (b). Schema can wait until pre-launch + 3 months;
     decision should be locked NOW.

### Defer (do NOT pre-build)

All Tier 1.5+ items pre-launch — building these now is the
architecture-astronaut trap:
  - Bid storage / Ad Rank formula / auction RPC
  - Quality Score model (needs ≥500 events to train)
  - Advertiser self-serve dashboard
  - Billing rails (Stripe / IAP / RevenueCat for advertisers)
  - Geographic / language targeting layer
  - Pacing / budget enforcement
  - Brand-safety / forbidden-concept blocklist
  - Second-price auction settlement, programmatic bidding, marketplace dynamics

### The honest pushback (中肯, 2026-05-30 founder reminder)

Google could ship AdWords because PageRank had already won the web.
**PikTag has not yet won the tag-graph.** Every pre-launch
architectural decision should ask: *"does this make the tag-graph
more accurate, more trusted, more reactivation-fuel?"* If yes,
ship. If "this is groundwork for monetization," **defer.**

The thesis must prove itself first — 6 months of organic users
finding right-people via tag-search is the prerequisite for any
auction to not feel coercive. **Monetization at month 3 will kill
the only signal that makes monetization at month 24 actually
valuable.**

### Infra: do we need Railway / Render / Fly / etc. for this?

**No, not pre-launch and probably not pre-traction either.** The
current stack already covers the auction MVP cleanly:
  - **Supabase (Postgres + Edge Functions + Auth + Realtime)** —
    handles bid storage (new tables), auction RPC (SQL function),
    Quality Score materialized view, Stripe webhook handler (Edge
    Function), per-rank impression logging (Postgres batch INSERT).
  - **Vercel** — advertiser dashboard is just a Next.js app
    querying Supabase like the landing page already does.
  - **GitHub Actions** — already wires CI builds + Supabase deploy.

A separate PaaS (Railway / Render / Fly.io) only becomes useful
LATER, and only for these specific workloads — never wholesale:
  - Real-time auction sub-100ms latency at high concurrency if
    Supabase Edge Function cold-start budget hurts checkout flows
  - ML model serving for Quality Score IF the model becomes neural
    (initially it's a SQL aggregate)
  - High-throughput impression queue worker IF Postgres batch INSERT
    rate becomes a write-amplification problem (won't pre-launch)
  - Long-running Stripe reconciliation jobs that exceed Edge
    Function timeouts

None of these bite pre-launch. Premature infrastructure complexity
is a worse trap than premature monetization — every added service
is +1 deploy pipeline, +1 secret to rotate, +1 monitoring surface,
+1 oncall page. Decline until something forces you off Supabase.
Document the migration trigger condition ("if X breaks Y, then we
add Z") rather than building Z speculatively.

_(Founder explicitly asked the North Star be remembered — 2026-05.)_
