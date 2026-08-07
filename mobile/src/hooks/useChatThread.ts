import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { Message, MessageStatus, ThreadMessage } from '../types/chat';
import {
  dequeue,
  dequeueMany,
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
import { useLoadDeadline } from './useLoadDeadline';
import { checkOffline } from '../lib/netStatus';

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

// ── When may a queued send be DELETED from disk? ─────────────────────
//
// Only on POSITIVE proof that retrying it can never work.
//
// The rule used to be the exact opposite: anything that did not look
// like a transport failure (/network|fetch|timeout|offline/i) was
// assumed permanent and dequeued. That threw away the only durable copy
// of the user's message for a 503, for a `JWT expired`, and for the
// case this whole offline pass exists for — a captive portal answering
// the insert with an HTML login page, which surfaces as a JSON parse
// error and matches none of those words. The old comment argued the
// text survived because the bubble stayed on screen, but that bubble
// lives only in React state: it dies on the next navigation, and the
// queue entry we had just deleted is the only thing that rebuilds it.
//
// So the default is now KEEP, and this predicate is the narrow
// exception. Every code below means "the server understood the request
// and refused it on its merits", which no amount of retrying changes:
//
//   42501  insufficient_privilege        — an RLS policy said no
//   23503  foreign_key_violation         — the conversation is gone
//   23502  not_null_violation            — malformed row
//   23514  check_violation               — failed a CHECK constraint
//   22001  string_data_right_truncation  — body longer than the column
//
// 23505 (unique_violation) is deliberately absent: isDuplicateSend
// handles it, and it means DELIVERED, which is the opposite outcome.
//
// Everything else — transport failures, 5xx, gateway HTML, expired or
// unrefreshable tokens, anything unrecognised — stays queued. Being
// wrong in this direction costs one redundant retry (which the 23505
// path then resolves as delivered); being wrong in the other direction
// costs the user their message.
const PERMANENT_SEND_CODES = new Set([
  '42501',
  '23503',
  '23502',
  '23514',
  '22001',
]);

function isPermanentSendError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code ?? '');
  if (PERMANENT_SEND_CODES.has(code)) return true;
  // Same conditions reached by message when the code is absent (a
  // PostgREST error surfaced through a wrapper, or a thrown Error).
  const msg = String((err as { message?: unknown }).message ?? '');
  return /row-level security|violates check constraint|violates not-null constraint|violates foreign key constraint|permission denied/i.test(
    msg,
  );
}

// 23505 = unique_violation. On the (sender_id, client_nonce) index it
// means the server ALREADY HAS this exact message: an earlier attempt
// reached the database and we never learned about it, because the
// realtime echo needs a live socket and the sends that matter most are
// made just as connectivity returns, when it often is not up yet. A
// resend that hits this index has therefore DELIVERED — marking the
// bubble failed and raising an error banner for a message the recipient
// can already read is wrong twice over. Deliberately NOT folded into
// isNetworkError: this is a server answer, not a transport failure, and
// the two need opposite handling.
function isDuplicateSend(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === '23505') return true;
  const msg = String((err as { message?: unknown }).message ?? '');
  return /duplicate key value violates unique constraint/i.test(msg);
}

/**
 * Fold a fresh set of SERVER rows into what is on screen WITHOUT losing
 * anything `incoming` simply did not ask about.
 *
 * `incoming` is authoritative only for the WINDOW it covers: the newest
 * PAGE_SIZE rows, as of the moment the query was planned. It is not a
 * statement about the thread as a whole, and the previous version of
 * this function treated it as one — it kept `prev` rows whose status was
 * not 'sent' and dropped every other row on the floor. Two things
 * disappeared as a result:
 *
 *  1. A JUST-SENT message. `doInsert` flips the bubble to 'sent' the
 *     instant the insert is accepted, while its id is still
 *     `optimistic-<nonce>`. A fetchLatest already in flight — the same
 *     reconnect fires both — answers from a snapshot taken before that
 *     insert landed, so the row is absent from `incoming`, and the old
 *     status filter deleted it for being 'sent'. The user watched their
 *     message vanish, retyped it, and the recipient got it twice.
 *
 *  2. EVERY PAGE `loadMore` HAD FETCHED. Older pages are 'sent' rows
 *     outside the newest-50 window, so every foreground (which calls
 *     fetchLatest) silently threw the scrollback away.
 *
 * The rule now: a row is replaced only when `incoming` actually carries
 * it — matched by client_nonce first (the identity that survives the
 * optimistic → durable swap) and by id otherwise. Anything else is
 * carried across.
 *
 * Unsent bubbles stay pinned at the head, where a composed-but-unsent
 * message belongs in this newest-first list and where
 * `restoreQueuedBubbles` also puts them. Server rows — incoming plus
 * carried — are merged by created_at descending, which puts a
 * locally-sent row above the window and an older page below it, both
 * without special-casing.
 *
 * This is what makes `void flushQueue(); void fetchLatest();` safe to
 * run concurrently: whichever lands first, nothing is lost.
 */
function mergePendingSends(
  prev: ThreadMessage[],
  incoming: ThreadMessage[],
): ThreadMessage[] {
  const acknowledgedNonces = new Set<string>();
  const acknowledgedIds = new Set<string>();
  for (const m of incoming) {
    if (m.client_nonce) acknowledgedNonces.add(m.client_nonce);
    acknowledgedIds.add(m.id);
  }
  const carried = prev.filter((m) => {
    if (m.client_nonce && acknowledgedNonces.has(m.client_nonce)) return false;
    return !acknowledgedIds.has(m.id);
  });
  if (carried.length === 0) return incoming;

  const byNewestFirst = (a: ThreadMessage, b: ThreadMessage): number => {
    const delta =
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    // Stable tie-break so a re-merge of identical data cannot reorder
    // the list and make FlatList re-key rows.
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  };

  const pending = carried.filter((m) => m.status !== 'sent');
  const carriedSent = carried.filter((m) => m.status === 'sent');
  const merged =
    carriedSent.length === 0
      ? incoming
      : [...incoming, ...carriedSent].sort(byNewestFirst);

  if (pending.length === 0) return merged;
  return [...pending.sort(byNewestFirst), ...merged];
}

/** A queue envelope, rendered as the bubble the user last saw. */
function bubbleFromQueued(q: QueuedSend): ThreadMessage {
  return {
    // Same shape sendMessage builds, so the reconcile-by-nonce path in
    // handleRealtimeInsert swaps it for the durable row without caring
    // where it came from.
    id: `optimistic-${q.nonce}`,
    conversation_id: q.conversation_id,
    sender_id: q.sender_id,
    body: q.body,
    created_at: q.created_at,
    client_nonce: q.nonce,
    // 'failed' renders the tappable 「傳送失敗 · 輕點重試」 bubble. Honest
    // for a message sitting in the queue, and it keeps the message
    // manually retryable even if no automatic flush ever runs.
    status: 'failed',
  };
}

/** Queue entries belonging to this conversation AND this account. */
function ownQueued(
  items: QueuedSend[],
  conversationId: string,
  userId: string,
): QueuedSend[] {
  // The `sender_id` half is redundant now that the queue is stored per
  // user id — keep it anyway: it is the check that makes "one account
  // can never transmit another's text" true even if the storage layer is
  // ever changed again.
  return items.filter(
    (q) => q.conversation_id === conversationId && q.sender_id === userId,
  );
}

/**
 * The single place a queued envelope is handed to the server, so the
 * interactive path (sendMessage / retry) and the background flush
 * classify identical failures identically. Never throws.
 */
type SendAttempt =
  | { outcome: 'sent' }
  | { outcome: 'duplicate' }
  | { outcome: 'retry' }
  | { outcome: 'permanent'; message: string };

async function attemptSend(q: QueuedSend): Promise<SendAttempt> {
  try {
    const { error: insErr } = await supabase
      .from('piktag_messages')
      .insert({
        conversation_id: q.conversation_id,
        sender_id: q.sender_id,
        body: q.body,
        client_nonce: q.nonce,
      })
      .select()
      .single();
    if (insErr) {
      if (isDuplicateSend(insErr)) return { outcome: 'duplicate' };
      if (isPermanentSendError(insErr)) {
        return { outcome: 'permanent', message: insErr.message };
      }
      return { outcome: 'retry' };
    }
    return { outcome: 'sent' };
  } catch (e) {
    if (isPermanentSendError(e)) {
      return {
        outcome: 'permanent',
        message: e instanceof Error ? e.message : 'Send failed',
      };
    }
    // supabase-js RESOLVES most transport failures rather than throwing,
    // so reaching here at all is unusual — all the more reason to keep
    // the message rather than guess that it is unsendable.
    return { outcome: 'retry' };
  }
}

/**
 * Reconcile the disk queue with an attempt's outcome and report the
 * status its bubble should now show.
 *
 * 'sent' and 'duplicate' are both DELIVERED (see isDuplicateSend);
 * 'permanent' is the only failure that earns a dequeue. 'retry' leaves
 * the entry exactly where it was.
 */
async function settleSend(
  userId: string,
  nonce: string,
  attempt: SendAttempt,
): Promise<MessageStatus> {
  if (attempt.outcome !== 'retry') await dequeue(userId, nonce);
  return attempt.outcome === 'sent' || attempt.outcome === 'duplicate'
    ? 'sent'
    : 'failed';
}

/** Optional live-thread bindings for the flusher below. */
type FlushUi = {
  conversationId: string;
  isMounted: () => boolean;
  restore: (items: QueuedSend[]) => void;
  setStatus: (nonce: string, status: MessageStatus) => void;
  setError: (message: string) => void;
};

// Serialises flushes PROCESS-WIDE. Mount, reconnect, foreground and the
// inbox can each fire one at nearly the same instant, and the queue is a
// single shared list: two concurrent passes would double-send (the
// second reads the queue before the first has dequeued anything) and
// lean on the 23505 handler to clean up after them.
let flushInFlight = false;

/**
 * Send everything this account has queued — in EVERY conversation, not
 * just an open one.
 *
 * The queue has always been global (one list per account), but its only
 * flusher lived inside a mounted `useChatThread` and filtered the list
 * down to that hook's `conversationId`. Messages written offline in
 * three conversations therefore required REOPENING all three, one at a
 * time, with nothing anywhere to say something was still pending. Ask
 * three people for coffee on a venue's dead wifi and two of them never
 * heard from you.
 *
 * `ui` is optional. When a thread happens to be open we hand it
 * callbacks so its own bubbles animate as they go out; entries for other
 * conversations are transmitted silently, and their bubbles are rebuilt
 * from this same queue by the hydration effect if and when the user
 * opens them.
 */
export async function flushChatSendQueue(
  userId: string | null | undefined,
  ui?: FlushUi,
): Promise<void> {
  if (!userId) return;
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    // `sender_id` filter: see ownQueued. Two independent defences
    // against one account transmitting another's text, not one.
    const items = (await peek(userId)).filter((q) => q.sender_id === userId);
    if (items.length === 0) return;
    // Put the open thread's bubbles back BEFORE testing the network, so
    // the user sees their unsent messages waiting even with no signal.
    if (ui && ui.isMounted()) {
      ui.restore(items.filter((q) => q.conversation_id === ui.conversationId));
    }
    // Offline, every insert below would sit through ~25s of auth-refresh
    // backoff to learn what NetInfo already knows (see lib/netStatus.ts).
    // Nothing is dequeued on this path.
    if (await checkOffline()) return;

    for (const q of items) {
      const visible = !!ui && q.conversation_id === ui.conversationId;
      if (visible && ui!.isMounted()) ui!.setStatus(q.nonce, 'sending');
      const attempt = await attemptSend(q);
      const status = await settleSend(userId, q.nonce, attempt);
      if (visible && ui!.isMounted()) {
        ui!.setStatus(q.nonce, status);
        if (attempt.outcome === 'permanent') ui!.setError(attempt.message);
      }
      // Transport is down (or the portal is eating the request). Every
      // remaining entry would pay the same backoff for the same answer,
      // so stop here — they stay queued, and the next reconnect,
      // foreground or inbox visit picks the queue back up.
      if (attempt.outcome === 'retry') return;
    }
  } finally {
    flushInFlight = false;
  }
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

    // FAIL FAST WHEN THERE IS NO NETWORK — offline this select does not
    // fail, it sits through ~25s of auth-refresh backoff first (see
    // lib/netStatus.ts). The disk hydration below has already restored
    // the tail of this thread; returning here writes nothing, so the
    // cached messages and the send queue are both untouched.
    if (await checkOffline()) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      if (messagesRef.current.length === 0) setError('offline');
      setLoading(false);
      return;
    }

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
      // MERGE, never replace. A plain `setMessages(mapped)` here is one
      // of the three reasons a message written offline could vanish:
      // this fetch runs alongside flushQueue (the same reconnect fires
      // both), and its answer — assembled before the flush inserted
      // anything — does not contain the pending row, so assigning it
      // wholesale wiped the very bubble the flush was about to look for.
      setMessages((prev) => mergePendingSends(prev, mapped));
      // The server holding a row with our nonce is proof of delivery,
      // and the only proof available when the realtime socket was down
      // at the moment the row landed. Retire those queue entries so a
      // later flush cannot resend an already-delivered message.
      // CONFIRMED rows only: a failed fetch returns far above this line,
      // so "I couldn't ask" can never reach this dequeue.
      const deliveredNonces = rows
        .filter((m) => m.sender_id === userId && !!m.client_nonce)
        .map((m) => m.client_nonce as string);
      if (deliveredNonces.length > 0) void dequeueMany(userId, deliveredNonces);
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

    // FAIL FAST WHEN THERE IS NO NETWORK — the same guard fetchLatest
    // has, and for a sharper reason. `hasMoreRef` stays TRUE after a
    // disk hydration on purpose (a bounded cache proves nothing about
    // what the server still holds), so opening a SHORT cached
    // conversation offline hands FlatList a list whose end is already on
    // screen and onEndReached fires immediately. Without this the user
    // got a ~25s "loading older messages" spinner, at the end of which
    // nothing loaded and nothing could have. Returning here writes
    // nothing: no state, no cache, and hasMoreRef is untouched so
    // pagination can still probe once connectivity returns.
    if (await checkOffline()) return;

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
    async (nonce: string, body: string, composedAt?: string): Promise<void> => {
      if (!userId) return;
      // ── QUEUE FIRST, ALWAYS ─────────────────────────────────────────
      // The disk queue — not React state — is the durable record of a
      // message the server has not acknowledged. Writing it BEFORE the
      // attempt (rather than only on the failure branches, as before)
      // closes the window where the app is killed mid-insert and the
      // text exists nowhere but a component that is now gone. `enqueue`
      // dedupes by nonce, so a retry re-asserts one entry, never adds a
      // second.
      const envelope: QueuedSend = {
        nonce,
        conversation_id: conversationId,
        sender_id: userId,
        body,
        // Keep the ORIGINAL compose time across retries. Stamping "now"
        // would march a long-queued message back to the top of the
        // thread every time we retried it.
        created_at: composedAt ?? new Date().toISOString(),
      };
      await enqueue(userId, envelope);

      // Sending is the one thing that genuinely cannot work offline
      // ("不能傳新的資訊"). Mark the bubble immediately instead of
      // letting the insert hang ~25s first — the user should find out in
      // a second that the message is waiting, not after staring at a
      // pending bubble. The entry stays queued for the next flush.
      if (await checkOffline()) {
        if (isMountedRef.current) setStatus(nonce, 'failed');
        return;
      }
      // One classifier for both paths (see attemptSend / settleSend).
      // On success or a duplicate the entry is dequeued HERE rather than
      // waiting for the realtime echo: the echo needs a live socket, and
      // the sends that matter most are made just as connectivity
      // returns, when it often is not up yet. The echo's own dequeue is
      // a redundant second line of defence, not the only one.
      const attempt = await attemptSend(envelope);
      const status = await settleSend(userId, nonce, attempt);
      if (isMountedRef.current) {
        setStatus(nonce, status);
        // Only a positively-permanent refusal raises the banner. A
        // 'retry' outcome is still owed a retry and stays queued, so
        // telling the user it failed for good would be wrong.
        if (attempt.outcome === 'permanent') setError(attempt.message);
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
      // Same timestamp on the bubble and on the queue envelope, so a
      // bubble rebuilt from disk lands exactly where this one was.
      await doInsert(nonce, trimmed, now);
    },
    [conversationId, userId, doInsert],
  );

  const retry = useCallback(
    async (nonce: string): Promise<void> => {
      const existing = messagesRef.current.find((m) => m.client_nonce === nonce);
      if (!existing) return;
      setStatus(nonce, 'sending');
      await doInsert(nonce, existing.body, existing.created_at);
    },
    [doInsert, setStatus],
  );

  /**
   * Put a bubble on screen for every queued message of this thread that
   * does not have one. Idempotent, and it never disturbs a message that
   * is already rendered — including one mid-send.
   */
  const restoreQueuedBubbles = useCallback((items: QueuedSend[]): void => {
    if (items.length === 0) return;
    setMessages((prev) => {
      const known = new Set(
        prev.map((m) => m.client_nonce).filter((n): n is string => !!n),
      );
      const missing = items.filter((q) => !known.has(q.nonce));
      if (missing.length === 0) return prev;
      const restored = missing
        .map(bubbleFromQueued)
        // Newest-first, matching the inverted list this feeds.
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      // An unsent message is by definition newer than anything the
      // server has, so it belongs at the head.
      return [...restored, ...prev];
    });
  }, []);

  // Delegates to the process-wide flusher, which drains the queue for
  // EVERY conversation and not only this one — see flushChatSendQueue.
  // The bindings below are what let this thread's own bubbles animate
  // 傳送中 → 已送出 while they go out; other conversations are sent
  // silently and rebuild their bubbles from the queue when opened.
  const flushQueue = useCallback(async (): Promise<void> => {
    if (!userId || !conversationId) return;
    await flushChatSendQueue(userId, {
      conversationId,
      isMounted: () => isMountedRef.current,
      restore: restoreQueuedBubbles,
      setStatus,
      setError,
    });
  }, [conversationId, userId, setStatus, restoreQueuedBubbles]);

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
      if (!Array.isArray(cached) || cached.length === 0) {
        // Nothing cached for this thread. Offline that is final — stop
        // the spinner and let the screen show its retry surface.
        if (await checkOffline()) {
          if (cancelled || !isMountedRef.current) return;
          if (messagesRef.current.length === 0) setError('offline');
          setLoading(false);
        }
        return;
      }
      const restored: ThreadMessage[] = cached.map((m) => ({ ...m, status: 'sent' }));
      // Only fill a thread that has no SERVER rows yet — never overwrite
      // live ones. The test used to be `prev.length > 0`, which also
      // counted the pending bubbles the queue hydration below restores:
      // one queued message was then enough to suppress the whole cached
      // history, leaving the user offline with their unsent bubble and
      // nothing else. mergePendingSends keeps both.
      setMessages((prev) =>
        prev.some((m) => m.status === 'sent') ? prev : mergePendingSends(prev, restored),
      );
      // hasMoreRef stays TRUE on purpose: a bounded cache proves nothing
      // about what the server still holds, so pagination must remain
      // able to probe once connectivity returns.
      // Readable history on screen — drop any offline flag so the thread
      // renders instead of the retry card.
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, conversationId]);

  // ── Queue hydration ────────────────────────────────────────────────
  // Rebuild the pending bubbles for THIS conversation from disk.
  //
  // Disk hydration above restores server rows only (by design — see the
  // comment on the setPersistentThreadMessages call), so before this
  // effect existed nothing ever re-read chatSendQueue on mount: `peek`
  // was reachable from flushQueue alone. A message written offline
  // therefore disappeared from the screen the moment the user left the
  // conversation and — because flushQueue then skipped any entry whose
  // bubble was gone — was never sent either. It sat in the queue until
  // sign-out deleted it.
  //
  // Runs regardless of connectivity, so even with no signal at all the
  // user finds their unsent message still waiting where they left it.
  useEffect(() => {
    if (!userId || !conversationId) return;
    let cancelled = false;
    void (async () => {
      const items = await peek(userId);
      if (cancelled || !isMountedRef.current) return;
      const mine = ownQueued(items, conversationId, userId);
      if (mine.length === 0) return;
      restoreQueuedBubbles(mine);
      // A pending bubble IS content, so the thread is no longer waiting
      // on anything to paint. Clearing `error` matters as much: without
      // it an offline fetchLatest that ran before this landed would
      // leave the screen on its retry card, hiding the message.
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, conversationId, restoreQueuedBubbles]);

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
    // Flush on MOUNT, not only on an offline→online transition. A cold
    // start that is ALREADY online never sees that transition
    // (wasConnectedRef starts at the current value), so a message queued
    // before the app was killed would sit there until the user happened
    // to lose and regain signal. flushQueue no-ops on an empty queue and
    // is serialised against the reconnect flush.
    void flushQueue();
    subscribe();

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [fetchLatest, flushQueue, subscribe, unsubscribe]);

  useEffect(() => {
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'active') {
        subscribe();
        fetchLatest();
        // Same reasoning as the mount flush: coming back from background
        // on a phone that never reported a connectivity change is the
        // other way a queued message gets stranded.
        void flushQueue();
      } else if (state === 'background' || state === 'inactive') {
        unsubscribe();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [subscribe, unsubscribe, fetchLatest, flushQueue]);

  // Auto-flush queued sends when network connectivity transitions from
  // offline to online. Manual retry on failed bubbles still works as a
  // fallback if the user tapped retry while offline. The same transition
  // re-runs fetchLatest, which short-circuits while offline and so needs
  // an explicit restart to pick up anything missed.
  //
  // The two run concurrently ON PURPOSE, and that is now safe:
  // fetchLatest merges rather than replaces (mergePendingSends), so its
  // answer can no longer wipe the optimistic bubble out from under the
  // flush that is about to send it.
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (!wasConnected && isConnected) {
      void flushQueue();
      void fetchLatest();
    }
  }, [isConnected, flushQueue, fetchLatest]);

  // Online but the select is going nowhere. Stop the spinner; a late
  // response still paints over whatever this leaves on screen.
  useLoadDeadline(loading, () => {
    setLoading(false);
    if (messagesRef.current.length === 0) setError('offline');
  });

  // Same safety net for pagination. checkOffline() above covers the
  // airplane-mode case; this covers the one it cannot see — NetInfo says
  // "connected" but the request is doomed anyway (captive portal, venue
  // wifi that associates and routes nowhere). No error surface here: the
  // thread is already readable, so the honest outcome is simply to stop
  // claiming that older messages are one moment away.
  useLoadDeadline(loadingMore, () => {
    setLoadingMore(false);
  });

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
