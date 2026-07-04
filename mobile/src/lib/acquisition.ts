// acquisition.ts
//
// Lightweight, NO-SDK signup-source attribution. The founder chose the
// no-SDK route (no Branch / AppsFlyer) — so this derives the acquisition
// source from the URL the app was cold-launched with (a QR-scan deep
// link, a pikt.ag/{username} profile link, or a utm-tagged URL) and
// falls back to the app-store platform when there's no launch URL.
//
// The contract (matches the DB migration that added the columns):
//   signup_source vocabulary:
//     'qr'           — launch deep link carried a `sid` (a QR scan session)
//     'web_profile'  — launch deep link carried a `username` but no sid
//     'utm:<source>' — launch URL had a `utm_source` query param (lowercased)
//     'app_store'    — none of the above AND iOS
//     'play_store'   — none of the above AND Android
//   signup_campaign: utm_campaign (only when a utm_source was present)
//
// FIRST-TOUCH: the two AsyncStorage keys are written exactly once (never
// overwritten), so a later launch with a different URL can't rewrite the
// original acquisition source. Everything here is best-effort — a failure
// to attribute must NEVER surface to the user or block launch.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// First-touch AsyncStorage keys — written once, never overwritten.
const ACQ_SOURCE_KEY = 'piktag_acq_source';
const ACQ_CAMPAIGN_KEY = 'piktag_acq_campaign';

// Platform-based store fallback — the source when no launch URL carried
// any attribution signal. iOS → App Store, Android → Play Store.
function storeFallbackSource(): string {
  return Platform.OS === 'ios' ? 'app_store' : 'play_store';
}

// Derive { source, campaign } from a launch URL per the vocabulary above.
// Reuses the same normalization AppNavigator.parseSidFromUrl uses so the
// `piktag://` scheme and `https://pikt.ag/...` links parse identically.
// Returns null campaign unless a utm_source was present.
function deriveFromUrl(url: string | null): { source: string; campaign: string | null } {
  if (url) {
    try {
      // Same trick as parseSidFromUrl: rewrite the custom scheme to a real
      // https origin so the WHATWG URL parser accepts it and exposes the
      // path + query the same way for both link forms.
      const parsed = new URL(url.replace('piktag://', 'https://piktag.app/'));
      const utmSource = parsed.searchParams.get('utm_source');
      if (utmSource && utmSource.trim()) {
        // utm attribution wins — value lowercased into 'utm:<source>'.
        const campaign = parsed.searchParams.get('utm_campaign');
        return {
          source: `utm:${utmSource.trim().toLowerCase()}`,
          campaign: campaign && campaign.trim() ? campaign.trim() : null,
        };
      }
      const sid = parsed.searchParams.get('sid');
      if (sid) {
        // A QR scan session.
        return { source: 'qr', campaign: null };
      }
      const pathParts = parsed.pathname.replace(/^\//, '').split('/');
      const username = pathParts[0] || undefined;
      if (username) {
        // Arrived via a pikt.ag/{username} profile link, no sid.
        return { source: 'web_profile', campaign: null };
      }
    } catch {
      // Unparsable URL — fall through to the platform store fallback.
    }
  }
  return { source: storeFallbackSource(), campaign: null };
}

// Capture the acquisition source at app launch (fire-and-forget). Reads
// the cold-start URL, derives source + campaign, and stores them ONCE
// (first-touch) — if `piktag_acq_source` is already set we leave both
// values untouched. Best-effort: never throws.
export async function captureAcquisitionSource(): Promise<void> {
  try {
    // Already captured on a prior launch — first-touch means we never
    // overwrite, so bail before reading the URL.
    const existing = await AsyncStorage.getItem(ACQ_SOURCE_KEY);
    if (existing) return;

    // expo-linking (dynamic import mirrors AppNavigator's deep-link
    // capture, which lazy-loads it and short-circuits on web).
    if (Platform.OS === 'web') return;
    const Linking = await import('expo-linking');
    const initialUrl = await Linking.getInitialURL();

    const { source, campaign } = deriveFromUrl(initialUrl);
    await AsyncStorage.setItem(ACQ_SOURCE_KEY, source);
    if (campaign) await AsyncStorage.setItem(ACQ_CAMPAIGN_KEY, campaign);
  } catch (err) {
    if (__DEV__) console.warn('[acquisition] capture failed:', err);
  }
}

// Persist the captured signup source onto the user's profile — ONLY on
// the new-signup path (call from OnboardingScreen, the linear wizard only
// brand-new accounts reach). The `.is('signup_source', null)` guard makes
// this first-touch-only at the DB layer too: a re-run never overwrites an
// existing value, so mis-firing on an existing user is a no-op. Best-
// effort: never throws.
export async function persistSignupSourceIfNew(userId: string): Promise<void> {
  try {
    if (!userId) return;
    // Read the first-touch capture. If none was stored (e.g. capture
    // never ran), default to the platform store so every new signup still
    // gets attributed to SOMETHING.
    const source = (await AsyncStorage.getItem(ACQ_SOURCE_KEY)) || storeFallbackSource();
    const campaign = await AsyncStorage.getItem(ACQ_CAMPAIGN_KEY);
    await supabase
      .from('piktag_profiles')
      .update({ signup_source: source, signup_campaign: campaign })
      .eq('id', userId)
      .is('signup_source', null);
  } catch (err) {
    if (__DEV__) console.warn('[acquisition] persist failed:', err);
  }
}
