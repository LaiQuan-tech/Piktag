# ref — 產品史與已出貨功能契約:官方帳號、nav、掃描器、活動標籤、激活清單、程式一致性、人脈圖

> 本檔內容 2026-07-06 自 CLAUDE.md 原文搬出(逐字,未改寫)。完整舊版:docs/claude/archive/CLAUDE-2026-07-06-full.md
> 檔內「see above / 上文」類指涉以舊版為準。

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
Tags replaced 2026-07-06, v2 same day (20260706010000): the profile is
the DEMO every new user sees first, so the ten model a COPYABLE
identity across dimensions, brand voice carried by word choice —
DefineYourVibe / DigitalNomad(身份) / ReactNative(技能) /
ThriftedFashion(興趣) / GravelCycling(興趣) / ENFP(MBTI) / SideQuest /
AuraFarming / IceBreaker(技能+品牌) / BetaEra. Position-ordered,
English-everywhere. Bio = the teaching line ("Tags are how people find
you — job, skills, hobbies, MBTI, anything that's you. Tap your
profile to add yours."). Rule: @piktag's tags are a TEACHING surface —
any future edit keeps dimension coverage (身份/技能/興趣/MBTI), never
reverts to all-slogan. (v1 all-slogan set + seed Startup/AI/tag both
superseded.)
`find_tag_similar_strangers` is dead code and was left unswept — add the
two-hop is_official predicates if ever revived.


## Nav change — Chat tab replaced event-QR tab (2026-06-24, SHIPPED)

Founder feedback 2026-06-24: the **活動 QR (event-group QR) tab is
unpopular/ignored**; **chat should be promoted** into that bottom-tab slot.
Approved after honest evaluation; **SHIPPED 2026-06-24** (plan below kept
as as-built reference). Tab order is now Home / Search / **Chat**
(MessageCircle) / Notifications / Profile. Event-QR (QrGroupList /
AddTagCreate / QrGroupDetail) lives in RootStack as full-screen pushes,
reached from the **Profile-tab header QrCode icon** ("建立活動 QR", next to
Settings) + on_this_day deep links. (Was the ConnectionsScreen/Friends header
QrCode icon until 2026-06-25 — founder felt a QR icon next to the scan CTA
was too heavy; moved it to Profile, beside the personal QR, since both are
"a QR I generate/show". The Friends header is now just "+" (scan→connect,
the North-Star friend-add) + sort; "+" was UserPlus, now a plain Plus.) Chat-unread badge moved to ChatTab; bell-header
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

## Event tags reworked: burst batch-tag prompt (2026-07-03, SHIPPED)

Founder accepted the diagnosis that event tags' structural flaw is
"requires foresight" (create the QR BEFORE the event — nobody remembers,
and only organizers ever would). The rework, shipped pre-launch:

- **方向一 (shipped): burst detection → one-move batch tag.** Adding ≥3
  real connections within 60 min = "user is AT an event". After the Nth
  scan-connect success, ScanResultScreen routes to **BatchTagScreen**
  (RootStack) ONCE per burst: cohort list (default all selected) + tag
  name input → writes **private connection tags** (`piktag_connection_tags`
  is_private=true — the SAME shape the event-QR scan flow writes; owner-only,
  findable via the Friends tag filter, never enters matching). Detection in
  `lib/burstTag.ts` (connections only — ContactSync imports deliberately
  excluded; @piktag excluded; one offer per burst keyed on newest connection
  id in AsyncStorage). PostHog: `burst_tag_prompt_shown` / `burst_tag_applied`
  — THE success metric for the rework. BatchTagScreen is deliberately the
  SEED of the future full batch-tag feature (widen cohort to "pick any
  friends" later; don't build a second batch UI).
- **QrGroupList empty-state copy repositioned to the ORGANIZER** ("one QR
  for the whole room, everyone auto-tagged, searchable months later") —
  the old name-blanking copy described the PERSONAL QR (wrong feature on
  that screen). Keys qrGroup.emptyTitle/emptyDesc/createFirst ×19.
- **方向二 (SHIPPED 2026-07-03): event context as a temporary MODE of the
  personal QR.** The personal-QR sheet (QrCodeModal, gradient — the strip
  uses FIXED colours per the dark-mode rule) gains 「加上活動情境」: name +
  8h window written to `piktag_profiles.qr_context_name/qr_context_expires_at`
  (migration 20260703000000). NO URL change — printed QRs and the web scan
  path pick it up automatically. Application lives in UserDetailScreen's
  `applyQrContextTags()` (self-contained; called from BOTH the sid flow and
  the plain personal-QR followUser flow): if the SCANNED person's context is
  active at connect time, the name lands as a private connection tag on BOTH
  rows. Gated to QR/link-origin visits (username/sid param) — organic search
  adds never pick it up. Expiry enforced at read time; no cron.
- **方向三 (SHIPPED 2026-07-03): the event QR connects the ROOM.**
  After connecting via a REAL (non-local_) scan session, UserDetail's
  success alert offers 「看看這場的人」— explicit privacy OPT-IN: the button
  calls `set_event_visibility` (SECURITY DEFINER; validates REAL membership
  — your own connection row carries the scan_session_id, or you're host)
  then opens **EventAttendeesScreen** (RootStack). The list comes ONLY from
  the `event_attendees` RPC which enforces: reciprocity (must be visible to
  see the room), checklist #4 (is_official excluded), checklist #3 (viewer's
  dismissals on ANY surface respected — NOTE: piktag_match_dismissals.surface
  has a CHECK constraint; ALTER it to add 'event_attendees' before wiring a
  dismiss gesture here). `piktag_event_visibility` is deny-all RLS (RPC-only).
  Room connect reuses established shapes: both connection rows
  (ignoreDuplicates — never clobbers existing met_at), session event tags +
  date/loc as private tags on both rows, auto-follow, PostHog friend_added
  source='event_room'. A 20-person room = 190 potential edges, not 19.
  **Re-entry (UX fix, same day):** the post-connect offer is one-shot, so
  FriendDetailScreen renders a 「看看這場的人」 row under the friend's
  event-tags section whenever the connection's scan_session_id row is
  still readable (RLS exposes is_active sessions only → host closing the
  event hides the row). Tapping IS the labeled visibility opt-in (desc
  line states others will see you) → set_event_visibility → EventAttendees.
  **Prominence pass (founder feedback 2026-07-05: "提示不夠明顯 / 離開 app
  找不到掃過的人"):** (a) the post-connect offer is now a BRANDED CENTRED
  MODAL on UserDetail (icon + title + tier-2 primary button; the system
  Alert was reflex-dismissed), same consent copy; (b) QrGroupListScreen
  (the Event Tags page) gains a 「我參加的」 ListFooter section — every
  ACTIVE session the viewer scanned into (from their connections'
  scan_session_id, sessions hosted by OTHERS), row = event name + host ·
  date · location, tap = labeled opt-in → EventAttendees. This is the
  durable GLOBAL entry back into any room. Keys eventRoom.offerTitle/
  myEventsSection/myEventsHint ×19.
- **Revisit triggers:** % of new connections carrying event-context tags,
  searches hitting event tags, friend_added source='event_room' volume.

## Reactivation/connection backlog — founder-approved list (2026-07-04)

Post-audit of both North-Star loops (激活舊關係 + 連結新關係). Verified
COMPLETE and not to rebuild: main search covers all three memory tiers
(member public tags / friends' private connection tags / local contacts);
promote-on-registration fires the generic friend notification; reconnect
cron→chat, dormant sort, on_this_day, room list + re-entry all live.
Founder approved ALL FIVE below as worth doing (2026-07-04):

1. **Contact-import batch bucketing — SHIPPED 2026-07-04** (was the biggest
   gap — the loops' intersection). ContactSync's 尚未加入 section header
   gains a 「快速分類」 pill (shows when ≥2 non-member contacts) → the
   SHARED BatchTagScreen in import mode (`deviceContacts` param): nothing
   pre-selected (a bucket is a subset), 全選 toggle, preset chips
   #同事/#同學/#家人/#客戶 + free input, and a QUICK-SORT LOOP — save
   applies the bucket, resets selection, stays for the next circle; 完成
   exits. Writes the `tags` array on piktag_local_contacts (creating rows
   for contacts that had none; created ids + accumulated tags tracked so
   the 2nd bucket UPDATES instead of duplicating). Those tags are exactly
   what promote_local_contacts copies into REAL connection tags when the
   person joins — bucketing now IS future serendipity fuel. PostHog:
   `import_batch_tagged`. **FREE tier by design — the paid boundary below
   stands: no free "pick any friends" entry was added.**
2. **"Your saved contact joined" notification — SHIPPED 2026-07-05.**
   New type `contact_joined` (category notif_social), inserted by
   promote_local_contacts_for_profile (migration 20260705000000) with a
   NON-EMPTY English SQL body + rich data (saved_name/saved_at/tag_names/
   connection_id/friend_user_id → router lands on FriendDetail
   generically). **Old-build compatibility protocol:** the generic
   'friend' row from trg_notify_friend is KEPT (old builds only know that
   type) but stamped `data.source='promote'`; new builds' social filter
   HIDES friend-with-source-promote so the story shows exactly once. No
   extra push (the generic friend push already covers the lock screen).
   4-point checklist complete; i18n `notifications.types.contact_joined.body` ×19.
3. **寄聯絡資料 follow-up — SHIPPED 2026-07-05.**
   `piktag_local_contacts.intro_sent_at` (same migration); recorded on
   channel-pick (intent-to-send — the OS never confirms delivery).
   LocalContactShareButton owns the 3-state CTA: normal → 已寄出 · M/D
   (disabled, opacity 0.45, 7 days) → 再寄一次. Locked CTA
   position/weight untouched.
4. **Chat-thread context line — SHIPPED 2026-07-05.** ChatThread header
   shows "認識於 2026/3 · #tag #tag" under the name (viewer's own
   connection met_at + ≤2 private tags; no data → no line). Key
   `chat.metContext` ×19.
5. **Dormant TIEBREAKER in search_users — SHIPPED 2026-07-05**
   (migration 20260705010000). NOT a re-weighting: the deferred-tuning
   doctrine stands — main weights untouched. Among EQUAL match scores,
   the viewer's longest-known friends rank first (`vc.met_at ASC NULLS
   LAST` via a LEFT JOIN on the viewer's own connection rows); strangers
   keep their position. A true coefficient boost still waits for
   piktag_search_impressions volume.

**Paid batch-tagging boundary (founder plan, next version):** friend-facing
batch tagging will be a PAID feature. Decision to prevent cannibalization
AND protect the tag engine: **free = system-initiated cohorts** (the burst
prompt's auto-cohort at events; the import batch at ContactSync — moments
that BUILD tag data; paywalling data creation would starve the North-Star
engine at cold start), **paid = user-initiated arbitrary selection**
(anytime multi-select of ANY friends, multi-tag apply/remove, bulk manage).
Never add a free "pick any friends" batch entry — that IS the paid line.
BatchTagScreen stays the single shared UI for all tiers.

**Card-scan speed levers (2026-07-04): (a)(b)(c) SHIPPED, (d) post-launch.**
- (a) **Prewarm**: `prewarmScanBusinessCard()` (scanCard.ts, 60s throttle,
  body `{warmup:true}` — the edge fn answers above its JWT guard) fires on
  CardCameraScreen AND CameraScanScreen mount. Kills the cold-start tail.
- (b) **Instant fields**: `extractQuickFields()` regex-mines phone/email/
  website from OCR text; `onQuickFields` paints them ~1-2s before Gemini.
  **Overwrite protocol**: runScan's `quickApplied` records exactly what the
  quick pass wrote — applyPrefill lets Gemini REPLACE a quick value (it
  picks the right number when a card lists several) but NEVER a value the
  user edited (cur !== quickApplied.X). Dates rejected as phone candidates.
- (c) **Pipeline overlap**: capture screens call `startScanJob()` on the
  final frame BEFORE navigating; EditLocalContact `claimScanJob(uri)`
  awaits the in-flight job — navigation/mount time overlaps the scan.
  Single-slot job stash; quick fields emitted pre-claim replay on claim;
  unclaimed jobs are overwritten harmlessly.
- (d) **vision-camera live-frame OCR — post-launch ONLY (founder asked
  2026-07-04; deliberately held).** It's a big native dependency swap on
  the app's most crash-prone surface days before store submission, and it
  shares the camera with the North-Star QR path — a regression there costs
  more than the remaining latency win. Plan: after 1.0.8 ships, spike on a
  branch (vision-camera v4 + frame-processor OCR), acceptance = QR + card
  paths stable on device, then compare card_scan_latency p50/p95.
Measure every lever against `card_scan_latency` p50/p95 (PostHog).


## Code-consistency contracts + backlog (audit 2026-07-05)

Shared helpers that new code MUST use (never re-inline):
- `lib/userTags.ts`: `findOrCreateTag` / `resolveTagIdsByName` /
  `attachPrivateTagsToConnections` — the ONE resolve-and-attach path for
  private connection tags (BatchTag, EventAttendees consume these).
- `lib/eventRoom.ts`: `joinEventRoom(navigation, sessionId)` — the ONE
  opt-in→open sequence for every 這場的人 entry (UserDetail modal,
  FriendDetail row, QrGroupList 我參加的 all route through it).
- `components/InitialsAvatar` — never hand-roll an avatar-initials
  fallback (BatchTag/EventAttendees were caught doing this and fixed).

Known duplication accepted for now (post-launch consolidation targets —
each touches the live QR-connect path, not worth churn right after the
iOS release):
1. UserDetailScreen's inline `ensureTagIdsByName` + `attachTagsToConnections`
   duplicate the lib versions — migrate when next touching that screen.
2. "Create a connection PAIR (fwd+rev rows + follow + tags)" exists in ~4
   shapes: ScanResult.handleConfirm, UserDetail.handleAddFriendFromQr,
   EventAttendees.ensureConnRow, lib/followUser + the promote SQL fn.
   Post-launch: one `lib/connectUsers` with per-flow options.
3. ManageTags / EditProfile still carry inline findOrCreateTag copies
   (pre-existing note in lib/userTags).
4. Ad-hoc date formatting (YYYY/M in ChatThread, M/D in ShareButton) —
   fine at this scale; extract a util only if more call sites appear.

## Network graph replaced the invite-lineage Tribe (2026-06-25)

Founder: the old "Tribe" (TribeConstellation + `get_tribe_lineage`/
`get_tribe_size`) drew the **invite tree** — who you brought to PikTag — but
the invite-code system is RETIRED (open signup), so it was a near-empty,
PikTag-vanity number nobody cares about. Replaced with **`NetworkGraphScreen`**:
a force-directed graph of how the viewer's OWN friends interconnect, reached
by tapping the **friend count** on the Friends-page header (was a Profile
"Tribe" stat — that stat + `fetchTribeSize` were removed; the friend graph is
about the network, not Profile vanity).

- RPC **`get_friend_graph()`** (20260625000000, SECURITY DEFINER, auth.uid()-
  guarded): returns `friends` (the caller's friends, identity shown — they're
  the caller's own), `edges` (friend↔friend pairs = cluster structure),
  `bridges` (2nd-degree people connecting ≥2 of your friends, NOT yet your
  friend), `bridge_edges`.
- **Bridges are anonymized** — the RPC returns only `{id, mutual_count}`, NO
  name/avatar; the graph renders faceless hollow dots. A deliberate TAP routes
  to `UserDetail` (the reveal + connect, under that screen's privacy checks) —
  the North-Star friend-add payoff. is_public-only so a tap always lands on a
  viewable profile.
- Honors the ranking-surface checklist: excludes @piktag (#4, else it's a
  universal hub), reads `piktag_match_dismissals` (#3 — never re-surface a
  dismissed person, even anonymized), friends vs bridges shown as visually
  distinct tiers (#1, not cascaded). The old `get_tribe_*` RPCs are left in
  the DB (harmless, no caller) — don't be confused that nothing calls them.
- Route renamed `TribeConstellation` → `NetworkGraph`; old screen file deleted.
- **Contact tier added 2026-07-06** (founder: graph should feel 豐富 AND
  nudge non-members to join): the owner's UN-promoted
  `piktag_local_contacts` render as EDGE-LESS coral nodes —
  `CONTACT_CORAL = '#ff5757'` (brand gradient stop 1; FIXED colour +
  hardcoded white FG, not theme-mapped). Edge-less is deliberate: they
  aren't connected to anyone, so repulsion settles them on the
  periphery — an honest "orbiting the network" visual. Tap →
  `LocalContactDetail`, whose locked CTA (寄我的聯絡資料給他) IS the
  conversion push — don't add a separate invite CTA to the graph.
  Capped at 30 most-recent (O(n²) layout). Contacts alone count as a
  drawable graph (cold-start). Promoted contacts are EXCLUDED
  (`promoted_to_connection_id IS NULL`) — they're already friend nodes.
  Key `network.legendContact` ×19.

## Network graph is 2D — pseudo-3D was tried and REVERTED (2026-06-26)

`NetworkGraphScreen` proved popular; the founder wanted a 3D upgrade and we
shipped a native pseudo-3D build (3D force layout projected per-frame with a
reanimated auto-rotation; per-node `<AnimatedG transform>` + per-edge
`<AnimatedLine>`). **On real sparse data it BROKE the core and was reverted
same day** — do NOT rebuild it:
- **`<AnimatedLine>` with animated x1/y1/x2/y2 didn't render** in rn-svg → the
  edges (the whole point — they show the relationships) vanished. Bumping
  stroke/opacity didn't help because they weren't drawing at all.
- The **3D projection clumped nodes** on top of each other (two friends at
  different z projecting to the same screen point), so even edges that drew
  were 0-length and invisible.
The current build is **robust 2D**: static `<Line>` edges (always draw —
bright piktag500, width 3 for friends; gray dashed for bridges), an explicit
**overlap-resolution pass** in the force layout so nodes never clump, avatars
via absolute-coord `<ClipPath>` (fine now that positions are static), bridges =
gray dot + person silhouette, pinch/zoom/pan on the container, and a gentle
container-level fly-in (`intro` 0→1 drives opacity + a slight scale-up). No
rotation, no AnimatedLine, no per-node AnimatedG.
If the founder wants real 3D rotation later, the path is the **WebView
`3d-force-graph`** option (option 乙) — a purpose-built engine that handles
edges + rotation correctly — NOT another native pseudo-3D attempt.

