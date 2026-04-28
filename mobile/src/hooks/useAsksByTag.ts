import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type AskByTagItem = {
  ask_id: string;
  author_id: string;
  author_username: string | null;
  author_full_name: string | null;
  author_avatar_url: string | null;
  body: string;
  title: string | null;
  expires_at: string;
  created_at: string;
  tag_names: string[];
};

/**
 * Fetches every active, non-expired Ask that is tagged with `tagId`,
 * regardless of whether the viewer follows the author. RLS filters out
 * inactive / expired rows automatically.
 *
 * Why not `fetch_ask_feed`? That RPC restricts results to 1st/2nd-degree
 * friends with at least one overlapping tag. On a TagDetail page the
 * point is *discovery* — surfacing strangers who are asking about this
 * tag — so we need a query that ignores friend-degree and personal tag
 * overlap.
 *
 * Uses three round-trips (ask_tags → asks → profiles+tag_names) to keep
 * row sizes small and avoid one giant join. Caps at `limit` results.
 */
export function useAsksByTag(tagId: string | null | undefined, limit = 20): AskByTagItem[] {
  const [asks, setAsks] = useState<AskByTagItem[]>([]);

  useEffect(() => {
    if (!tagId) {
      setAsks([]);
      return;
    }
    let cancelled = false;

    (async () => {
      // Step 1: ask_ids tagged with this tag.
      const { data: askTagRows } = await supabase
        .from('piktag_ask_tags')
        .select('ask_id')
        .eq('tag_id', tagId);

      if (cancelled) return;
      const askIds = (askTagRows ?? []).map((r: any) => r.ask_id);
      if (askIds.length === 0) {
        setAsks([]);
        return;
      }

      // Step 2: ask rows themselves. RLS already filters is_active +
      // expires_at > now(), so we just need to order + cap.
      const { data: askRows } = await supabase
        .from('piktag_asks')
        .select('id, author_id, body, title, expires_at, created_at')
        .in('id', askIds)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (cancelled) return;
      if (!askRows || askRows.length === 0) {
        setAsks([]);
        return;
      }

      const visibleAskIds = (askRows as any[]).map((a) => a.id);
      const authorIds = Array.from(new Set((askRows as any[]).map((a) => a.author_id)));

      // Step 3 (parallel): author profiles + every tag on each visible ask.
      const [profilesRes, tagJoinRes] = await Promise.all([
        supabase
          .from('piktag_profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', authorIds),
        supabase
          .from('piktag_ask_tags')
          .select('ask_id, tag:piktag_tags!tag_id(name)')
          .in('ask_id', visibleAskIds),
      ]);

      if (cancelled) return;

      const profileMap = new Map<string, any>();
      for (const p of profilesRes.data ?? []) {
        profileMap.set((p as any).id, p);
      }

      const tagsByAsk = new Map<string, string[]>();
      for (const row of (tagJoinRes.data ?? []) as any[]) {
        const id = row.ask_id;
        const name = row.tag?.name;
        if (!id || !name) continue;
        const arr = tagsByAsk.get(id) ?? [];
        if (!arr.includes(name)) arr.push(name);
        tagsByAsk.set(id, arr);
      }

      const composed: AskByTagItem[] = (askRows as any[]).map((a) => {
        const p = profileMap.get(a.author_id);
        return {
          ask_id: a.id,
          author_id: a.author_id,
          author_username: p?.username ?? null,
          author_full_name: p?.full_name ?? null,
          author_avatar_url: p?.avatar_url ?? null,
          body: a.body,
          title: a.title,
          expires_at: a.expires_at,
          created_at: a.created_at,
          tag_names: tagsByAsk.get(a.id) ?? [],
        };
      });

      setAsks(composed);
    })();

    return () => {
      cancelled = true;
    };
  }, [tagId, limit]);

  return asks;
}
