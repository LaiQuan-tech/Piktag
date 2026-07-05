// eventRoom.ts — the ONE way into 「這場的人」 (extracted 2026-07-05).
//
// Three surfaces open the room (UserDetail's post-connect modal,
// FriendDetail's re-entry row, QrGroupList's 我參加的 section) and all
// carry the same contract: the tap IS the labeled visibility opt-in →
// set_event_visibility (SECURITY DEFINER; validates REAL membership
// server-side) → EventAttendeesScreen. Keeping the sequence here means
// a future change (e.g. an analytics event, an error toast) lands on
// every entry at once instead of drifting per screen.

import { supabase } from './supabase';

export async function joinEventRoom(navigation: any, sessionId: string): Promise<void> {
  try {
    await supabase.rpc('set_event_visibility', {
      p_session_id: sessionId,
      p_visible: true,
    });
    navigation.navigate('EventAttendees', { sessionId });
  } catch (e) {
    console.warn('[eventRoom] opt-in/open failed:', e);
  }
}
