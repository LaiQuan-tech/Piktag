# ref — 創辦人工作準則全文 + 上線 UX 契約(含所有 verbatim 引言與完整脈絡)

> 本檔內容 2026-07-06 自 CLAUDE.md 原文搬出(逐字,未改寫)。完整舊版:docs/claude/archive/CLAUDE-2026-07-06-full.md
> 檔內「see above / 上文」類指涉以舊版為準。

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

## Launch UX contracts + instrumentation (founder-approved 2026-06-29)

Shipped as the "UX 建議跟 Debug 建議都改" batch. These are CONTRACTS —
don't quietly regress them:

- **Push permission is CONTEXTUAL, never at launch.** Startup calls
  `registerForPushNotifications(userId, { requestPermission: false })`
  (token refresh only, no OS prompt). The one-shot OS ask lives in
  `maybeAskPushPermission()` (pushNotifications.ts) and fires at the
  first meaningful moment: first friend-add success (ScanResultScreen
  success-alert onPress) or first Notifications-tab open. AsyncStorage
  `piktag_push_prompted_v1` guards one-shot; `canAskAgain=false` → never
  nag. Do NOT re-add a cold ask at startup — a cold refusal on iOS is
  near-permanent (Settings-only to undo).
- **Onboarding funnel events + PREDEFINED relax trigger.** PostHog
  `wizard_step_completed` (`profile`/`tags`/`links`; `links` fires inside
  handleComplete = wizard completion). Chain with `signup_complete` in a
  PostHog funnel. **Founder pre-approved trigger: if the tags→links step
  loses >30% of users in the first weeks post-launch, relax the step-3
  gate from ≥3 links to ≥1 (or skippable) — execute, don't re-litigate.**
  The ≥3-TAGS gate stays (it's the North Star; links are not).
- **card_scan_latency** (PostHog) = shutter tap → fields visible.
  CardCamera stamps `scanCapturedAt` into the EditLocalContact nav params;
  EditLocalContact reports at applyPrefill. Watch p50/p95 — p95 is the
  "mistaken for a broken app" number for the speed red line.
- **Cold-start = ONE action (card scan), taught twice.** Founder 2026-06-29
  ("精簡成一個" + "精靈最後要導引去拍名片"):
    1. **Wizard payoff step** has two-tier CTAs — PRIMARY tier-2 solid
       「掃一張名片試試」→ `finishOnboarding('cardScan')` resets to Main
       with CardCamera pushed on top (user-chosen, so the 2026-06-05
       "don't auto-dump into a creation surface" rule stands; Back →
       Home); secondary outline 「開始使用 PikTag」→ Home.
    2. **Friends-page cold-start** = a single tier-2 button (same copy) +
       one desc line, rendered in the **ListFooter while the only
       connection is @piktag** (fixed-UUID check) — NOT in
       ListEmptyComponent, which never renders because the official
       auto-friend means the list is never truly empty (SMOKE step-3
       catch). The old 4-row action list is GONE; nothing lost: QR-scan =
       header "+", search = its own tab, contacts import = Settings.
  Keys `connections.coldStartActionCard(+Desc)` ×19 (shared by both
  surfaces — no separate wizard copy).
- **Font scaling truth** (verified 2026-06-29): RN's default
  `allowFontScaling=true` means the app ALREADY follows iOS Dynamic Type —
  nothing in the codebase disables it. A GLOBAL `maxFontSizeMultiplier`
  cap is NOT reliably settable on RN 0.81 + React 19 (function-component
  defaultProps removed; Text.js reads none). Post-launch backlog:
  per-component `maxFontSizeMultiplier` on layout-critical rows if big-font
  breakage shows up. Don't claim "app ignores system font size" — it doesn't.
- **RTL (ar/ur) layout is NOT implemented** (no I18nManager anywhere) —
  those locales render translated text in LTR layout. Deliberate, NA-first;
  revisit only if ar-market traction appears.
- **Deep multi-agent audit cadence**: run a workflow deep-scan after every
  MAJOR refactor (nav restructure, pipeline swap), not routinely. The
  2026-06-29 run: 12 candidates → 7 false positives killed by adversarial
  verify → 5 real (2 HIGH were refactor leftovers). Always adversarially
  verify AI-reported bugs before fixing.
- **SMOKE_TEST.md (repo root)**: the 10-minute manual loop to walk before
  EVERY store submission. Step 6 (chat push routing) and step 9 (delete →
  re-register resurrection) exist because those exact bugs shipped once.


---

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
