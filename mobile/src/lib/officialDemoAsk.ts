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
  return authorId === OFFICIAL_ACCOUNT_ID;
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
