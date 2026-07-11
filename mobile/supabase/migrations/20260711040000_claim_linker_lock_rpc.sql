-- 20260711040000_claim_linker_lock_rpc.sql
--
-- Root fix for the PHANTOM LOCK SKIP (2026-07-11 incident, part 3).
--
-- The edge fn claimed the linker mutex via PostgREST:
--   .update({locked_at: now}).eq('id',1).or('locked_at.is.null,locked_at.lt.X').select()
-- Forensics (probe v4) showed the UPDATE **sets** locked_at yet the
-- RETURNING representation comes back EMPTY, so every run concluded
-- "another linker run in progress" and self-skipped — indefinitely.
-- (Once the backlog was force-run, processed=50/linked+created=50 —
-- the engine itself was fine.) Whatever the precise PostgREST filter
-- semantics, an atomic server-side claim is the robust shape:
--
--   claim_linker_lock(p_stale_minutes) → true  = you own the run
--                                       → false = someone else does
--
-- SECURITY DEFINER, service_role-only: the linker edge fn is the sole
-- intended caller.

CREATE OR REPLACE FUNCTION public.claim_linker_lock(p_stale_minutes int DEFAULT 3)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.linker_run_lock
     SET locked_at = now()
   WHERE id = 1
     AND (locked_at IS NULL
          OR locked_at < now() - make_interval(mins => p_stale_minutes));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_linker_lock(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_linker_lock(int) TO service_role;
