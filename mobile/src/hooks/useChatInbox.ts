import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import {
  CACHE_KEYS,
  CHAT_THREAD_CACHE_MAX_MESSAGES,
  getPersistentCache,
  setPersistentCache,
  setPersistentThreadMessages,
} from '../lib/dataCache';
import { checkOffline } from '../lib/netStatus';
import { useLoadDeadline } from './useLoadDeadline';
import type { InboxConversation, InboxTab, Message } from '../types/chat';

// How many conversation rows we keep on disk for offline reading. The
// inbox is sorted newest-first, so this is "the 50 threads you actually
// touch"; anything below that is scrollback nobody opens with no signal.
const INBOX_CACHE_MAX = 50;

// How many conversations get their message tail pulled down for offline
// reading when the inbox loads.
//
// WHY THIS EXISTS (founder 2026-08-08: 「沒辦法看舊的聊天記錄」). The
// CHAT_THREADS cache was only ever written by useChatThread.fetchLatest
// — i.e. a thread became readable offline only if you had OPENED it,
// online, since installing the build that added the cache. Caching the
// inbox but not the messages means the user taps a conversation they
// can see and gets an empty thread, which is exactly what was reported.
//
// 10 x 30 messages is the same order as the bound the thread cache
// already enforces (20 conversations x 30), so this cannot grow the
// on-disk footprint past what dataCache.ts already documents. It runs
// ONCE per account per app session, in the background, after the inbox
// itself has already painted.
const THREAD_PREFETCH_MAX_CONVERSATIONS = 10;

type FetchInboxRow = {
  id: string;
  other_user_id: string;
  other_username: string | null;
  other_full_name: string | null;
  other_avatar_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  last_read_at: string;
  initiated_by: string;
  is_connection: boolean;
  i_have_replied: boolean;
  folder_override: InboxTab | null;
};

type UseChatInboxReturn = {
  conversations: InboxConversation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useChatInbox(): UseChatInboxReturn {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Guards against a stale fetch completing after unmount or after the
  // auth user changes (e.g. rapid sign-out/sign-in).
  const requestIdRef = useRef<number>(0);
  // Coalesce bursts of realtime updates into a single refetch. When
  // multiple conversations update in the same tick (e.g. a backfill or
  // a mark-all-read sweep) we'd otherwise fire fetch_inbox once per
  // event. 250ms is imperceptible to users but collapses storms.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flipped the first time the RPC answers successfully. The disk
  // hydration below refuses to paint after that, so a slow AsyncStorage
  // read can never resurrect conversations the server has just told us
  // are gone (blocked / deleted).
  const liveFetchDoneRef = useRef<boolean>(false);
  // Mirrors `conversations` so the loaders can ask "is anything already
  // on screen?" without taking it as a dependency.
  const conversationsRef = useRef<InboxConversation[]>([]);
  // One thread-tail prefetch per account per mount. Reset alongside
  // liveFetchDoneRef in the hydration effect below.
  const threadPrefetchDoneRef = useRef<boolean>(false);

  const userId = user?.id ?? null;

  /**
   * Pull the recent messages of the top conversations onto disk so they
   * can be READ with no signal. Fire-and-forget: never awaited by the
   * caller, never touches component state, and every write is guarded by
   * its own query having succeeded — a failed one simply leaves the
   * previous snapshot in place.
   */
  const prefetchThreadTails = useCallback(
    async (rows: InboxConversation[]): Promise<void> => {
      if (!userId || threadPrefetchDoneRef.current) return;
      threadPrefetchDoneRef.current = true;
      // `rows` is already newest-first. Take the top N, then write them
      // OLDEST-first: setPersistentThreadMessages prunes the map by write
      // time, so writing newest-last is what keeps the conversations the
      // user is most likely to open from being evicted later.
      const targets = rows
        .filter((c) => c.last_message_at !== null)
        .slice(0, THREAD_PREFETCH_MAX_CONVERSATIONS)
        .reverse();
      for (const c of targets) {
        if (!isMountedRef.current) return;
        const { data, error } = await supabase
          .from('piktag_messages')
          .select('id, conversation_id, sender_id, body, created_at, client_nonce')
          .eq('conversation_id', c.id)
          .order('created_at', { ascending: false })
          .limit(CHAT_THREAD_CACHE_MAX_MESSAGES);
        if (error || !Array.isArray(data) || data.length === 0) continue;
        await setPersistentThreadMessages<Message>(userId, c.id, data as Message[]);
      }
    },
    [userId],
  );

  const fetchInbox = useCallback(async (): Promise<void> => {
    if (!userId) {
      setConversations([]);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = ++requestIdRef.current;

    // FAIL FAST WHEN THERE IS NO NETWORK. `fetch_inbox` goes through
    // supabase-js, which resolves `auth.getSession()` first; with an
    // expired access token and no signal that is ~25s of refresh backoff
    // before the RPC even reports failure (see lib/netStatus.ts). The
    // disk hydration below has already painted whatever we had, and
    // returning here writes nothing, so no snapshot can be damaged.
    if (await checkOffline()) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      // Only claim a failure when there is nothing to show. With a
      // cached inbox the app-wide <OfflineBanner> is the correct — and
      // only — signal; a retry card over a readable list would be noise.
      if (conversationsRef.current.length === 0) setError('offline');
      setLoading(false);
      return;
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('fetch_inbox');
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      const rows: FetchInboxRow[] = Array.isArray(data) ? (data as FetchInboxRow[]) : [];
      const mapped: InboxConversation[] = rows.map((r) => ({
        id: r.id,
        other_user_id: r.other_user_id,
        other_username: r.other_username,
        other_full_name: r.other_full_name,
        other_avatar_url: r.other_avatar_url,
        last_message_at: r.last_message_at,
        last_message_preview: r.last_message_preview,
        last_message_sender_id: r.last_message_sender_id,
        last_read_at: r.last_read_at,
        initiated_by: r.initiated_by,
        is_connection: r.is_connection,
        i_have_replied: r.i_have_replied,
        folder_override: r.folder_override ?? null,
        unread:
          r.last_message_at !== null &&
          r.last_message_sender_id !== userId &&
          new Date(r.last_message_at).getTime() > new Date(r.last_read_at).getTime(),
      }));

      // NULLS LAST sort: rows with no messages sink to the bottom so
      // the active threads are always at the top of the list.
      mapped.sort((a, b) => {
        if (a.last_message_at === null && b.last_message_at === null) return 0;
        if (a.last_message_at === null) return 1;
        if (b.last_message_at === null) return -1;
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      });

      setConversations(mapped);
      liveFetchDoneRef.current = true;
      // Mirror the inbox to disk so a cold start with no signal still
      // shows who you've been talking to. Same rows the list renders —
      // no extra query, no reshaping.
      void setPersistentCache(
        CACHE_KEYS.CHAT_INBOX,
        userId,
        mapped.slice(0, INBOX_CACHE_MAX),
      );
      // ...and the messages inside the top conversations, so tapping one
      // offline shows the history instead of an empty thread.
      void prefetchThreadTails(mapped);
      setError(null);
    } catch (e) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      if (isMountedRef.current && reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId, prefetchThreadTails]);

  // Debounced refresh. Every realtime event routes through here so the
  // inbox can't fire more than one fetch_inbox per 250ms window, no
  // matter how chatty the server is.
  const scheduleRefresh = useCallback((): void => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (isMountedRef.current) void fetchInbox();
    }, 250);
  }, [fetchInbox]);

  const subscribe = useCallback((): void => {
    if (!userId) return;
    if (channelRef.current) return;

    // One channel per screen. We bind UPDATE on piktag_conversations
    // only — the server's message-insert trigger bumps last_message_at
    // on the conversation row, so listening to piktag_messages INSERT
    // here would double-fire for every new message without adding new
    // information. Supabase's postgres_changes filter doesn't support
    // OR, so we listen broadly and rely on RLS + the narrow fetch_inbox
    // RPC for correctness. All events funnel through scheduleRefresh so
    // bursts collapse to one fetch per 250ms window.
    const channel = supabase
      .channel(`chat-inbox-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'piktag_conversations',
        },
        scheduleRefresh,
      )
      .subscribe();

    channelRef.current = channel;
  }, [userId, scheduleRefresh]);

  const unsubscribe = useCallback((): void => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // Stale-while-revalidate, disk layer. Runs once per account: paint
  // the last known inbox immediately, then let fetchInbox overwrite it.
  // Offline it is the only thing that ever paints — which is the point
  // (founder 2026-08-06: 聊天歷史 must be readable with no signal).
  useEffect(() => {
    // Reset per account, so a sign-in as someone else re-hydrates from
    // THEIR snapshot instead of being suppressed by the previous user's
    // completed fetch.
    liveFetchDoneRef.current = false;
    threadPrefetchDoneRef.current = false;
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const cached = await getPersistentCache<InboxConversation[]>(
        CACHE_KEYS.CHAT_INBOX,
        userId,
      );
      if (cancelled || !isMountedRef.current) return;
      if (liveFetchDoneRef.current) return;
      if (!Array.isArray(cached) || cached.length === 0) {
        // Nothing on disk. Offline that is final for this launch: stop
        // the skeleton now and let ChatListScreen render its retry card
        // rather than sit on placeholders for ~25s.
        if (await checkOffline()) {
          if (cancelled || !isMountedRef.current) return;
          if (conversationsRef.current.length === 0) setError('offline');
          setLoading(false);
        }
        return;
      }
      // Never clobber rows that already landed from the network.
      setConversations((prev) => (prev.length > 0 ? prev : cached));
      // We have something readable — drop any offline flag so the list
      // shows instead of the error card.
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Online but the RPC is going nowhere (captive portal / dead venue
  // wifi). Stop the skeleton; the fetch still paints if it lands.
  useLoadDeadline(loading, () => {
    setLoading(false);
    if (conversationsRef.current.length === 0) setError('offline');
  });

  useEffect(() => {
    isMountedRef.current = true;
    setLoading(true);
    fetchInbox();
    subscribe();

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [fetchInbox, subscribe, unsubscribe]);

  useEffect(() => {
    // Pause realtime while backgrounded so we don't hold a socket open
    // indefinitely; on resume we reopen and re-sync in case we missed
    // events while detached.
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'active') {
        subscribe();
        fetchInbox();
      } else if (state === 'background' || state === 'inactive') {
        unsubscribe();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [subscribe, unsubscribe, fetchInbox]);

  return {
    conversations,
    loading,
    error,
    refresh: fetchInbox,
  };
}
