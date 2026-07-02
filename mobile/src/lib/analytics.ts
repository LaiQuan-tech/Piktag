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

// (trackInviteShared / trackInviteRedeemed removed — the invite-code
// /redeem gate was retired; open signup, no codes.)

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
 * Onboarding-wizard funnel (founder 2026-06-29). One event per step
 * COMPLETION: 'profile' | 'tags' | 'links' ('links' fires inside
 * handleComplete — completing step 3 IS completing the wizard). Chain
 * with signup_complete in a PostHog funnel to see per-step drop-off.
 * Predefined trigger (see CLAUDE.md): if the tags→links step loses
 * >30% of users, relax the ≥3-links gate to ≥1.
 */
export const trackWizardStepCompleted = (step: 'profile' | 'tags' | 'links') =>
  posthog?.capture('wizard_step_completed', { step });

/**
 * Card-scan perceived latency: shutter tap → form fields visible
 * (founder speed red line — competitors anchored users to "instant").
 * Watch p50/p95 in PostHog; p95 is the "mistaken for a broken app" tail.
 */
export const trackCardScanLatency = (durationMs: number) =>
  posthog?.capture('card_scan_latency', { duration_ms: Math.round(durationMs) });

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

// initAnalytics() used to gate PostHog behind iOS ATT
// (App Tracking Transparency). Removed 2026-05-26 because the
// gate was dead code — no caller ever invoked it — yet the
// matching NSUserTrackingUsageDescription string still sat in
// Info.plist. Apple Review 5.1.2(i) flagged this exact mismatch:
// "the app does not use App Tracking Transparency to request
// the user's permission before tracking their activity" while
// the privacy declaration claimed tracking. PikTag doesn't
// actually track users across apps/sites — PostHog uses an
// anonymous device-scoped distinct_id, NOT IDFA — so the correct
// fix is to drop the ATT path entirely AND scrub the plist
// string + privacy declaration. PostHog initializes itself at
// module load (see new PostHog() above) and respects
// setAnalyticsOptIn() flipped from SettingsScreen.
