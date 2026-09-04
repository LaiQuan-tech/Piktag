// warmFriendDetails.ts
//
// Copy every friend's SOCIAL LINKS to disk when the friends list syncs,
// so they are readable offline without having opened that friend first.
//
// Founder, on a device, 2026-09-03:
//
//   目前要曾經查看過該好友才會看到個人檔案，如果在有網路的時候沒有查看
//   過，就會還是看不到內容
//
// He is right, and the previous design had the reasoning backwards. The
// per-friend snapshot (CACHE_KEYS.FRIEND_DETAILS) was written only by
// FriendDetailScreen's own successful fetch, on the theory that the
// friends you need offline are the ones you just looked at. But the case
// this app exists for is the opposite one: you are at a venue with no
// signal, trying to place someone you have NEVER opened. "You should have
// visited them earlier, while online" is not something a user can be
// expected to have done.
//
// So the list warms them all. Links only — deliberately:
//
//   * The CONNECTIONS snapshot already carries the header (name, avatar,
//     nickname, met_at, birthday) and the viewer's own tags on the
//     connection, and FriendDetailScreen already falls back to those for
//     a friend opened for the first time offline. Links are the one
//     section with NO fallback at all; they are also what the founder
//     asked for the first time round (「沒有社交連結、標籤」).
//   * The tag row FriendDetailScreen renders comes from a consolidated
//     RPC with pick counts, mutual flags and hidden tags. Reconstructing
//     an approximation here would write a DIFFERENT tag row than the one
//     the friend's page shows online, and it would take precedence over
//     the connection-tags fallback. A worse answer that outranks a better
//     one is not an improvement.
//
// Cost is two round-trips per 100 friends, on a list refresh that already
// made four. Nothing here ever blocks a render: every failure leaves the
// previous snapshot exactly as it was.

import { supabase } from './supabase';
import { checkOffline } from './netStatus';
import { filterBiolinksByVisibility } from './biolinkVisibility';
import {
  FRIEND_DETAIL_CACHE_MAX_FRIENDS,
  FRIEND_DETAIL_CACHE_MAX_LINKS,
  mergePersistentFriendDetails,
} from './dataCache';
import type { Biolink } from '../types';

// PostgREST puts `.in()` lists in the QUERY STRING, so one request per
// 100 ids keeps the URL far below what proxies and CDNs will accept. A
// 500-friend account would otherwise build a ~19 KB URL and get a 414
// from something in the middle with no useful error.
const ID_BATCH = 100;

type WarmPatch = { biolinks: Biolink[] };

/**
 * Warm the per-friend link snapshots for `friendIds`.
 *
 * Fire-and-forget: callers should not await this on a render path. Safe
 * to call on every list refresh — it is bounded, and it only ever writes
 * on a query that actually answered.
 */
export async function warmFriendDetails(
  userId: string | null | undefined,
  friendIds: string[],
): Promise<void> {
  if (!userId) return;
  // No signal: the friends list is painting from its own snapshot and
  // there is nothing to copy. Returning here writes NOTHING, so the
  // existing snapshots are untouched.
  if (await checkOffline()) return;

  const ids = Array.from(new Set(friendIds.filter(Boolean))).slice(
    0,
    FRIEND_DETAIL_CACHE_MAX_FRIENDS,
  );
  if (ids.length === 0) return;

  const patches: Record<string, WarmPatch> = {};

  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    // Same query FriendDetailScreen makes for one friend, widened to
    // many. Matching it exactly matters: the snapshot this writes has to
    // be indistinguishable from the one a real visit writes, or offline
    // would show a different link list than online did.
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .in('user_id', batch)
      .eq('is_active', true)
      .order('position', { ascending: true });

    // supabase-js RESOLVES with { data: null, error } on a transport
    // failure. Writing `[]` for this batch would erase the links of
    // every friend in it — the exact "a failed fetch degrades a good
    // snapshot" bug this repo has now been bitten by several times. Skip
    // the batch; the next refresh tries again.
    if (error || !data) continue;

    const byUser = new Map<string, Biolink[]>();
    for (const row of data as Biolink[]) {
      const owner = (row as any)?.user_id;
      if (!owner) continue;
      const arr = byUser.get(owner);
      if (arr) arr.push(row);
      else byUser.set(owner, [row]);
    }

    // Every id in the batch gets an entry, INCLUDING the ones with no
    // rows — for them the empty array is the true answer ("this friend
    // has no links"), and it is only safe to write it because the query
    // above is known to have answered.
    for (const friendId of batch) {
      // Everyone here is a confirmed connection, so the visibility tier
      // is at least 'friend'. A close friend may be entitled to see more
      // than this; caching the narrower tier can only ever show FEWER
      // links than they are allowed, never more, and opening that friend
      // online replaces this with the exact list. Under-showing is the
      // safe direction for a visibility filter.
      const visible = filterBiolinksByVisibility(byUser.get(friendId) ?? [], 'friend');
      patches[friendId] = { biolinks: visible.slice(0, FRIEND_DETAIL_CACHE_MAX_LINKS) };
    }
  }

  if (Object.keys(patches).length === 0) return;
  // One read, one write for the whole list.
  await mergePersistentFriendDetails<WarmPatch>(userId, patches);
}

export default warmFriendDetails;
