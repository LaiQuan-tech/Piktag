-- 20260608010000_fix_function_search_path_warnings.sql
-- =============================================================================
-- Clear the Supabase Security Advisor "Function Search Path Mutable" warnings
-- (founder 2026-06-08). A function/procedure without a fixed `search_path`
-- resolves unqualified object names against the CALLER's search_path — a
-- schema-injection vector, especially for SECURITY DEFINER routines. The fix
-- the advisor wants is a pinned search_path on every public routine.
--
-- Rather than enumerate signatures by hand (brittle), loop over pg_proc and
-- pin `search_path = public, extensions` on every public function/procedure
-- that doesn't already have a search_path in proconfig. Comprehensive (clears
-- the whole category whatever the count) + idempotent (NOT EXISTS skips
-- already-pinned routines, so re-runs are no-ops). `public, extensions` is the
-- project's standard (covers pgvector's `<=>` in `extensions`, per the
-- documented 42883 gotcha). ALTER on an already-created routine only sets the
-- config — it does NOT re-validate the body, so no eager-validation failures.
-- =============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')        -- functions + procedures (not aggregates/window)
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c
        WHERE c ILIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER ROUTINE %s SET search_path = public, extensions', r.sig);
    EXCEPTION WHEN OTHERS THEN
      -- Never let one stubborn routine abort the whole sweep.
      RAISE WARNING 'could not pin search_path on %: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;
