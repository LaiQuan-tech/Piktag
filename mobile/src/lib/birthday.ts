// birthday.ts
//
// ONE canonical normalizer for the self-declared profile birthday.
//
// The daily-birthday-check edge function matches with a STRICT
// equality: piktag_profiles.birthday = 'MM/DD' (zero-padded, slash,
// no year — e.g. "05/08"). Anything else ("5/8", "05-08",
// "1990-05-08", "2000-05-08") will never .eq() today's "MM/DD", so
// the birthday notification silently never fires — and birthday
// reminders are the core of the CRM, so a format slip = the feature
// quietly not working.
//
// RegisterScreen previously stored the raw typed string; Onboarding
// had no birthday field at all (so OAuth users never set one). This
// makes every entry point produce the exact format the cron needs.
//
// Accepts the common shapes a user (or a card/profile import) might
// give — M/D, MM/DD, M-D, MM-DD, YYYY-MM-DD, the 2000-MM-DD sentinel
// — and returns strict "MM/DD", or null if empty / unparseable /
// out of range (caller decides whether to warn or skip).
export function toBirthdayMMDD(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  let mm: number | null = null;
  let dd: number | null = null;

  let m = s.match(/^(\d{1,2})[/-](\d{1,2})$/); // M/D, MM-DD, etc.
  if (m) {
    mm = parseInt(m[1], 10);
    dd = parseInt(m[2], 10);
  } else {
    m = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/); // YYYY-MM-DD / 2000-MM-DD
    if (m) {
      mm = parseInt(m[1], 10);
      dd = parseInt(m[2], 10);
    }
  }

  if (mm == null || dd == null) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  return `${String(mm).padStart(2, '0')}/${String(dd).padStart(2, '0')}`;
}
