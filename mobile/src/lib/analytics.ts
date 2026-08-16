import AsyncStorage from '@react-native-async-storage/async-storage';
import PostHog from 'posthog-react-native';

import { CACHE_KEYS, getPersistentCache, setPersistentCache } from './dataCache';

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

// ── The opt-out gate ─────────────────────────────────────────────────
//
// TWO layers, on purpose, because neither one alone is sufficient:
//
//  1. `optedIn` below, checked by the `capture()` choke point that every
//     helper in this file goes through. This is the layer we control and
//     the one that is true the instant the user flips the Switch — no
//     await, no SDK internals, no trusting a third party with the
//     founder's privacy promise.
//  2. posthog.optOut(), flipped by setAnalyticsOptIn(). This is the ONLY
//     thing that can suppress the SDK's OWN autocapture ($app_opened,
//     app lifecycle, session replay) — events that never pass through
//     any function in this file and which layer 1 therefore cannot see.
//
// Default is opted IN, and that is a deliberate reading of what the code
// already assumed rather than a fresh policy choice: PostHog is
// constructed capturing (no `defaultOptIn: false`), every reader in the
// repo has always used `stored !== 'false'` (i.e. only an explicit
// opt-out counts), and SettingsScreen's local state has always
// initialised to `true`. Rendering the Switch ON while the stored value
// is unset is therefore honest — unset really does mean "sending".
let optedIn = true;

/** What the gate currently says. Exported so UI can render truth, not a guess. */
export const isAnalyticsOptedIn = (): boolean => optedIn;

/**
 * THE choke point. Every helper below goes through it; nothing in this
 * file calls posthog.capture() directly. Wrapped in try/catch for the
 * same reason trackScreen always was — PostHog can throw before it has
 * initialised, and analytics must never take a user flow down with it.
 */
const capture = (event: string, props?: Record<string, unknown>): void => {
  if (!optedIn) return;
  try {
    // PostHog types properties as a JsonType map; every call site here
    // passes string/number literals, so the cast is safe. Same cast the
    // screen() call below has always used.
    posthog.capture(event, props as Record<string, never> | undefined);
  } catch {
    // Swallow — analytics must never break a user flow.
  }
};

// ── Typed event helpers ──
// Each wraps the gated capture() above with a fixed event name so
// callers can't typo the string and analytics stay consistent.
//
// Only helpers that have at least one call site live here. Re-add
// new ones alongside their first usage to avoid bitrot.

/** User added a hidden tag to a friend. */
export const trackHiddenTagAdded = (tagType: 'time' | 'location' | 'frequent' | 'text') =>
  capture('hidden_tag_added', { tag_type: tagType });

/** User opened a friend's detail page. */
export const trackFriendDetailViewed = () =>
  capture('friend_detail_viewed');

/** User applied the tag filter on ConnectionsScreen. */
export const trackTagFilterApplied = (tagName: string) =>
  capture('tag_filter_applied', { tag_name: tagName });

// (trackInviteShared / trackInviteRedeemed removed — the invite-code
// /redeem gate was retired; open signup, no codes.)

/** User completed signup via the chosen auth method. */
export const trackSignupComplete = (props: { method: 'apple' | 'google' | 'email' }) =>
  capture('signup_complete', props);

/** User completed login via the chosen auth method. */
export const trackLoginComplete = (props: { method: 'apple' | 'google' | 'email' }) =>
  capture('login_complete', props);

/** User scanned a QR code. */
export const trackQrScanned = (props: { type: 'invite' | 'profile' | 'unknown' }) =>
  capture('qr_scanned', props);

/** User successfully added a friend connection. 'event_room' = the
 *  attendee↔attendee connect from the 這場的人 list (方向三).
 *  'user_detail' = the plain follow button on the public profile screen
 *  — entry origin isn't carried on route params (search / tag detail /
 *  chat / followers all land there identically), so this is the honest
 *  generic bucket. 'recommendation' = adds originating from a
 *  personalized-recommendation surface (wire it when that surface
 *  passes an explicit origin). */
export const trackFriendAdded = (props: {
  source: 'qr' | 'search' | 'contact' | 'invite' | 'event_room' | 'user_detail' | 'recommendation';
}) =>
  capture('friend_added', props);

/** User sent a chat message. */
export const trackMessageSent = () => capture('message_sent');

/** User posted an Ask. */
export const trackAskPosted = () => capture('ask_posted');

/**
 * Onboarding-wizard funnel (founder 2026-06-29). One event per step
 * COMPLETION: 'profile' | 'tags' | 'links' ('links' fires inside
 * handleComplete — completing step 3 IS completing the wizard). Chain
 * with signup_complete in a PostHog funnel to see per-step drop-off.
 * Predefined trigger (see CLAUDE.md): if the tags→links step loses
 * >30% of users, relax the ≥3-links gate to ≥1.
 */
export const trackWizardStepCompleted = (step: 'profile' | 'tags' | 'links') =>
  capture('wizard_step_completed', { step });

/**
 * Burst batch-tag prompt (event-tag rework 方向一, 2026-07-03): shown when
 * the last hour's connection adds hit the burst threshold. `shown` count =
 * cohort size; `applied` fires on save with how many were kept selected.
 * These two are THE success metric for the rework — if shown≫applied the
 * prompt is noise; if applied tracks shown the safety-net thesis holds.
 */
export const trackBurstTagPromptShown = (cohortSize: number) =>
  capture('burst_tag_prompt_shown', { cohort_size: cohortSize });
export const trackBurstTagApplied = (cohortSize: number, taggedCount: number) =>
  capture('burst_tag_applied', { cohort_size: cohortSize, tagged_count: taggedCount });

/** Import quick-sort (backlog #1, 2026-07-04): one bucket saved from the
 *  ContactSync batch flow. Count only — tag names are user content. */
export const trackImportBatchTagged = (taggedCount: number) =>
  capture('import_batch_tagged', { tagged_count: taggedCount });

/**
 * Card-scan perceived latency: shutter tap → form fields visible
 * (founder speed red line — competitors anchored users to "instant").
 * Watch p50/p95 in PostHog; p95 is the "mistaken for a broken app" tail.
 */
export const trackCardScanLatency = (durationMs: number) =>
  capture('card_scan_latency', { duration_ms: Math.round(durationMs) });

/**
 * Screen-view auto-capture. Called from the NavigationContainer state
 * listener in App.tsx so we get one event per route change. Checks the
 * gate FIRST and explicitly — screen() is a separate SDK entry point
 * from capture(), so the choke point above does not cover it and a
 * comment claiming it "respects opt-out automatically" is exactly the
 * kind of thing that turns out to be false at the worst moment.
 */
export const trackScreen = (name: string, params?: Record<string, unknown>) => {
  if (!optedIn) return;
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

/**
 * Bind subsequent events to this account. A THIRD SDK entry point
 * (identify(), not capture() or screen()), and the one that carries the
 * user's email — so it gets the gate too. AppNavigator used to call
 * `posthog.identify()` on the raw client, which would have sailed
 * straight past every check in this file.
 */
export const identifyUser = (userId: string, props?: Record<string, unknown>): void => {
  if (!optedIn) return;
  try {
    posthog.identify(userId, props as Record<string, never> | undefined);
  } catch {
    // Swallow — analytics must never break the auth flow.
  }
};

// ── Privacy / opt-out controls ────────────────────────────────────────
//
// Flip BOTH layers of the gate described at the top of this file. Purely
// in-memory and synchronous, so the moment the user releases the Switch
// the next capture() is already blocked — persistence happens separately
// and must never be what the user's privacy waits on.
export const setAnalyticsOptIn = (nextOptedIn: boolean): void => {
  optedIn = nextOptedIn;
  try {
    if (nextOptedIn) {
      posthog.optIn();
    } else {
      posthog.optOut();
    }
  } catch {
    // Layer 1 (the `optedIn` flag above) has already taken effect, which
    // is the layer that governs everything this app sends deliberately.
  }
};

/**
 * Device-level MIRROR of the last applied choice.
 *
 * Not the source of truth — CACHE_KEYS.ANALYTICS_OPT_IN below is, and it
 * is per-account. This exists for exactly one reason: on a cold start
 * PostHog begins capturing at module load, and the authoritative
 * per-account value cannot be read until Supabase has resolved a session
 * and told us the user id, which is hundreds of milliseconds later. That
 * window is enough for app-lifecycle autocapture and the first
 * trackScreen. So App.tsx reads THIS at boot to get the gate right from
 * the first tick, and AuthContext overwrites it with the per-account
 * answer as soon as there is an account to answer for.
 *
 * It holds a preference, never user content, and sign-out deletes it
 * anyway (AuthContext.signOut) so it cannot carry user A's choice into
 * user B's session on a shared phone.
 */
export const ANALYTICS_OPT_IN_KEY = 'analytics_opt_in';

/** Storage encoding, in one place so reader and writer cannot drift. */
const OPT_OUT_VALUE = 'false';
const OPT_IN_VALUE = 'true';

/**
 * Boot path. Applies the device mirror before anything can be captured.
 * Called once from App.tsx at module scope, as early as possible.
 *
 * Default is opted IN: only an explicit 'false' counts as an opt-out,
 * matching what the PostHog client, this module and SettingsScreen have
 * all assumed since day one.
 */
export const applyStoredAnalyticsOptIn = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(ANALYTICS_OPT_IN_KEY);
    setAnalyticsOptIn(stored !== OPT_OUT_VALUE);
  } catch {
    // Best-effort: a read failure leaves the gate at its default.
  }
};

/**
 * Account path, and the authoritative one. Reads the per-account value
 * out of the same namespaced store every other cache uses
 * (`piktag_cache_v1:analyticsOptIn:<uid>`), so it is swept by
 * clearPersistentCaches() on sign-out along with everything else and
 * cannot leak between accounts on a shared device. Called from
 * AuthContext the moment a session resolves.
 *
 * An account that has never chosen is opted IN — the same default as the
 * boot path, so the Switch and the wire agree on first launch.
 */
export const applyAccountAnalyticsOptIn = async (
  userId: string | null | undefined,
): Promise<void> => {
  if (!userId) return;
  const stored = await getPersistentCache<boolean>(CACHE_KEYS.ANALYTICS_OPT_IN, userId);
  const next = stored !== false;
  setAnalyticsOptIn(next);
  // Keep the boot mirror in step, so the NEXT cold start is correct
  // before the session resolves.
  try {
    await AsyncStorage.setItem(ANALYTICS_OPT_IN_KEY, next ? OPT_IN_VALUE : OPT_OUT_VALUE);
  } catch {
    // Best-effort; the per-account value above is what actually decides.
  }
};

/**
 * Record a choice the user just made: runtime gate first (instant), then
 * both stores. Awaiting the writes is safe for the caller precisely
 * because the gate is already flipped before the first await.
 */
export const persistAnalyticsOptIn = async (
  userId: string | null | undefined,
  nextOptedIn: boolean,
): Promise<void> => {
  setAnalyticsOptIn(nextOptedIn);
  try {
    await AsyncStorage.setItem(
      ANALYTICS_OPT_IN_KEY,
      nextOptedIn ? OPT_IN_VALUE : OPT_OUT_VALUE,
    );
  } catch {
    // best-effort
  }
  // No-ops when signed out, by setPersistentCache's own contract.
  await setPersistentCache(CACHE_KEYS.ANALYTICS_OPT_IN, userId, nextOptedIn);
};

/**
 * Sign-out. Drop the device mirror (the per-account copy is handled by
 * clearPersistentCaches, which reaches it because it is a member of
 * CACHE_KEYS) and return the gate to its default, so the signed-out shell
 * and any next account start from "opted in" rather than inheriting the
 * previous user's choice in either direction.
 *
 * Also resets PostHog's own distinct_id so the next account does not
 * inherit the outgoing one's identity.
 */
export const resetAnalyticsOptInOnSignOut = async (): Promise<void> => {
  setAnalyticsOptIn(true);
  try {
    posthog.reset();
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(ANALYTICS_OPT_IN_KEY);
  } catch {
    // best-effort
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
