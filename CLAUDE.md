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

## How the founder works (keep doing this)

- **中肯 / trust-but-verify.** Give honest, balanced advice; push back with
  reasoning when something is wrong or disproportionate. Verify claims
  (incl. your own and agents') against the actual code/DB before asserting.
  The founder values honest correction over compliance.
- **Don't reinvent; match existing patterns/design.** Reuse canonical
  components, RPCs, styles. Deviating "to be clever" is a defect here.
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
  chip pattern (gray pill, no "+", purple press-flash, cap 3, opt-in);
  the "尚未加入 PikTag" not-joined row in ConnectionsScreen (local
  contacts + pending scans). Before building any chip/row/pill, check
  if one of these (or an existing component) already covers it.
- **Every change:** `tsc` clean → commit → push. i18n spans **19 locales**
  (`mobile/src/i18n/locales/*.json`) — keep all in sync (JSON round-trip
  into the right block; verify the key landed where intended).
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
- **Repo layout:** real mobile app = `mobile/`; landing = `landing/`
  (Vercel, `dist` gitignored, rebuilt on push; meta in
  `landing/api/*` + `landing/public/*` + `src/main.tsx`). The top-level
  `/src` is a STALE DUPLICATE — ignore it. Repo `LaiQuan-tech/Piktag`.
- **iOS TestFlight** builds on push to `mobile/**` (excl. supabase/scripts);
  `concurrency: cancel-in-progress` collapses bursts. Apple's per-app daily
  upload cap is real → batch mobile commits; a hit is a soft 24h wait.
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

## Brand voice — locked phrases

- **"PikTag to connect."** is the locked brand verb phrase on landing
  (sits below the hero title as `hero.description`, paired with the
  logo in the nav). DO NOT modify, translate, or remove without
  explicit founder approval. It survives hook-line refactors —
  when the founder swapped "Tag the Vibe, Keep the Tribe" for
  "Tag yourself. Find anyone." 2026-05-30, "PikTag to connect."
  stayed put. Treat the logo + this phrase as the constant brand
  signature; the hook line is the rotating creative.
- **"Tag yourself. Find anyone."** is the current hook line
  (2026-05-30, replacing "Tag the Vibe, Keep the Tribe"). Mobile
  brandTagline is English-everywhere; landing hero.title1+title2
  is localized per locale (founder-approved zh-TW: "自己標自己，
  誰都找得到。"). See commit 107130a for the full 5-surface align.

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

_(Founder explicitly asked the North Star be remembered — 2026-05.)_
