// Burst detection for the post-event batch-tag prompt (founder 2026-07-03,
// event-tag rework "方向一"). The insight: the app already KNOWS the user is
// at an event — adding several connections within an hour is the strongest
// possible signal. Instead of requiring the foresight to create an event QR
// beforehand (the structural reason event tags went unused), the app notices
// the burst after the fact and offers to tag the whole batch in one move.
//
// This is deliberately the first incarnation of BATCH TAGGING: the cohort is
// auto-selected (the last hour's adds); the future full batch-tag feature
// widens selection to any friends, reusing BatchTagScreen.
//
// Scope guards:
//   - Only piktag_connections (the QR-scan/connect path) count — local
//     contacts and ContactSync imports are excluded on purpose: importing an
//     address book is not "being at an event".
//   - @piktag official auto-friend is excluded (counting-surface rule #4).
//   - One burst = one offer. A burst is identified by its NEWEST connection
//     id; once offered (shown), the same burst never re-prompts. Only a NEW
//     connection on top of the window re-arms the offer.

import { supabase } from './supabase';

export type BurstPerson = {
  connectionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
};

const WINDOW_MINUTES = 60;
const MIN_BURST = 3;
const PROMPTED_KEY = 'piktag_burst_tag_prompted_v1';

/**
 * Returns the last hour's connection burst (newest first) when it is worth
 * offering to tag: >= 3 real people AND not already offered for this burst.
 * Best-effort — any failure returns null and the caller proceeds normally.
 */
export async function detectRecentBurst(userId: string): Promise<BurstPerson[] | null> {
  try {
    const sinceIso = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('piktag_connections')
      .select(
        'id, created_at, connected_user:piktag_profiles!connected_user_id(id, full_name, username, avatar_url, is_official)',
      )
      .eq('user_id', userId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data) return null;

    const people: BurstPerson[] = (data as any[])
      .filter((c) => c.connected_user && c.connected_user.is_official !== true)
      .map((c) => ({
        connectionId: c.id as string,
        userId: c.connected_user.id as string,
        name: (c.connected_user.full_name || c.connected_user.username || '') as string,
        avatarUrl: (c.connected_user.avatar_url ?? null) as string | null,
      }));
    if (people.length < MIN_BURST) return null;

    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    if ((await AsyncStorage.getItem(PROMPTED_KEY)) === people[0].connectionId) return null;
    return people;
  } catch {
    return null;
  }
}

/** Mark the burst as offered (call when the prompt is SHOWN, not on save —
 *  a dismissal must not re-prompt until a NEW connection tops the window). */
export async function markBurstOffered(people: BurstPerson[]): Promise<void> {
  try {
    if (!people[0]) return;
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem(PROMPTED_KEY, people[0].connectionId);
  } catch {
    /* best-effort */
  }
}
