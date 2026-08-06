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
  // ── Offline surfaces, round 2 (founder 2026-08-06: 通知 / 搜尋 /
  //    聊天歷史 / QR must all survive a venue with no signal) ──
  // Inbox conversation list (ChatList).
  CHAT_INBOX: 'chatInbox',
  // Recent messages per conversation, as ONE map under ONE key — see
  // the bounds below. A key-per-conversation scheme would escape
  // clearPersistentCaches(), which iterates exactly this object, and
  // the previous account's DMs would survive a sign-out on a shared
  // device. That is not a tradeoff we are willing to make.
  CHAT_THREADS: 'chatThreads',
  // Popular-tags bootstrap for the Search default surface.
  SEARCH_BOOTSTRAP: 'searchBootstrap',
  // The viewer's OWN scannable QR card (CameraScanScreen show mode).
  MY_QR: 'myQr',
  // The last activity/event QR the viewer generated (AddTagScreen).
  EVENT_QR: 'eventQr',
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

// ── Chat-history bounds ──────────────────────────────────────────────
// Reading past threads offline is worth real disk; the WHOLE archive is
// not. We keep the most recently touched conversations only, and only
// the tail of each one — enough to reopen a thread at a venue and
// remember what was said, nowhere near "sync the account to the phone".
// 20 x 30 x ~200 bytes ≈ 120 KB worst case.
export const CHAT_THREAD_CACHE_MAX_CONVERSATIONS = 20;
export const CHAT_THREAD_CACHE_MAX_MESSAGES = 30;

type ThreadCacheEntry<T> = { updatedAt: number; messages: T[] };
type ThreadCacheMap<T> = Record<string, ThreadCacheEntry<T>>;

/**
 * Recent messages for ONE conversation, out of the single per-user
 * CHAT_THREADS map. Newest-first, exactly as the thread screen holds
 * them.
 */
export async function getPersistentThreadMessages<T>(
  userId: string | null | undefined,
  conversationId: string,
): Promise<T[] | null> {
  if (!userId || !conversationId) return null;
  const map = await getPersistentCache<ThreadCacheMap<T>>(CACHE_KEYS.CHAT_THREADS, userId);
  const entry = map?.[conversationId];
  return Array.isArray(entry?.messages) ? entry.messages : null;
}

/**
 * Write the tail of one conversation, pruning the map back to the N
 * most recently written conversations. Read-modify-write on a single
 * key — the whole point is that sign-out can wipe it in one call.
 */
export async function setPersistentThreadMessages<T>(
  userId: string | null | undefined,
  conversationId: string,
  messages: T[],
): Promise<void> {
  if (!userId || !conversationId) return;
  try {
    const existing =
      (await getPersistentCache<ThreadCacheMap<T>>(CACHE_KEYS.CHAT_THREADS, userId)) ?? {};
    const next: ThreadCacheMap<T> = {
      ...existing,
      [conversationId]: {
        updatedAt: Date.now(),
        messages: messages.slice(0, CHAT_THREAD_CACHE_MAX_MESSAGES),
      },
    };
    const ids = Object.keys(next);
    if (ids.length > CHAT_THREAD_CACHE_MAX_CONVERSATIONS) {
      const keep = ids
        .sort((a, b) => (next[b]?.updatedAt ?? 0) - (next[a]?.updatedAt ?? 0))
        .slice(0, CHAT_THREAD_CACHE_MAX_CONVERSATIONS);
      const pruned: ThreadCacheMap<T> = {};
      for (const id of keep) pruned[id] = next[id];
      await setPersistentCache(CACHE_KEYS.CHAT_THREADS, userId, pruned);
      return;
    }
    await setPersistentCache(CACHE_KEYS.CHAT_THREADS, userId, next);
  } catch {
    // Best-effort, same contract as every other write here.
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
