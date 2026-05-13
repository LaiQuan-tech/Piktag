-- 20260513070000_qr_group_member_rpcs_uuid_fix.sql
--
-- Two fixes that together explain "I scanned my friend's Vibe QR
-- but their member list stays at 0":
--
-- 1. UUID vs TEXT comparison: `piktag_connections.scan_session_id`
--    is `uuid` in production, but both qr_group_members and
--    qr_group_member_count were written with
--    `WHERE scan_session_id = p_group_id::text`. Postgres can't
--    compare uuid = text without an explicit cast — it raises
--    `42883: operator does not exist`. PostgREST surfaces that as
--    an error to the client, which silently swallowed it and
--    rendered 0 members. (Same bug pattern we hit on the brand-new
--    vibe_member_current_tags RPC; this catches up the two older
--    sister functions.)
--
-- 2. Historic data backfill: connections that pre-date this fix
--    might be missing scan_session_id on the host-side row even
--    though the matching pending_connection has the attribution.
--    Backfill those so member lists immediately fill out instead
--    of needing each pair to re-scan.

-- ── 1. qr_group_members ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qr_group_members(p_group_id uuid)
RETURNS TABLE (
  connection_id uuid,
  connected_user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  met_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.id,
    c.connected_user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    c.met_at
  FROM piktag_connections c
  JOIN piktag_profiles p ON p.id = c.connected_user_id
  -- Cast both sides to text so the comparison works whether
  -- scan_session_id is uuid or text in this deployment.
  WHERE c.scan_session_id::text = p_group_id::text
    AND c.user_id = (SELECT host_user_id FROM piktag_scan_sessions WHERE id = p_group_id)
    AND auth.uid() = c.user_id  -- viewer must be the Vibe host
  ORDER BY c.met_at DESC;
$$;

REVOKE ALL ON FUNCTION public.qr_group_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_group_members(uuid) TO authenticated;

-- ── 2. qr_group_member_count ────────────────────────────────
CREATE OR REPLACE FUNCTION public.qr_group_member_count(p_group_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*)::integer
  FROM piktag_connections
  WHERE scan_session_id::text = p_group_id::text
    AND user_id = (SELECT host_user_id FROM piktag_scan_sessions WHERE id = p_group_id);
$$;

REVOKE ALL ON FUNCTION public.qr_group_member_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_group_member_count(uuid) TO authenticated;

-- ── 3. Backfill — copy scan_session_id from forward to reverse
-- For every (scanner→host) connection that has a scan_session_id,
-- find the matching (host→scanner) row that's MISSING it and
-- copy it across. This is a one-time data fix for connections
-- created via UserDetailScreen.handleAddFriendFromQr before the
-- client-side bug fix landed (the function used to skip
-- scan_session_id on the reverse insert).
--
-- "First Vibe wins" — never overwrite an existing scan_session_id
-- on the reverse row; only fill in NULLs.
UPDATE public.piktag_connections AS reverse
   SET scan_session_id = forward.scan_session_id
  FROM public.piktag_connections AS forward
 WHERE reverse.scan_session_id IS NULL
   AND forward.scan_session_id IS NOT NULL
   AND reverse.user_id          = forward.connected_user_id
   AND reverse.connected_user_id = forward.user_id;
