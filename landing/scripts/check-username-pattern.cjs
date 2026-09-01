#!/usr/bin/env node
// Guards the username gate that silently killed 48 of 112 real users'
// share links and QR codes (fixed in e99c614, 2026-08-17).
//
// The bug: `VALID_USERNAME` in the share route was /^[a-zA-Z0-9_]{2,30}$/ —
// no dot — while the mobile signup flow HANDS OUT `name.<random digits>`
// whenever a handle is taken. The guard rejected those handles before the
// database was ever queried, so the route returned its own "user not found"
// page. From the outside it read as a routing 404; routing was never at
// fault. The same regex gated `isIndexableProfile`, so those users were
// dropped from the sitemap too.
//
// Two rules that must never break again:
//   1. Dotted and hyphenated handles are LEGAL — they are the app's own
//      default output, not an edge case.
//   2. The pattern lives in _config.js ONLY. The route and the sitemap both
//      import it. They previously kept separate copies, and drifting apart
//      is precisely how this shipped.
//
// Dependency-free on purpose: `node landing/scripts/check-username-pattern.cjs`.
const { VALID_USERNAME, STATIC_ASSET_LIKE } = require('../api/_config.js');

// [input, shouldBeAccepted, why]
const CASES = [
  // The exact shape the signup flow generates on a handle collision, and
  // the two handles named in the original bug report.
  ['karlcohen.71222', true, 'app-generated dotted handle (the original bug)'],
  ['leostevens.66556', true, 'app-generated dotted handle'],
  ['name.42', true, 'dotted handle, short suffix'],
  ['legacy-handle', true, 'legacy hyphenated handle (3 users had these)'],
  ['piktag', true, 'plain handle'],
  ['a_b.c-d', true, 'all legal separators, interior'],
  ['ab', true, 'minimum length'],
  ['a'.repeat(30), true, 'maximum length'],

  // Separators may not lead or trail — mobile's normalizeUsername bars these.
  ['.leading', false, 'leading dot'],
  ['trailing.', false, 'trailing dot'],
  ['-leading', false, 'leading hyphen'],
  ['trailing-', false, 'trailing hyphen'],

  // DELIBERATELY LAX on length: mobile requires 3-30, this gate accepts 1.
  // The gate's only job is to keep obvious non-handles (assets, paths) out
  // of the analytics funnel — whether a handle EXISTS is the database's
  // call. Making this gate stricter than the signup rule is exactly the
  // mistake that took 48 users offline, so laxer-than-mobile is the safe
  // direction and this case asserts we stay that way.
  ['a', true, 'shorter than mobile allows — gate stays permissive, DB decides'],

  // Not handles at all.
  ['a'.repeat(31), false, 'too long'],
  ['has space', false, 'space'],
  ['has/slash', false, 'path separator'],
  ['emoji😀', false, 'non-ascii'],
  ['', false, 'empty'],
];

// Real static files never reach this route (Vercel serves them before
// rewrites), but a MISSING one would — and would pollute the
// share_link_viewed funnel with fake profile views.
const ASSET_CASES = [
  ['favicon.ico', true],
  ['robots.txt', true],
  ['sitemap.xml', true],
  ['apple-touch-icon.png', true],
  ['karlcohen.71222', false], // a dotted handle is NOT an asset
  ['name.42', false],
];

let failed = 0;
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failed += 1;
};

for (const [input, expected, why] of CASES) {
  const got = VALID_USERNAME.test(input);
  if (got !== expected) {
    fail(`VALID_USERNAME(${JSON.stringify(input)}) = ${got}, expected ${expected} — ${why}`);
  }
}

for (const [input, expected] of ASSET_CASES) {
  const got = STATIC_ASSET_LIKE.test(input);
  if (got !== expected) {
    fail(`STATIC_ASSET_LIKE(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
  }
}

// A dotted handle must survive BOTH gates, since the route applies them
// together: `!VALID_USERNAME.test(u) || STATIC_ASSET_LIKE.test(u)` → 404.
for (const handle of ['karlcohen.71222', 'name.42', 'a_b.c-d']) {
  if (!VALID_USERNAME.test(handle) || STATIC_ASSET_LIKE.test(handle)) {
    fail(`${handle} would still 404 — it must pass the username gate AND not look like an asset`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed. Dotted handles are the app's default output — rejecting them takes real users' share links and QR codes offline.`);
  process.exit(1);
}
console.log(`ok — ${CASES.length + ASSET_CASES.length + 3} username-gate checks passed`);
