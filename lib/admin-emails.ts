/**
 * Server-only. Check if an email is in the admin allowlist.
 *
 * ADMIN_EMAILS env var is a comma-separated list of lowercase emails.
 * We use strict equals (case-insensitive) to prevent substring bypass like
 *   `alice@admin.com.evil.com` matching `alice@admin.com` via `includes()`.
 */
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return getAdminEmails().includes(normalized);
}
