// sanitizeTelemetry.ts
//
// Strip the most common PII shapes from search queries before they
// land in piktag_search_telemetry. The telemetry table is RLS owner-
// only (a user can only ever read their own rows), so this is a
// second line of defense — useful when aggregating across users for
// "which queries keep failing" analysis without an admin needing to
// see raw user input.
//
// We deliberately keep this narrow: emails and long digit runs only.
// Aggressive scrubbing (names, addresses, etc.) would gut the very
// signal we're trying to keep — "people searched '攝影師' a lot" is
// information; "[NAME] searched [REDACTED] a lot" is not. The point
// is to keep digit-strings (phone numbers, ID numbers, CC tails) and
// email addresses out, since those are the high-risk shapes that
// usually appear in queries by accident.

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Catch runs of 7+ consecutive digits (the floor for "could be a
// phone number" — local Taiwan numbers are 8-10 digits; intl can be
// 7-15). Tolerates separators (- . space) between digit chunks.
const PHONE_RE = /(?:\d[\s.-]?){7,}/g;
const MAX_LEN = 120;

/**
 * Reduce a raw search query down to telemetry-safe form. Idempotent;
 * pure; safe to call on already-sanitized output.
 *
 * Returns '' for null / undefined / empty input — telemetry inserter
 * can then write '' rather than null and avoid downstream NULL checks.
 */
export function sanitizeQueryForTelemetry(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.replace(EMAIL_RE, '[EMAIL]').replace(PHONE_RE, '[PHONE]');
  // Collapse any whitespace runs left by replacement.
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN - 1) + '…';
  return s;
}
