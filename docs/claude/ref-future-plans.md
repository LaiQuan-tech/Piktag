# ref — 未來版本方向:v2 小號(alt accounts)、v3 標籤拍賣(含不可先建清單)

> 本檔內容 2026-07-06 自 CLAUDE.md 原文搬出(逐字,未改寫)。完整舊版:docs/claude/archive/CLAUDE-2026-07-06-full.md
> 檔內「see above / 上文」類指涉以舊版為準。

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

---

## 收費模式評估(founder-approved 為正式決策點,2026-07-06)

創辦人提出五案,評估結論(完整推理見當日對話;本節為裁決記錄):

1. **貴人王($5/mo,主動媒合新朋友)— 贊成,五案最優。** 賣「更多核心
   產品」給付費者:更高頻率/更多候選/完整 why-this-match/主動引介。
   不腐蝕他人體驗、不污染標籤資料。前提:免費層媒合品質先達標
   (見 60-TRIGGERS #19 門檻),冷啟動期不開賣。
2. **人氣王($5/mo,搜尋保證前三)— 現行形式否決。** 違反本檔上方鎖定的
   Sponsored ≠ Organic 原則與「自我贊助模式駁回」決策。唯一可活形式 =
   獨立贊助區塊、明確標示、限額、品質分把關(= v3 拍賣簡化版),
   且要等資料原語齊備(60-TRIGGERS #22)。**絕不混排、絕不保證名次。**
3. **批次標籤 — 贊成,併入 Pro。** 免費/付費界線照舊(免費 = 系統發起
   cohort;付費 = 任選好友)。綜效:批次標籤豐富付費者資料 → 其媒合
   與搜回更準 → 貴人王更有感。BatchTagScreen 仍是唯一共用 UI。
4. **個人標籤置頂 — 單獨不成立。** `is_pinned` 已存在且屬免費預期;
   若指影響搜尋排序則是方案 2 問題。賣車/賣房的真需求 = 商業身分,
   導入 `piktag_business_profiles` 方向(60-TRIGGERS #23),不做小配件。
5. **藍勾勾($15/mo)— 改定位後可行。** 非名人認證,是「真人/實名」
   信任徽章,賣連結轉化率(Ask/活動房間/橋樑都是陌生信任面)。
   定價降至 $2-3/mo 或一次性;`is_verified` 只表真人,絕不與
   廣告主資格共用 flag(60-TRIGGERS #20)。

**新增方案(Claude 提出、創辦人納入):**
- **主辦方方案(B2B)**:大房間、名單匯出、品牌 QR、會後分析 ——
  企業付費補貼用戶成長,不碰排序誠信(60-TRIGGERS #21)。
- **人脈 CRM 進階**:跟進排程、備註搜尋、匯出、引介追蹤,併入 Pro。

**打包與時機(裁決):** 單一 **PikTag Pro $5-8/mo**(貴人王+批次+CRM
進階),不做兩個並列 $5 訂閱;真人認證獨立低價;主辦方獨立 B2B;
人氣王需求導入贊助軌道。iOS 訂閱一律走 IAP(含 Apple 抽成定價)。
**現在只定門檻不動手** —— 「第 3 個月變現會殺死第 24 個月變現的信號」
教義不變;資料原語持續累積即可。
