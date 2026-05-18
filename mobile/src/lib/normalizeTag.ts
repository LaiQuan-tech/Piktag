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
