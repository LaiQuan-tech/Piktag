#!/usr/bin/env node
// check-i18n-parity.mjs
//
// Guards against the recurring "added a key to some locales but not all"
// drift (founder 2026-06-07, after `save` / Ask strings / wizard phone
// step leaked English because keys were missing in 12-14 of the 19
// locales and i18next fell back to en).
//
// WHAT IT CHECKS: every key present in ANY locale must be present in
// EVERY locale. Reports the missing (locale, key) pairs and exits 1 on
// drift, 0 when all 19 are in sync.
//
// WHAT IT DOESN'T CHECK: wrong-LANGUAGE values (e.g. an English string
// left in a non-en locale). That can't be detected without false
// positives (brand names, {{vars}}, shared Latin terms). Key parity is
// the high-signal, zero-false-positive guard; value review stays manual.
//
// Run: node mobile/scripts/check-i18n-parity.mjs   (from repo root)
//   or: node scripts/check-i18n-parity.mjs         (from mobile/)

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n', 'locales');

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`No locale JSON files found in ${LOCALES_DIR}`);
  process.exit(2);
}

const keysByLocale = {};
for (const f of files) {
  const loc = f.replace(/\.json$/, '');
  let json;
  try {
    json = JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8'));
  } catch (e) {
    console.error(`✗ ${f} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  keysByLocale[loc] = new Set(Object.keys(flatten(json)));
}

const union = new Set();
for (const set of Object.values(keysByLocale)) for (const k of set) union.add(k);

let drift = 0;
const lines = [];
for (const loc of Object.keys(keysByLocale).sort()) {
  const missing = [...union].filter((k) => !keysByLocale[loc].has(k)).sort();
  if (missing.length) {
    drift += missing.length;
    lines.push(`\n### ${loc}: missing ${missing.length} key(s)`);
    for (const k of missing) lines.push(`    ${k}`);
  }
}

console.log(`i18n parity: ${files.length} locales, ${union.size} distinct keys.`);
if (drift === 0) {
  console.log('✓ All locales in sync — 0 missing keys.');
  process.exit(0);
}
console.error(`✗ Locale drift: ${drift} missing (locale, key) pair(s). Fill these so no user falls back to English:`);
console.error(lines.join('\n'));
process.exit(1);
