-- 20260530030000_backfill_language_en_to_null.sql
--
-- Backfill existing 'en' values to NULL on piktag_profiles.language.
--
-- Context (chained from 20260530010000):
--   The column had DEFAULT 'en' set in Supabase Studio (not via
--   migration). 20260530010000 dropped the default so new rows are
--   honestly NULL, but existing rows still carry 'en' regardless of
--   whether the user actually picked English or was just born with
--   the database default.
--
-- I previously left those rows alone with the rationale "we can't
-- distinguish real picks from defaults, better to preserve."
-- Re-examined 2026-05-30 with the founder and decided the OPPOSITE
-- is true:
--
--   • Nothing reads piktag_profiles.language right now — not server,
--     not client (commit 8dd4c24 broke the only client read site
--     and routed i18n through AsyncStorage + device locale).
--   • The instant we add localized notifications (digest emails,
--     push body i18n) — the future use this column is being held
--     for — having 'en' on a Taiwanese user's row will send them
--     English copy when zh-TW would have been correct. That's
--     WORSE than NULL (which a competent fallback treats as
--     "unknown → device locale or English").
--   • Preserving "the user might have picked English" is an
--     imagined cost. The actual user signal lives in AsyncStorage
--     on their device. If they really want English, they re-pick.
--
-- Pre-launch user base is tiny, so the blast radius is small even
-- if I'm wrong. Doing the honest cleanup now beats waiting until
-- localized-notification time and discovering the mass mis-tagging.

UPDATE public.piktag_profiles
SET language = NULL
WHERE language = 'en';
