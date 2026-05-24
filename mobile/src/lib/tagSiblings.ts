// tagSiblings.ts
//
// "Concept-sibling expansion" is the piece of logic that makes
// PikTag's cross-language matching work: given a tag, return every
// other tag sharing the same `concept_id`. Auto-link-concepts +
// the LLM judge group cross-language synonyms under one concept,
// and search / TagDetail expand through this to find every variant.
//
// Before this module the same dance was hand-rolled in three places
// (TagDetailScreen.getSiblingTagIds, SearchScreen.handleSearchByTags,
// SearchScreen.private-world-effect). Per CLAUDE.md "don't reinvent;
// match existing patterns" — one helper, three callers.

import { supabase } from './supabase';

/**
 * Given a tag id, return every tag id sharing its concept (including
 * the input tag). For tags with NULL concept_id (linker hasn't run
 * yet) we return just the input. Never returns [] — the input id is
 * always present so callers can safely .in('tag_id', result).
 */
export async function getSiblingTagIds(tagId: string): Promise<string[]> {
  if (!tagId) return [];
  try {
    const { data: tagRow } = await supabase
      .from('piktag_tags')
      .select('concept_id')
      .eq('id', tagId)
      .single();
    if (!tagRow?.concept_id) return [tagId];
    const { data: siblings } = await supabase
      .from('piktag_tags')
      .select('id')
      .eq('concept_id', tagRow.concept_id);
    if (!siblings || siblings.length === 0) return [tagId];
    return [...new Set([tagId, ...siblings.map((s: any) => s.id)])];
  } catch (err) {
    console.warn('[getSiblingTagIds] failed for', tagId, err);
    return [tagId];
  }
}

/**
 * Multi-tag variant — given several tag ids that may belong to
 * different concepts, return the union of all siblings (no
 * duplicates). Uses `concept_id IN (...)` so it's one round-trip
 * regardless of input size.
 */
export async function expandSiblingTagIds(tagIds: string[]): Promise<string[]> {
  const seedIds = [...new Set(tagIds.filter(Boolean))];
  if (seedIds.length === 0) return [];
  try {
    const { data: tagRows } = await supabase
      .from('piktag_tags')
      .select('concept_id')
      .in('id', seedIds);
    const conceptIds = [
      ...new Set((tagRows || []).map((r: any) => r.concept_id).filter(Boolean)),
    ];
    if (conceptIds.length === 0) return seedIds;
    const { data: siblings } = await supabase
      .from('piktag_tags')
      .select('id')
      .in('concept_id', conceptIds);
    if (!siblings || siblings.length === 0) return seedIds;
    return [
      ...new Set([...seedIds, ...siblings.map((s: any) => s.id)]),
    ];
  } catch (err) {
    console.warn('[expandSiblingTagIds] failed:', err);
    return seedIds;
  }
}

/**
 * Fetch the visible names for a set of tag ids. Used in tandem with
 * the sibling helpers when matching against piktag_local_contacts.tags
 * (which stores plain name strings, not FKs, so we match by name).
 */
export async function getTagNamesByIds(tagIds: string[]): Promise<string[]> {
  const ids = [...new Set(tagIds.filter(Boolean))];
  if (ids.length === 0) return [];
  try {
    const { data } = await supabase
      .from('piktag_tags')
      .select('name')
      .in('id', ids);
    return (data || [])
      .map((r: any) => r.name)
      .filter((n: any): n is string => typeof n === 'string' && n.length > 0);
  } catch (err) {
    console.warn('[getTagNamesByIds] failed:', err);
    return [];
  }
}
