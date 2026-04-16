import PostHog from 'posthog-react-native';

// PostHog product analytics — tracks the 12 core events that map to
// Piktag's AHA moments: connect → tag → query. The API key is public
// (write-only, same model as Sentry DSN), so hardcoding is standard.
//
// Disabled in __DEV__ to keep dev console clean.
export const posthog = new PostHog(
  'phc_CagxzXtHwJ6xXYQ2pdDGmmbh5kRiyQ7ikjFjJnSrr7Hr',
  {
    host: 'https://us.i.posthog.com',
    disabled: __DEV__,
  },
);

// ── Typed event helpers ──
// Each wraps posthog.capture() with a fixed event name so callers
// can't typo the string and analytics stay consistent.

/** User completed registration (any provider). */
export const trackSignedUp = (provider: 'email' | 'google' | 'apple' | 'phone') =>
  posthog.capture('signed_up', { provider });

/** User finished onboarding flow. */
export const trackCompletedOnboarding = () =>
  posthog.capture('completed_onboarding');

/** User added their very first tag (any type). */
export const trackAddedFirstTag = (tagName: string) =>
  posthog.capture('added_first_tag', { tag_name: tagName });

/** User scanned a QR code for the first time. */
export const trackFirstQrScanned = () =>
  posthog.capture('first_qr_scanned');

/** A new connection was established (QR scan → friend added). */
export const trackConnectionMade = (method: 'qr' | 'invite' | 'manual') =>
  posthog.capture('first_connection_made', { method });

/** User added a hidden tag to a friend. */
export const trackHiddenTagAdded = (tagType: 'time' | 'location' | 'frequent' | 'text') =>
  posthog.capture('hidden_tag_added', { tag_type: tagType });

/** User opened a friend's detail page. */
export const trackFriendDetailViewed = () =>
  posthog.capture('friend_detail_viewed');

/** User applied the tag filter on ConnectionsScreen. */
export const trackTagFilterApplied = (tagName: string) =>
  posthog.capture('tag_filter_applied', { tag_name: tagName });

/** User reviewed a friend in ActivityReviewScreen. */
export const trackConnectionReviewed = () =>
  posthog.capture('connection_reviewed');

/** User shared an invite code. */
export const trackInviteShared = () =>
  posthog.capture('invite_shared');

/** User redeemed an invite code. */
export const trackInviteRedeemed = (code: string) =>
  posthog.capture('invite_redeemed', { code });

/** P coin earned or spent. */
export const trackPCoinsChanged = (delta: number, reason: string) =>
  posthog.capture('p_coins_earned', { delta, reason });
