// usePendingScans.ts
//
// Phase 3 of "Magic Onboarding": read-only surface of people who
// scanned the current member's QR and left a name on the web page
// but haven't installed/registered yet (piktag_pending_connections,
// status='pending', scanner_name set). Backed by the get_pending_scans
// SECURITY DEFINER RPC (scoped server-side to auth.uid() = host).
//
// Mirrors useLocalContacts' shape so ConnectionsScreen integrates it
// the same way. Resolved rows (scanner registered → existing
// resolve_pending_connections promoted them to a real connection)
// stop being returned automatically, so they just disappear here and
// reappear as a normal friend — no client cleanup.

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export type PendingScan = {
  id: string;
  scanner_name: string;
  event_tags: string[] | null;
  event_location: string | null;
  created_at: string;
};

export function usePendingScans() {
  const { user } = useAuth();
  const [scans, setScans] = useState<PendingScan[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase.rpc('get_pending_scans');
      if (!error && Array.isArray(data)) {
        setScans(data as PendingScan[]);
      }
    } catch (err) {
      console.warn('[usePendingScans] refresh failed:', err);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { scans, refresh };
}
