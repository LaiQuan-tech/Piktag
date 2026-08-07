import AsyncStorage from '@react-native-async-storage/async-storage';
import { CACHE_KEYS, getPersistentCache, setPersistentCache } from './dataCache';

// Pending send envelope. `nonce` is the same value inserted into
// piktag_messages.client_nonce so that when the server echoes the row
// back via realtime we can reconcile the optimistic bubble with the
// durable id. Keeping this queue on disk means drafts survive cold
// starts — without it, a send attempted while offline would be lost
// if the user killed the app before reconnecting.
export type QueuedSend = {
  nonce: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

// ── 2026-08-08: off the device-global key, onto the per-user cache ────
// The queue now lives under CACHE_KEYS.CHAT_SEND_QUEUE, namespaced by
// user id and therefore swept by clearPersistentCaches() on sign-out.
// It was the last device-global key holding user data, and it held the
// worst of it: the full plaintext BODY of every unsent DM, on a key
// sign-out never cleared. On a shared phone A's unsent message text sat
// on disk after A logged out.
//
// `sender_id` stays on the envelope even though the key is now per-user:
// useChatThread.flushQueue still filters on it, and that filter is what
// guarantees one account can never transmit another's queued text. Two
// independent defences, not one.
//
// The legacy key is DELETED, never read as a fallback. DELIBERATE
// CONSEQUENCE, decided by the founder rather than overlooked: any
// message still sitting in the queue when a device updates to this build
// is discarded — it is neither migrated nor sent. Reading the old key to
// carry entries over would mean reading a store we cannot attribute to
// an account, which is the leak itself. The user-visible cost is bounded
// (an unsent bubble the user can retype); the alternative keeps one
// account's plaintext reachable from another's session.
const LEGACY_QUEUE_KEY = 'piktag_chat_send_queue_v1';

let legacyPurged = false;

/**
 * Best-effort, once-per-app-run deletion of the device-global queue.
 * Idempotent and safe to call from anywhere; it never reads the key.
 */
export async function purgeLegacyChatSendQueue(): Promise<void> {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    await AsyncStorage.removeItem(LEGACY_QUEUE_KEY);
  } catch {
    // Best-effort. A failed delete costs one more attempt next launch.
  }
}

export async function loadQueue(userId: string | null | undefined): Promise<QueuedSend[]> {
  // No user id => no queue. Never fall back to an unscoped key: that is
  // exactly the global store this migration removed.
  if (!userId) return [];
  const parsed = await getPersistentCache<unknown>(CACHE_KEYS.CHAT_SEND_QUEUE, userId);
  if (!Array.isArray(parsed)) return [];
  // Defensive filter — a corrupt entry shouldn't poison the whole queue.
  return parsed.filter((item): item is QueuedSend => {
    if (!item || typeof item !== 'object') return false;
    const q = item as Partial<QueuedSend>;
    return (
      typeof q.nonce === 'string' &&
      typeof q.conversation_id === 'string' &&
      typeof q.sender_id === 'string' &&
      typeof q.body === 'string' &&
      typeof q.created_at === 'string'
    );
  });
}

export async function saveQueue(
  userId: string | null | undefined,
  items: QueuedSend[],
): Promise<void> {
  if (!userId) return;
  // setPersistentCache swallows write failures by design — non-fatal
  // here too: worst case the user re-sends manually, which beats
  // crashing the thread.
  await setPersistentCache(CACHE_KEYS.CHAT_SEND_QUEUE, userId, items);
}

export async function enqueue(
  userId: string | null | undefined,
  item: QueuedSend,
): Promise<void> {
  if (!userId) return;
  const items = await loadQueue(userId);
  // Dedupe by nonce so a retry loop can't grow the queue unboundedly.
  const next = items.filter((q) => q.nonce !== item.nonce);
  next.push(item);
  await saveQueue(userId, next);
}

export async function dequeue(
  userId: string | null | undefined,
  nonce: string,
): Promise<void> {
  if (!userId) return;
  const items = await loadQueue(userId);
  const next = items.filter((q) => q.nonce !== nonce);
  if (next.length !== items.length) {
    await saveQueue(userId, next);
  }
}

export async function peek(userId: string | null | undefined): Promise<QueuedSend[]> {
  return loadQueue(userId);
}
