import AsyncStorage from '@react-native-async-storage/async-storage';

export const CACHE_KEYS = {
  NOTIFICATIONS: 'notifications',
  CONNECTIONS: 'connections',
  PROFILE: 'profile',
  // The auth-level profile row (AuthContext). Deliberately a SEPARATE key
  // from PROFILE: ProfileScreen stores a wider 5-field snapshot under
  // PROFILE, and mixing the two shapes under one key is how you get an
  // `undefined.length` crash on a cache hit.
  AUTH_PROFILE: 'authProfile',
} as const;

const DEFAULT_TTL_MS = 300_000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function setCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function getCache<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function invalidateCache(key: string): void {
  cache.delete(key);
}

// ─────────────────────────────────────────────────────────────────────
// Persistent (disk) layer — survives a cold start, which the in-memory
// Map above does not.
//
// Why: at an exhibition the network is weak or absent, and a cold start
// with an empty in-memory cache used to mean a blank profile and a QR
// code built from an empty username. Persisting the same snapshots the
// screens already build lets those surfaces paint from disk offline.
//
// DELIBERATELY NO TTL. This is the offline fallback of last resort:
// stale content beats a blank screen at a venue, and every reader here
// also fires a live refetch that overwrites it the moment the network
// answers. Freshness is the fetch's job, not the cache's.
//
// Every entry is namespaced by user id — this repo has already been bitten
// once by a device-global flag leaking between accounts on the same phone
// (the onboarding-completion bug), so nothing cached goes in unscoped.
// ─────────────────────────────────────────────────────────────────────

const PERSIST_PREFIX = 'piktag_cache_v1';

const persistKey = (key: string, userId: string) => `${PERSIST_PREFIX}:${key}:${userId}`;

export async function setPersistentCache<T>(
  key: string,
  userId: string | null | undefined,
  data: T,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(persistKey(key, userId), JSON.stringify({ data }));
  } catch {
    // Caching is best-effort — a write failure must never break a screen.
  }
}

export async function getPersistentCache<T>(
  key: string,
  userId: string | null | undefined,
): Promise<T | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(persistKey(key, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: T } | null;
    return (parsed?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * Drop every persisted snapshot for one account. Called on explicit
 * sign-out so a shared device doesn't show the previous user's cached
 * profile or friend list.
 */
export async function clearPersistentCaches(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.multiRemove(
      Object.values(CACHE_KEYS).map((key) => persistKey(key, userId)),
    );
  } catch {
    // best-effort
  }
}
