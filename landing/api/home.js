const { escapeHtml, resolveLocale } = require('./_config');

// ─────────────────────────────────────────────────────────────────────────
// Homepage ("/") social-share card — per-locale TITLE, constant DESCRIPTION.
// ─────────────────────────────────────────────────────────────────────────
// "/" is rewritten to this fn (see landing/vercel.json) so non-JS social
// crawlers (FB / LINE / X / WhatsApp / Slack) get a localized <title> +
// OG/Twitter card. The SPA shell (with Vite's hashed asset tags) is fetched
// from the statically-served /index.html and the meta tags are string-
// replaced in place — keeping the asset graph byte-correct.
//
// TITLE source = the SAME hero.title1 + hero.title2 the SPA's
// LocalizedDocumentMeta (src/main.tsx) uses, tightened with the IDENTICAL
// regex (collapse whitespace, trim, strip only TRAILING terminal
// punctuation), prefixed with "PikTag — ". DESCRIPTION is the locked
// English brand signature for EVERY locale (do NOT translate it).
//
// CommonJS (landing/api/package.json "type":"commonjs"). All 19 locale
// JSONs are STATICALLY required below — Vercel's file tracer can't follow a
// dynamic require, so every locale must be named literally to ship in the
// bundle.

// Locked English brand signature — constant for every locale. Do NOT
// translate (the Pick/Tag wordplay only works in English).
const DESCRIPTION = 'Pick. Tag. Connect.';

// Static requires — one literal per locale so the Vercel bundler traces
// them. Keys are the TRANSLATIONS / app-i18n codes (loc.htmlLang).
const LOCALE_JSON = {
  en: require('../src/i18n/locales/en.json'),
  'zh-TW': require('../src/i18n/locales/zh-TW.json'),
  'zh-CN': require('../src/i18n/locales/zh-CN.json'),
  ja: require('../src/i18n/locales/ja.json'),
  ko: require('../src/i18n/locales/ko.json'),
  es: require('../src/i18n/locales/es.json'),
  fr: require('../src/i18n/locales/fr.json'),
  pt: require('../src/i18n/locales/pt.json'),
  ru: require('../src/i18n/locales/ru.json'),
  ar: require('../src/i18n/locales/ar.json'),
  hi: require('../src/i18n/locales/hi.json'),
  id: require('../src/i18n/locales/id.json'),
  th: require('../src/i18n/locales/th.json'),
  tr: require('../src/i18n/locales/tr.json'),
  bn: require('../src/i18n/locales/bn.json'),
  de: require('../src/i18n/locales/de.json'),
  it: require('../src/i18n/locales/it.json'),
  vi: require('../src/i18n/locales/vi.json'),
  ur: require('../src/i18n/locales/ur.json'),
};

// Tighten the two-line hero slogan into a title slot — MIRRORS
// LocalizedDocumentMeta in src/main.tsx EXACTLY: join the two title lines
// with a space, collapse all whitespace runs to a single space, trim, then
// strip ONLY trailing terminal punctuation across scripts (Latin . ! ? , ·
// CJK 。．！？，、 · Devanagari/Bengali danda । · Arabic/Urdu full stop ۔ —
// Thai has no sentence terminator). Keep this regex byte-identical to
// main.tsx so the crawler card and the JS-hydrated <title> always agree.
function tightenTitle(t1, t2) {
  const slogan = `${t1 || ''} ${t2 || ''}`
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s。．.!！?？,，、।۔]+$/u, '');
  return `PikTag — ${slogan}`;
}

// Per-locale title map, keyed by loc.htmlLang (the same code as the JSON
// keys). Built once at module load.
const TITLE_BY_LANG = {};
for (const [code, json] of Object.entries(LOCALE_JSON)) {
  const hero = (json && json.hero) || {};
  TITLE_BY_LANG[code] = tightenTitle(hero.title1, hero.title2);
}
const DEFAULT_TITLE = TITLE_BY_LANG.en;

module.exports = async function handler(req, res) {
  // SAFE FALLBACK: any error degrades "/" to the static English homepage
  // via a 302 to /index.html. "/" must NEVER hard-break.
  try {
    const loc = resolveLocale(req);
    const lang = (loc && loc.htmlLang) || 'en';
    const title = TITLE_BY_LANG[lang] || DEFAULT_TITLE;

    // Fetch the SPA shell (with Vite's hashed asset tags) from the
    // statically-served /app.html. The build renames index.html → app.html
    // (scripts/rename-shell.mjs) precisely so "/" has NO static file and the
    // vercel.json "/" → /api/home rewrite actually fires; /app.html stays
    // static, so this round-trip keeps the Vite asset hrefs correct.
    const r = await fetch('https://' + req.headers.host + '/app.html');
    const shell = await r.text();

    let html;
    try {
      const safeLang = escapeHtml(lang);
      const safeTitle = escapeHtml(title);
      const safeDesc = escapeHtml(DESCRIPTION);

      // Replace ONLY the existing tags. Tolerant regexes: match by the
      // distinguishing attribute (lang / name / property) regardless of
      // attribute order or self-closing style, so a Vite-built shell whose
      // attribute formatting differs slightly from the source index.html
      // still matches.
      html = shell
        // <html lang="en"> → loc.htmlLang
        .replace(/(<html\b[^>]*\blang=")[^"]*(")/i, `$1${safeLang}$2`)
        // <title>...</title> → title
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
        // name="description"
        .replace(
          /(<meta\b[^>]*\bname="description"[^>]*\bcontent=")[^"]*(")/i,
          `$1${safeDesc}$2`,
        )
        // property="og:title"
        .replace(
          /(<meta\b[^>]*\bproperty="og:title"[^>]*\bcontent=")[^"]*(")/i,
          `$1${safeTitle}$2`,
        )
        // property="og:description"
        .replace(
          /(<meta\b[^>]*\bproperty="og:description"[^>]*\bcontent=")[^"]*(")/i,
          `$1${safeDesc}$2`,
        )
        // name="twitter:title"
        .replace(
          /(<meta\b[^>]*\bname="twitter:title"[^>]*\bcontent=")[^"]*(")/i,
          `$1${safeTitle}$2`,
        )
        // name="twitter:description"
        .replace(
          /(<meta\b[^>]*\bname="twitter:description"[^>]*\bcontent=")[^"]*(")/i,
          `$1${safeDesc}$2`,
        );
    } catch {
      // Fetch succeeded but a later step threw — send the unmodified shell
      // rather than 302. Crawlers still get the (English) static card; the
      // SPA hydrates per-locale on JS-capable clients.
      html = shell;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    // MANDATORY — without Vary the edge cache would serve one locale's card
    // to every crawler (same i18n-collision bug fixed on the share fns).
    res.setHeader('Vary', 'Accept-Language');
    return res.status(200).send(html);
  } catch (err) {
    console.error('home card error:', err);
    // Absolute last resort: degrade to the static English homepage. "/"
    // can never hard-break.
    res.statusCode = 302;
    res.setHeader('Location', '/index.html');
    res.end();
  }
};
