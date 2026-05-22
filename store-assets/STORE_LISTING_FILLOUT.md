# PikTag v1.0.0 — Store Listing Copy (zh-TW + en)

Last revised: 2026-05-23 (re-pivot to North America as PRIMARY launch
market; brand voice unchanged — "Pick. Tag. Connect." / "Pick your
people" / "Search by need, not by name")

This document is the **single source of truth** for every store-listing field
on Apple App Store Connect AND Google Play Console. Paste copy from here when
filling the listing forms.

Two markets covered with full copy:
- **en** (North America, PRIMARY launch market — keyword & screenshot
  effort goes here first)
- **zh-TW** (Taiwan, secondary launch — full copy ready; ships day 1
  because it's authored, not because TW is the strategic priority)

The other 17 locales (zh-CN, ja, ko, es, fr, pt, ru, ar, bn, hi, id, th,
tr, de, it, vi, ur) have full in-app i18n but their Apple/Play listings
can fall through to en on day 1. See "Per-locale rollout plan" at the
bottom.

---

## Brand voice cheat sheet

Use these everywhere — same tone as the app's onboarding slides + landing
page hero. NO marketing-speak ("revolutionary", "ultimate", "cutting-edge").

| Slot | zh-TW | en |
|------|-------|-----|
| **Hero slogan** (brand-locked English) | Pick. Tag. Connect. | Pick. Tag. Connect. |
| **Primary positioning** | 找對的人，從標籤開始 | Pick your people. |
| **Functional clarity** | 不靠名字，靠標籤 | Search by need, not by name. |
| **Mission #1** (define yourself) | 用標籤告訴大家你是誰 | Define yourself with tags |
| **Mission #2** (activate network) | 讓老朋友活起來 | Bring old connections back to life |
| **Mission #3** (reverse lookup) | 用需求找人，不是用名字 | Find people by what they do |

---

## App name

The single highest-weight ASO field. A pure-brand "PikTag" leaves
24/30 characters of the highest-weight keyword real estate empty —
and "PikTag" is a coined word with zero pre-launch search volume.
Standard ASO pattern is `BrandName — short descriptor`. Apple's name-
stuffing crackdown only penalises spammy phrase chains; one tasteful
descriptor is industry-standard and compliant.

**Recommended (en, primary):**
- **`PikTag — Personal CRM`** (21 / 30) ← lead. "Personal CRM" is the
  rising US category (Clay, Dex, Folk, Cloze) and the keyword space
  is far less saturated than "networking" or "business card scanner".
- Alternative: `PikTag — CRM for Your People` (28) — echoes the
  "Pick your people" brand line; keeps brand voice while still
  surfacing "CRM".
- Avoid: `PikTag` alone — wastes 24 chars of the highest-weight slot.

**Recommended (zh-TW):**
- **`PikTag・用標籤管理人脈`** (12 / 30) ← lead. Contains the two
  highest-intent zh search roots: 標籤 + 人脈.
- Alternative: `PikTag・標籤人脈・名片管理` (14) — adds 名片管理, the
  card-scan funnel hook (high zh search volume).

---

## App Store Subtitle (Apple only, ≤30 chars)

| Locale | Copy | Chars |
|--------|------|-------|
| en | Pick your people. Tag CRM. | 26 / 30 |
| zh-TW | 用標籤找人脈,不靠名字 | 11 / 30 |

> Apple's subtitle appears immediately under the app name in search results
> and the install page. Treat it as the elevator-pitch line — AND remember
> Apple indexes the subtitle words for search ranking, so wasting 13/30
> chars on a one-line slogan throws away free indexable space.
>
> The en version keeps "Pick your people." (brand-locked) and adds
> "Tag CRM." — the CRM keyword you can't fit in the 30-char app name
> beyond "Personal CRM". Pair: title indexes "personal CRM"; subtitle
> indexes "tag CRM". Both feed Apple's combinatorial keyword engine.
>
> The zh-TW version trades the warmer brand line for the harder
> keyword 人脈 + the differentiator phrasing 「不靠名字」.

---

## Promotional text (Apple only, ≤170 chars, updatable without re-review)

| Locale | Copy | Chars |
|--------|------|-------|
| zh-TW | 不靠名字找人，靠標籤找人。把朋友標籤化，需要時舊人脈會主動找上你。發 Ask 廣播你的需求，對的人自然出現。 | 53 / 170 |
| en | Search by need, not by name. Tag your network — old friends and new opportunities find you when it matters. Post an Ask, and the right people surface. | 152 / 170 |

> Apple lets you change this anytime without going through review. Use it
> for announcements ("New: Ask broadcasts!", "Featured in App Store Korea")
> after launch.

---

## Short description / Play Store hook (Google Play only, ≤80 chars)

| Locale | Copy | Chars |
|--------|------|-------|
| zh-TW | 不靠名字找人，靠標籤找人。把人脈標籤化，舊朋友主動找上你。 | 28 / 80 |
| en | Tag your network. Search by need, not by name. Old friends reach you. | 70 / 80 |

> Google's short description is the line that appears below the title in
> Play Store search. Make it specific — generic CRM language will lose
> against incumbents (LinkedIn, contacts apps).

---

## Full description (≤4000 chars)

### zh-TW

```
PikTag 是一款用標籤連結人脈的社交 CRM。
不靠名字找人，靠標籤找人。

# 三個核心動作

✦ 用標籤定義自己
   選 10 個最能代表你的標籤——這就是你在 PikTag 的身份。
   別人能透過你會的、你愛的找到你。

✦ 讓老朋友活起來
   生日提醒、認識週年、共同回憶會主動找上你。
   再也不會遇到「咦這人是誰來著」的尷尬時刻。

✦ 用需求找人
   「我需要懂攝影的朋友」「在台北附近的設計師」「認識誰在做新創？」
   PikTag 不是讓你照名字翻通訊錄，是讓你把需求說出來，對的人就出現。

# 主要功能

📍 標籤即身份
   AI 從你的 bio 推薦標籤，10 個標籤勝過一頁履歷。

🔄 Ask 廣播
   有需求？發一則 Ask，自動 fan-out 給標籤匹配的朋友。
   24 小時內，最對的人會自然冒出來。

📷 QR Code 互掃
   見面當下掃一下，社群連結（IG / LinkedIn / 電話）一秒交換。

🗓 智慧 CRM
   生日提醒、認識週年、共通標籤高亮——讓每段關係有溫度。

🔍 反向搜尋
   不知道對方叫什麼，但記得他會什麼？輸入需求，PikTag 找出來。

🔒 隱藏標籤
   私人筆記（「在誠品認識的」「葉家排骨」）只有你看得到。

🌐 19 種語言
   繁中、簡中、英、日、韓、西、法、葡、俄、阿、孟、印、印尼、泰、土、德、義、越、烏爾都。

# 為什麼 PikTag 不是另一個通訊錄

通訊錄解決「我有他電話嗎？」的問題。
PikTag 解決「我認識誰會 X？」的問題。

電話本是 1980 年代的工具，標籤是 2026 年的工具。

# 適合誰

· 經常去活動 / 聚會 / 研討會的人
· 創業圈、投資圈、設計圈、工程圈
· 大學生、研究生、新鮮人
· 任何「認識的人比記得住的人多」的人

PikTag 免費使用。部分進階功能未來可能會推出付費方案。
有問題請聯絡 support@pikt.ag

Pick. Tag. Connect.
```

字數：672 / 4000 ✓

### en

```
PikTag is a tag-first personal CRM.
Search by need, not by name.

# Three core moves

✦ Define yourself with tags
   Pick 10 tags that capture who you are — this is your PikTag identity.
   Let others find you by what you do, not just what you're called.

✦ Bring old connections back to life
   Birthdays, meet-anniversaries, and shared memories surface when they
   matter. No more "wait, who is this person again?" awkwardness.

✦ Find people by what they do
   "Need a friend who shoots photos." "Designers near me." "Anyone in
   startups?" PikTag isn't a phone book — it's a discovery layer over
   your network. Tell it what you need; the right person surfaces.

# Key features

📍 Tags as identity
   AI suggests tags from your bio. 10 tags say more than a CV.

🔄 Ask broadcasts
   Got a need? Post an Ask and PikTag fans it out to friends whose tags
   match. The right person typically surfaces within 24 hours.

📷 QR exchange
   Meet someone? Scan each other's QR. Instagram, LinkedIn, phone —
   exchanged in one tap.

🗓 Smart CRM
   Birthday reminders, meet-anniversaries, mutual-tag highlighting on
   every friend's profile. Keep relationships warm without lifting a
   finger.

🔍 Reverse search
   Don't remember a name but remember what they do? Type the need,
   PikTag finds the person.

🔒 Hidden tags
   Private annotations ("met at the Q3 mixer", "great BBQ rec") visible
   only to you.

🌐 19 languages
   Traditional & Simplified Chinese, English, Japanese, Korean, Spanish,
   French, Portuguese, Russian, Arabic, Bengali, Hindi, Indonesian,
   Thai, Turkish, German, Italian, Vietnamese, Urdu.

# Why PikTag isn't just another contacts app

Contacts apps answer "do I have their phone number?"
PikTag answers "who do I know that does X?"

The phone book is a 1980s tool. Tags are a 2026 tool.

# Who it's for

· People who go to events, meetups, conferences
· Founders, investors, designers, engineers
· Students and recent grads
· Anyone whose network grew faster than their memory for it

PikTag is free. Some advanced features may move to paid in the future.
Questions? Email support@pikt.ag

Pick. Tag. Connect.
```

Char count: 1812 / 4000 ✓

---

## Keywords (Apple only, ≤100 chars, hidden, comma-separated)

Apple's keywords field is **invisible to users** but feeds App Store search.
Don't repeat words from the title or subtitle — Apple already indexes those
AND combines roots across slots (title `Personal CRM` + keyword `scanner`
→ ranks for "personal CRM scanner"). Comma-separated, no spaces after
commas (saves chars).

### en (PRIMARY — North America launch)

```
business,card,scanner,contacts,relationship,reconnect,startup,founder,designer,networking,bio,link
```

(98 / 100 chars ✓)

> Strategic notes:
> - Dropped `CRM`, `tag`, `personal` — all in title/subtitle already
> - Dropped `connect` — in brand slogan "Pick. Tag. Connect."
> - Dropped `community`, `meet`, `event` — generic, low US conversion
> - Added `business,card,scanner` — Apple combines into "business card
>   scanner" (a high-volume US search; PikTag's card-scan feature
>   maps directly)
> - Added `relationship,reconnect` — US personal-CRM intent terms
>   (Dex/Cloze/UpHabit position around relationship management)
> - Kept `bio,link` — Linktree-adjacent niche; PikTag has bio links

### zh-TW (Phase-1 launch — copy ready)

```
名片掃描,名片管理,拓展人脈,人脈經營,通訊錄,聯絡人,認識朋友,社交,商務,活動,聚會,研討會,交流,校友,客戶,同學,商務社交,QR
```

(68 / 100 chars ✓ — Chinese chars each count 1; room left if you want
to add more validated terms)

> Strategic notes:
> - Title already carries 標籤 + 人脈 — DON'T repeat
> - 名片掃描 / 名片管理 are HIGH-volume zh-TW search terms (the card-scan
>   funnel hook; competitors like 名片全能王 pull real traffic on these)
> - Persona-context: 校友 / 同學 / 客戶 / 商務社交 cover the people-you-met
>   surfaces
> - QR is left in (lower volume than zh markets used to be, but free)

> **Volume validation pending**: pick a free tool (AppTweak / Mobile
> Action / Sensor Tower free tier) and validate each candidate against
> US App Store / TW App Store search volume before final paste. The
> picks above are intent-based; volume might rank a few differently.

---

## Category

**Primary:** Social Networking (Apple) / Social (Google Play)

**Secondary** (Apple supports two): Productivity

> Reasoning: PikTag's core loop is meeting + remembering + finding people,
> which Social Networking captures. Productivity is the natural second
> because the CRM / tag / reminders dimension differentiates it from pure
> social apps. Communication is a weaker third option if Productivity isn't
> available.

---

## Play Store tags (choose 5)

Google Play's tags are curated dropdown values, not free-form. Pick from
this priority list (drop the bottom ones if dropdown doesn't list them):

1. **Social Networking** — core positioning
2. **Productivity** — tags + reminders + relationship management
3. **Communication** — QR + bio link exchange
4. **Events** — networking events / meetups / conferences
5. **Business** — professional networking use case

Fallback if any unavailable: Lifestyle, Community, Contacts.

---

## Contact details

- Support email: support@pikt.ag
- Privacy email: privacy@pikt.ag
- Phone: (leave blank — Apple/Google both let you skip)
- Website: https://pikt.ag
- Privacy policy URL: https://pikt.ag/privacy
- Terms URL: https://pikt.ag/terms (optional in Apple, recommended in Play)

---

## Screenshots — the actual conversion lever

Text copy gets the listing FOUND. Screenshots get it INSTALLED. Most
users decide from the first 2 frames (visible above the fold in App
Store search results without scrolling) without ever reading copy.
This doc historically covered only copy — that gap is the biggest
risk to install rate. Treat the screenshot set as as much work as
all the text above combined.

### Frame-by-frame narrative (en, primary)

| # | Frame | Headline (over the screenshot) | Why |
|---|-------|--------------------------------|-----|
| 1 | **Reverse search in action** — search box showing "designer in SF", results below | "Search by need, not by name." | This IS the differentiator. Lead with it. Not the home feed, not the tag picker — the moment that makes PikTag unlike a contacts app. |
| 2 | **QR exchange mid-scan** — two phones / one with QR overlay + the resulting profile | "Meet someone. One tap." | The other moment users instantly understand. Captures the high-intent "meet a stranger" use case. |
| 3 | **AI tag suggestions** — the suggestion chips with one being tapped | "AI knows what you do." | Frames PikTag as smart, not manual. |
| 4 | **Ask broadcast** — Ask composer + the "matched friends" results | "Post a need. The right people surface." | The serendipity loop made concrete. |
| 5 | **Friend profile with mutual tags + meet-anniversary** | "Old friends, brought back to life." | The CRM/reactivation use case. |
| 6 | **Hidden tags / private annotations** | "Notes only you see." | Privacy framing — important for US tech-savvy audience. |

Frames 1-2 are non-negotiable; frames 3-6 are the order of importance
if you have to cut.

### Visual rules

- **First-frame headline must be readable at 1/3 size** (search-results
  preview is tiny). Use 36pt+ for the caption.
- **Use the brand gradient (#ff5757 → #8c52ff)** as the screenshot
  background or accent — recognition compounds across the set.
- **No phone bezel chrome.** Modern style is the screenshot floating
  on a brand-color background with the caption above. Apple's own
  apps do this.
- **Caption is in the screenshot, not the metadata.** Apple's
  per-screenshot caption field is deprecated/ignored.

### Sizes to ship

- **iPhone 6.7" (iPhone 14 Pro Max)** — REQUIRED by Apple, used for
  ALL iPhone sizes if smaller ones aren't supplied. Ship this one
  first.
- **iPhone 6.5"** — optional but recommended.
- **iPhone 5.5"** — only if you care about iPhone 8-era devices.
- **iPad 12.9"** — required ONLY if you support iPad. PikTag is
  iPhone-only per app.json — skip iPad screenshots.
- **Google Play phone** — 16:9 or 9:16, 320–3840px each side.

### Post-launch optimization

Apple's **Product Page Optimization (PPO)** lets you A/B-test up to
3 screenshot variants against the default with real install data.
Plan your second variant from week 1 — try a different headline on
frame 1 (e.g. "Personal CRM that searches by need" vs the brand
slogan) and measure conversion. Cycle every 2-3 weeks.

**Custom Product Pages (CPP)** let you ship up to 35 alternate
listings (different first frame + first 3 screenshots + promotional
text) and drive specific traffic to them via Apple Search Ads or
campaign URLs. Useful once you start paid acquisition.

---

## Per-locale rollout plan

For Apple App Store Connect, every supported language can have its own
listing (subtitle / description / keywords). For Google Play Console,
there's a similar localized listing feature.

With **North America as the primary market**, the priority order changes:
en gets the keyword research, screenshot work, and ASO iteration; other
locales get listings as cheap-to-launch additions.

**Phase 1 (launch day):** en (primary, full ASO effort) + zh-TW (copy
already authored — ships at no marginal cost).

**Phase 2 (week 1-2 post-launch):** **es** (US Latino population + LATAM
spillover — highest-ROI 2nd listing for a North America-led launch),
then ja, ko, fr, pt — pick based on which Phase-1 locale shows the
strongest install/conversion signal in App Store Connect analytics.

**Phase 3 (when org capacity allows):** zh-CN, ru, ar, bn, hi, id, th,
tr, de, it, vi, ur.

For markets without a localized listing, Apple/Play fall through to the
default (en for Apple, en for Play). The in-app UI is fully localized in
**all 19 languages**, so users in non-translated-listing markets still
get a fully-localized app once installed — just not a localized listing.

---

## Quick paste-checklist for App Store Connect

- [ ] App name (en): `PikTag — Personal CRM` (or chosen variant — see App name section)
- [ ] App name (zh-TW): `PikTag・用標籤管理人脈` (or chosen variant)
- [ ] Subtitle: paste from "App Store Subtitle" section above
- [ ] Promotional text: paste from "Promotional text" section above
- [ ] Description: paste full description for the locale
- [ ] Keywords: paste keywords string (en only first; others later)
- [ ] Support URL: `https://pikt.ag`
- [ ] Marketing URL (optional): `https://pikt.ag`
- [ ] Privacy policy URL: `https://pikt.ag/privacy`
- [ ] Primary category: Social Networking
- [ ] Secondary category: Productivity
- [ ] Age rating: complete questionnaire (no objectionable content,
      user-generated content moderated, occasional/mild themes if any)

## Quick paste-checklist for Google Play Console

- [ ] App name (en): `PikTag — Personal CRM` (or chosen variant — see App name section)
- [ ] App name (zh-TW): `PikTag・用標籤管理人脈` (or chosen variant)
- [ ] Short description: paste from "Short description" section above
- [ ] Full description: paste full description for the locale
- [ ] Category: Social
- [ ] Tags: pick 5 from "Play Store tags" priority list above
- [ ] Privacy policy URL: `https://pikt.ag/privacy`
- [ ] Contact email: `support@pikt.ag`
- [ ] Website: `https://pikt.ag`
