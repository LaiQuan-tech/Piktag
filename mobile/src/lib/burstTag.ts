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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { CACHE_KEYS, getPersistentCache, setPersistentCache } from './dataCache';

export type BurstPerson = {
  connectionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
};

const WINDOW_MINUTES = 60;
const MIN_BURST = 3;
// ── 2026-08-08: off the device-global key ────────────────────────────
// This stored one of the viewer's piktag_connections ids under a
// device-global key that sign-out never cleared, so on a shared phone
// user A's burst marker suppressed (or mis-armed) user B's prompt. It
// now lives under CACHE_KEYS.BURST_TAG_PROMPT, keyed by user id and
// therefore swept by clearPersistentCaches(). The legacy key is deleted,
// never read — same contract as every other migration here. The only
// cost is that one user may be offered one burst a second time.
const LEGACY_PROMPTED_KEY = 'piktag_burst_tag_prompted_v1';

let legacyPromptPurged = false;

async function purgeLegacyPromptKey(): Promise<void> {
  if (legacyPromptPurged) return;
  legacyPromptPurged = true;
  try {
    await AsyncStorage.removeItem(LEGACY_PROMPTED_KEY);
  } catch {
    /* best-effort */
  }
}

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

    void purgeLegacyPromptKey();
    const prompted = await getPersistentCache<string>(
      CACHE_KEYS.BURST_TAG_PROMPT,
      userId,
    );
    if (prompted === people[0].connectionId) return null;
    return people;
  } catch {
    return null;
  }
}

/** Mark the burst as offered (call when the prompt is SHOWN, not on save —
 *  a dismissal must not re-prompt until a NEW connection tops the window). */
export async function markBurstOffered(
  userId: string,
  people: BurstPerson[],
): Promise<void> {
  try {
    if (!userId || !people[0]) return;
    await setPersistentCache<string>(
      CACHE_KEYS.BURST_TAG_PROMPT,
      userId,
      people[0].connectionId,
    );
  } catch {
    /* best-effort */
  }
}
