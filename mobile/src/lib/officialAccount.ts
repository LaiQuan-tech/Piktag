import type { TFunction } from 'i18next';

// PikTag official account (fixed UUID, auto-friended at wizard completion).
// SINGLE source of truth for this constant — other call sites (e.g.
// ConnectionsScreen's cold-start check) should import it from here rather
// than re-declaring it locally.
//
// Split out of lib/officialDemoAsk.ts 2026-11-18 when the Ask UI was taken
// down from this client: the weekly demo-Ask rotation (getDemoAskText /
// getDemoAskTag / ROTATION_ANCHOR_MS) had no mobile renderer left and was
// deleted. landing/api/a/[askId].js still carries its own copy of that
// rotation for the public /a/:askId page; with no mobile surface rendering
// the demo Ask there is nothing left on this side to keep in sync.
export const OFFICIAL_ACCOUNT_ID = '00000000-0000-4000-a000-000000000001';

/**
 * General-purpose official-account check (profile bio, showcase tags, etc).
 */
export function isOfficialAccount(userId: string | null | undefined): boolean {
  return userId === OFFICIAL_ACCOUNT_ID;
}

/**
 * The official @piktag account's bio in the DB is teaching copy written in
 * English ("Tags are how people find you..."). This is
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
