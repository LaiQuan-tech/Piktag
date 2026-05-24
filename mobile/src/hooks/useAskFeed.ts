import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { AskFeedItem, MyActiveAsk } from '../types/ask';

export function useAskFeed() {
  const { user } = useAuth();
  const [asks, setAsks] = useState<AskFeedItem[]>([]);
  const [myAsk, setMyAsk] = useState<MyActiveAsk | null>(null);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const fetchFeed = useCallback(async () => {
    if (!user) return;
    try {
      const [feedResult, myAskResult] = await Promise.all([
        supabase.rpc('fetch_ask_feed', { p_limit: 20 }),
        supabase.rpc('fetch_my_active_ask'),
      ]);

      if (!isMounted.current) return;

      // Surface server-side RPC errors. fetch_ask_feed silently
      // returning an error (e.g. function definition drift,
      // permission revoke, RLS misconfig) used to land as an empty
      // feed because we only branched on `data` truthiness — the
      // user saw "no asks" with no signal that anything went wrong.
      if (feedResult.error) {
        console.warn('useAskFeed fetch_ask_feed error:', feedResult.error);
      }

      if (feedResult.data) {
        setAsks(Array.isArray(feedResult.data) ? feedResult.data : []);
      }

      if (myAskResult.data) {
        const d = Array.isArray(myAskResult.data) ? myAskResult.data[0] : myAskResult.data;
        setMyAsk(d && d.id ? d : null);
      } else {
        setMyAsk(null);
      }
    } catch (err) {
      console.warn('useAskFeed fetch error:', err);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // Realtime: refresh on any piktag_asks mutation. We listen to all
  // three event types because each one matters to a different screen:
  //   * INSERT — a friend posts a new ask, surfaces in the feed
  //   * UPDATE — author edits body/tags or the trigger flips is_active
  //   * DELETE — author tears down their ask (hard DELETE, cascades
  //     piktag_ask_tags/dismissals). Without this branch, deletions
  //     made from one screen (e.g. ConnectionsScreen's AskStoryRow)
  //     don't propagate to other open consumers (e.g. ProfileScreen's
  //     own useAskFeed instance), so the deleted ask continues to
  //     show until the user manually pulls-to-refresh. That was the
  //     reported bug — fixed by adding the DELETE branch below.
  //
  // Channel name is suffixed with the user id + a random nonce so
  // multiple hook instances (Profile + Connections + any modal) each
  // get their own subscription rather than fighting for one shared
  // channel — the Supabase client dedupes by name and the last-bound
  // listener can clobber the others.
  useEffect(() => {
    if (!user) return;
    const channelName = `asks-feed-${user.id}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'piktag_asks',
      }, () => {
        fetchFeed();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'piktag_asks',
      }, () => {
        fetchFeed();
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'piktag_asks',
      }, () => {
        fetchFeed();
      })
      // Defensive cross-trigger: piktag_notifications inserts of type
      // ask_posted are fanned out by the notify_ask_posted DB trigger
      // to exactly the users who should also see the ask in their
      // feed (same piktag_connections lookup). If the piktag_asks
      // INSERT realtime event misses this client (websocket race,
      // backgrounded socket, RLS quirk on initial fan-out), the
      // notification INSERT lands later via a different filter path
      // (RLS allows reading own notifications) and gives us a second
      // chance to refetch. Reported scenario: B got the push but the
      // ask wasn't on the rail — this listener guarantees parity.
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'piktag_notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const t = (payload as any)?.new?.type;
        if (t === 'ask_posted') fetchFeed();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchFeed]);

  return { asks, myAsk, loading, refresh: fetchFeed };
}
