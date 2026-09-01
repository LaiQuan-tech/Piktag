// Unread-notification indicator for the Chat header bell.
//
// The bell lost its tab on 2026-09-01 (event tags took the slot), so the
// only in-app sign that something is waiting is the dot this drives.
// Deliberately a DOT, not a number: the Chat tab already carries a
// numeric badge for unread messages, and two different counts on one
// surface teaches people to distrust both. Anything time-critical
// arrives as a push, which deep-links straight to its target.
//
// `head: true` + `count: 'exact'` asks Postgres for the count only —
// no rows cross the wire.
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export function useNotificationUnread(): { hasUnread: boolean; refresh: () => void } {
  const { user } = useAuth();
  const userId = user?.id;
  const [hasUnread, setHasUnread] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHasUnread(false);
      return;
    }
    try {
      const { count, error } = await supabase
        .from('piktag_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      // A failed request is not evidence of "nothing unread" — leave the
      // dot exactly as it was rather than clearing it on a flaky network.
      if (error) return;
      setHasUnread((count ?? 0) > 0);
    } catch {
      /* offline or transport error — keep the last known state */
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check when the user comes back to the screen holding the bell, so
  // the dot clears after they read things and reappears when new ones land.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { hasUnread, refresh };
}

export default useNotificationUnread;
