-- 20260518010000_birthday_format_backfill.sql
--
-- One-time data fix for the birthday-notification CRM bug.
--
-- daily-birthday-check matches with a STRICT equality:
--     .eq('birthday', 'MM/DD')   -- zero-padded, slash, no year
-- on BOTH piktag_profiles.birthday AND piktag_connections.birthday.
--
-- Historically these were written in mixed formats:
--   • RegisterScreen      — raw user input ("5/8", "1990-05-08", …)
--   • EditLocalContact    — "2000-MM-DD" (→ promoted into
--                            piktag_connections.birthday as-is)
--   • FriendDetail editor — "2000-MM-DD"
-- None of those ever equal today's "MM/DD", so the birthday
-- notification silently never fired for those rows.
--
-- The app code is now fixed to always WRITE strict "MM/DD"
-- (lib/birthday.ts toBirthdayMMDD, used by Register / Onboarding /
-- EditLocalContact / FriendDetail). This migration backfills the
-- EXISTING rows in all three tables to the same format.
--
-- Idempotent & safe:
--   • Rows already '^\d{2}/\d{2}$' are skipped (re-runnable).
--   • Only parseable shapes are touched; the final range check
--     (month 1-12, day 1-31) prevents writing garbage.
--   • Unparseable values are LEFT AS-IS (not nulled) — the app
--     re-normalizes them on the next edit.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['piktag_profiles','piktag_connections','piktag_local_contacts']) AS tbl
  LOOP
    EXECUTE format($f$
      WITH norm AS (
        SELECT id,
          CASE
            WHEN birthday ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' THEN
              lpad((regexp_match(birthday,'^[0-9]{4}-([0-9]{1,2})-([0-9]{1,2})$'))[1],2,'0')
              || '/' ||
              lpad((regexp_match(birthday,'^[0-9]{4}-([0-9]{1,2})-([0-9]{1,2})$'))[2],2,'0')
            WHEN birthday ~ '^[0-9]{1,2}[-/][0-9]{1,2}$' THEN
              lpad((regexp_match(birthday,'^([0-9]{1,2})[-/]([0-9]{1,2})$'))[1],2,'0')
              || '/' ||
              lpad((regexp_match(birthday,'^([0-9]{1,2})[-/]([0-9]{1,2})$'))[2],2,'0')
            ELSE NULL
          END AS mmdd
        FROM %1$I
        WHERE birthday IS NOT NULL
          AND birthday <> ''
          AND birthday !~ '^[0-9]{2}/[0-9]{2}$'
      )
      UPDATE %1$I t
      SET birthday = n.mmdd
      FROM norm n
      WHERE t.id = n.id
        AND n.mmdd IS NOT NULL
        AND split_part(n.mmdd,'/',1)::int BETWEEN 1 AND 12
        AND split_part(n.mmdd,'/',2)::int BETWEEN 1 AND 31;
    $f$, r.tbl);
  END LOOP;
END $$;
