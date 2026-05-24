// followUser.ts
//
// Single helper for "I want to follow this person" — wraps the two
// inserts that ALWAYS need to happen together but were historically
// done in only some of the places that triggered a follow:
//
//   1. piktag_follows  ← the directional "I follow them" relationship
//   2. piktag_connections ← my address-book / CRM record for them
//
// Why both: ConnectionsScreen displays `connections ∩ follows` (a
// connection only shows up if you're also following). SearchScreen
// splits results into "friends / explore" by intersecting against
// piktag_connections. FriendDetailScreen's tag picker writes
// hidden_tags against a connection_id. Without the connection row,
// the followed user is invisible in every UI surface that ranks
// "people I know" — they exist only as a row in piktag_follows that
// nothing else queries by default. The user reports it as "I tapped
// follow but they disappeared" — a confusing dead-end.
//
// The previous behavior was inconsistent:
//   - UserDetailScreen.handleToggleFollow:  inserts both ✓
//   - FriendDetailScreen.handleToggleFollow: inserts only follows ✗
//   - FriendDetailScreen recommended-list:  inserts only follows ✗
//   - UserDetailScreen recommended-list:    inserts only follows ✗
//
// Funnelling all four through this helper guarantees the contract.

import { supabase } from './supabase';

export type FollowResult = {
  /** Connection row id — present when a connection was found or
   *  newly created. Callers that subsequently want to attach
   *  hidden tags / notes / picked-public-tags should thread this
   *  through (it's the FK target). */
  connectionId: string | null;
  /** Whichever step failed first, or null on full success. Even if
   *  this is non-null the follow may have succeeded — check the
   *  caller's needs. */
  error: any | null;
};

/**
 * Follow the given user. Idempotent — safe to call when the viewer
 * already follows or is already connected.
 *
 * @param followerId  the viewer's auth.users.id
 * @param followingId the user being followed
 */
export async function followUser(
  followerId: string,
  followingId: string,
): Promise<FollowResult> {
  // 1. Follow row. onConflict tolerates the "already followed" case
  //    silently — same as a no-op tap.
  const { error: followErr } = await supabase
    .from('piktag_follows')
    .upsert(
      { follower_id: followerId, following_id: followingId },
      { onConflict: 'follower_id,following_id' },
    );
  if (followErr) {
    return { connectionId: null, error: followErr };
  }

  // 2. Connection row. We need the id back so the caller can attach
  //    tags afterwards (e.g. FriendDetailScreen's pickTag modal).
  //    Strategy:
  //      a) try to find an existing row — preserves any prior
  //         met_at / met_location / nickname / note / birthday set
  //         when the contact was first imported via QR scan, contact
  //         sync, or local_contact promotion
  //      b) if none, create one with met_at=now
  //
  //    Avoiding a blind upsert here because ON CONFLICT DO UPDATE
  //    would silently overwrite the user's existing met-at /
  //    location with stale "follow time" data, which feels wrong.
  const { data: existing } = await supabase
    .from('piktag_connections')
    .select('id')
    .eq('user_id', followerId)
    .eq('connected_user_id', followingId)
    .maybeSingle();

  if (existing?.id) {
    return { connectionId: existing.id, error: null };
  }

  const { data: created, error: createErr } = await supabase
    .from('piktag_connections')
    .insert({
      user_id: followerId,
      connected_user_id: followingId,
      met_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createErr) {
    // Follow succeeded; connection insert failed (maybe a race —
    // another tab created the row between our select and insert).
    // Try a defensive re-select before giving up.
    const { data: raceWinner } = await supabase
      .from('piktag_connections')
      .select('id')
      .eq('user_id', followerId)
      .eq('connected_user_id', followingId)
      .maybeSingle();
    if (raceWinner?.id) {
      return { connectionId: raceWinner.id, error: null };
    }
    console.warn('[followUser] connection insert failed:', createErr);
    return { connectionId: null, error: createErr };
  }

  return { connectionId: created?.id ?? null, error: null };
}
