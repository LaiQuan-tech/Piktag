// Unread-notification indicator for the header bell (components/
// NotificationBell — in the Connections header since 2026-11-18, when the
// chat UI that used to hold it was taken down).
//
// The bell lost its tab on 2026-09-01 (event tags took the slot), so the
// only in-app sign that something is waiting is the dot this drives.
// Deliberately a DOT, not a number: it began beside the Chat tab's
// numeric unread-message badge, where two different counts on one
// surface teach people to distrust both; a dot is still all it needs. Anything time-critical
// arrives as a push, which deep-links straight to its target.
//
// `head: true` + `count: 'exact'` asks Postgres for the count only —
// no rows cross the wire.
import { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { RETIRED_NOTIFICATION_TYPES_PGRST } from '../lib/notificationTypes';

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
        .eq('is_read', false)
        // Retired chat / Ask types (server still writes them for old app
        // versions) are hidden from the feed, so they must not light the
        // dot either — otherwise it can never be cleared.
        .not('type', 'in', RETIRED_NOTIFICATION_TYPES_PGRST);
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
