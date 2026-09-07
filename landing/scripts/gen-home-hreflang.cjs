#!/usr/bin/env node
// Writes the homepage's hreflang block into index.html, between the
// HREFLANG:START / HREFLANG:END markers.
//
// The links are STATIC in the shell (see the comment beside the markers),
// so they have to be generated rather than hand-maintained: a hand-kept
// list drifts from the translation table, and an hreflang that promises a
// language at a URL rendering a different one is worse than none at all.
//
// Source of truth is LOCALE_CODES from api/_config.js — the same list the
// profile and tag routes build their alternates from.
const fs = require('fs');
const path = require('path');
const { LOCALE_CODES } = require('../api/_config.js');

const SITE = 'https://pikt.ag/';
const file = path.join(__dirname, '..', 'index.html');
const START = '<!-- HREFLANG:START (generated — do not hand-edit) -->';
const END = '<!-- HREFLANG:END -->';

const links = LOCALE_CODES.map(
  (code) => `    <link rel="alternate" hreflang="${code}" href="${SITE}?lang=${code}" />`
);
links.push(`    <link rel="alternate" hreflang="x-default" href="${SITE}" />`);

const html = fs.readFileSync(file, 'utf8');
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s === -1 || e === -1) {
  console.error('markers not found in index.html — refusing to guess where the block goes');
  process.exit(1);
}
const next =
  html.slice(0, s + START.length) + '\n' + links.join('\n') + '\n' + html.slice(e);
fs.writeFileSync(file, next);
console.log(`ok — ${LOCALE_CODES.length} hreflang + x-default written to index.html`);
