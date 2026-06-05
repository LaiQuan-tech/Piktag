// Pragmatic client-side email format check (防呆). Catches the common
// mistakes — missing @, missing domain/TLD, stray spaces — BEFORE a
// signup / login round-trip, so the user gets immediate feedback instead
// of a generic server error ("收下了卻默默失敗" is the pattern to avoid).
// Deliberately NOT RFC-complete: the auth server is the final word; this
// just gates the obvious garbage.
export function isValidEmail(email: string): boolean {
  const e = (email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
