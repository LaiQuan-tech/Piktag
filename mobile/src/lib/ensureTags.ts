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
import { normalizeTagName } from './normalizeTag';

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
    // Which of these already exist? (Case-sensitive match — a
    // case-variant that slips through just hits the 23505 guard below.)
    const { data: existing } = await supabase
      .from('piktag_tags')
      .select('name')
      .in('name', names);
    const have = new Set(
      (existing || []).map((r: any) => String(r.name).toLowerCase()),
    );
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
