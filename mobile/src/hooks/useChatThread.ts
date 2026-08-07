import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Message, MessageStatus, ThreadMessage } from '../types/chat';
import {
  dequeue,
  enqueue,
  peek,
  purgeLegacyChatSendQueue,
  type QueuedSend,
} from '../lib/chatSendQueue';
import {
  getPersistentThreadMessages,
  setPersistentThreadMessages,
} from '../lib/dataCache';
import { useNetInfo } from './useNetInfo';

const PAGE_SIZE = 50;

type UseChatThreadReturn = {
  messages: ThreadMessage[];
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  sendMessage: (body: string) => Promise<void>;
  retry: (nonce: string) => Promise<void>;
  /**
   * Re-runs the initial page fetch. Used by `<ErrorState>` retry CTAs
   * and by callers that want to force a refresh after recovering from
   * a transient failure. Realtime + reconnect-flush already cover the
   * happy paths, so this is mainly for the explicit-retry UX.
   */
  reload: () => Promise<void>;
  markRead: () => Promise<void>;
  error: string | null;
};

// Best-effort UUID. expo-crypto is present in the project; falling back
// avoids a crash during dev if the native module hasn't been linked yet.
function newNonce(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    const rand = (): string =>
      Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .slice(1);
    return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
  }
}

// Heuristic: Supabase/PostgREST surfaces transport failures as plain
// Error('Network request failed') or similar. Anything we can't
// classify as network we treat as a server/RLS error and do NOT queue,
// otherwise a forbidden send would retry forever.
function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /network|fetch|timeout|timed out|offline/i.test(msg);
}

export function useChatThread(conversationId: string): UseChatThreadReturn {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { isConnected } = useNetInfo();
  const wasConnectedRef = useRef<boolean>(isConnected);

  const isMountedRef = useRef<boolean>(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const requestIdRef = useRef<number>(0);
  // Tracks whether the server has more older messages than what we've
  // already loaded. Initialized true so the first loadMore can probe;
  // set to false as soon as a fetch returns < PAGE_SIZE rows.
  const hasMoreRef = useRef<boolean>(true);
  // Set once the server has answered for this thread. Guards the disk
  // hydration below from painting over a fresher (possibly empty)
  // server result that arrived first.
  const liveFetchDoneRef = useRef<boolean>(false);
  // Latest messages snapshot for callbacks that shouldn't re-create on
  // every state change (realtime handler, flush loop).
  const messagesRef = useRef<ThreadMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const fetchLatest = useCallback(async (): Promise<void> => {
    if (!userId || !conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const reqId = ++requestIdRef.current;
    try {
      const { data, error: selErr } = await supabase
        .from('piktag_messages')
        .select('id, conversation_id, sender_id, body, created_at, client_nonce')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (!isMountedRef.current || reqId !== requestIdRef.current) return;

      if (selErr) {
        setError(selErr.message);
        return;
      }

      const rows: Message[] = Array.isArray(data) ? (data as Message[]) : [];
      const mapped: ThreadMessage[] = rows.map((m) => ({ ...m, status: 'sent' }));
      setMessages(mapped);
      liveFetchDoneRef.current = true;
      // Persist the tail of this thread so it can be RE-READ offline.
      // Server rows only — optimistic / failed bubbles belong to
      // chatSendQueue, and caching them here would resurrect a bubble
      // the queue is separately responsible for retrying. The helper
      // bounds this to the newest CHAT_THREAD_CACHE_MAX_MESSAGES and
      // keeps at most CHAT_THREAD_CACHE_MAX_CONVERSATIONS threads.
      void setPersistentThreadMessages<Message>(userId, conversationId, rows);
      // If we got fewer than a full page, there is nothing older — skip
      // future loadMore probes so the inverted FlatList doesn't show a
      // dangling "loading older" spinner on brand-new threads.
      hasMoreRef.current = rows.length >= PAGE_SIZE;
      setError(null);
    } catch (e) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      if (isMountedRef.current && reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [conversationId, userId]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!userId || !conversationId) return;
    if (loadingMore) return;
    // Short-circuit when fetchLatest already proved the server has no
    // older messages. Without this, FlatList's onEndReached fires on
    // brand-new threads (1 message) and spins forever.
    if (!hasMoreRef.current) return;

    // Keyset pagination anchored on the oldest *server* message. We
    // skip optimistic rows (status !== 'sent') because their timestamps
    // are client clock and could overlap real rows.
    const current = messagesRef.current;
    const oldest = [...current].reverse().find((m) => m.status === 'sent');
    if (!oldest) return;

    setLoadingMore(true);
    try {
      const { data, error: selErr } = await supabase
        .from('piktag_messages')
        .select('id, conversation_id, sender_id, body, created_at, client_nonce')
        .eq('conversation_id', conversationId)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (!isMountedRef.current) return;
      if (selErr) {
        setError(selErr.message);
        return;
      }

      const rows: Message[] = Array.isArray(data) ? (data as Message[]) : [];
      const older: ThreadMessage[] = rows.map((m) => ({ ...m, status: 'sent' }));
      setMessages((prev) => [...prev, ...older]);
      if (rows.length < PAGE_SIZE) hasMoreRef.current = false;
    } catch (e) {
      if (!isMountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load older messages');
    } finally {
      if (isMountedRef.current) setLoadingMore(false);
    }
  }, [conversationId, userId, loadingMore]);

  const handleRealtimeInsert = useCallback(
    (incoming: Message): void => {
      if (incoming.conversation_id !== conversationId) return;

      setMessages((prev) => {
        // Reconcile by client_nonce: the optimistic bubble we inserted
        // a moment ago is now durable — swap in the server id/created_at
        // so future edits (e.g. pagination) line up.
        if (incoming.sender_id === userId && incoming.client_nonce) {
          const idx = prev.findIndex(
            (m) => m.client_nonce && m.client_nonce === incoming.client_nonce,
          );
          if (idx !== -1) {
            const next = prev.slice();
            next[idx] = { ...incoming, status: 'sent' };
            // Clear the queue entry now that the server acknowledged it.
            void dequeue(userId, incoming.client_nonce);
            return next;
          }
        }

        // Dedupe by id in case the row was inserted via another path
        // (e.g. direct select after retry completed).
        if (prev.some((m) => m.id === incoming.id)) return prev;

        return [{ ...incoming, status: 'sent' }, ...prev];
      });
    },
    [conversationId, userId],
  );

  const subscribe = useCallback((): void => {
    if (!conversationId) return;
    if (channelRef.current) return;

    const channel = supabase
      .channel(`chat-thread-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'piktag_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          handleRealtimeInsert(payload.new as Message);
        },
      )
      .subscribe();

    channelRef.current = channel;
  }, [conversationId, handleRealtimeInsert]);

  const unsubscribe = useCallback((): void => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const markRead = useCallback(async (): Promise<void> => {
    if (!userId || !conversationId) return;
    try {
      await supabase.rpc('mark_conversation_read', { conv_id: conversationId });
    } catch {
      // Non-fatal — read cursor will catch up on the next call.
    }
  }, [conversationId, userId]);

  const setStatus = useCallback(
    (nonce: string, status: MessageStatus): void => {
      setMessages((prev) =>
        prev.map((m) => (m.client_nonce === nonce ? { ...m, status } : m)),
      );
    },
    [],
  );

  const doInsert = useCallback(
    async (nonce: string, body: string): Promise<void> => {
      if (!userId) return;
      try {
        const { error: insErr } = await supabase
          .from('piktag_messages')
          .insert({
            conversation_id: conversationId,
            sender_id: userId,
            body,
            client_nonce: nonce,
          })
          .select()
          .single();

        if (insErr) {
          if (isNetworkError(insErr)) {
            await enqueue(userId, {
              nonce,
              conversation_id: conversationId,
              sender_id: userId,
              body,
              created_at: new Date().toISOString(),
            });
            if (isMountedRef.current) setStatus(nonce, 'failed');
          } else {
            // RLS / validation error: surface and don't retry silently,
            // otherwise the queue would spin on a permanently-blocked send.
            if (isMountedRef.current) {
              setStatus(nonce, 'failed');
              setError(insErr.message);
            }
          }
          return;
        }

        // Success path is a no-op — the realtime INSERT will reconcile
        // the optimistic row by client_nonce.
      } catch (e) {
        if (isNetworkError(e)) {
          await enqueue(userId, {
            nonce,
            conversation_id: conversationId,
            sender_id: userId,
            body,
            created_at: new Date().toISOString(),
          });
          if (isMountedRef.current) setStatus(nonce, 'failed');
        } else {
          if (isMountedRef.current) {
            setStatus(nonce, 'failed');
            setError(e instanceof Error ? e.message : 'Send failed');
          }
        }
      }
    },
    [conversationId, userId, setStatus],
  );

  const sendMessage = useCallback(
    async (body: string): Promise<void> => {
      const trimmed = body.trim();
      if (!trimmed || !userId || !conversationId) return;

      const nonce = newNonce();
      const now = new Date().toISOString();

      const optimistic: ThreadMessage = {
        // Temp id; replaced by the server id on realtime echo. Prefixed
        // so any accidental key collision with a real uuid is impossible.
        id: `optimistic-${nonce}`,
        conversation_id: conversationId,
        sender_id: userId,
        body: trimmed,
        created_at: now,
        client_nonce: nonce,
        status: 'sending',
      };

      setMessages((prev) => [optimistic, ...prev]);
      await doInsert(nonce, trimmed);
    },
    [conversationId, userId, doInsert],
  );

  const retry = useCallback(
    async (nonce: string): Promise<void> => {
      const existing = messagesRef.current.find((m) => m.client_nonce === nonce);
      if (!existing) return;
      setStatus(nonce, 'sending');
      await doInsert(nonce, existing.body);
    },
    [doInsert, setStatus],
  );

  const flushQueue = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const items: QueuedSend[] = await peek(userId);
    // Only flush entries belonging to this conversation + this user;
    // other threads own their own queue entries and will flush them.
    // The `sender_id` half of this filter is redundant now that the
    // queue is stored per user id — keep it anyway: it is the check that
    // makes "one account can never transmit another's text" true even if
    // the storage layer is ever changed again.
    const mine = items.filter(
      (q) => q.conversation_id === conversationId && q.sender_id === userId,
    );
    for (const q of mine) {
      // If the bubble is no longer in the thread (thread was unmounted
      // and the message fell off the window), skip — a fresh send in a
      // new mount will replace it.
      const present = messagesRef.current.some((m) => m.client_nonce === q.nonce);
      if (!present) continue;
      setStatus(q.nonce, 'sending');
      await doInsert(q.nonce, q.body);
    }
  }, [conversationId, userId, doInsert, setStatus]);

  // Disk hydration (stale-while-revalidate). Paints the last N messages
  // we saw in this thread before the network answers — and, with no
  // network at all, instead of it. Reading only: sending offline still
  // goes through chatSendQueue exactly as before.
  useEffect(() => {
    // A different thread (or account) has its own liveness: reset before
    // the fetch effect below re-runs, or the previous conversation's
    // "server already answered" would suppress this one's hydration.
    liveFetchDoneRef.current = false;
    if (!userId || !conversationId) return;
    let cancelled = false;
    void (async () => {
      const cached = await getPersistentThreadMessages<Message>(userId, conversationId);
      if (cancelled || !isMountedRef.current) return;
      if (liveFetchDoneRef.current) return;
      if (!Array.isArray(cached) || cached.length === 0) return;
      const restored: ThreadMessage[] = cached.map((m) => ({ ...m, status: 'sent' }));
      // Only fill an empty thread — never overwrite live rows.
      setMessages((prev) => (prev.length > 0 ? prev : restored));
      // hasMoreRef stays TRUE on purpose: a bounded cache proves nothing
      // about what the server still holds, so pagination must remain
      // able to probe once connectivity returns.
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, conversationId]);

  useEffect(() => {
    isMountedRef.current = true;
    // One-way migration off the device-global send queue (see
    // LEGACY_QUEUE_KEY in lib/chatSendQueue). Delete only, never read:
    // anything left in it at update time is discarded on purpose. This
    // is the screen that owns the queue, so this is where the old key
    // gets dropped — the same shape as the piktag_last_qr /
    // piktag_recent_locations / piktag_user_presets migrations.
    void purgeLegacyChatSendQueue();
    setLoading(true);
    fetchLatest();
    subscribe();

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [fetchLatest, subscribe, unsubscribe]);

  useEffect(() => {
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'active') {
        subscribe();
        fetchLatest();
      } else if (state === 'background' || state === 'inactive') {
        unsubscribe();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [subscribe, unsubscribe, fetchLatest]);

  // Auto-flush queued sends when network connectivity transitions from
  // offline to online. Manual retry on failed bubbles still works as a
  // fallback if the user tapped retry while offline.
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (!wasConnected && isConnected) {
      void flushQueue();
    }
  }, [isConnected, flushQueue]);

  // Explicit-retry surface used by the screen-level <ErrorState>.
  // We clear the in-place error and bounce the loading flag back on
  // before delegating to fetchLatest so the FlatList swaps from the
  // error empty-state to a spinner immediately, rather than appearing
  // frozen between tap and response.
  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    await fetchLatest();
  }, [fetchLatest]);

  return {
    messages,
    loading,
    loadingMore,
    loadMore,
    sendMessage,
    retry,
    reload,
    markRead,
    error,
  };
}
