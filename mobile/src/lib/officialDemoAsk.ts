import type { TFunction } from 'i18next';

// PikTag official account (fixed UUID, auto-friended at wizard completion).
// SINGLE source of truth for this constant — other call sites (e.g.
// ConnectionsScreen's cold-start check) should import it from here rather
// than re-declaring it locally.
export const OFFICIAL_ACCOUNT_ID = '00000000-0000-4000-a000-000000000001';

/**
 * The official @piktag account carries a long-lived demo Ask row (10-year
 * expiry) so its profile always has something to show. That row's real
 * `expires_at` is meaningless — showing a live countdown against it produces
 * absurd output ("87670h left") and teaches new users the wrong mental model
 * for how long a real Ask lasts (24h). Any surface that renders an Ask
 * authored by this account must:
 *   - never render a countdown / expiry-derived status for it, and
 *   - swap in the fixed demo title/body below instead of the DB row's
 *     (often English-only) content, so the demo teaches Ask in the
 *     viewer's own language.
 */
export function isOfficialDemoAsk(authorId: string | null | undefined): boolean {
  return isOfficialAccount(authorId);
}

/**
 * General-purpose official-account check for non-Ask surfaces (profile bio,
 * badges, etc). isOfficialDemoAsk is kept as a semantic alias for Ask call
 * sites and now just delegates here — OFFICIAL_ACCOUNT_ID stays the single
 * source of truth in this file.
 */
export function isOfficialAccount(userId: string | null | undefined): boolean {
  return userId === OFFICIAL_ACCOUNT_ID;
}

// ── Weekly demo-Ask content rotation (pure display layer) ──────────────
//
// The single long-lived demo Ask row never changes in the DB. Instead
// every render surface derives WHICH of DEMO_ASK_VARIANT_COUNT canned
// variants to show purely from the wall clock, so the @piktag profile's
// demo Ask quietly refreshes its topic each week without any cron, DB
// write, or new table. The landing page (landing/api/a/[askId].js)
// computes the SAME index from the SAME anchor + formula, so mobile and
// web always agree on "this week's" variant.
//
// KEEP ROTATION_ANCHOR_MS and DEMO_ASK_VARIANT_COUNT byte-identical with
// the landing copy — if they drift, the two surfaces show different
// variants for the same account. ROTATION_ANCHOR_MS is a fixed UTC epoch
// (2026-01-01), never "now", so the schedule is deterministic everywhere.
export const ROTATION_ANCHOR_MS = Date.UTC(2026, 0, 1);
export const DEMO_ASK_VARIANT_COUNT = 4;
const WEEK_MS = 7 * 24 * 3600 * 1000;

// Fallback copy (English) mirrors the ask.demoTitle{K}/demoBody{K} i18n
// keys — used as i18next defaultValue so a missing key can never render
// blank. The single display tag per variant stays the English canonical
// concept string in ALL locales (mirrors the demo's existing behavior;
// the tag is a concept name, not translated) and overrides the DB row's
// stored [ReactNative, SideQuest] wherever the demo Ask is rendered.
const DEMO_ASK_VARIANTS: ReadonlyArray<{ title: string; body: string; tag: string }> = [
  {
    title: 'React Native developer',
    body: 'Looking for a React Native developer for a side project — who do you know?',
    tag: 'ReactNative',
  },
  {
    title: 'Wedding photographer',
    body: "Getting married this fall — who's a wedding photographer worth recommending?",
    tag: 'Photography',
  },
  {
    title: 'Technical co-founder',
    body: 'Getting serious about my side project — looking for a technical co-founder. Who should I meet?',
    tag: 'Startup',
  },
  {
    title: 'Personal trainer',
    body: "Trying to get back in shape — any personal trainers you'd recommend?",
    tag: 'Fitness',
  },
];

/**
 * The index (0..DEMO_ASK_VARIANT_COUNT-1) of the variant to show this
 * week. Deterministic function of the clock only — no state, no I/O.
 */
export function getDemoAskVariantIndex(): number {
  // Euclidean modulo: JS's % keeps the dividend's sign, so a device whose
  // clock is set BEFORE the anchor would yield -1/-2, index the variant
  // array out of bounds, and throw on `.title` — inside a memo that runs on
  // the Connections tab for every user (everyone auto-friends @piktag),
  // which the global ErrorBoundary turns into an unrecoverable error screen.
  const raw = Math.floor((Date.now() - ROTATION_ANCHOR_MS) / WEEK_MS);
  return ((raw % DEMO_ASK_VARIANT_COUNT) + DEMO_ASK_VARIANT_COUNT) % DEMO_ASK_VARIANT_COUNT;
}

export function getDemoAskText(t: TFunction): { title: string; body: string } {
  const k = getDemoAskVariantIndex();
  const fallback = DEMO_ASK_VARIANTS[k];
  return {
    title: t(`ask.demoTitle${k}`, { defaultValue: fallback.title }),
    body: t(`ask.demoBody${k}`, { defaultValue: fallback.body }),
  };
}

/**
 * The single display tag ('ReactNative' | 'Photography' | 'Startup' |
 * 'Fitness') for this week's variant. Render surfaces that show the demo
 * Ask's tag chips must swap in [getDemoAskTag()] for the DB row's stored
 * tags so the chip matches the (rotated) body.
 */
export function getDemoAskTag(): string {
  return DEMO_ASK_VARIANTS[getDemoAskVariantIndex()].tag;
}

/**
 * The official @piktag account's bio in the DB is teaching copy written in
 * English ("Tags are how people find you..."). Like the demo Ask, this is
 * instructional content aimed at every new user regardless of the account's
 * stored language — so it should render in the viewer's own device language
 * rather than the DB row's literal (English) bio. Regular users' bios are
 * never touched by this function.
 */
export function getOfficialBio(t: TFunction): string {
  return t('profile.officialBio', {
    defaultValue:
      "Tags are how people find you — job, skills, hobbies, MBTI, anything that's you. Tap your profile to add yours.",
  });
}

/**
 * The official @piktag account carries a set of showcase tags stored in
 * the DB under a single canonical name (some non-English like '匹克球'/'美食'
 * — kept here as their English concept name 'Pickleball'/'Foodie' — and
 * two social-intent tags 'OpenToCollab'/'CoffeeChat') so its profile always
 * shows off the cross-language tag-matching story. Rendering those literal
 * stored strings to every viewer defeats the point — a Japanese viewer
 * should see ピックルボール, an English viewer Pickleball, etc. This map is
 * keyed on the DB's stored tag name and returns the viewer-language label
 * to *display*; callers must keep passing the original tag.id/tag.name to
 * navigation/lookups so tapping the chip still resolves to the same
 * concept-linked tag row. Returns null for any tag that isn't a showcase
 * tag (i.e. "don't override" — render tag.name as-is). The '攝影'/'咖啡'
 * entries are the previous showcase pair (swapped out 2026-07-15); kept
 * for backward compatibility and harmless once those tags are detached.
 *
 * Tag names are CASE-INSENSITIVE system-wide: the DB's uniqueness index is
 * on lower(name) (20260425010000_tag_name_unique.sql) and the official-tag
 * migration finds-or-creates with `WHERE lower(name) = lower(...)`, so the
 * stored row for a showcase concept may carry any casing a user happened to
 * create it with ('foodie', 'PICKLEBALL', ...). This map is therefore KEYED
 * BY LOWERCASE and looked up with a lowercased name — an exact-case map
 * would silently no-op on those rows and show non-English viewers the raw
 * English string. Keep every key here lowercase. (CJK keys are unaffected
 * by case folding; they stay byte-identical.)
 */
const OFFICIAL_TAG_LABEL_KEYS: Record<string, string> = {
  '攝影': 'showcaseTag.photography',
  '咖啡': 'showcaseTag.coffee',
  'pickleball': 'showcaseTag.pickleball',
  'foodie': 'showcaseTag.foodie',
  'opentocollab': 'showcaseTag.openToCollab',
  'coffeechat': 'showcaseTag.coffeeChat',
};

export function getOfficialTagLabel(tagName: string, t: TFunction): string | null {
  if (!tagName) return null;
  // toLowerCase (not toLocaleLowerCase) on purpose — locale-independent, so
  // a Turkish device can't fold 'I' to 'ı' and miss a key.
  const key = OFFICIAL_TAG_LABEL_KEYS[tagName.toLowerCase()];
  if (!key) return null;
  return t(key);
}
