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

export function getDemoAskText(t: TFunction): { title: string; body: string } {
  return {
    title: t('ask.demoTitle', { defaultValue: 'React Native developer' }),
    body: t('ask.demoBody', {
      defaultValue:
        'Looking for a React Native developer for a side project — who do you know?',
    }),
  };
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
 */
const OFFICIAL_TAG_LABEL_KEYS: Record<string, string> = {
  '攝影': 'showcaseTag.photography',
  '咖啡': 'showcaseTag.coffee',
  'Pickleball': 'showcaseTag.pickleball',
  'Foodie': 'showcaseTag.foodie',
  'OpenToCollab': 'showcaseTag.openToCollab',
  'CoffeeChat': 'showcaseTag.coffeeChat',
};

export function getOfficialTagLabel(tagName: string, t: TFunction): string | null {
  const key = OFFICIAL_TAG_LABEL_KEYS[tagName];
  if (!key) return null;
  return t(key);
}
