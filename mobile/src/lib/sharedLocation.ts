// sharedLocation.ts
//
// Keeps a location-sharing user's coordinates FRESH so they don't drop
// off the friends map after the 24h `isLocationFresh` staleness gate
// (FriendsMapModal). The Settings toggle writes coords once at opt-in
// time, but with no refresh a user vanishes from friends' maps a day
// later. This is the low-cost "refresh on app open / foreground" fix
// (2026-06-05) — a real background-location task is the heavier
// alternative we deliberately skipped.
//
// Guardrails:
//   • Only runs when the user has share_location = true (opted in).
//   • NEVER prompts for permission — only refreshes if location
//     permission is ALREADY granted (getForegroundPermissionsAsync).
//     If the user revoked it in OS settings, we silently skip.
//   • Throttled: skips if coords were written within REFRESH_THROTTLE_MS,
//     so frequent foregrounding doesn't hammer GPS / the DB.
//   • Fully best-effort — any failure is swallowed.

import { getForegroundPermissionsAsync, getCurrentPositionAsync, Accuracy } from 'expo-location';
import { supabase } from './supabase';

// Refresh at most this often. 1h keeps coords well inside the map's 24h
// freshness window while a user who opens the app daily stays visible.
const REFRESH_THROTTLE_MS = 60 * 60 * 1000;

let inFlight = false;

export async function refreshSharedLocationIfNeeded(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from('piktag_profiles')
      .select('share_location, location_updated_at')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.share_location) return; // not sharing → nothing to do

    // Throttle: skip if we refreshed recently enough.
    if (profile.location_updated_at) {
      const age = Date.now() - new Date(profile.location_updated_at).getTime();
      if (age >= 0 && age < REFRESH_THROTTLE_MS) return;
    }

    // Only refresh if permission is ALREADY granted — never prompt here.
    const { status } = await getForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const pos = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
    await supabase
      .from('piktag_profiles')
      .update({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        location_updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);
  } catch {
    // best-effort; silent
  } finally {
    inFlight = false;
  }
}
