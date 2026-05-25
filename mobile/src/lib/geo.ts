// geo.ts
//
// Tiny geographic helpers. Currently used by SearchScreen's proximity
// boost — when a viewer has shared their location AND a search result
// has too, profiles within ~50 km bubble to the front of the result
// list. Centralized here so future surfaces (Map, Connections sort,
// Tag detail "nearby") can share the same distance math.

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two (lat, lng) points, in kilometers.
 * Haversine formula — accurate to ~0.5% for the distances we care
 * about (city-scale up to a few thousand km). Order-independent.
 *
 * Returns Infinity if any coordinate is null/undefined — callers can
 * treat that as "unknown distance" without branching.
 */
export function haversineKm(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined,
): number {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return Number.POSITIVE_INFINITY;
  }
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
