# Bio API Production Test

Tested against `https://lqtech-bio.vercel.app` on 2026-04-17.

## Profile: @fullwish
- HTTP: 200
- Title: `Jeff (@fullwish) | #piktag`  (correct)
- OG title / OG image: present, points at real Supabase avatar
- Avatar URL: working (`https://kbwfdskulxnhjckdvghj.supabase.co/storage/v1/object/public/avatars/581ee614-.../avatar.jpg`)
- Biolinks rendered: 7 (`.biolink`)
- Tags rendered: 3 (`.tag` chips)
- Tag count on page: 3 (inside `.tags` container)
- Raw template leaks: none (no `${...}` patterns)
- HTML tag balance: `<div>` 10/10, `<a>` 10/10 — balanced
- JSON-LD: **INVALID** — `JSON.parse` fails with `Bad control character in string literal in JSON at position 278`. The `description` field contains an unescaped literal newline from the user's bio (`我是一個想要把產品做到全世界，\n讓萬物通達的產品經理！`). Node's `JSON.parse` rejects it, so Google Rich Results / schema validators will reject it too.
- Issues: JSON-LD description is not JSON-escaped (literal `\n` inside a JSON string).

## Tag: /tag/科技
- HTTP: 200
- Title: `#科技 — 在 #piktag 上的人`
- OG title: `#科技 — 在 #piktag 上的人`
- Members rendered: 7 profile cards with avatar + `/username` links (`/kevinliu`, `/autotest2`, `/jasonwu`, `/flowtest`, `/test1`, `/fullwish`, `/alexchen`)
- Avatars: 7 `<img src>` entries, all from Supabase storage
- Raw template leaks: none
- HTML tag balance: `<div>` 30/30 — balanced
- JSON-LD: not emitted on tag page (neutral — tag pages don't require Person schema)
- Issues: none

## Invite: /i/test
- HTTP: 404
- Body: bare Vercel `NOT_FOUND` placeholder (`"The page could not be found / NOT_FOUND / hkg1::..."`) — no PikTag branding, no nice `notFound*` translations, no "Back to PikTag" button.
- Raw template leaks: n/a
- JSON-LD: n/a
- Issues: 404 is **not branded**. The `_config.js` has i18n strings `notFoundTitle`, `notFoundHeading`, `notFoundText`, `notFoundBack` ready, but the `/i/[code]` route appears to delegate to Vercel's default 404 instead of rendering a branded page. Low severity for invite codes specifically, but if `/<nonexistent-username>` behaves the same way it is a worse UX problem — **worth spot-checking before switching the domain**.

## Root: /
- HTTP: 200
- Serves the "coming soon" zh-TW placeholder (`用 #piktag 記住每個重要的人 / 即將上線，敬請期待`) with the old `#0fcdd6` teal logo color (not the `#aa00ff` purple brand color from `_config.js`).
- This will be replaced by the landing page post-switch, so not a blocker — flagging for awareness.

## Verdict

**SOFT GO** — core profile and tag rendering work with real Supabase data and no template leakage.

### Blocking issue
1. **JSON-LD parse failure on profiles with multi-line bios.** Any user whose `bio` contains a newline (likely many of them) ships invalid schema.org JSON. Low runtime impact (doesn't break rendering), but Google SEO / rich-result validators will flag every such page. The fix is a 1-line change in the profile handler where the description is injected — replace raw interpolation with `JSON.stringify(bio).slice(1, -1)` or equivalent.

### Non-blocking follow-ups
2. Invite 404 falls back to Vercel's bare "NOT_FOUND" — verify that `/<nonexistent-username>` uses the branded `notFoundTitle` template, not this bare one. If profile 404 is also bare, that's the real problem, not the invite one.
3. Root placeholder uses teal brand color; will be replaced.

If you're willing to ship SEO-invalid JSON-LD for now and patch it post-switch, domain switch is safe. If you want a clean cutover, fix #1 first (~5 min change).
