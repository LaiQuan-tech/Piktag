# PikTag — App Store Marketing Screenshot Pipeline

Generates the **6-card marketing screenshot set** for Apple App Store
Connect (iPhone 6.9" + iPad 13") in a single Python pass — each card =
brand gradient background + bold zh-TW title + subtitle + the actual app
screenshot inside a rounded phone mockup + decorative sparkles & chips.

Inspired by the LINE / Notion / Linear App Store listings. NOT the raw
device screenshots — those go through the marketing wrap to become the
slot images Apple actually shows.

## Why this exists

App Store conversion turns on the FIRST 2 frames in search results. Raw
device screenshots compete poorly against competitor apps that wrap their
shots with brand color + a one-line value prop. The marketing wrap:

- Frames each shot in PikTag's purple→pink brand gradient
- Adds a 2-line title + subtitle that delivers the value prop without
  the user opening the listing
- Drops the device chrome (no notch, no signal bars in the bezel area —
  status bar inside the screenshot is kept, that's intentional)
- Adds floating callout chips on the hero card (#1) to highlight specific
  features ("3 秒就好" / "AI 自動加標籤")
- Sparkles across all 6 for visual consistency — recognition compounds
  across the set

## Files

| File | What it does |
|---|---|
| `build_screenshot.py` | iPhone 6.9" (1320 × 2868) generator — ASC iPhone slot |
| `build_screenshot_ipad.py` | iPad 13" (2064 × 2752) generator — ASC iPad slot |
| `build_fake_map.py` | One-off generator for card #6's fake Taipei map background (used as source app screenshot for #6) |
| `screenshots-6.9/` | **Source** app screenshots (raw simulator captures) used as the phone-mockup inner image |
| `screenshots-6.9-marketing/` | **Output** wrapped iPhone marketing PNGs (`01-marketing.png` … `06-marketing.png`) |
| `screenshots-ipad-marketing/` | **Output** wrapped iPad marketing PNGs (`01-marketing.png` … `06-marketing.png`) |

## Quick start

### Generate one card

```bash
cd store-assets/app-store
python3 build_screenshot.py 1            # iPhone card #1
python3 build_screenshot_ipad.py 1       # iPad card #1
```

### Generate the whole set (iPhone + iPad)

```bash
cd store-assets/app-store
for i in 1 2 3 4 5 6; do
  python3 build_screenshot.py "$i"
  python3 build_screenshot_ipad.py "$i"
done
```

### Push to the desktop for review

The wrapped PNGs are at native ASC resolution (1320×2868 iPhone,
2064×2752 iPad), which are **above the 2000px chat limit** in
`~/.claude/CLAUDE.md` — you cannot inspect them in chat directly.
Workflow:

```bash
DEST=~/Desktop/PikTag-AppStore-Marketing
mkdir -p "$DEST/iPhone-6.9" "$DEST/iPad-13"
cp screenshots-6.9-marketing/*.png "$DEST/iPhone-6.9/"
cp screenshots-ipad-marketing/*.png "$DEST/iPad-13/"
```

To inspect a card in chat, downscale to ≤1024px first:

```bash
mkdir -p /tmp/preview
sips -Z 1024 screenshots-ipad-marketing/01-marketing.png \
  --out /tmp/preview/01-preview.png
# Then `Read /tmp/preview/01-preview.png` in the agent.
```

Per the global CLAUDE.md rule: NEVER `Read` the native-res output PNGs.

## The 6 cards

Captions live in `CARDS_BY_LANG` in both scripts (`SS_LANG=zh|en`, default
zh). Same content, same order on iPhone and iPad — only the canvas
geometry differs.

Rev 2 (founder 2026-06-11, Zuckerberg-standard pass): order = the locked
story (be found → meet via QR → meet via card → reconnect via AI →
discover nearby → growth), captions are scenarios in the same voice as the
wizard + store description. Card 1 mirrors the wizard's step-2 title.

| # | Title (zh) | Title (en) | Source screenshot |
|---|---|---|---|
| 1 | 讓別人搜得到你 | Let people find you | `04-profile.png` |
| 2 | 見面掃一下，朋友自動歸檔 | One scan, friends filed | `05-qr.png` |
| 3 | 拍張名片，3 秒記住一個人 | Scan a card, remember them | `01-cardscan.png` |
| 4 | 不知道怎麼開口，AI 給你 3 句 | AI breaks the ice, 3 openers ready | `03-ai.png` |
| 5 | 附近誰跟你同頻，地圖看得見 | Your people, on a map | `06-map.png` |
| 6 | 你的人脈，看得見的成長 | Your circle, in numbers | `02-stats.png` |

### EN set (NA is the primary market — REQUIRED before launch)

The en captions are wired in, but a real EN set needs EN APP SCREENS:
switch the app/simulator language to English, retake all 6 sources into
`screenshots-6.9-en/` (same filenames), then:

```bash
for i in 1 2 3 4 5 6; do SS_LANG=en python3 build_screenshot.py $i; done
for i in 1 2 3 4 5 6; do SS_LANG=en python3 build_screenshot_ipad.py $i; done
# outputs land in screenshots-6.9-marketing-en/ + screenshots-ipad-marketing-en/
```

### Retake shotlist (content fixes the captions can't paper over)

1. `04-profile.png` — fine as-is (rich profile). Ideally retake with an
   EN-named demo account for the en set.
2. `02-stats.png` — current capture shows ZEROS + four empty states
   ("nobody uses this app"). Retake on an account with real-looking data
   (friends curve, scan counts, top tags) before shipping card 6.
3. `03-ai.png` — current capture is an empty chat ("尚無訊息") with the
   icebreaker chips cut off at the bottom. Retake with the AI-opener
   suggestions fully visible (all 3), ideally with one sent message.
4. NEW SOURCE WANTED: a search-results capture (type a tag → people
   appear) — the product thesis has no card today; would replace or
   precede card 1 as the strongest possible opener.

Card #6 (`06-map.png`) is generated by `build_fake_map.py` — a clean
illustrated Taipei map without Google Maps watermark / "For dev purposes
only" overlay. Run it once when the cell network / Google API gives a
messy capture:

```bash
python3 build_fake_map.py    # writes to screenshots-6.9/06-map.png
```

## Layout system

Both scripts share the same conceptual layout, differ only in canvas
geometry. The constants live near the top of each file.

### iPhone (1320 × 2868)

```
y = 0
├─ Gradient fill (purple → pink, diagonal)
├─ TITLE_TOP=260       ── Title line 1 (2 lines if title has 「，」)
├─ ...                    Title line 2
├─ SUBTITLE_GAP=50     ── Gap
├─ Subtitle (one line)
├─ PHONE_TOP=700       ── Phone mockup (white frame + screenshot + shadow)
│  ├─ PHONE_W=980, PHONE_H=2096
│  └─ inner aspect 952/2068 ≈ 0.460 (matches source iPhone 1320/2868)
├─ Sparkles (overlaid)
├─ Chips on card #1 only (overlaid on top of phone)
└─ End at y=2868
```

### iPad (2064 × 2752)

```
y = 0
├─ Gradient fill
├─ TITLE_TOP=200       ── Title line 1
├─ ...                    Title line 2
├─ SUBTITLE_GAP=64     ── Gap (larger than iPhone)
├─ Subtitle
├─ PHONE_TOP=700       ── Phone mockup
│  ├─ PHONE_W=960, PHONE_H=2050
│  └─ inner aspect 928/2018 ≈ 0.460 (still iPhone source aspect)
└─ End at y=2752
```

## Customization

### Title / subtitle for a card

Edit the `CARDS` array in both scripts:

```python
CARDS = [
    ("拍張名片，標籤幫你記住", "3 秒掃描建檔，幫你想起對方是誰", "01-cardscan.png"),
    ...
]
```

- `wrap_title()` auto-splits the title on `「，」` if length > 9. Keep
  titles ≤ ~14 chars; long titles bleed off-canvas.
- Subtitle is single-line. Aim ≤ ~26 chars on iPhone, ≤ ~30 on iPad.
- The English equivalent is NOT shipped — Apple lets en-US fall back to
  the screenshot's "default language" slot. We mark the zh-TW set as
  the 6.9" slot's default and Apple auto-uses it for en-US.

### Chips & sparkles

Per-card in `CARD_EXTRAS`:

```python
CARD_EXTRAS = {
    1: {
        "sparkles": _SPARKLES,
        "chips": [
            (220, 1120, "3 秒就好", "", _G_WHITE),
            (1100, 1900, "AI 自動加標籤", "", _G_PINK),
        ],
    },
    2: {"sparkles": _SPARKLES, "chips": []},
    ...
}
```

- **Chips** are floating callouts. Format: `(cx, cy, label, icon, gradient)`.
  Use `""` for icon to skip (text-only chip). Founder rule: chips ONLY on
  card #1 (拍張名片) — they highlight the "AI auto-tag" wow that needs
  surfacing on the hero frame; later cards should breathe.
- **Sparkles** are the 4-point ✦ shapes scattered across the canvas. The
  `_SPARKLES` constant holds `(cx, cy, size)` tuples — same for all 6
  cards (consistency across the set).
- iPhone vs iPad sparkle positions are different (different canvas
  widths). Update both files if you re-art the sparkle layout.

### Font / colors

- Font: `Hiragino Sans GB.ttc` (`/System/Library/Fonts/...`) —
  `index=2` for title (W6 bold), `index=0` for subtitle (W3 regular).
  Hiragino renders both 繁中 + 簡中 + en cleanly.
- Brand gradient endpoints are hardcoded: `GRAD_START=(140,82,255)` =
  `piktag500 #8c52ff`, `GRAD_END=(236,72,153)` = pink-500 `#ec4899`.
- Drop shadow on text is 60-alpha black, 4-5px offset — keeps title
  readable on the bright gradient.

## Source app screenshots

The `screenshots-6.9/` directory holds the RAW app captures (and the
generated `06-map.png`) that get pasted inside the phone mockup. These
ARE native iPhone 6.9" simulator screenshots — 1320 × 2868.

To re-capture from the simulator:

```bash
# iPhone 17 Pro Max simulator, on the screen you want
xcrun simctl io booted screenshot path/to/01-cardscan.png
```

The marketing wrap auto-handles aspect:
- If the source aspect matches the phone frame inner aspect (≈ 0.460),
  no crop. This is the case for all native iPhone captures.
- If wider, center-crop horizontally. If taller, center-crop vertically.
  This protects against accidentally mismatched sources.

## Layout fix history (lessons learned)

### 2026-06-09: iPad subtitle was hidden behind phone mockup

**Symptom**: On iPad cards, the subtitle text rendered correctly but the
phone mockup started 14 px ABOVE the subtitle's bottom edge, partially
obscuring it. On cards where the phone screenshot had a white status bar
(e.g. #2 dashboard), the subtitle was nearly invisible against the white.

**Root cause**: Title font (132 px) + 2-line title + subtitle (58 px) +
gap (52 px) put the subtitle baseline at y ≈ 554, and `PHONE_TOP = 540`.
Phone covered the bottom 14 px of subtitle.

**Fix** (committed):
- `TITLE_FONT_SIZE`: 132 → 116
- `SUBTITLE_FONT_SIZE`: 58 → 54
- `TITLE_TOP`: 180 → 200
- `TITLE_LINE_GAP`: 16 → 14
- `SUBTITLE_GAP`: 52 → 64
- `PHONE_TOP`: 540 → **700** (the load-bearing change)
- `PHONE_W`: 1020 → 960
- `PHONE_H`: 2182 → 2050 (kept the 0.460 source aspect)
- `PHONE_RADIUS`: 80 → 76

The new layout leaves a **136 px clear band** between subtitle bottom
(~564) and phone top (700). Phone bottom now ends at y = 2750, leaving
2 px below — tight but within canvas.

**iPhone version was NOT touched** — it had `PHONE_TOP = 700` from day
1 and never had this collision. iPad inherited an older smaller PHONE_TOP.

If you re-tune layout numbers, validate with all 6 cards by running the
preview workflow (`sips -Z 1024` + Read in chat).

## Shipping the output

### App Store Connect

1. Open ASC → app → Version 1.0.x → 預覽和截圖.
2. For iPhone 6.9" slot: drag in `screenshots-6.9-marketing/01..06-marketing.png`.
3. For iPad 13" slot: drag in `screenshots-ipad-marketing/01..06-marketing.png`.
4. ASC's 13" upload also fills the 12.9" slot automatically (Apple's
   "use 13" file for 12.9" iPad" option). No separate 12.9" set needed.

Screenshot replacements on a **live** version are accepted without
re-review (ASC's "always editable" policy for visuals). On an
**inflight** version (waiting / in review), screenshots ARE part of the
submission package — reviewer sees them.

### Google Play Console

Play Store uses 16:9 phone screenshots (different aspect from iPhone
slot) — the iPhone marketing PNGs **do not match**. We currently rely
on Play's "Use Apple screenshots" fallback or a separate rebrand pass
in `../google-play/screenshots-rebranded/`. Not auto-generated.

If you want to fork the pipeline for Play, copy `build_screenshot.py`,
change `W, H` to `1080, 1920` (or whatever Play target), and re-tune
the layout constants. Same `CARDS` config works.

## Don'ts

- **NEVER `Read` the native-res output PNGs in chat** — they exceed the
  global 2000 px chat-image limit. Use `sips -Z 1024` to make a preview
  first. See `~/.claude/CLAUDE.md` "Image / Screenshot Size Limit".
- **NEVER add emoji to the title / subtitle / chip labels.** Founder
  rule, no emoji anywhere in user-facing content (CLAUDE.md). Sparkles
  ARE OK — they're drawn polygons, not Unicode glyphs. The ✦ characters
  in this doc / comments are reference only, not in rendered output.
- **NEVER hand-edit the output PNGs.** Re-run the script. Hand-edits get
  lost the next time anyone runs the pipeline.
- **DON'T put chips on cards #2–#6.** Hero-only (#1). The other cards
  carry their narrative in the screenshot itself; extra chips compete
  with the screenshot for attention.

## Related docs

- `store-assets/STORE_LISTING_FILLOUT.md` — the source-of-truth for all
  store-listing copy (app name, subtitle, description, promo text,
  keywords) — separate concern from these visuals.
- `~/.claude/CLAUDE.md` — global rules (no emoji, 2000 px image limit,
  繁中 reply preference, never resize native-res screenshots).
- `mobile/CLAUDE.md` — PikTag working memory (brand voice, North Star,
  locked phrases like "Tag yourself. Find anyone." / "Pick. Tag. Connect.").

## Rev 3 (2026-06-12) — 17 locales, reconstructed screens, dual renderer

- **Captions**: all 17 App-Store locales live in `captions.py`
  (`CARDS_BY_LANG` + `CHIP_BY_LANG`), shared by both build scripts. `\n`
  in a title forces a 2-line break.
- **App-screen set**: zh-TW uses the Chinese captures (`screenshots-6.9/`);
  every other locale reuses ONE English set (`screenshots-6.9-en/`) —
  founder call: localize captions, one app-screen set (NA primary). Cards
  3/4/6 (card-scan, AI chat, stats) are faithful HTML reconstructions
  (the live simulator captures were a black viewfinder / empty chat /
  all-zero dashboard); cards 1/2 (profile, QR) reconstructed in English;
  card 5 (map) is the real map with an English header overlay.
- **Two renderers**:
  - `build_screenshot.py` / `build_screenshot_ipad.py` (PIL) — Latin /
    CJK / Cyrillic (13 locales). `SS_LANG=<locale>`.
  - `compose_chrome.py` (headless Chrome) — ko / ar / th / hi only,
    because Hiragino lacks those glyphs AND PIL does no complex-text
    shaping (Arabic joining+RTL, Thai marks, Devanagari conjuncts).
    `compose_chrome.py <lang> <iphone|ipad> <1-6>`.
- No sparkles (founder 2026-06-12). Card-scan demo data is fully
  fictional (example.com, 555-01XX). Outputs:
  `screenshots-6.9-marketing-<locale>/` (iPhone 6.9") +
  `screenshots-ipad-marketing-<locale>/` (iPad); zh-TW omits the suffix.
