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
| Other person's profile (FriendDetail) | **hybrid(2026-07-06 探測證實,本表原記載已過時)**:hidden last → is_pinned → viewer-picked → pickCount → isMutual → position(FriendDetailScreen.tsx ~556) | 出貨行為:社群 pick 會動態上浮,owner 的置頂永遠最優先;原「rules only」記載與程式碼不符,創辦人 2026-07-06 確認以出貨行為為準(置頂=付費功能的前提) |
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
gating (unlinked tags still exact-match → no regression).
**⚠ 2026-09-10 限定:「concept-aware」只涵蓋「命中之後的 sibling 展開」,
不涵蓋「query 字串怎麼找到那顆概念」。** 後者純字面(tag name / alias),
所以一顆沒有該語言別名的概念,concept-aware 再完整也搜不到。查
「跨語言搜不到」的回報時**不要讀到下面這行就結案** —— 先查別名,
詳見本檔「語意標籤的基礎是翻譯」節。Already
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
2. **Vector recall fallback (SHIPPED — 但 2026-09-10 證實救不了跨語言,
   見下方限定)**: zero-result recovery now tries
   `semanticTagSearch` (embedding → match_concepts_by_embedding pgvector
   kNN over tag_concepts.embedding, service-role RPC) FIRST; Gemini
   extract-search-intent is layer 2. Same {keywords} contract both layers.
   NOTE: kNN RPC is LANGUAGE sql with `<=>` → search_path MUST include
   `extensions` (the 2026-06-06 CI gotcha).
   **⚠ 2026-09-10 限定:出貨 ≠ 有效。** 這條路要三個結果集**全空**才啟動
   (SearchScreen:1982-1988),`p_limit: 5` 只取最近 5 顆,呼叫端還有
   `similarity < 0.5` 過濾(semantic-tag-search:97)。跨語言同義詞 cosine
   約 0.71 過得了門檻,但概念表一大就擠不進前 5。**不要把它當成跨語言的
   保險** —— 別名才是。
3. **Moat metrics (SHIPPED, admin-only RPCs)**: admin_concept_coverage
   (tag + instance linkage %, THE health number for cross-language
   matching) and admin_cross_language_match_rate (clicks where query
   script ≠ clicked-tag script — the unique-to-PikTag value, measured).
   **⚠ 2026-09-10 限定:「THE health number」這句話已不成立。**
   admin_concept_coverage 只量「標籤有沒有掛到概念」,**滿分也可能整批是
   單語概念**(當天探測:~595 顆概念裡 470 顆只有 1 個別名),而單語概念
   對其他語言的搜尋等同不存在。跨語言的健康指標請看
   `admin_alias_provenance()` / `admin_alias_backfill_remaining()`。
   原句保留是因為它對「標籤→概念」那一段仍然正確 → 見本檔
   「語意標籤的基礎是翻譯」節。
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


## Biolink 興趣訊號(2026-07-11)

- **訊號定義**:用戶公開 biolink 的 distinct platform 組合(例:
  {github, spotify, twitch}),每個 platform 以 IDF 加權
  `LN(1 + N / (1 + holders))` —— 與推薦 cron 的 concept IDF 同款公式
  (20260705020000 的 mutual_score)。用途**只限**推薦 cron 排序的
  tiebreaker:concept IDF 主權重(mutual_score)不動,affinity 只在
  主分數同分/近似時決定先後。不是新的召回來源,不會讓零共同標籤的
  人進推薦。

- **隱私紅線(fail-closed)**:只採 `visibility = 'public'` AND
  `is_active = true`,而且**雙邊一致**(viewer 和 candidate 兩側都用
  同一條件),NULL 一律不採。理由:推薦排序本身就是洩漏面 ——
  若 friends/private 連結計入計分,收件人可以從「這個人為什麼排前面」
  反推候選人**藏了**什麼平台。任何放寬(哪怕只放寬自己那一側)都是
  把私密設定變成可觀測訊號,禁止。

- **排除的 platform key**(無興趣訊號價值或屬敏感類):
  `phone` / `email` / `custom` / `website` / `blog` / `portfolio`
  (通訊與 generic 連結,人人都有,零區辨力)+ payment/排程類
  (`calendly` / `cal` / `venmo` / `cashapp` / `paypal` / `patreon` /
  `kofi` / `buymeacoffee` / `stripe` / `alipay`)。此清單**複寫**於
  migration 20260711010000 —— `mobile/src/lib/platforms.ts` 的分類
  (`cat` 欄)若有增改,必須同步該 migration 的排除清單,兩處不一致
  = 訊號悄悄吃進不該吃的 key。

- **personalized_recs 契約**:`piktag_profiles.personalized_recs = false`
  = 該用戶**不參與個人化推薦計算**(雙向:不作為收件人被個人化,也不
  以推斷型訊號的形式被計入)。未來任何**推斷型訊號**要進 Ask 匹配或
  其他 Recommended 面時,必須先讀此欄。`match_ask_to_friends` 現在
  **刻意不閘**:用戶主動發 Ask 請求、匹配只消耗顯式標籤(自己打的),
  不涉推斷 —— 這是設計,不要「補上」。

- **不碰 search_users**:搜尋面照舊走 replay 門檻(60-TRIGGERS #2,
  admin_search_funnel 沒贏不准動)。biolink 訊號進搜尋排序 = 搜尋權重
  改動,同樣受該門檻管轄。



## 語意標籤的基礎是翻譯,不是 embedding(2026-09-10,創辦人定調)

> 創辦人原話:**「我們的語意標籤最基礎還是要包含翻譯」**。這條寫在這裡
> 是因為 2026-09-10 用一個真實 bug 證明了它:**embedding 完全健康,概念
> 存在且有向量,跨語言匹配還是失敗。**

### 觸發事件

創辦人搜「水晶」找不到好友,那位好友的自訂標籤是 `crystal`。

當時所有「看起來像根因」的猜測**全錯**:標籤有 `concept_id`、概念有
embedding、linker 前一天還在鑄新概念(2026-06 的 Gemini 故障早就結束,
只是沒人回寫文件 —— 見 ref-infra-ops.md:102「踩坑補遺」節那條 2026-09-10 更正)。

**真正的原因**:`search_users` 從 query 字串走到 concept **只有兩條路**
(20260705020000:455-470):

1. 某個 `piktag_tags.name` 含這個字串 → 取它的 `concept_id`
2. 某個 `tag_aliases.alias` 含這個字串 → 取它的 `concept_id`

**沒有第三條。搜尋路徑上完全沒有 embedding。** 向量只出現在 client 的
zero-result 補救(SearchScreen:1982-1988),而那條路要求三個結果集**全空**
才啟動,又串在同一把 Gemini key 上。

補救那條路的召回瓶頸是**數量**不是相似度:`match_concepts_by_embedding`
本身沒有下限但 `p_limit: 5` **只取最近 5 顆**;呼叫端
`semantic-tag-search/index.ts:97` 另有 `similarity < 0.5 → continue`
(註解「Loose floor at 0.5」)。跨語言同義詞 cosine 約 0.71,**過得了 0.5
這道門**,所以擋住它的是「擠不進前 5 名」,而且概念表愈大愈擠不進去。
(原記載「無相似度下限」,2026-09-10 驗收證偽 —— 下限存在,只是不是主因。)

所以:**一顆沒有中文別名的概念,對中文搜尋而言不存在,無論它的向量多好。**

### 這條原則的三個推論

1. **鑄概念時必須同時產生翻譯。** linker 原本鑄出來的概念是**單語的** ——
   只有一個別名,就是造出它的那個標籤字串。2026-09-10 **live DB 探測**(repo 內無法複驗):~595 顆概念
   裡 470 顆只有 1 個別名,其中真的有標籤、值得回填的是 ~285 顆。已修(auto-link-concepts Phase 1 鑄造路徑 +
   Phase 3 回填,19 語系)。
2. **跨語言匹配有一個隱藏前提,現在被消除了。** 舊行為能運作只有兩種情況:
   兩種語言的標籤**碰巧都已經有人建過**(embedding 才有機會橋接),或
   **有人手工策劃過**(古著/咖啡/匹克球/水晶都是這樣來的)。沒人用某語言
   標過的概念,用該語言搜尋結構上就是找不到。
3. **別名覆蓋率才是護城河的健康指標,不是概念覆蓋率。** `admin_concept_coverage`
   量的是「標籤有沒有掛到概念」,那個滿分也可能全是單語概念。要看
   `admin_alias_provenance()` 和 `admin_alias_backfill_remaining()`。

### 生成品質:具體名詞完美,抽象名詞會漂移

2026-09-10 **live DB 抽查** 151 筆機器生成別名(ar/bn/hi/ur 四個無人可驗的語言):

- **乾淨**:排球→volleyball、法國→France、software、Business、DigitalNomad、
  美學→aesthetics、台北/台南(專有名詞音譯,有效)。模型**有在省略**
  (品味無 ur、募資無 bn),不是硬湊滿 19 個 —— 平均每顆 7.9 個。
- **兩類會出錯,都出在抽象概念**:
  - **語意窄化**:`募資` → 四語全變成「群眾募資」。但募資泛指籌資
    (VC/天使/私募都算),群眾募資是 `群眾募資`。
  - **泛稱汙染(更嚴重)**:`品味` → 印地語 `रुचि`(興趣/喜好,極常用日常字)、
    阿拉伯語 `ذوق`。任何人搜「興趣」都會撈到標 `品味` 的人。**泛稱比翻錯更糟**
    —— 翻錯只是沒用,泛稱是主動製造雜訊。

**規則**:抽象特質/活動類概念,若目標語言只有泛用日常詞可對應,**寧可省略**。

### 為什麼 `tag_aliases.source` 必須存在

`alias` 欄位是**全域 UNIQUE**,所以一個錯的別名會永久佔住那個字串、且錯誤
是靜默的(該語言的搜尋撈出錯的人,而最該發現的人最不會回報)。19 語系裡
有 4 個(ar/bn/hi/ur)我們無人能抽查。

沒有來源欄位,機器寫的和手工策劃的**永遠分不出來**,發現某語言品質不行時
只能全留或人工翻查。有了它,回收是外科手術:

```sql
DELETE FROM tag_aliases WHERE source = 'llm' AND language = 'bn';
```

值:`legacy`(此欄位之前就存在,來源不明)/ `seed`(seed 或策劃 migration)/
`llm`(模型生成)/ `NULL`(linker 寫的標籤本名 —— 刻意不標,因為那三處是
upsert,標了會把既有列的 source 覆寫掉,每跑一輪磨掉一點 seed 標記)。

### 踩坑補遺(演算法/標籤/排序)

> 40-MAINTENANCE §3 指定的去處。新的演算法類教訓一律加在這裡,不要另開新節。

- **`tag_aliases.language` 的可信度**按 `source` 分,不是一律不可信:
  - **`llm` 可信** —— 生成器明確寫入 language(auto-link-concepts:711/952),
    所以 `delete ... where source='llm' and language='bn'` 這種單一語言回收
    是可靠的。**`seed`** 由 migration 逐列指定,也可信。
  - **`legacy` / NULL 不可信** —— schema 是 `DEFAULT 'zh-TW'`,而 linker 的
    三個標籤本名 upsert(index.ts:576/642/678)**都沒指定 language**,所以
    ~85%(2018/2377,2026-09-10 探測)的既有列自稱中文,不管實際是什麼。
  - **可執行的一句**:別名 COUNT 一律可信;別名 LANGUAGE **只在
    `source IN ('llm','seed')` 時可信**。**絕不可用它判斷「這顆概念缺哪些
    語言」**(那要看 legacy 列)。修正 2000+ 列是獨立工作,尚未做,見
    60-TRIGGERS #33。
  - 注意 `admin_alias_provenance()` 有 `GROUP BY a.language`
    (20260910020000:86)—— 它**確實在讀這一欄**,所以那張報表的 legacy
    列的 language 軸是失真的,看 `llm` 那幾列才準。(原記載「目前沒有任何
    地方讀這欄」,2026-09-10 驗收證偽 —— 同一批改動自己加了讀取者。)
- **「幽靈概念」不值得補。** 470 顆單語概念裡只有 ~285 顆真的有標籤,
  其餘 ~185 顆沒有任何人標過,補了也橋不到任何人。回填選擇器
  (`select_concepts_needing_aliases`)因此 inner join 標籤 rollup。
- **「問過了」和「問到了」必須分開記。** `tag_concepts.aliases_generated_at`
  在**每次嘗試後都蓋章,即使模型零回應** —— 否則一顆答不出來的概念
  (自創詞、內部梗)會每 5 分鐘被重挑,永遠燒配額。
- **回填必須有整輪時間上限。** 12 次別名呼叫 × 15s timeout 疊在 Phase 1 的
  50 次 embedding 上,足以撞到 Deno wall-clock 上限 —— 那正是 2026-07 讓
  `linker_run_lock` 卡死數週的成因(worker 被殺,`finally` 的解鎖跑不到)。
  `RUN_SOFT_DEADLINE_MS = 120s`。實測每輪處理 ~5.5 顆,**瓶頸是這個時間閘
  而非 12 次配額上限** —— 這是刻意的,不要為了快兩小時去鬆綁它。
- **部署成功 ≠ 程式跑得到。** 2026-09-08 有人修好語意分類器,但當時
  Phase 1 沒事做就整個 return,那段程式碼**根本執行不到**,373 個標籤裡
  317 個的 `semantic_type` 還是 NULL(「the fix was correct and the code was
  unreachable」)。驗收一律看**資料有沒有動**(`attempted` 之類的計數器),
  不是看 workflow 綠勾。同理:`cron.job_run_details` 的 `succeeded` 只代表
  觸發函式送出了 HTTP 請求,不代表 edge function 做完了工作。
