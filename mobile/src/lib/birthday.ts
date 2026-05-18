// birthday.ts
//
// ONE canonical normalizer for the birthday value, across every
// entry point (RegisterScreen, Onboarding, EditLocalContact,
// FriendDetail).
//
// AUTHORITATIVE consumer = the pg_cron DB function
// enqueue_birthday_notifications() (migration 20260428120007),
// which is what actually emits the "it's X's birthday" notification.
// Its model:
//   • piktag_connections.birthday is a real DATE column — used
//     directly via EXTRACT(MONTH/DAY).
//   • piktag_profiles.birthday is TEXT, but only counts when it
//     matches ^\d{4}-\d{2}-\d{2}$ (YYYY-MM-DD), then ::date.
//   • piktag_local_contacts.birthday is TEXT and is copied verbatim
//     into piktag_connections.birthday (DATE) by the promote
//     trigger — so it MUST be a date-castable string.
// Only month/day matter (year is ignored), so a year-less birthday
// uses the sentinel year 2000.
//
// => The single correct format is "YYYY-MM-DD" (e.g. 2000-05-08 for
//    a year-less birthday, or 1990-05-08 if a real year is given).
//    NOT "MM/DD" — that can't be stored in the DATE column, breaks
//    the promote cast, and fails the profile-side regex.
//
// (The `daily-birthday-check` edge function does .eq('birthday',
//  'MM/DD'); against a DATE column that can never match — it is the
//  broken/legacy path, not the source of truth.)
//
// Accepts the common shapes a user/import might give — M/D, MM/DD,
// M-D, MM-DD, YYYY-MM-DD, 2000-MM-DD — and returns strict
// "YYYY-MM-DD", or null if empty / unparseable / out of range.
export function toBirthdayDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  let yyyy = 2000;
  let mm: number | null = null;
  let dd: number | null = null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // YYYY-MM-DD / 2000-MM-DD
  if (m) {
    yyyy = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
    dd = parseInt(m[3], 10);
  } else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})$/))) {
    // M/D, MM-DD, MM/DD (year-less)
    mm = parseInt(m[1], 10);
    dd = parseInt(m[2], 10);
  } else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    // YYYYMMDD (no separators)
    yyyy = parseInt(m[1], 10);
    mm = parseInt(m[2], 10);
    dd = parseInt(m[3], 10);
  } else if ((m = s.match(/^(\d{2})(\d{2})$/))) {
    // MMDD (no separator, year-less) — real users type "0713".
    // Month-first matches the app's MM-DD guidance everywhere; an
    // invalid mm (>12) just fails the range check below → null.
    mm = parseInt(m[1], 10);
    dd = parseInt(m[2], 10);
  }

  if (mm == null || dd == null) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  if (yyyy < 1900 || yyyy > 2100) return null;

  return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
