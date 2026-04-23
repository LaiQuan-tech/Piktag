import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';

/**
 * Fetch the viewer's own note plus every note currently active for the
 * given set of user ids. One round-trip, indexed by user_id.
 *
 * Returns { myNote, otherNotes } where:
 *   - myNote is the viewer's own current piktag_user_status text (null
 *     if none / expired)
 *   - otherNotes maps other user_id -> their note text
 *
 * The view layer (ChatFriendsRow) decides whether to render each note
 * as a speech bubble or omit it — this hook just exposes the data.
 */
export function useChatFriendStatuses(
  myUserId: string | null | undefined,
  otherUserIds: string[],
): { myNote: string | null; otherNotes: Map<string, string> } {
  const [myNote, setMyNote] = useState<string | null>(null);
  const [otherNotes, setOtherNotes] = useState<Map<string, string>>(
    () => new Map(),
  );

  // Stabilise the input array so the effect only fires when the set of
  // user ids actually changes. Conversations can re-render on every
  // realtime tick without the counterparts shifting.
  const idsKey = useMemo(
    () => [...otherUserIds].sort().join(','),
    [otherUserIds],
  );

  useEffect(() => {
    if (!myUserId) return;
    let cancelled = false;

    const allIds = Array.from(new Set([myUserId, ...otherUserIds]));
    if (allIds.length === 0) return;

    void (async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('piktag_user_status')
        .select('user_id, text, expires_at')
        .in('user_id', allIds)
        .gt('expires_at', nowIso);

      if (cancelled) return;
      if (error || !data) {
        setMyNote(null);
        setOtherNotes(new Map());
        return;
      }

      let mine: string | null = null;
      const map = new Map<string, string>();
      for (const row of data as Array<{ user_id: string; text: string | null }>) {
        const t = (row.text ?? '').trim();
        if (!t) continue;
        if (row.user_id === myUserId) {
          mine = t;
        } else {
          map.set(row.user_id, t);
        }
      }
      setMyNote(mine);
      setOtherNotes(map);
    })();

    return () => {
      cancelled = true;
    };
  // idsKey + myUserId are the meaningful inputs; the raw array ref is
  // kept out of deps on purpose (see idsKey memoization above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId, idsKey]);

  return { myNote, otherNotes };
}
