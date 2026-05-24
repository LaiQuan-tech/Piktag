// extract-brand-paths.js
//
// One-shot script: read SVG path data from the simple-icons package
// (CC0-licensed) for each PikTag platform, write a slim static map
// to src/components/brandPaths.ts. The app only ships the ~40 paths
// it actually uses, not the full 3000+ icon catalog.
//
// Run with:  node scripts/extract-brand-paths.js
// Re-run whenever PLATFORMS changes (new platform added) or after
// updating simple-icons (logo refresh).

const fs = require('fs');
const path = require('path');

// PikTag platform key → simple-icons slug. Keys must match
// PLATFORM_MAP in src/lib/platforms.ts. Only platforms with an
// official brand glyph go here; generic ones (Phone / Email /
// Website / Blog / Portfolio / Custom) stay on lucide.
const PLATFORM_TO_SLUG = {
  // Communication
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  line: 'line',
  wechat: 'wechat',
  kakaotalk: 'kakaotalk',
  signal: 'signal',
  messenger: 'messenger',
  discord: 'discord',
  // Social
  instagram: 'instagram',
  x: 'x',
  tiktok: 'tiktok',
  threads: 'threads',
  bluesky: 'bluesky',
  facebook: 'facebook',
  snapchat: 'snapchat',
  reddit: 'reddit',
  pinterest: 'pinterest',
  mastodon: 'mastodon',
  // Video
  youtube: 'youtube',
  twitch: 'twitch',
  vimeo: 'vimeo',
  bilibili: 'bilibili',
  // Music
  spotify: 'spotify',
  'apple-music': 'applemusic',
  soundcloud: 'soundcloud',
  bandcamp: 'bandcamp',
  'youtube-music': 'youtubemusic',
  // Professional
  linkedin: 'linkedin',
  github: 'github',
  gitlab: 'gitlab',
  behance: 'behance',
  dribbble: 'dribbble',
  medium: 'medium',
  // Writing
  substack: 'substack',
  notion: 'notion',
  hashnode: 'hashnode',
  // Business
  calendly: 'calendly',
  cal: 'caldotcom',
  paypal: 'paypal',
  patreon: 'patreon',
  kofi: 'kofi',
  buymeacoffee: 'buymeacoffee',
  stripe: 'stripe',
};

const ICONS_DIR = path.join(__dirname, '..', 'node_modules', 'simple-icons', 'icons');
const OUT_FILE = path.join(__dirname, '..', 'src', 'components', 'brandPaths.ts');

const result = {};
const missing = [];

for (const [key, slug] of Object.entries(PLATFORM_TO_SLUG)) {
  const svgPath = path.join(ICONS_DIR, `${slug}.svg`);
  if (!fs.existsSync(svgPath)) {
    missing.push(`${key} (slug: ${slug})`);
    continue;
  }
  const svg = fs.readFileSync(svgPath, 'utf8');
  // Each simple-icons SVG has exactly one <path d="..."/>
  const m = svg.match(/<path d="([^"]+)"/);
  if (!m) {
    missing.push(`${key} (no path in ${slug}.svg)`);
    continue;
  }
  result[key] = m[1];
}

const header = `// Auto-generated from simple-icons (CC0-licensed). Do not edit by
// hand — re-run scripts/extract-brand-paths.js to regenerate.
//
// Each value is the \`d\` attribute of a single 24x24 viewBox path
// representing the brand glyph in monochrome. PlatformIcon renders
// these with our gray700 fill so they read as part of the UI rather
// than blasting brand colors. Source SVGs live in
// node_modules/simple-icons/icons/{slug}.svg.

`;

const body = `export const BRAND_PATHS: Record<string, string> = ${JSON.stringify(result, null, 2)};\n`;

fs.writeFileSync(OUT_FILE, header + body);

console.log(`Wrote ${Object.keys(result).length} brand paths → ${OUT_FILE}`);
if (missing.length) {
  console.warn(`Skipped ${missing.length} missing icons:\n  ${missing.join('\n  ')}`);
}
