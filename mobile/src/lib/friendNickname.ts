// friendNickname.ts
//
// ONE write path for "the name I call this friend".
//
// `piktag_connections.nickname` is the viewer's private display-name
// override — the friends list, search, tag detail, the location list and
// both profile screens all read `nickname || full_name || username`. Two
// screens can now EDIT it (FriendDetail and UserDetail), and a rename is
// not a one-line update: it has to detect a zero-row write, revert its own
// optimistic paint on failure, ignore itself if a newer rename has started,
// drop the in-memory connections cache and patch the disk snapshot.
//
// Copying that into a second screen is how the two paths drift. This repo
// already paid for that lesson this week: the contact rename used
// `.select()` and could see a zero-row write, the friend rename did not,
// and they disagreed about whether a save had succeeded. So the logic
// lives here and both screens call it.
//
// The screens keep their own optimistic UI, because what to repaint is
// screen-specific — a reducer on one, plain state on the other. This owns
// the WRITE and the CACHES; they own the pixels.

import { supabase } from './supabase';
import {
  CACHE_KEYS,
  getPersistentCache,
  setPersistentCache,
  invalidateCache,
} from './dataCache';

/** Narrow shape of a cached connections row — only what is touched here. */
type CachedRow = {
  connected_user_id?: string;
  connected_user?: { id?: string } | null;
  nickname?: string | null;
};

export type SaveNicknameResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'noop' | 'failed' };

/**
 * Read the viewer's nickname for a friend out of the connections snapshot.
 *
 * No network: the snapshot is written by the friends list on every
 * successful load, so this answers instantly and works with no signal. A
 * screen that has the nickname from its own fetch should prefer that; this
 * is for screens whose fetch does not carry it (get_user_detail does not).
 */
export async function readCachedNickname(
  userId: string | null | undefined,
  friendId: string | null | undefined,
): Promise<string | null> {
  if (!userId || !friendId) return null;
  try {
    const cached = await getPersistentCache<CachedRow[]>(CACHE_KEYS.CONNECTIONS, userId);
    if (!Array.isArray(cached)) return null;
    const row = cached.find(
      (c) => (c?.connected_user_id ?? c?.connected_user?.id) === friendId,
    );
    return row?.nickname ?? null;
  } catch {
    return null;
  }
}

/**
 * Write the nickname, and keep every cache that shows a name in step.
 *
 * `previous` is what the caller optimistically replaced, so a failure can
 * be reported precisely rather than guessed at. An empty `next` stores
 * NULL, which reverts the display to the person's real name — the way out
 * of a nickname, without a delete button.
 */
export async function saveFriendNickname({
  userId,
  connectionId,
  friendId,
  next,
  previous,
}: {
  userId: string;
  connectionId: string;
  friendId: string;
  next: string;
  previous: string | null;
}): Promise<SaveNicknameResult> {
  const trimmed = next.trim();
  const value = trimmed.length > 0 ? trimmed : null;
  // Nothing to do is not a write. Without this an identical nickname is
  // rewritten on every accidental open-and-confirm.
  if (value === previous) return { ok: false, reason: 'noop' };

  // `.select()` so a zero-row update is VISIBLE. PostgREST answers a filter
  // matching nothing with 204 and error === null, so without it a rename
  // that stored nothing reported success: the header kept the new name and
  // the snapshot was patched with a nickname the server does not have. That
  // happens for real — the row can be gone (unfriended on another device)
  // while a stale connectionId still rides along from a cached list.
  const { data: updated, error } = await supabase
    .from('piktag_connections')
    .update({ nickname: value })
    .eq('id', connectionId)
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    console.warn(
      '[friendNickname] save failed:',
      error ?? 'no row updated (connection gone, or RLS denied)',
    );
    return { ok: false, reason: 'failed' };
  }

  // The friends list reads the IN-MEMORY layer first and only falls back to
  // disk when that is missing (a 5-minute TTL entry). Patching only the
  // disk copy left the rename invisible on the list until that expired.
  invalidateCache(CACHE_KEYS.CONNECTIONS);

  // And the disk snapshot, or the list — and every offline read of it —
  // shows the old name until the next fully successful fetch, which with
  // no signal could be days.
  try {
    const cached = await getPersistentCache<CachedRow[]>(CACHE_KEYS.CONNECTIONS, userId);
    if (Array.isArray(cached)) {
      await setPersistentCache(
        CACHE_KEYS.CONNECTIONS,
        userId,
        cached.map((c) =>
          (c?.connected_user_id ?? c?.connected_user?.id) === friendId
            ? { ...c, nickname: value }
            : c,
        ),
      );
    }
  } catch {
    /* best-effort, same contract as every other snapshot write */
  }

  return { ok: true, value };
}
