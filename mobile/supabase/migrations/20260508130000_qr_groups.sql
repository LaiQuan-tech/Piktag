-- 20260508130000_qr_groups.sql
--
-- Task 2: turn QR codes from ephemeral 24-hour scan sessions into
-- persistent "QR groups" with a friend list. The underlying table
-- piktag_scan_sessions is reused (no rename — too much existing code
-- references the name) but its meaning changes:
--   * Each row = a long-lived group/classifier
--   * `name` (new) — user-given or auto-generated label like
--     "Coffee tasting · May 8"
--   * `expires_at` — now optional; new groups leave it NULL =
--     "never expires, re-shareable any time"
--   * Existing per-session columns (event_date, event_location,
--     event_tags) stay for backward compat but are no longer the
--     primary identifier — `name` is. Task 3 will replace the
--     date/location pickers with AI-generated tag suggestions, at
--     which point those columns may be dropped or repurposed.
--
-- Friend list per group: derived from piktag_connections.scan_session_id
-- (already exists). No new join table needed — a connection IS a
-- friend, and its scan_session_id IS the originating QR group.

-- 1. Add the name column.
ALTER TABLE public.piktag_scan_sessions
  ADD COLUMN IF NOT EXISTS name text;

-- 2. Make expires_at optional. Existing rows keep their 24h expiry;
--    new rows will pass NULL = persistent group.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'piktag_scan_sessions'
      AND column_name = 'expires_at'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.piktag_scan_sessions
      ALTER COLUMN expires_at DROP NOT NULL;
  END IF;
END $$;

-- 3. Add a host-can-always-read-own-rows policy. The existing
--    "Authenticated users can read active sessions" policy gates on
--    is_active=true — fine for the scanner side, but the host's
--    group list needs to see archived/inactive ones too.
DROP POLICY IF EXISTS "Host can read own scan sessions" ON public.piktag_scan_sessions;
CREATE POLICY "Host can read own scan sessions" ON public.piktag_scan_sessions
  FOR SELECT
  USING (auth.uid() = host_user_id);

-- 4. Index to make "list my groups by recency" cheap.
CREATE INDEX IF NOT EXISTS idx_scan_sessions_host_recent
  ON public.piktag_scan_sessions (host_user_id, created_at DESC);

-- 5. Convenience RPC: count members of a group.
--    Members = piktag_connections rows linking this scan_session
--    to a real registered user. SECURITY DEFINER so the count
--    works even when the host doesn't have direct RLS access to
--    other users' connection rows.
CREATE OR REPLACE FUNCTION public.qr_group_member_count(p_group_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*)::integer
  FROM piktag_connections
  WHERE scan_session_id = p_group_id::text
    AND user_id = (SELECT host_user_id FROM piktag_scan_sessions WHERE id = p_group_id);
$$;

REVOKE ALL ON FUNCTION public.qr_group_member_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_group_member_count(uuid) TO authenticated;

-- 6. Convenience RPC: list members of a group with profile basics.
--    Same security model — host-authorised via the connection row's
--    user_id, then joined to piktag_profiles for display.
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
  WHERE c.scan_session_id = p_group_id::text
    AND c.user_id = (SELECT host_user_id FROM piktag_scan_sessions WHERE id = p_group_id)
    AND auth.uid() = c.user_id  -- viewer must be the group host
  ORDER BY c.met_at DESC;
$$;

REVOKE ALL ON FUNCTION public.qr_group_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_group_members(uuid) TO authenticated;
