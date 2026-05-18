-- 20260519040000_get_pending_scans.sql
--
-- 絕招一 / Magic Onboarding — Phase 3 (member-side surfacing).
--
-- Phases 1+2 capture a scanner's name onto the pending rail. This
-- lets the HOST (member) see those named-but-not-yet-joined people
-- on their home list immediately — the social-pressure / re-engage
-- hook — instead of the record staying invisible until the scanner
-- installs the app.
--
-- One SECURITY DEFINER RPC (the canonical aggregated-read pattern
-- here — cf. search_users / tag_page_members) rather than a client
-- join: the host can RLS-read their own pending rows, but the
-- event_tags live on piktag_scan_sessions; doing it server-side
-- avoids widening scan_sessions RLS and an N+1. Strictly scoped to
-- auth.uid() = host_user_id, so a caller only ever sees their own.
--
-- Only NAMED + still-pending rows surface (anonymous page-load rows
-- have no identity to show; resolved rows already became real
-- connections via resolve_pending_connections and naturally drop
-- out — no cleanup needed).
--
-- Idempotent CREATE OR REPLACE. resolve_pending_connections is
-- UNCHANGED; no schema change (Phase 1 added scanner_name).

CREATE OR REPLACE FUNCTION public.get_pending_scans()
RETURNS TABLE (
  id              uuid,
  scanner_name    text,
  event_tags      text[],
  event_location  text,
  created_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pc.id,
    pc.scanner_name,
    COALESCE(s.event_tags, '{}')::text[] AS event_tags,
    s.event_location,
    pc.created_at
  FROM piktag_pending_connections pc
  LEFT JOIN piktag_scan_sessions s
         ON s.id::text = pc.scan_session_id
  WHERE pc.host_user_id = auth.uid()
    AND pc.status = 'pending'
    AND pc.scanner_name IS NOT NULL
  ORDER BY pc.created_at DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_pending_scans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_scans()
  TO authenticated, service_role;
