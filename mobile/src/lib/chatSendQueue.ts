import AsyncStorage from '@react-native-async-storage/async-storage';

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

const STORAGE_KEY = 'piktag_chat_send_queue_v1';

export async function loadQueue(): Promise<QueuedSend[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
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
  } catch {
    return [];
  }
}

export async function saveQueue(items: QueuedSend[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // AsyncStorage failure here is non-fatal — worst case the user
    // re-sends manually. We silently swallow rather than crash the thread.
  }
}

export async function enqueue(item: QueuedSend): Promise<void> {
  const items = await loadQueue();
  // Dedupe by nonce so a retry loop can't grow the queue unboundedly.
  const next = items.filter((q) => q.nonce !== item.nonce);
  next.push(item);
  await saveQueue(next);
}

export async function dequeue(nonce: string): Promise<void> {
  const items = await loadQueue();
  const next = items.filter((q) => q.nonce !== nonce);
  if (next.length !== items.length) {
    await saveQueue(next);
  }
}

export async function peek(): Promise<QueuedSend[]> {
  return loadQueue();
}
