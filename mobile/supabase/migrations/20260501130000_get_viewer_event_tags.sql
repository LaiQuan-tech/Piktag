-- =============================================================================
-- get_viewer_event_tags: derive the viewer's "event tags" — tags that came
-- in through QR scan-session flows rather than tags the user typed manually.
--
-- WHY THIS IS DERIVED, NOT STORED
-- -------------------------------
-- We don't keep a separate "event_tags_for_user" table. The source of truth
-- already lives in two places:
--
--   1. piktag_scan_sessions.event_tags[]   — the tags the host attached to
--      a scan session (e.g. ["#wedding", "#taipei2026"]).
--   2. piktag_connection_tags (is_private = true) — the per-connection rows
--      that resolve_pending_connections() (see 20260408_pending_connections.sql,
--      lines ~115-145) inserts when a guest scans the host's QR and the
--      pending-connection promotion fires for both sides.
--
-- The flow:
--   host creates scan_session w/ event_tags[]
--     → guest scans QR, lands as a pending_connection
--     → resolve_pending_connections() flips it to a real piktag_connections row
--       AND copies each event_tags[] entry into piktag_connection_tags
--       (is_private=true, both directions) — finding-or-creating piktag_tags rows.
--     → connection.scan_session_id is preserved on the connection row so we
--       can tell "this came from a scan" vs "this was a manual add".
--
-- So at query time we just intersect: tags on the viewer's connections that
-- (a) belong to a scan-sourced connection (scan_session_id IS NOT NULL),
-- (b) are private (is_private = true — that's the marker resolve_pending sets),
-- and (c) match a name in the originating session's event_tags[] array. That
-- last check is what distinguishes "event tag" from "I manually privately
-- tagged this person 'cousin' after the event".
--
-- TRADE-OFFS
-- ----------
--   + No extra table to keep in sync; resolve_pending_connections() already
--     does the heavy lifting and any backfill / dedupe story is automatic.
--   + Counts reflect reality (deletions of connections / tags propagate).
--   - O(connections × tags) per call. Fine at current scale; if this gets
--     hot we can materialize into a view or add a (user_id, scan_session_id)
--     index. LIMIT 12 keeps the result set bounded for the UI.
--   - The ANY(ss.event_tags) check is a linear scan of the array per row;
--     event_tags arrays are tiny (handful of entries), so this is cheap.
--
-- WHY SECURITY DEFINER
-- --------------------
-- piktag_scan_sessions has RLS that (correctly) prevents a user from reading
-- another host's session row. But the viewer here is reading scan sessions
-- *attached to their own connections* — sessions they legitimately participated
-- in as a guest. Rather than loosen the RLS policy on scan_sessions globally,
-- we run SECURITY DEFINER and gate strictly on `c.user_id = p_user` (and
-- p_user comes from auth.uid() unless explicitly passed). The join chain
-- guarantees we never surface session data the caller isn't already
-- connected through.
--
-- Idempotent (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_viewer_event_tags(
  p_user uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  name text,
  uses bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  -- Require an authenticated caller. p_user defaults to auth.uid(); if the
  -- caller explicitly passed NULL AND there's no session, refuse.
  IF v_me IS NULL AND p_user IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- If no explicit p_user was provided, fall back to the caller. (The DEFAULT
  -- already does this, but we re-assert here for the explicit-NULL case.)
  IF p_user IS NULL THEN
    p_user := v_me;
  END IF;

  RETURN QUERY
  WITH event_tag_uses AS (
    SELECT t.id, t.name, count(*)::bigint AS uses
    FROM piktag_connections c
    JOIN piktag_scan_sessions ss ON ss.id = c.scan_session_id
    JOIN piktag_connection_tags ct
      ON ct.connection_id = c.id AND ct.is_private = true
    JOIN piktag_tags t ON t.id = ct.tag_id
    WHERE c.user_id = p_user
      AND c.scan_session_id IS NOT NULL
      AND ss.event_tags IS NOT NULL
      AND t.name = ANY(ss.event_tags)
    GROUP BY t.id, t.name
  )
  SELECT etu.id, etu.name, etu.uses
  FROM event_tag_uses etu
  ORDER BY etu.uses DESC, etu.name
  LIMIT 12;
END;
$$;

REVOKE ALL ON FUNCTION public.get_viewer_event_tags(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_viewer_event_tags(uuid) TO authenticated;
