import { logApiUsage } from './apiUsage';

export const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || 'AIzaSyA7EfF5bYvUSGeNE0T8DAiLR53SpZTTzlY';

export type PlaceResult = {
  name: string;
  address: string;
  placeId: string;
};

/**
 * Fetch nearby places using Google Places Nearby Search (New) API
 */
export async function fetchNearbyPlaces(
  latitude: number,
  longitude: number,
  radiusMeters = 500,
  maxResults = 10,
): Promise<PlaceResult[]> {
  logApiUsage('places_nearby', { radiusMeters, maxResults });
  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const body = {
      includedTypes: ['restaurant', 'cafe', 'bar', 'store', 'shopping_mall', 'gym', 'park', 'museum', 'art_gallery', 'night_club', 'university', 'school', 'library', 'hotel', 'tourist_attraction', 'convention_center', 'event_venue'],
      maxResultCount: maxResults,
      locationRestriction: {
        circle: {
          center: { latitude, longitude },
          radius: radiusMeters,
        },
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.id',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    if (!data.places || data.places.length === 0) return [];

    return data.places.map((p: any) => ({
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      placeId: p.id || '',
    })).filter((p: PlaceResult) => p.name);
  } catch {
    return [];
  }
}

/**
 * Autocomplete place search using Google Places Autocomplete (New) API
 */
export async function autocompletePlaces(
  input: string,
  latitude?: number,
  longitude?: number,
  maxResults = 5,
): Promise<PlaceResult[]> {
  if (!input || input.length < 2) return [];
  logApiUsage('places_autocomplete', { inputLength: input.length, maxResults });

  try {
    const url = 'https://places.googleapis.com/v1/places:autocomplete';
    const body: any = {
      input,
      languageCode: 'zh-TW',
    };

    if (latitude !== undefined && longitude !== undefined) {
      body.locationBias = {
        circle: {
          center: { latitude, longitude },
          radius: 5000,
        },
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    if (!data.suggestions) return [];

    return data.suggestions
      .filter((s: any) => s.placePrediction)
      .slice(0, maxResults)
      .map((s: any) => ({
        name: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text?.text || '',
        address: s.placePrediction.structuredFormat?.secondaryText?.text || '',
        placeId: s.placePrediction.placeId || '',
      }))
      .filter((p: PlaceResult) => p.name);
  } catch {
    return [];
  }
}
