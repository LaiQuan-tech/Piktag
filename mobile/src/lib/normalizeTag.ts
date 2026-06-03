// normalizeTag.ts
//
// One canonical tag-name normalizer shared by every surface that
// lets a user type a tag (AddTag event tags, ManageTags, Ask
// composer, …). Before this, each screen rolled its own:
//   • AddTagScreen      — only trim(): a typed "#design" was stored
//                          LITERALLY as "#design" then rendered as
//                          "##design" → a distinct, broken tag.
//   • ManageTagsScreen  — trim().replace(/^#/,'')  (single # only)
//   • AskStoryRow        — replace(/^#+/,'').trim()
// Net effect: "#design", "design", "design " could become three
// different rows in the global tag pool depending on entry point.
//
// Deliberately does NOT lower-case. The live piktag_tags pool is
// mixed-case and used for display; case-folding here would split or
// merge existing tags unpredictably and change how they render.
// Scope is purely structural: drop leading '#'(s), trim ends,
// collapse internal whitespace runs. Length limits stay at the
// call site (they differ — some cap, some reject).
export function normalizeTagName(raw: string): string {
  return (raw || '')
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Escape SQL LIKE wildcards (% and _) and backslash so a tag name passed
// to PostgREST `.ilike("name", X)` matches X literally, just case-
// insensitively. piktag_tags carries TWO unique indexes on `name`:
//   • piktag_tags_name_key — case-sensitive UNIQUE(name)
//   • idx_piktag_tags_name_unique — UNIQUE(lower(name)) (functional)
// A case-sensitive `.eq("name", X)` will MISS an existing row whose
// case differs (e.g. lookup "Piktag" while the row is "PikTag"); the
// subsequent INSERT then hits the lower() index → 23505; the 23505
// fallback re-select is ALSO case-sensitive → false negative → the
// user sees "標籤加不了" even though the tag exists. Switching the
// SELECTs to `.ilike("name", ilikeEscape(X))` matches the lower()
// index efficiently and returns the existing row regardless of case.
// `_` and `%` in a tag name (rare but legal) would otherwise act as
// wildcards and either over-match (wrong tag id) or fail to escape
// across PostgREST → SQL boundaries; the explicit escape closes both.
export function ilikeEscape(s: string): string {
  return s.replace(/[\\_%]/g, '\\$&');
}
