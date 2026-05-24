-- 20260518010000_birthday_format_backfill.sql
--
-- One-time data fix so the birthday-notification CRM works.
--
-- AUTHORITATIVE consumer = pg_cron fn enqueue_birthday_notifications
-- (20260428120007). It needs:
--   • piktag_connections.birthday — a real DATE column. Already a
--     valid date for every row (the column type enforces it); the
--     cron EXTRACT()s month/day. NOTHING TO BACKFILL HERE — and a
--     regex on a date column is an error (that's the failure the
--     first version of this migration hit).
--   • piktag_profiles.birthday — TEXT, counted ONLY when it matches
--     ^\d{4}-\d{2}-\d{2}$ then ::date.
--   • piktag_local_contacts.birthday — TEXT, copied verbatim into
--     piktag_connections.birthday (DATE) by the promote trigger, so
--     it must be a date-castable string.
--
-- => Canonical text format = YYYY-MM-DD (year-less → 2000-MM-DD).
-- This backfills the two TEXT columns from the historical mix
-- (M/D, MM-DD, MM/DD, 1990-5-8, and the briefly-shipped wrong MM/DD)
-- to strict YYYY-MM-DD.
--
-- Idempotent & safe:
--   • Rows already '^\d{4}-\d{2}-\d{2}$' are skipped (re-runnable).
--   • Only parseable shapes are touched; range-checked (1-12/1-31).
--   • Unparseable values are LEFT AS-IS (not nulled) — the app
--     re-normalizes them on the next edit.
--   • piktag_connections is intentionally NOT touched (DATE column,
--     already correct).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['piktag_profiles','piktag_local_contacts']) AS tbl
  LOOP
    EXECUTE format($f$
      WITH norm AS (
        SELECT id,
          CASE
            -- YYYY-M-D (real year, maybe not zero-padded) → keep year
            WHEN birthday ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' THEN
              (regexp_match(birthday,'^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$'))[1]
              || '-' ||
              lpad((regexp_match(birthday,'^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$'))[2],2,'0')
              || '-' ||
              lpad((regexp_match(birthday,'^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$'))[3],2,'0')
            -- year-less M/D, MM-DD, MM/DD → 2000-MM-DD sentinel
            WHEN birthday ~ '^[0-9]{1,2}[-/][0-9]{1,2}$' THEN
              '2000-' ||
              lpad((regexp_match(birthday,'^([0-9]{1,2})[-/]([0-9]{1,2})$'))[1],2,'0')
              || '-' ||
              lpad((regexp_match(birthday,'^([0-9]{1,2})[-/]([0-9]{1,2})$'))[2],2,'0')
            ELSE NULL
          END AS iso
        FROM %1$I
        WHERE birthday IS NOT NULL
          AND birthday <> ''
          AND birthday !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      )
      UPDATE %1$I t
      SET birthday = n.iso
      FROM norm n
      WHERE t.id = n.id
        AND n.iso IS NOT NULL
        AND split_part(n.iso,'-',2)::int BETWEEN 1 AND 12
        AND split_part(n.iso,'-',3)::int BETWEEN 1 AND 31;
    $f$, r.tbl);
  END LOOP;
END $$;
