import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type UserActiveAsk = {
  id: string;
  body: string;
  title: string | null;
  expires_at: string;
  created_at: string;
  tag_names: string[];
};

/**
 * Fetches the most recent active, non-expired Ask authored by `userId`.
 *
 * RLS already permits any authenticated user to read active+non-expired
 * asks (see `asks_select` policy in 20260427_ask_feature.sql), so this
 * is a direct two-step query — find the ask row, then pull its tag
 * names. We don't go through `fetch_ask_feed` because that RPC filters
 * by friend-degree + tag overlap and would hide an ask whose author the
 * viewer follows but whose tags don't intersect the viewer's.
 *
 * Returns null when the user has no active ask.
 */
export function useUserActiveAsk(userId: string | null | undefined): UserActiveAsk | null {
  const [ask, setAsk] = useState<UserActiveAsk | null>(null);

  useEffect(() => {
    if (!userId) {
      setAsk(null);
      return;
    }
    let cancelled = false;

    (async () => {
      // `.maybeSingle()` so a user with no active ask returns data=null
      // instead of throwing PGRST116 and spamming Sentry.
      const { data: askRow } = await supabase
        .from('piktag_asks')
        .select('id, body, title, expires_at, created_at')
        .eq('author_id', userId)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (!askRow) {
        setAsk(null);
        return;
      }

      const { data: tagRows } = await supabase
        .from('piktag_ask_tags')
        .select('tag:piktag_tags!tag_id(name)')
        .eq('ask_id', (askRow as any).id);

      if (cancelled) return;

      const tag_names = (tagRows ?? [])
        .map((r: any) => r.tag?.name)
        .filter((n: any): n is string => typeof n === 'string' && n.length > 0);

      setAsk({ ...(askRow as any), tag_names });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return ask;
}
