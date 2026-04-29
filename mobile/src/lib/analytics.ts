import { Platform } from 'react-native';
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

/** User completed signup via the chosen auth method. */
export const trackSignupComplete = (props: { method: 'apple' | 'google' | 'email' }) =>
  posthog?.capture('signup_complete', props);

/** User completed login via the chosen auth method. */
export const trackLoginComplete = (props: { method: 'apple' | 'google' | 'email' }) =>
  posthog?.capture('login_complete', props);

/** User scanned a QR code. */
export const trackQrScanned = (props: { type: 'invite' | 'profile' | 'unknown' }) =>
  posthog?.capture('qr_scanned', props);

/** User successfully added a friend connection. */
export const trackFriendAdded = (props: { source: 'qr' | 'search' | 'contact' | 'invite' }) =>
  posthog?.capture('friend_added', props);

/** User sent a chat message. */
export const trackMessageSent = () => posthog?.capture('message_sent');

/** User posted an Ask. */
export const trackAskPosted = () => posthog?.capture('ask_posted');

/**
 * Screen-view auto-capture. Called from the NavigationContainer state
 * listener in App.tsx so we get one event per route change. Wrapped in
 * try/catch because PostHog can throw if not yet initialized, and we
 * never want analytics to crash navigation. Respects opt-out
 * automatically — posthog.screen() honors the same flag as capture().
 */
export const trackScreen = (name: string, params?: Record<string, unknown>) => {
  try {
    // PostHog's screen() expects PostHogEventProperties (a JsonType
    // map). Route params come from React Navigation typed as
    // `object | undefined` — at runtime they're JSON-serializable
    // (route params must be to support state persistence/deep links),
    // so the cast is safe.
    posthog.screen(name, params as Record<string, never> | undefined);
  } catch {
    // Swallow — analytics must never break navigation.
  }
};

// ── Privacy / opt-out controls ──
//
// Toggles PostHog capture on or off. Persisted by SettingsScreen via
// AsyncStorage; this helper just flips the runtime state so events
// stop being sent immediately when the user opts out.
export const setAnalyticsOptIn = (optedIn: boolean): void => {
  if (optedIn) {
    posthog.optIn();
  } else {
    posthog.optOut();
  }
};

// Lazily initializes PostHog after first sign-in. On iOS, also requests
// App Tracking Transparency permission. If the user denies tracking,
// PostHog is opted out so no events are captured. No-ops on Android
// (no ATT) and on web. Safe to call multiple times.
let analyticsInitialized = false;
export const initAnalytics = async (): Promise<void> => {
  if (analyticsInitialized) return;
  analyticsInitialized = true;

  try {
    if (Platform.OS === 'ios') {
      const mod = await import('expo-tracking-transparency');
      const { status } = await mod.requestTrackingPermissionsAsync();
      if (status !== 'granted') {
        posthog.optOut();
        return;
      }
    }
    posthog.optIn();
  } catch {
    // expo-tracking-transparency might not be linked on first install.
    // Fail open and let the user toggle in Settings.
  }
};
