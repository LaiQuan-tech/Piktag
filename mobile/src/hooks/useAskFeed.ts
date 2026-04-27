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

  // Realtime: refresh when a new ask is created
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('asks-feed')
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
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchFeed]);

  return { asks, myAsk, loading, refresh: fetchFeed };
}
