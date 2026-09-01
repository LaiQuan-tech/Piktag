const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SITE_ORIGIN,
  isIndexableProfile,
} = require('./_config');

// ─────────────────────────────────────────────────────────────────────────
// /sitemap.xml — generated live, not at build time.
// ─────────────────────────────────────────────────────────────────────────
// WHY LIVE AND NOT A BUILD STEP
//
// The two things this file lists — profiles and tags — change when a USER
// acts, not when a developer deploys. Someone signs up on a Tuesday and
// adds three tags; a build-time sitemap would keep claiming they do not
// exist until the next deploy, which on a landing site can be weeks. The
// inverse is worse: a user deactivates their account (is_public = false)
// and a stale file keeps handing Google a page we have promised to hide.
// Freshness is the entire point of a sitemap, so the sitemap has to be as
// fresh as the pages it lists — and every page it lists is already
// rendered live by a serverless function against the same anon key
// (api/u, api/tag). A build-time sitemap would be the only thing on this
// site with a different notion of "now".
//
// Cost of doing it live is small and bounded: two or three PostgREST
// reads behind a 6-hour edge cache, so real traffic is served from
// Vercel's CDN and Supabase sees a handful of requests a day.
//
// The counter-argument for build-time — no runtime dependency, cannot
// 500 — is answered by the catch below: any failure degrades to a valid
// sitemap containing the static pages, never a 500 and never an empty
// file. Google retries a sitemap; it does not punish one.
//
// Revisit this decision if the profile count reaches six figures, at
// which point the right answer is a materialized view in Postgres that
// this function pages through, not a build step.
//
// ─────────────────────────────────────────────────────────────────────────
// SHAPE
//
//   /sitemap.xml            sitemap index
//   /sitemap-static.xml     the handful of hand-maintained pages
//   /sitemap-profiles-N.xml eligible profiles, CHUNK per file
//   /sitemap-tags-N.xml     tags with at least one eligible holder
//
// An index from day one even though everything fits in one file today:
// the 50,000-URL / 50MB per-file limit is a hard protocol limit, and
// retrofitting an index later means changing the URL that is already
// registered in Search Console and cited in robots.txt.
//
// ─────────────────────────────────────────────────────────────────────────
// KEYS
//
// Anon key only, exactly as the profile and tag pages use. Everything
// listed here is readable without auth by construction — if RLS ever
// stops returning a row, it silently drops out of the sitemap, which is
// the correct failure direction. A service-role key would bypass RLS and
// could publish rows the site cannot actually serve; it must never appear
// in this file.

// URLs per child sitemap. Far below the 50,000 protocol limit on
// purpose: it bounds how many PostgREST pages one request has to walk
// (CHUNK / PAGE round trips) so a child sitemap can never approach the
// function timeout.
const CHUNK = 5000;
// PostgREST caps a single response at 1000 rows by default.
const PAGE = 1000;

const AUTH_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

// Profiles that are public, not test accounts, still active, and holding
// at least one PUBLIC tag.
//
// The `piktag_user_tags!inner(...)` embed is an INNER JOIN: it keeps only
// profiles that have a matching non-private tag row. That last condition
// is the thin-content gate — a PikTag profile with no tags is a name and
// an avatar, which is exactly the page Google files under "thin" and an
// AI assistant has no reason to cite. It is also the page that makes the
// product look empty to whoever clicks through.
//
// `order=username.asc` is required, not cosmetic: chunking uses offset,
// and offset without a stable order can skip or repeat rows between the
// index's count and a child's slice.
const PROFILE_QUERY =
  'piktag_profiles' +
  '?select=username,updated_at,is_public,is_test_account,is_active,onboarding_completed' +
  ',piktag_user_tags!inner(user_id)' +
  '&is_public=eq.true' +
  '&is_test_account=eq.false' +
  '&is_active=eq.true' +
  '&piktag_user_tags.is_private=eq.false' +
  '&order=username.asc';

// Tags held publicly by at least one eligible profile. Same reasoning:
// a tag page whose only holders are QA accounts is a page full of fake
// people, and a tag nobody holds renders an empty state.
const TAG_QUERY =
  'piktag_tags' +
  '?select=name' +
  ',piktag_user_tags!inner(is_private,piktag_profiles!inner(is_public,is_test_account,is_active))' +
  '&piktag_user_tags.is_private=eq.false' +
  '&piktag_user_tags.piktag_profiles.is_public=eq.true' +
  '&piktag_user_tags.piktag_profiles.is_test_account=eq.false' +
  '&piktag_user_tags.piktag_profiles.is_active=eq.true' +
  '&order=name.asc';

// Hand-maintained pages. Deliberately absent: /download and /scan
// (store-redirect and post-scan interstitials, no content of their own),
// /delete-account (a support page, kept crawlable for app-store
// compliance but not something to promote), /pitch (investor material),
// /reset-password (one-time token URL). Those are handled in robots.txt.
//
// No `lastmod`: these are static files whose real modification date is
// not available at request time, and Google explicitly discounts a site's
// lastmod values wholesale once it catches them being wrong. An absent
// lastmod is a smaller loss than a distrusted one.
const STATIC_PAGES = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/contact', changefreq: 'monthly', priority: '0.5' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.3' },
  { loc: '/child-safety', changefreq: 'yearly', priority: '0.3' },
];

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// A <loc> must be a properly escaped absolute URL. Tag names are user
// data and routinely non-Latin ("攝影") or punctuation-bearing, so the
// path segment is percent-encoded first and the result XML-escaped.
function absoluteUrl(path) {
  return xmlEscape(`${SITE_ORIGIN}${path}`);
}

// W3C datetime, date-only form. Sitemaps accept it and it avoids
// implying more precision than piktag_profiles.updated_at carries.
function isoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Row count without pulling the rows: PostgREST reports the total in
// Content-Range when asked for count=exact, and Range: 0-0 keeps the body
// to a single row.
async function countRows(query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { ...AUTH_HEADERS, Prefer: 'count=exact', Range: '0-0' },
  });
  // "0-0/195" when there are rows, "*/0" when there are none.
  const range = res.headers.get('content-range') || '';
  const total = parseInt(range.split('/')[1], 10);
  return Number.isFinite(total) ? total : 0;
}

// Walk one CHUNK-sized slice of a query, PAGE rows at a time.
async function fetchSlice(query, offset, limit) {
  const rows = [];
  let cursor = offset;
  const end = offset + limit;
  while (cursor < end) {
    const take = Math.min(PAGE, end - cursor);
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${query}&offset=${cursor}&limit=${take}`,
      { headers: AUTH_HEADERS },
    );
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`PostgREST: ${JSON.stringify(body).slice(0, 200)}`);
    rows.push(...body);
    if (body.length < take) break;
    cursor += take;
  }
  return rows;
}

function urlsetXml(entries) {
  const body = entries
    .map((e) => {
      const parts = [`    <loc>${e.loc}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${e.lastmod}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function indexXml(paths) {
  const body = paths
    .map((p) => `  <sitemap>\n    <loc>${absoluteUrl(p)}</loc>\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

function staticEntries() {
  return STATIC_PAGES.map((p) => ({
    loc: absoluteUrl(p.loc),
    changefreq: p.changefreq,
    priority: p.priority,
  }));
}

async function profileEntries(part) {
  const rows = await fetchSlice(PROFILE_QUERY, (part - 1) * CHUNK, CHUNK);
  return rows
    // The SQL filters cover the three DB flags. isIndexableProfile
    // re-applies them AND adds the two things SQL cannot express: the
    // username must match the shape the /:username route accepts (a
    // legacy dotted handle 404s), and obvious unflagged test handles are
    // dropped. Same predicate the profile page's robots meta uses.
    .filter(isIndexableProfile)
    .map((row) => ({
      loc: absoluteUrl(`/${encodeURIComponent(row.username)}`),
      // Lower bound on true last-modified: adding a tag writes to
      // piktag_user_tags, which does not touch profiles.updated_at. An
      // honest "the profile record last changed then" beats a fabricated
      // now().
      lastmod: isoDate(row.updated_at),
      changefreq: 'weekly',
      priority: '0.7',
    }));
}

async function tagEntries(part) {
  const rows = await fetchSlice(TAG_QUERY, (part - 1) * CHUNK, CHUNK);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const name = row && row.name;
    if (!name) continue;
    // Tag names are unique case-insensitively in the DB, but the page is
    // reached by lower(name) match — guard against a duplicate slipping
    // in and producing two <url> entries for the same page.
    const key = String(name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      loc: absoluteUrl(`/tag/${encodeURIComponent(name)}`),
      // No lastmod: a tag page changes when anyone adds or removes the
      // tag, and piktag_tags has no column that tracks that.
      changefreq: 'weekly',
      priority: '0.6',
    });
  }
  return out;
}

module.exports = async function handler(req, res) {
  const raw = Array.isArray(req.query.part) ? req.query.part[0] : req.query.part;
  const part = raw ? String(raw) : '';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // 6h at the edge, a day of stale-while-revalidate. Crawlers refetch a
  // sitemap far less often than that, so this is effectively one origin
  // hit per six hours no matter how many bots are looking.
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  // No Vary: Accept-Language. A sitemap is language-independent, and
  // varying it would fragment the edge cache for nothing.

  try {
    if (!part) {
      const [profileCount, tagCount] = await Promise.all([
        countRows(PROFILE_QUERY),
        countRows(TAG_QUERY),
      ]);
      // Counts here are pre-JS-filter, so they are an UPPER bound on the
      // URLs a child will emit. Chunk count derived from an upper bound
      // can only over-provision, never drop a page on the floor.
      // A zero count lists no child at all rather than an empty
      // <urlset> — Search Console flags empty sitemaps as errors.
      const paths = ['/sitemap-static.xml'];
      for (let i = 1; i <= Math.ceil(profileCount / CHUNK); i++) {
        paths.push(`/sitemap-profiles-${i}.xml`);
      }
      for (let i = 1; i <= Math.ceil(tagCount / CHUNK); i++) {
        paths.push(`/sitemap-tags-${i}.xml`);
      }
      return res.status(200).send(indexXml(paths));
    }

    if (part === 'static') {
      return res.status(200).send(urlsetXml(staticEntries()));
    }

    const profileMatch = /^profiles-(\d+)$/.exec(part);
    if (profileMatch) {
      const n = parseInt(profileMatch[1], 10);
      if (n < 1) return res.status(404).send(urlsetXml([]));
      return res.status(200).send(urlsetXml(await profileEntries(n)));
    }

    const tagMatch = /^tags-(\d+)$/.exec(part);
    if (tagMatch) {
      const n = parseInt(tagMatch[1], 10);
      if (n < 1) return res.status(404).send(urlsetXml([]));
      return res.status(200).send(urlsetXml(await tagEntries(n)));
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(404).send('Not found');
  } catch (err) {
    console.error('sitemap error:', err);
    // Degrade, never 500. A sitemap that lists only the static pages is
    // a correct sitemap; a 500 makes Search Console flag the site.
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(200).send(urlsetXml(staticEntries()));
  }
};
