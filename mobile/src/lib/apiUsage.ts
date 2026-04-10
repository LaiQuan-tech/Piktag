// Lightweight client-side logger for billable third-party API calls.
//
// Every call is fire-and-forget: we never `await` the insert, never
// throw on failure, and never show the user an error if the log
// write fails. The whole point is that a broken logger must not
// degrade the product experience. At worst we lose a data point
// and the cost-trend chart in Supabase Studio is a little jittery.
//
// Usage:
//   import { logApiUsage, ApiType } from '../lib/apiUsage';
//   logApiUsage('maps_js_map_load');
//   logApiUsage('places_autocomplete', { queryLength: q.length });

import { supabase } from './supabase';

export type ApiType =
  // Google Maps Platform SKUs
  | 'maps_js_map_load'        // new google.maps.Map() inside FriendsMapModal
  | 'places_autocomplete'     // fetchAutocompletePlaces
  | 'places_nearby'           // fetchNearbyPlaces
  | 'geocoding'               // reverse geocode lat/lng → address
  // Gemini
  | 'gemini_generate';        // ManageTagsScreen AI tag suggestions

// In-memory rate limit to avoid spamming the log if something (e.g.
// a StrictMode double-render in dev, or a retry loop) re-fires the
// same event many times in a row. Each api_type can be logged at
// most once every MIN_INTERVAL_MS per process.
const MIN_INTERVAL_MS = 500;
const lastLoggedAt = new Map<ApiType, number>();

/**
 * Record one billable API call to piktag_api_usage_log.
 *
 * Returns nothing and never throws. Safe to call from render paths,
 * useEffects, event handlers — anywhere. The insert runs on the
 * Supabase network thread and is not awaited.
 */
export function logApiUsage(apiType: ApiType, metadata?: Record<string, unknown>): void {
  try {
    const now = Date.now();
    const last = lastLoggedAt.get(apiType) ?? 0;
    if (now - last < MIN_INTERVAL_MS) return;
    lastLoggedAt.set(apiType, now);

    // Fire-and-forget: grab the current user id, then insert.
    // Both promises swallow every error so the logger can never
    // crash a render path or an event handler.
    supabase.auth
      .getUser()
      .then(({ data }) => {
        const uid = data?.user?.id ?? null;
        supabase
          .from('piktag_api_usage_log')
          .insert({
            user_id: uid,
            api_type: apiType,
            metadata: metadata ?? null,
          })
          .then(() => {}, () => {});
      })
      .catch(() => {});
  } catch {
    // Never let the logger crash anything.
  }
}
