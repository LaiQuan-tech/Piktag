-- 20260522000000_record_pending_connection.sql
--
-- Restore the "non-member scans QR → installs → auto-connects via
-- sid" rail. After 20260428l_rls_hardening (C2) tightened
-- piktag_pending_connections.INSERT to "authenticated AND
-- auth.uid() = host_user_id", landing's anon-key REST POST from
-- /u/<username> silently failed with 403 — try/catch swallowed it
-- and the founder didn't notice for weeks. Result: no pending row
-- got written, so resolve_pending_connections() had nothing to
-- resolve and the POSITIONING.md scan→connect wedge was dead in
-- prod.
--
-- Fix: SECURITY DEFINER RPC anon CAN call, that does the same
-- insert the landing page WAS trying to do — but server-side, so
-- the RLS table policy stays tight (still authenticated-only direct
-- writes; this RPC is the ONLY anon-writeable path).
--
-- Defence-in-depth in the function body:
--   • host_user_id must reference a real profile (FK enforces this
--     too at insert time).
--   • scan_session_id must look like a UUID (cheap regex; landing
--     already validates, but never trust the caller).
--   • idempotent ON CONFLICT — a non-member who reloads /u/X?sid=…
--     twice shouldn't error or duplicate.
--
-- The function returns nothing the caller doesn't already know
-- (landing already has host id + sid); landing only needs the call
-- to succeed.
--
-- Idempotent: CREATE OR REPLACE + narrow GRANT.

CREATE OR REPLACE FUNCTION public.record_pending_connection(
  p_host_user_id uuid,
  p_scan_session_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Argument sanity. Reject empty / non-UUID-shaped sid early —
  -- otherwise FK would still reject but the error surface for a
  -- malformed sid would be uglier and could leak schema info.
  IF p_host_user_id IS NULL OR p_scan_session_id IS NULL THEN
    RETURN;
  END IF;

  IF p_scan_session_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN;
  END IF;

  -- Confirm the host exists. Anonymous callers shouldn't be able
  -- to pollute the table by guessing UUIDs.
  IF NOT EXISTS (SELECT 1 FROM public.piktag_profiles WHERE id = p_host_user_id) THEN
    RETURN;
  END IF;

  -- Insert the pending row. Mirrors what landing/api/u/[username].js
  -- was already trying to do. The table has NO (host_user_id,
  -- scan_session_id) UNIQUE constraint so we can't use ON CONFLICT;
  -- a NOT EXISTS gate is cheap (idx_pending_conn_session covers it)
  -- and a TOCTOU race on duplicates is harmless because the resolve
  -- flow already does ORDER BY created_at DESC LIMIT 1.
  IF NOT EXISTS (
    SELECT 1 FROM public.piktag_pending_connections
    WHERE host_user_id = p_host_user_id
      AND scan_session_id = p_scan_session_id
  ) THEN
    INSERT INTO public.piktag_pending_connections (host_user_id, scan_session_id)
    VALUES (p_host_user_id, p_scan_session_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pending_connection(uuid, text)
  TO anon, authenticated;
