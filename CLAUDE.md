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
7. **Interest-graph coverage as a user-visible metric.** Each user has
   a "tag-graph health score" combining: has-self-tags / has-friend-
   tags / has-ask-history / has-event-tags / concept-diversity. Surface
   it (LinkedIn "Profile strength" analog) so under-tagged users get
   nudged to enrich — feeds back into #1–#4.

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

_(Founder explicitly asked the North Star be remembered — 2026-05.)_
