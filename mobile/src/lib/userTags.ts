// userTags.ts
//
// Canonical "attach a tag to a user" persistence — extracted 2026-06-05
// for the onboarding wizard Step 2 (which needed tag-adding but had no
// tag UI). The tricky part is findOrCreateTag's race handling: a
// concurrent client can create the same tag between our SELECT and
// INSERT, so the INSERT hits piktag_tags' UNIQUE INDEX on lower(name)
// (Postgres 23505) and we must re-SELECT the winner's id. Getting that
// wrong surfaces as "標籤加不了" for any tag whose stored case differs
// from what the user typed.
//
// ManageTagsScreen + EditProfileScreen still carry their own inline
// copies of this logic (findOrCreateTag / linkTagToUser); they should
// migrate to these helpers in a follow-up so there's ONE source of
// truth (founder DRY rule). New code (onboarding) uses this from day 1.

import { supabase } from './supabase';
import { ilikeEscape } from './normalizeTag';

/**
 * Resolve a tag NAME to its piktag_tags id, creating the row if needed.
 * Case-insensitive (the table's UNIQUE INDEX is on lower(name)).
 * Returns null only on a genuine failure (never on the create-race —
 * that's handled by re-selecting the 23505 winner).
 */
export async function findOrCreateTag(name: string): Promise<string | null> {
  let { data: tag } = await supabase
    .from('piktag_tags')
    .select('id')
    .ilike('name', ilikeEscape(name))
    .maybeSingle();
  if (!tag) {
    const { data: newTag, error: insertErr } = await supabase
      .from('piktag_tags')
      .insert({ name })
      .select('id')
      .single();
    if (newTag) {
      tag = newTag;
    } else if (insertErr && (insertErr as any).code === '23505') {
      // Lost the create race — re-select the winner (case-insensitive,
      // matching the lower(name) index).
      const { data: raced } = await supabase
        .from('piktag_tags')
        .select('id')
        .ilike('name', ilikeEscape(name))
        .maybeSingle();
      tag = raced ?? null;
    }
  }
  return tag?.id ?? null;
}

/**
 * Link an existing tag id to a user (piktag_user_tags row) + bump the
 * tag's usage counter. `position` is the new row's display order.
 * Returns true on success. Best-effort usage bump (non-fatal).
 */
export async function addUserTag(
  userId: string,
  tagId: string,
  position: number,
): Promise<boolean> {
  const { error } = await supabase
    .from('piktag_user_tags')
    .insert({ user_id: userId, tag_id: tagId, position });
  if (error) return false;
  await supabase.rpc('increment_tag_usage', { tag_id: tagId });
  return true;
}

/**
 * Convenience: resolve a name and link it to the user in one call.
 * Returns the tag id on success, null on failure.
 */
export async function addUserTagByName(
  userId: string,
  name: string,
  position: number,
): Promise<string | null> {
  const tagId = await findOrCreateTag(name);
  if (!tagId) return null;
  const ok = await addUserTag(userId, tagId, position);
  return ok ? tagId : null;
}
