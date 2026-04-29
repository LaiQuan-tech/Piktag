import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { ChatUnreadSummary } from '../types/chat';

type UnreadContextValue = ChatUnreadSummary & {
  refresh: () => Promise<void>;
};

const DEFAULT_SUMMARY: ChatUnreadSummary = {
  total: 0,
  primary: 0,
  requests: 0,
  general: 0,
};

// Default context returns zeros + a no-op refresh. This lets screens
// call useChatUnread() unconditionally during incremental rollout —
// before the Provider is mounted at the app root — without needing
// to guard every read.
const ChatUnreadContext = createContext<UnreadContextValue>({
  ...DEFAULT_SUMMARY,
  refresh: async () => {},
});

// Shape returned by get_chat_unread_summary. Postgres uses *_count
// suffixes to avoid colliding with the reserved word `primary`.
type UnreadSummaryRow = {
  total: number | null;
  primary_count: number | null;
  requests_count: number | null;
  general_count: number | null;
};

type ProviderProps = {
  children: React.ReactNode;
};

export function ChatUnreadProvider({ children }: ProviderProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [summary, setSummary] = useState<ChatUnreadSummary>(DEFAULT_SUMMARY);

  const isMountedRef = useRef<boolean>(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const requestIdRef = useRef<number>(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!userId) {
      setSummary(DEFAULT_SUMMARY);
      return;
    }

    const reqId = ++requestIdRef.current;
    try {
      const { data, error } = await supabase.rpc('get_chat_unread_summary');
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      if (error) return;

      // RPC returns a single-row TABLE; postgrest delivers it as an
      // array, but we normalize both shapes defensively.
      const row: UnreadSummaryRow | null = Array.isArray(data)
        ? ((data[0] as UnreadSummaryRow | undefined) ?? null)
        : ((data as UnreadSummaryRow | null) ?? null);

      if (!row) {
        setSummary(DEFAULT_SUMMARY);
        return;
      }

      setSummary({
        total: row.total ?? 0,
        primary: row.primary_count ?? 0,
        requests: row.requests_count ?? 0,
        general: row.general_count ?? 0,
      });
    } catch {
      // A badge that fails to refresh shouldn't crash the app.
    }
  }, [userId]);

  const subscribe = useCallback((): void => {
    if (!userId) return;
    if (channelRef.current) return;

    const channel = supabase
      .channel(`chat-unread-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'piktag_conversations',
        },
        () => {
          // Refetching the summary is cheap and avoids having to
          // classify the row (primary/requests/general) on the client.
          refresh();
        },
      )
      .subscribe();

    channelRef.current = channel;
  }, [userId, refresh]);

  const unsubscribe = useCallback((): void => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    refresh();
    subscribe();

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, [refresh, subscribe, unsubscribe]);

  useEffect(() => {
    const handleAppState = (state: AppStateStatus): void => {
      if (state === 'active') {
        subscribe();
        refresh();
      } else if (state === 'background' || state === 'inactive') {
        unsubscribe();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [subscribe, unsubscribe, refresh]);

  const value = useMemo<UnreadContextValue>(
    () => ({ ...summary, refresh }),
    [summary, refresh],
  );

  // Using React.createElement instead of JSX keeps this file a plain
  // .ts module (no .tsx rename needed) while still producing a valid
  // Provider element.
  return React.createElement(
    ChatUnreadContext.Provider,
    { value },
    children,
  );
}

export function useChatUnread(): UnreadContextValue {
  return useContext(ChatUnreadContext);
}
