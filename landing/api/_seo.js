const {
  SITE_ORIGIN,
  escapeHtml,
  jsonLd,
  isIndexableProfile,
  LOCALE_CODES,
} = require('./_config');

// ─────────────────────────────────────────────────────────────────────────
// _seo.js — <head> content for the server-rendered public pages.
// ─────────────────────────────────────────────────────────────────────────
// Titles, meta descriptions, robots directives and JSON-LD live here so
// the profile route, the tag route and the sitemap cannot drift apart
// about what "indexable" means.
//
// THE ONE RULE for everything in this file: every claim in the markup
// must be true of the rendered page. If the page does not display a
// person's name, the graph does not assert one. If a tag page shows 12
// cards, the ItemList has 12 items — not the tag's usage_count. Structured
// data that describes content the visitor cannot see is a manual-action
// risk with Google and, worse, it teaches an AI assistant something false
// about a real person.

const SITE_ID = `${SITE_ORIGIN}/#website`;
const ORG_ID = `${SITE_ORIGIN}/#organization`;
const TAGSET_ID = `${SITE_ORIGIN}/#tagset`;

const APP_STORE_URL = 'https://apps.apple.com/app/id6761379641';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ag.pikt.app';

// Google truncates around 60 characters and shows roughly 155 of a meta
// description. These are budgets, not hard limits — the point is to put
// the load-bearing words (the person's name and their tags) inside the
// visible window rather than after the ellipsis.
const TITLE_BUDGET = 65;
const DESCRIPTION_BUDGET = 158;

const BRAND_SUFFIX = ' | #PikTag';

function truncate(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  // Prefer a word boundary, but never emit a stub — a mid-word cut beats
  // truncating "Software Architecture" to "Software" and losing the term
  // someone would actually search for.
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

// Tag values arrive from two shapes across the routes: bare strings from
// the profile route's flattened list, and { name } objects elsewhere.
function tagNames(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (t && typeof t === 'object' ? t.name : t))
    .map((t) => String(t || '').trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────
// Profile page
// ─────────────────────────────────────────────────────────────────────────

// "Pauline Chen (@pauline) — #勵志 #莫忘初衷 #韌性 | #PikTag"
//
// The old title was "Name (@handle) | #PikTag", which tells a searcher
// nothing about the person and gives a ranking engine nothing to match.
// PikTag's whole proposition is that a person is findable by what they do,
// so the tags belong in the title — they are the only words on the page
// that answer "who do I know that shoots weddings?".
//
// Tags are preferred over the headline because they are the vocabulary
// people search in; the headline is the fallback when a profile has none.
// Both are already displayed on the page, so neither is a fabricated
// claim, and no new translated strings are needed — this composes purely
// from the user's own data and works identically in all 19 locales.
function buildProfileTitle(name, handle, tags, headline) {
  const base = `${name} (@${handle})`;
  const room = TITLE_BUDGET - base.length - BRAND_SUFFIX.length - 3;

  if (room > 6) {
    const picked = [];
    for (const t of tags) {
      const candidate = picked.concat(`#${t}`).join(' ');
      if (candidate.length > room) break;
      picked.push(`#${t}`);
    }
    if (picked.length) return `${base} — ${picked.join(' ')}${BRAND_SUFFIX}`;
    if (headline) return `${base} — ${truncate(headline, room)}${BRAND_SUFFIX}`;
  }
  return `${base}${BRAND_SUFFIX}`;
}

// "PM · 我們幫大家對接人脈 & 機會 · #海派 #想像扶輪社 #冰美式"
//
// Joined with a middot rather than a sentence connective on purpose:
// any English glue word ("on PikTag", "is tagged") would read as broken
// language on the 18 non-English renders of the same page. Punctuation is
// language-neutral, and the parts are already the user's own words.
function buildProfileDescription(handle, bio, headline, tags) {
  const parts = [];
  if (headline) parts.push(headline);
  if (bio) parts.push(bio);
  if (tags.length) parts.push(tags.slice(0, 8).map((t) => `#${t}`).join(' '));
  if (!parts.length) parts.push(`@${handle}`);
  return truncate(parts.join(' · '), DESCRIPTION_BUDGET);
}

// The robots directive and the sitemap read the SAME predicate
// (isIndexableProfile), so a page can never be advertised in one and
// suppressed in the other.
//
//   deactivated  gets noindex, nofollow. is_public = false is what the
//                  app writes when someone deactivates, having told them
//                  "停用後你的個人頁將隱藏" — their page must stop
//                  passing any signal at all.
//   test / thin  gets noindex, follow. Not a person worth showing a
//                  searcher, but the links out to tag pages are real.
//   indexable    gets index, plus the two directives that actually change
//                  what a result looks like: a large image preview and an
//                  unclipped snippet, which is also what an AI overview
//                  quotes from.
function profileRobots(profile, tags) {
  if (!profile || profile.is_public !== true) return 'noindex, nofollow';
  if (!isIndexableProfile(profile)) return 'noindex, follow';
  if (!tags.length) return 'noindex, follow';
  return 'index, follow, max-image-preview:large, max-snippet:-1';
}

// ProfilePage wrapping a Person (or, for @piktag, an Organization).
//
// Replaces a bare Person node. The difference matters: a lone Person says
// "this person exists somewhere"; ProfilePage + mainEntity says "this page
// IS that person's profile", which is the relationship Google documents
// for profile pages and the one an assistant needs to attribute a quote.
function profileGraph({ profile, tags, biolinks, pageUrl, name, description, avatarUrl, locale, headline, latestTagAt }) {
  const handle = profile.username || '';
  const links = Array.isArray(biolinks) ? biolinks : [];

  // sameAs is "the same entity, elsewhere on the web" — it takes URLs, so
  // a mailto: goes in `email` instead. The previous markup put mailto:
  // into sameAs, which is invalid.
  const sameAs = [];
  for (const l of links) {
    if (isHttpUrl(l && l.url)) sameAs.push(l.url);
  }
  if (isHttpUrl(profile.website)) sameAs.push(profile.website);
  const uniqueSameAs = [...new Set(sameAs)];

  // Deliberately NOT emitted: schema.org `email`, even when the person
  // published a mailto: biolink. The address is already on the page as an
  // href, so putting it in structured data adds no ranking or citation
  // value — it only hands scrapers a labelled, machine-readable address
  // for a real person. No upside, real downside.

  const isOrg = profile.is_official === true;
  const entityId = `${pageUrl}#${isOrg ? 'organization' : 'person'}`;

  const entity = {
    '@type': isOrg ? 'Organization' : 'Person',
    '@id': entityId,
    name,
    // The @handle, which is how people actually refer to each other here
    // and a real alternate name for the entity.
    alternateName: `@${handle}`,
    url: pageUrl,
    // knowsAbout is the whole point of a PikTag profile: the tags ARE the
    // machine-readable claim "this is what I do / care about". They are
    // rendered as visible pills on the page, so this asserts nothing the
    // visitor cannot see.
    knowsAbout: tags,
  };
  if (avatarUrl) {
    entity[isOrg ? 'logo' : 'image'] = { '@type': 'ImageObject', url: avatarUrl };
    if (isOrg) entity.image = { '@type': 'ImageObject', url: avatarUrl };
  }
  if (description) entity.description = description;
  // The headline is the one line a member writes to say what they DO, and
  // it was reaching the title and the meta description while never
  // entering the graph. jobTitle is the field an answer engine reads to
  // answer "who is this person", so it was the one place it was missing.
  // Person only: an Organization's headline is a tagline, not a job.
  if (!isOrg && headline) entity.jobTitle = headline;
  if (uniqueSameAs.length) entity.sameAs = uniqueSameAs;
  if (isOrg) {
    // The official account is the SAME entity the homepage graph
    // describes, so it reuses that node's @id and its canonical url
    // (the site root). Two nodes sharing an @id but disagreeing about
    // `url` is how you get a merged entity with a coin-flip homepage.
    // The profile URL is still expressed — as the ProfilePage's url,
    // which is what it actually is.
    entity['@id'] = ORG_ID;
    entity.url = `${SITE_ORIGIN}/`;
    entity.mainEntityOfPage = { '@id': `${pageUrl}#page` };
    entity.sameAs = [...new Set([...(entity.sameAs || []), APP_STORE_URL, PLAY_STORE_URL])];
  }

  const page = {
    '@type': 'ProfilePage',
    '@id': `${pageUrl}#page`,
    url: pageUrl,
    name: `${name} (@${handle})`,
    isPartOf: { '@id': SITE_ID },
    mainEntity: { '@id': isOrg ? ORG_ID : entityId },
    inLanguage: (locale && locale.htmlLang) || 'en',
  };
  // The later of "the profile row changed" and "a tag was added". The
  // second used to be missing, and on this site it is usually the one
  // that moved: tags are the page's living content, while the profile row
  // only changes when someone edits their bio. Emitted only from real
  // timestamps — never Date.now(), which would claim freshness the page
  // has not earned.
  const stamps = [profile.updated_at, latestTagAt]
    .filter(Boolean)
    .map((v) => new Date(v))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (stamps.length) {
    page.dateModified = new Date(Math.max(...stamps.map((d) => d.getTime()))).toISOString();
  }

  return jsonLd({ '@context': 'https://schema.org', '@graph': [page, entity] });
}

// ─── hreflang ────────────────────────────────────────────────────────
// Every public page renders in 19 languages behind `?lang=`, and until
// now nothing told a crawler so. robots.txt deliberately leaves ?lang=
// crawlable and its own comment says why: "Blocking it would close the
// door on hreflang later". This is later.
//
// Without these links Google sees 19 near-identical URLs, picks one, and
// drops the rest as duplicates — so a Japanese search for a member's name
// cannot surface the Japanese rendering of their page. For a product whose
// entire pitch is finding people ACROSS languages, that is the wrong
// default. It matters for answer engines too: they resolve a page's
// language cluster before deciding which version to quote.
//
// Reciprocity is the rule Google actually enforces: every alternate must
// point back at every other, and each must be self-referential. Building
// the whole set from one canonical URL guarantees that by construction.
//
// x-default goes to the bare URL, which content-negotiates from
// Accept-Language — the correct target for "we do not know your language
// yet" rather than pinning it to English.
function hreflangLinks(canonicalUrl) {
  if (!canonicalUrl) return '';
  let base;
  try {
    base = new URL(canonicalUrl);
  } catch {
    return '';
  }
  // Strip any lang already on the canonical so alternates cannot stack
  // (?lang=ja&lang=ko) and so x-default is genuinely bare.
  base.searchParams.delete('lang');
  const bare = base.toString().replace(/\?$/, '');
  const links = LOCALE_CODES.map((code) => {
    const u = new URL(bare);
    u.searchParams.set('lang', code);
    return `<link rel="alternate" hreflang="${escapeHtml(code)}" href="${escapeHtml(u.toString())}">`;
  });
  links.push(`<link rel="alternate" hreflang="x-default" href="${escapeHtml(bare)}">`);
  return links.join('\n  ');
}

// One call, everything the profile route's <head> needs.
function profileSeo({ profile, tags, biolinks, locale, avatarUrl, rawName, latestTagAt }) {
  const names = tagNames(tags);
  const handle = profile.username || '';
  const pageUrl = `${SITE_ORIGIN}/${encodeURIComponent(handle)}`;
  const name = rawName || profile.full_name || handle || 'PikTag user';
  const headline = (profile.headline || '').trim();
  const bio = (profile.bio || '').trim();

  const title = buildProfileTitle(name, handle, names, headline);
  const description = buildProfileDescription(handle, bio, headline, names);

  return {
    pageUrl,
    title,
    titleHtml: escapeHtml(title),
    description,
    descriptionHtml: escapeHtml(description),
    robots: profileRobots(profile, names),
    jsonLdScript: profileGraph({
      headline,
      latestTagAt,
      profile,
      tags: names,
      biolinks,
      pageUrl,
      name,
      description,
      avatarUrl,
      locale,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tag page
// ─────────────────────────────────────────────────────────────────────────

// CollectionPage + DefinedTerm + ItemList.
//
// DefinedTerm is the honest type for a tag: it is a term drawn from a
// controlled vocabulary (PikTag's tag set), not a topic page about a
// subject. The ItemList carries exactly the people rendered as cards —
// `numberOfItems` is members.length and NOT the tag's usage_count, because
// the page shows at most 60 cards and claiming more than it displays is
// the classic structured-data violation.
function tagGraph({ tagName, members, pageUrl, description, locale }) {
  const list = (Array.isArray(members) ? members : []).map((m, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Person',
      name: m.name || m.username,
      alternateName: `@${m.username}`,
      url: `${SITE_ORIGIN}/${encodeURIComponent(m.username)}`,
      ...(m.avatar ? { image: m.avatar } : {}),
      // Only the tags actually printed on that person's card.
      ...(Array.isArray(m.tags) && m.tags.length ? { knowsAbout: m.tags } : {}),
    },
  }));

  const page = {
    '@type': 'CollectionPage',
    '@id': `${pageUrl}#page`,
    url: pageUrl,
    name: `#${tagName}`,
    description,
    isPartOf: { '@id': SITE_ID },
    inLanguage: (locale && locale.htmlLang) || 'en',
    about: { '@id': `${pageUrl}#term` },
    mainEntity: { '@id': `${pageUrl}#list` },
  };

  const term = {
    '@type': 'DefinedTerm',
    '@id': `${pageUrl}#term`,
    name: tagName,
    url: pageUrl,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      '@id': TAGSET_ID,
      name: 'PikTag tags',
      url: `${SITE_ORIGIN}/`,
    },
  };

  const itemList = {
    '@type': 'ItemList',
    '@id': `${pageUrl}#list`,
    numberOfItems: list.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: list,
  };

  return jsonLd({ '@context': 'https://schema.org', '@graph': [page, term, itemList] });
}

// A tag page with nobody on it is an empty state, not a search result.
// It stays crawlable (its links are real) but must not be indexed, and it
// is absent from the sitemap for the same reason.
function tagRobots(members) {
  if (!Array.isArray(members) || members.length === 0) return 'noindex, follow';
  return 'index, follow, max-image-preview:large, max-snippet:-1';
}

// ─────────────────────────────────────────────────────────────────────────
// Site-wide graph (homepage)
// ─────────────────────────────────────────────────────────────────────────
//
// Every other page's JSON-LD points at { "@id": SITE_ID } and, for the
// official account, ORG_ID. This is where those nodes are defined.
//
// On SearchAction: the target is a real, working URL pattern —
// pikt.ag/tag/<term> is how you search PikTag from the web, so the markup
// is truthful. Be aware that Google retired the sitelinks search box
// feature it used to drive; this is here because it is correct and other
// consumers still read it, not because it will produce a search box.
function siteGraph() {
  const org = {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'PikTag',
    legalName: 'PikTag Inc.',
    url: `${SITE_ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: `${SITE_ORIGIN}/logo.png` },
    email: 'support@pikt.ag',
    slogan: 'Tag yourself. Find anyone.',
    description:
      'PikTag is a contact app built on tags. You tag yourself with what describes you, and the people you meet become searchable by need instead of by name.',
    sameAs: [APP_STORE_URL, PLAY_STORE_URL],
  };

  const website = {
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: 'PikTag',
    url: `${SITE_ORIGIN}/`,
    publisher: { '@id': ORG_ID },
    inLanguage: 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_ORIGIN}/tag/{search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  const app = {
    '@type': 'MobileApplication',
    '@id': `${SITE_ORIGIN}/#app`,
    name: 'PikTag',
    operatingSystem: 'iOS, Android',
    applicationCategory: 'SocialNetworkingApplication',
    url: `${SITE_ORIGIN}/`,
    publisher: { '@id': ORG_ID },
    installUrl: [APP_STORE_URL, PLAY_STORE_URL],
    // The app is free to download; paid tiers exist for advanced
    // features. No aggregateRating — inventing one is a manual action.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };

  return jsonLd({ '@context': 'https://schema.org', '@graph': [org, website, app] });
}

module.exports = {
  hreflangLinks,
  SITE_ID,
  ORG_ID,
  APP_STORE_URL,
  PLAY_STORE_URL,
  truncate,
  tagNames,
  buildProfileTitle,
  buildProfileDescription,
  profileRobots,
  profileGraph,
  profileSeo,
  tagGraph,
  tagRobots,
  siteGraph,
};
