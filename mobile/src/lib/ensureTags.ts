// ensureTags.ts
//
// A tag only enters PikTag's semantic engine once it exists as a row
// in `piktag_tags` — the global tag registry. The concept linker
// (auto-link-concepts edge function) scans `piktag_tags` for rows with
// `concept_id IS NULL`; anything not in that table is never embedded,
// never concept-linked, and therefore never cross-language / concept
// matched.
//
// Member-friend tags get a piktag_tags row for free: piktag_connection_tags
// has a tag_id FK, so the tagging flow MUST resolve/create the row.
// Local-contact tags do NOT — piktag_local_contacts.tags is a plain
// text[] with no FK. Without this helper a contact tagged "Rotary"
// stays a bare string the semantic engine can't see, which guts the
// North Star ("a non-member local contact with strong tags is future
// serendipity fuel").
//
// ensureTagsRegistered registers each missing name into piktag_tags so the linker
// picks it up on its next pass. Best-effort and safe to fire-and-forget:
// a failed registration just means that tag isn't concept-linked YET —
// no corruption, and a later edit re-attempts it.

import { supabase } from './supabase';
import { normalizeTagName, ilikeEscape } from './normalizeTag';

/**
 * Make sure every given tag name exists in piktag_tags (the global tag
 * registry) so the concept linker can pick it up. Idempotent,
 * case-insensitive (piktag_tags has a UNIQUE INDEX on lower(name)),
 * best-effort — callers may fire-and-forget.
 */
export async function ensureTagsRegistered(rawNames: string[]): Promise<void> {
  const names = [
    ...new Set(rawNames.map(normalizeTagName).filter(Boolean)),
  ];
  if (names.length === 0) return;
  try {
    // Which of these already exist? piktag_tags has UNIQUE INDEX on
    // lower(name), so case-variant lookups MUST be case-insensitive or we
    // double-INSERT and waste a 23505 round-trip per variant. PostgREST
    // .in() is case-sensitive with no lower()-on-column option, so we
    // probe per-name with .ilike. Typical caller hands us ≤ ~10 names
    // (per local-contact save), so the N-query path is fine.
    const have = new Set<string>();
    for (const n of names) {
      const { data } = await supabase
        .from('piktag_tags')
        .select('name')
        .ilike('name', ilikeEscape(n))
        .maybeSingle();
      if (data) have.add(n.toLowerCase());
    }
    const missing = names.filter((n) => !have.has(n.toLowerCase()));
    // Insert one at a time: a single duplicate (23505 — lost a race, or
    // a lower(name) case-variant already exists) must not abort the rest.
    for (const name of missing) {
      const { error } = await supabase.from('piktag_tags').insert({ name });
      if (error && (error as any).code !== '23505') {
        console.warn('[ensureTagsRegistered] insert failed for', name, error.message);
      }
    }
  } catch (err) {
    console.warn('[ensureTagsRegistered] failed:', err);
  }
}
