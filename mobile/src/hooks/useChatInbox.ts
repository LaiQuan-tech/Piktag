import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { InboxConversation, InboxTab } from '../types/chat';

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

  const userId = user?.id ?? null;

  const fetchInbox = useCallback(async (): Promise<void> => {
    if (!userId) {
      setConversations([]);
      setLoading(false);
      setError(null);
      return;
    }

    const reqId = ++requestIdRef.current;
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
      setError(null);
    } catch (e) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      if (isMountedRef.current && reqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [userId]);

  const subscribe = useCallback((): void => {
    if (!userId) return;
    if (channelRef.current) return;

    // Filter: either side of the conversation matches me. Supabase's
    // postgres_changes filter doesn't support OR, so we listen to ALL
    // UPDATEs on piktag_conversations and rely on RLS + a full refresh
    // for correctness. A full refresh is cheap here — the inbox is
    // small and fetch_inbox is indexed.
    const channel = supabase
      .channel(`chat-inbox-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'piktag_conversations',
        },
        () => {
          fetchInbox();
        },
      )
      .subscribe();

    channelRef.current = channel;
  }, [userId, fetchInbox]);

  const unsubscribe = useCallback((): void => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

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
