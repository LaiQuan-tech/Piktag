import { Platform, Share, type ShareContent } from 'react-native';
import type { TFunction } from 'i18next';

export const APP_BASE_URL = 'https://pikt.ag';

type BuildArgs = {
  /**
   * What the recipient should read at the start of the message —
   * typically "Full Name (@username)" when sharing someone else's
   * profile, or "我" / "I" when sharing your own.
   */
  name: string;
  /** The profile username (used for the canonical share URL). */
  username: string;
  t: TFunction;
};

/**
 * Builds a platform-appropriate payload for React Native's `Share.share`
 * when the user shares a PikTag profile (their own or a friend's).
 *
 * The message copy is pulled from i18n (`share.profileInviteMessage`)
 * and deliberately contains the profile URL inline. We do NOT pass
 * `Share`'s separate `url` field because on iOS it makes apps like
 * iMessage render the link as a rich preview card IN ADDITION to
 * showing the URL that's already in the message body — users see the
 * URL twice. Keeping the URL inline gives us consistent
 * single-occurrence rendering across every share target (Messages,
 * WhatsApp, Line, Telegram, Mail …).
 *
 * The i18n template also includes:
 *   - a short brand-value pitch ("PikTag — tag every friend, scan QR
 *     to auto-capture when & where") so recipients who have never
 *     heard of PikTag understand what it is, and
 *   - a direct download CTA linking to https://pikt.ag so they can
 *     install the app without having to search the store.
 */
export function buildShareProfilePayload({
  name,
  username,
  t,
}: BuildArgs): ShareContent {
  const profileUrl = `${APP_BASE_URL}/${username}`;
  const message = t('share.profileInviteMessage', {
    name,
    url: profileUrl,
  });

  // `title` is Android-only (used as the share intent subject / email
  // subject line). iOS ignores it. We supply a short tag so email
  // clients and sharing targets that surface a title have something
  // sensible to show.
  return {
    message,
    title: Platform.OS === 'android' ? `${name} @ PikTag` : undefined,
  };
}

/**
 * Convenience wrapper that builds the payload and fires
 * `Share.share`. Swallows user-cancel errors silently.
 */
export async function shareProfile(args: BuildArgs): Promise<void> {
  const payload = buildShareProfilePayload(args);
  try {
    await Share.share(payload);
  } catch {
    // User cancelled or the share target failed. Nothing to do —
    // showing an error for "user hit cancel" would be worse UX.
  }
}
