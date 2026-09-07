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
  // ── Offline surfaces, round 3 (2026-08-07) ──
  // The groups the viewer HOSTS (QrGroupListScreen, main list).
  QR_GROUPS: 'qrGroups',
  // The sessions the viewer ATTENDED (同一畫面的「我參加的」段落).
  // A separate key from QR_GROUPS on purpose: the two come from
  // independent queries with independent failure modes, so a failed
  // attended fetch must not be able to touch the host list's snapshot
  // (and vice versa).
  QR_ATTENDED: 'qrAttended',
  // Per-group QR detail snapshots (QrGroupDetailScreen), as ONE map
  // under ONE key — same contract as CHAT_THREADS above, for the same
  // reason: a key-per-group scheme escapes clearPersistentCaches(),
  // which iterates exactly this object, and the previous host's event
  // QR + event tags would survive a sign-out on a shared phone. That is
  // precisely the leak `piktag_last_qr` had.
  QR_GROUP_DETAILS: 'qrGroupDetails',
  // The last couple of event locations the viewer picked. Was the
  // device-global `piktag_recent_locations` key until 2026-08-07 — on a
  // shared phone user A's venues showed up in user B's picker.
  RECENT_LOCATIONS: 'recentLocations',
  // The viewer's saved event-tag presets (AddTagScreen 常用組合).
  // Was the device-global `piktag_user_presets` key until 2026-08-07,
  // and the worst of the three device-global leaks: the local-first
  // merge in loadPresets APPENDED every preset that wasn't in the DB
  // answer, so signing in as B re-wrote A's presets (name, location,
  // tags, user_id) back to the shared key and offered them for B to
  // apply onto B's own QR. Per-user now, therefore swept on sign-out.
  TAG_PRESETS: 'tagPresets',
  // ── 2026-08-08 ──
  // Direct messages composed offline and not yet accepted by the server
  // (lib/chatSendQueue). Was the device-global `piktag_chat_send_queue_v1`
  // key, and the last one holding user data: it stored the full plaintext
  // BODY of every unsent DM, and sign-out never touched it, so on a shared
  // phone A's unsent message text stayed on disk after A logged out. The
  // flush path already refused to send another account's entries
  // (`sender_id === userId`, useChatThread.flushQueue) — the defect was the
  // residue, not delivery. Per-user now, therefore swept on sign-out.
  // ONE key holding the whole queue, never one key per conversation: a
  // per-conversation scheme escapes clearPersistentCaches(), which iterates
  // exactly this object.
  CHAT_SEND_QUEUE: 'chatSendQueue',
  // ── 2026-08-08, round 2: the device-global keys that were still out
  //    there after the chat-send-queue migration ──────────────────────
  // The commit that moved CHAT_SEND_QUEUE here called it "the last of
  // the four" device-global keys holding user data. That was wrong, and
  // believing it is worse than the leak: four more were still live.
  //
  // The viewer's recent search queries (SearchScreen). Was the
  // device-global `piktag_recent_searches`, and the worst of the
  // remaining four by a distance: it stores the literal NAMES and
  // COMPANIES a user typed, up to ten of them, and sign-out never
  // touched it. On a shared phone user B opened Search and read user A's
  // last ten searches.
  RECENT_SEARCHES: 'recentSearches',
  // Scanned business cards / not-yet-registered contacts
  // (useLocalContacts). New cache rather than a migration: these rows
  // had no snapshot at all, so every card scanned at an event vanished
  // from the offline friends list with no explanation.
  LOCAL_CONTACTS: 'localContacts',
  // Which Asks this viewer has already opened (AskStoryRow). Was the
  // device-global `piktag_viewed_ask_ids`, so A's read state greyed out
  // B's unread Asks.
  VIEWED_ASKS: 'viewedAsks',
  // The connection id of the last post-event burst we offered to batch
  // tag (lib/burstTag). Was `piktag_burst_tag_prompted_v1` and held one
  // of A's piktag_connections ids.
  BURST_TAG_PROMPT: 'burstTagPrompt',
  // Cached AI tag suggestions (ManageTagsScreen). Already per-user by
  // name (`piktag_ai_tags_<uid>`) but under its own prefix, so
  // clearPersistentCaches — which iterates exactly this object — never
  // reached it and a deleted account's suggestions stayed on disk.
  AI_TAG_SUGGESTIONS: 'aiTagSuggestions',
  // ── 2026-08-08, round 3 (founder, on a real device with no signal:
  //    「好友清單可以看到，點進去可以看到好友名稱，但沒有社交連結、標籤」) ──
  // Per-friend detail snapshots (FriendDetailScreen): the friend's
  // SOCIAL LINKS above all, plus the tag row as that screen actually
  // renders it. CACHE_KEYS.CONNECTIONS carries the header (name,
  // avatar, nickname) and the viewer's own tag NAMES, but it has never
  // carried biolinks at all — so a friend the viewer had opened online
  // still lost their whole link section the moment the signal went.
  // ONE map under ONE key, never one key per friend — same contract as
  // CHAT_THREADS / QR_GROUP_DETAILS above, for the same reason: a
  // key-per-friend scheme escapes clearPersistentCaches(), which
  // iterates exactly this object, and the previous account's friends'
  // links would survive a sign-out on a shared phone.
  FRIEND_DETAILS: 'friendDetails',
  // ── 2026-08-17 ──
  // Whether this account sends product analytics (lib/analytics, the
  // Settings switch). Not a cache — a preference — and it lives here
  // anyway, for the one property this object confers: membership in the
  // set clearPersistentCaches() iterates. A privacy choice stored under
  // its own device-global key is precisely the shape of the leak this
  // file has documented five times over: on a shared phone user A's
  // opt-out would silently govern user B, or worse, A's opt-out would be
  // forgotten and A would be tracked again under B's session. Per-user,
  // therefore swept on sign-out. The device-global ANALYTICS_OPT_IN_KEY
  // that lib/analytics still keeps is a boot-time MIRROR of this value,
  // not a second source of truth, and sign-out deletes it explicitly.
  ANALYTICS_OPT_IN: 'analyticsOptIn',
} as const;

const DEFAULT_TTL_MS = 300_000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// ── Which account does the in-memory Map belong to? ──────────────────
// The disk layer below namespaces every key by user id. This Map does
// NOT, and deliberately so: threading a user id through every
// setCache/getCache call site would work right up until the one call
// site that forgot, and that one would be the cross-account leak.
//
// Instead the whole Map has a single OWNER, and changing the owner
// drops everything. Two properties that a "invalidate the keys we know
// about on sign-out" approach cannot give us:
//
//  1. It cannot miss a key. An enumerated list rots — SearchScreen
//     already caches popular tags under a screen-local key that is not
//     in CACHE_KEYS at all, so any sign-out routine built from
//     Object.values(CACHE_KEYS) would have been incomplete from the day
//     it was written. `cache.clear()` has nothing to enumerate.
//  2. It cannot be bypassed. It hangs off the single funnel every
//     account change already passes through (AuthContext.applySession),
//     so it fires on sign-in too — B signing in on A's device wipes the
//     Map even if some future code path signs A out without telling us.
//
// TTL is irrelevant to this: the 5-minute default means a stale entry
// is happily served to the NEXT account inside that window, which is
// exactly the bug. Ownership, not expiry, is what separates accounts.
let cacheOwnerId: string | null = null;

/**
 * Declare which user the in-memory cache currently belongs to. Any
 * change (including to/from null on sign-out) empties it. Idempotent —
 * re-asserting the same owner is free, so this is safe to call on every
 * auth event, which is precisely how it is meant to be used.
 */
export function setCacheOwner(userId: string | null | undefined): void {
  const nextOwner = userId ?? null;
  if (nextOwner === cacheOwnerId) return;
  cacheOwnerId = nextOwner;
  cache.clear();
}

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

// ── QR group (event tag) detail bounds ───────────────────────────────
// A host needs their group QR on screen at a venue with no signal, so
// the detail snapshot is worth disk. The whole history of every group
// they ever made is not. 12 = the most recently OPENED groups: a host
// runs a handful of live events at a time, and the ones they need to
// present are by definition the ones they just opened. Worst case is
// roughly 12 x (one URL + a few tags + <=50 members) ≈ 150 KB, the same
// order as the chat cache above.
export const QR_GROUP_DETAIL_CACHE_MAX_GROUPS = 12;

type QrGroupDetailEntry<T> = { updatedAt: number; snapshot: T };
type QrGroupDetailMap<T> = Record<string, QrGroupDetailEntry<T>>;

/** One group's detail snapshot out of the single per-user map. */
export async function getPersistentQrGroupDetail<T>(
  userId: string | null | undefined,
  groupId: string | null | undefined,
): Promise<T | null> {
  if (!userId || !groupId) return null;
  const map = await getPersistentCache<QrGroupDetailMap<T>>(
    CACHE_KEYS.QR_GROUP_DETAILS,
    userId,
  );
  return (map?.[groupId]?.snapshot ?? null) as T | null;
}

/**
 * Write one group's snapshot, pruning the map back to the N most
 * recently written groups. Read-modify-write on a single key — the
 * whole point is that sign-out wipes it in one call.
 */
export async function setPersistentQrGroupDetail<T>(
  userId: string | null | undefined,
  groupId: string | null | undefined,
  snapshot: T,
): Promise<void> {
  if (!userId || !groupId) return;
  try {
    const existing =
      (await getPersistentCache<QrGroupDetailMap<T>>(
        CACHE_KEYS.QR_GROUP_DETAILS,
        userId,
      )) ?? {};
    const next: QrGroupDetailMap<T> = {
      ...existing,
      [groupId]: { updatedAt: Date.now(), snapshot },
    };
    const ids = Object.keys(next);
    if (ids.length > QR_GROUP_DETAIL_CACHE_MAX_GROUPS) {
      const keep = ids
        .sort((a, b) => (next[b]?.updatedAt ?? 0) - (next[a]?.updatedAt ?? 0))
        .slice(0, QR_GROUP_DETAIL_CACHE_MAX_GROUPS);
      const pruned: QrGroupDetailMap<T> = {};
      for (const id of keep) pruned[id] = next[id];
      await setPersistentCache(CACHE_KEYS.QR_GROUP_DETAILS, userId, pruned);
      return;
    }
    await setPersistentCache(CACHE_KEYS.QR_GROUP_DETAILS, userId, next);
  } catch {
    // Best-effort, same contract as every other write here.
  }
}

/**
 * Forget one group entirely. Called when the server says the row is
 * gone (deleted, or no longer ours) — WITHOUT that, a deleted group
 * would keep presenting a dead QR the next time the phone is offline.
 * Never call this on a transport failure; "I couldn't ask" is not
 * "it's gone".
 */
export async function dropPersistentQrGroupDetail(
  userId: string | null | undefined,
  groupId: string | null | undefined,
): Promise<void> {
  if (!userId || !groupId) return;
  try {
    const existing = await getPersistentCache<QrGroupDetailMap<unknown>>(
      CACHE_KEYS.QR_GROUP_DETAILS,
      userId,
    );
    if (!existing || !(groupId in existing)) return;
    const next: QrGroupDetailMap<unknown> = { ...existing };
    delete next[groupId];
    await setPersistentCache(CACHE_KEYS.QR_GROUP_DETAILS, userId, next);
  } catch {
    // best-effort
  }
}

// ── Friend detail bounds ─────────────────────────────────────────────
// Was 30 = "the most recently OPENED friends", on the reasoning that the
// ones you need offline are the ones you just looked at. Founder, on a
// device, 2026-09-03: 目前要曾經查看過該好友才會看到個人檔案，如果在有網路
// 的時候沒有查看過，就會還是看不到內容. That reasoning was backwards for the
// case this app exists for — you are at a venue, with no signal, trying to
// recall someone you have NEVER opened. "Visit them first, online" is not
// something a user can be expected to have done.
//
// So the friends list now warms this map for everyone in it
// (lib/warmFriendDetails.ts) and the bound has to hold the whole list
// rather than a recent window. 200 friends x 12 links is roughly 200 KB
// worst case — the same order as the chat cache, for the section the
// founder has now asked for twice.
//
// The per-friend arrays stay capped because the bound has to hold against
// the pathological account, not the average one: a friend can carry up to
// 100 public tags (the live query's own limit) and an unbounded number of
// links.
export const FRIEND_DETAIL_CACHE_MAX_FRIENDS = 200;
export const FRIEND_DETAIL_CACHE_MAX_LINKS = 12;
export const FRIEND_DETAIL_CACHE_MAX_TAGS = 40;

type FriendDetailEntry<T> = { updatedAt: number; snapshot: T };
type FriendDetailMap<T> = Record<string, FriendDetailEntry<T>>;

// A STRICTLY increasing stamp, because the eviction below is only as
// good as its ordering. Date.now() has millisecond resolution, so two
// writes in the same tick tie; Array.sort is stable, ties therefore
// resolve to insertion order — i.e. OLDEST first — and the pruner then
// evicts the most recent writes and keeps the stale ones, the exact
// inverse of what a most-recently-viewed bound is for. Verified against
// the real helper: filling the map in a loop dropped the newest entries.
// Resetting to 0 on a cold start is harmless: the next Date.now() is
// larger than every stamp already on disk.
let lastFriendDetailStamp = 0;
function friendDetailStamp(): number {
  const now = Date.now();
  lastFriendDetailStamp = now > lastFriendDetailStamp ? now : lastFriendDetailStamp + 1;
  return lastFriendDetailStamp;
}

/** One friend's detail snapshot out of the single per-user map. */
export async function getPersistentFriendDetail<T>(
  userId: string | null | undefined,
  friendId: string | null | undefined,
): Promise<T | null> {
  if (!userId || !friendId) return null;
  const map = await getPersistentCache<FriendDetailMap<T>>(
    CACHE_KEYS.FRIEND_DETAILS,
    userId,
  );
  return (map?.[friendId]?.snapshot ?? null) as T | null;
}

/**
 * MERGE a patch into one friend's snapshot, pruning the map back to the N
 * most recently written friends.
 *
 * Merge, not replace, and that is the whole point of the signature: this
 * screen's fields come from a handful of INDEPENDENT queries, and
 * supabase-js resolves a transport failure as `{data: null, error}`
 * rather than throwing. The caller passes only the fields whose query
 * actually answered, so a half-answered load tops up what it learned and
 * leaves every other field of the previous good snapshot untouched —
 * instead of writing a fabricated "this friend has no links" over the
 * links the viewer saw an hour ago.
 *
 * Keys explicitly set to `undefined` are dropped rather than merged, so a
 * caller cannot erase a field by accident.
 */
export async function mergePersistentFriendDetail<T extends object>(
  userId: string | null | undefined,
  friendId: string | null | undefined,
  patch: Partial<T>,
): Promise<void> {
  if (!userId || !friendId) return;
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
  if (Object.keys(defined).length === 0) return;
  try {
    const existing =
      (await getPersistentCache<FriendDetailMap<T>>(CACHE_KEYS.FRIEND_DETAILS, userId)) ?? {};
    const next: FriendDetailMap<T> = {
      ...existing,
      [friendId]: {
        updatedAt: friendDetailStamp(),
        snapshot: { ...(existing[friendId]?.snapshot ?? {}), ...defined } as T,
      },
    };
    const ids = Object.keys(next);
    if (ids.length > FRIEND_DETAIL_CACHE_MAX_FRIENDS) {
      const keep = ids
        .sort((a, b) => (next[b]?.updatedAt ?? 0) - (next[a]?.updatedAt ?? 0))
        .slice(0, FRIEND_DETAIL_CACHE_MAX_FRIENDS);
      const pruned: FriendDetailMap<T> = {};
      for (const id of keep) pruned[id] = next[id];
      await setPersistentCache(CACHE_KEYS.FRIEND_DETAILS, userId, pruned);
      return;
    }
    await setPersistentCache(CACHE_KEYS.FRIEND_DETAILS, userId, next);
  } catch {
    // Best-effort, same contract as every other write here.
  }
}

/**
 * The same merge for MANY friends at once: one read, one write.
 *
 * mergePersistentFriendDetail() does a full read-modify-write of the map
 * per call, which is right for the one friend a screen just loaded and
 * completely wrong for warming a whole friends list — 200 friends would
 * be 400 AsyncStorage round-trips on the JS thread every time the list
 * refreshes.
 *
 * Same rules as the singular version: `undefined` fields are dropped so a
 * caller cannot erase a field by accident, existing fields survive, and
 * the map is pruned to FRIEND_DETAIL_CACHE_MAX_FRIENDS by recency.
 *
 * Entries are stamped OLDER than anything written by the singular
 * version, deliberately. If the cap is ever reached, the friends the
 * viewer actually opened must outlive the ones a background warm merely
 * guessed at — otherwise a list refresh could evict the person they were
 * reading a minute ago.
 */
export async function mergePersistentFriendDetails<T extends object>(
  userId: string | null | undefined,
  patches: Record<string, Partial<T>>,
): Promise<void> {
  if (!userId) return;
  const friendIds = Object.keys(patches);
  if (friendIds.length === 0) return;
  try {
    const existing =
      (await getPersistentCache<FriendDetailMap<T>>(CACHE_KEYS.FRIEND_DETAILS, userId)) ?? {};
    const next: FriendDetailMap<T> = { ...existing };
    // Warmed entries sort BELOW anything a real visit wrote, but they must
    // still be ordered among THEMSELVES. They used to share one constant,
    // and the prune sorts by updatedAt and slices — with every warmed entry
    // tied, the tie broke on insertion order, which puts the just-warmed
    // friends last and therefore first to be evicted. On an account past
    // the cap that meant the 20 people you met this week were dropped on
    // every list refresh while 20 stale entries kept their slots: the exact
    // opposite of what this feature is for.
    //
    // Counting upward within the batch keeps later friends above earlier
    // ones, and the whole band stays under the live clock (milliseconds
    // since epoch), so a visit always outranks a warm.
    let warmStamp = 0;
    for (const friendId of friendIds) {
      const defined = Object.fromEntries(
        Object.entries(patches[friendId] ?? {}).filter(([, value]) => value !== undefined),
      ) as Partial<T>;
      if (Object.keys(defined).length === 0) continue;
      const prev = next[friendId];
      warmStamp += 1;
      next[friendId] = {
        // Never demote an entry a real visit wrote: keep the higher stamp.
        updatedAt: Math.max(prev?.updatedAt ?? 0, warmStamp),
        snapshot: { ...(prev?.snapshot ?? {}), ...defined } as T,
      };
    }
    const ids = Object.keys(next);
    if (ids.length > FRIEND_DETAIL_CACHE_MAX_FRIENDS) {
      const keep = ids
        .sort((a, b) => (next[b]?.updatedAt ?? 0) - (next[a]?.updatedAt ?? 0))
        .slice(0, FRIEND_DETAIL_CACHE_MAX_FRIENDS);
      const pruned: FriendDetailMap<T> = {};
      for (const id of keep) pruned[id] = next[id];
      await setPersistentCache(CACHE_KEYS.FRIEND_DETAILS, userId, pruned);
      return;
    }
    await setPersistentCache(CACHE_KEYS.FRIEND_DETAILS, userId, next);
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
