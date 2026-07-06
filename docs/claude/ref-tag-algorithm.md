# ref — 標籤演算法:North Star 全文、7 原則、排序規則、延後調參、演算法七條、概念感知

> 本檔內容 2026-07-06 自 CLAUDE.md 原文搬出(逐字,未改寫)。完整舊版:docs/claude/archive/CLAUDE-2026-07-06-full.md
> 檔內「see above / 上文」類指涉以舊版為準。

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
   and weight per-source. (Implemented STRUCTURALLY: source derives
   from the owning table — `piktag_user_tags` = self,
   `piktag_connection_tags` = friend/event, `piktag_ask_tags` = ask.
   There is NO `source` column on `piktag_user_tags` — live-probed
   2026-07-06; SQL writing one fails the whole migration stack.)
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


## Algorithm upgrades — the seven items (founder-approved 2026-07-05)

All shipped in migration 20260705020000 + semantic-tag-search edge fn +
SearchScreen wiring, EXCEPT where noted replay-gated:

1. **IDF on recommendations (SHIPPED)**: enqueue_recommendation_notifications
   scores candidates by SUM(ln(1+N/(1+holders))) per shared concept — rare
   overlap outranks ubiquitous overlap (serendipity IS rare overlap).
   **Search-side IDF is deliberately NOT shipped** — replay-gated: it must
   win an admin_search_funnel/NDCG replay before touching search ranking
   (deferred-tuning doctrine).
2. **Vector recall fallback (SHIPPED)**: zero-result recovery now tries
   `semanticTagSearch` (embedding → match_concepts_by_embedding pgvector
   kNN over tag_concepts.embedding, service-role RPC) FIRST; Gemini
   extract-search-intent is layer 2. Same {keywords} contract both layers.
   NOTE: kNN RPC is LANGUAGE sql with `<=>` → search_path MUST include
   `extensions` (the 2026-06-06 CI gotcha).
3. **Moat metrics (SHIPPED, admin-only RPCs)**: admin_concept_coverage
   (tag + instance linkage %, THE health number for cross-language
   matching) and admin_cross_language_match_rate (clicks where query
   script ≠ clicked-tag script — the unique-to-PikTag value, measured).
   Wire into the admin dashboard when convenient; callable today.
4. **Label chain (SHIPPED)**: query_id uuid on piktag_search_impressions +
   piktag_search_learnings; SearchScreen mints one per rendered result set
   (searchQueryIdRef) and stamps impressions AND clicks. Future ranking
   work trains toward MESSAGE-after-search, never raw clicks/dwell.
5. **Replay foundation (SHIPPED)**: admin_search_funnel(days) = per-rank
   impressions/clicks/CTR over the query_id join. RULE: no search-ranking
   change ships without winning here first.
6. **Cross-script quota in recommendations (SHIPPED)**: daily picks =
   top-2 by IDF score + the best cross-script candidate from ranks 3..12
   when one exists (else plain #3). Guarantees the cross-language bridge
   a seat without displacing clear wins.
7. **Friend-source decay in search_users (SHIPPED — principle #4's
   documented post-launch completion)**: friend weight 6 decays with a
   12-month e-folding on MAX(connection_tags.created_at), floor 3 (never
   below event tier); verified (30) deliberately undecayed. Function
   otherwise byte-identical to the 20260612010000 version.

