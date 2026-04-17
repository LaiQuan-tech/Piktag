# Landing Page Audit

## Critical (must fix before launch) — 3 issues
- Store buttons are dead links `href="#"` in both hero and final CTA — no app store URLs (index.html:156, 160, 246, 250)
- No `<main>` landmark wrapping the sections; all `<section>` sit bare in `<body>`, hurting screen-reader navigation and SEO (index.html:147–256)
- Hero logo `<img>` missing width/height attributes → layout shift / CLS on slow networks (index.html:151, also 262)

## Important (should fix) — 6 issues
- No `:focus-visible` styles on `.store-btn`, `.chip`, footer links — keyboard users get no clear focus ring (style block :31–144)
- Footer logo `alt="PikTag"` duplicates adjacent visible "PikTag" text → redundant SR announcement; use `alt=""` (index.html:262)
- No `prefers-reduced-motion` guard around hero fadeUp/scaleIn animations (index.html:104–105)
- No skip-to-content link for keyboard users
- `.chip` elements are `<div>` with hover transform suggesting interactivity but aren't focusable/actionable — either make `<button>`/`<a>` or drop the hover affordance (index.html:232–235)
- Footer links 13px with small inline gap; tap target likely below 44px on mobile (index.html:97, 265–273)

## Nice to have — 4 issues
- Add `loading="lazy"` + `decoding="async"` on footer logo (index.html:262)
- Preload the primary Poppins weight to avoid font swap flash (index.html:27)
- Verify "15 種語言" claim is accurate before launch (index.html:244)
- JSON-LD could add `aggregateRating` or `screenshot` fields once available (index.html:29)

JSON-LD parses valid. Title 39 chars OK. Meta description ~46 CJK chars OK. OG/Twitter/canonical complete. Heading hierarchy h1→h2→h3 clean. Contrast passes AA on all checked text. Viewport meta correct; no horizontal scroll at 320px.

## Overall score: 7.5/10
