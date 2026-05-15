-- 20260516000000_scan_session_fk_set_null.sql
--
-- Fix: deleting a Vibe (piktag_scan_sessions row) fails whenever
-- ANY friend was added through that Vibe.
--
-- Root cause: a BASE-SCHEMA foreign key (not defined in any
-- migration file — it predates the migration history, created
-- with the original Supabase schema) constrains
--   piktag_connections.scan_session_id → piktag_scan_sessions(id)
-- with ON DELETE NO ACTION. So Postgres refuses to delete a
-- scan_sessions row while any connection still references it,
-- raising FK-violation 23503. The QrGroupListScreen delete then
-- surfaces "刪除失敗".
--
-- Why SET NULL (not CASCADE, not RESTRICT):
--   • The delete-confirmation copy explicitly promises
--     「已經透過這個 QR 加你為好友的人不會受影響」 — the
--     friendships must survive. CASCADE would delete them.
--   • scan_session_id on a connection is provenance metadata
--     ("which Vibe we met at"). Once the Vibe is deleted that
--     breadcrumb is meaningless anyway — nulling it is the
--     correct, lossless-for-the-relationship outcome.
--   • RESTRICT/NO ACTION (status quo) is exactly the bug.
--
-- Idempotent: discovers the actual FK constraint name at runtime
-- (base-schema constraints don't have a predictable name), drops
-- whatever FK currently points column→table, ensures the column
-- is nullable so SET NULL can fire, then recreates the FK with
-- ON DELETE SET NULL. Safe to re-run — if the FK is already
-- SET NULL the drop+recreate just reasserts the same thing.

DO $$
DECLARE
  v_conname text;
BEGIN
  -- 1. Find the FK on piktag_connections.scan_session_id that
  --    targets piktag_scan_sessions, whatever it's named.
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class    rel  ON rel.oid  = con.conrelid          -- referencing table
  JOIN pg_class    fref ON fref.oid = con.confrelid         -- referenced table
  JOIN pg_attribute att ON att.attrelid = con.conrelid
                       AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND rel.relname  = 'piktag_connections'
    AND fref.relname = 'piktag_scan_sessions'
    AND att.attname  = 'scan_session_id'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.piktag_connections DROP CONSTRAINT %I',
      v_conname
    );
  END IF;
END $$;

-- 2. SET NULL requires the column to be nullable.
ALTER TABLE public.piktag_connections
  ALTER COLUMN scan_session_id DROP NOT NULL;

-- 3. Recreate the FK with the correct delete behaviour.
--    NOT VALID would skip validating existing rows; we WANT it
--    validated (existing rows already satisfy the FK since the
--    old constraint enforced it), so add it normally.
ALTER TABLE public.piktag_connections
  ADD CONSTRAINT piktag_connections_scan_session_id_fkey
  FOREIGN KEY (scan_session_id)
  REFERENCES public.piktag_scan_sessions (id)
  ON DELETE SET NULL;
