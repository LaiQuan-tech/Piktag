import PostHog from 'posthog-react-native';

// PostHog product analytics — tracks the core events that map to
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
//
// Only helpers that have at least one call site live here. Re-add
// new ones alongside their first usage to avoid bitrot.

/** User added a hidden tag to a friend. */
export const trackHiddenTagAdded = (tagType: 'time' | 'location' | 'frequent' | 'text') =>
  posthog.capture('hidden_tag_added', { tag_type: tagType });

/** User opened a friend's detail page. */
export const trackFriendDetailViewed = () =>
  posthog.capture('friend_detail_viewed');

/** User applied the tag filter on ConnectionsScreen. */
export const trackTagFilterApplied = (tagName: string) =>
  posthog.capture('tag_filter_applied', { tag_name: tagName });

/** User shared an invite code. */
export const trackInviteShared = () =>
  posthog.capture('invite_shared');

/** User redeemed an invite code. */
export const trackInviteRedeemed = (code: string) =>
  posthog.capture('invite_redeemed', { code });
