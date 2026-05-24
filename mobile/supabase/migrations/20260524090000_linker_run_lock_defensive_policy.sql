-- 20260524090000_linker_run_lock_defensive_policy.sql
--
-- DEFENSIVE: add an explicit FOR ALL service_role policy on
-- linker_run_lock.
--
-- 20260524040000 enabled RLS + granted SELECT/UPDATE to service_role +
-- postgres. In most Supabase configurations service_role BYPASSES RLS
-- entirely, so the missing policy is harmless — but that bypass
-- behavior is environment-dependent (it can be flipped per project,
-- and supabase docs no longer guarantee it). If the bypass were ever
-- disabled, the edge function's mutex claim
--   UPDATE … SET locked_at = now() WHERE id = 1 AND (locked_at IS NULL …)
-- would silently return 0 rows on a fresh deploy. The "fail open" code
-- path then proceeds without the lock — exactly the duplicate-concept
-- bug we built the lock to prevent.
--
-- Explicit policy = belt-and-suspenders. Cheap to add, eliminates the
-- env-dependent corner case.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.

DROP POLICY IF EXISTS linker_run_lock_service_role ON public.linker_run_lock;
CREATE POLICY linker_run_lock_service_role ON public.linker_run_lock
  FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);
