-- 2026-09-09 -- three fixes from the SECURITY DEFINER RPC audit.
--
-- MECHANISM NOTE, because this keeps biting us: on Supabase,
-- `REVOKE ... FROM PUBLIC` does NOT remove anon/authenticated. Supabase's
-- default privileges hand every new function an explicit grant naming
-- anon and authenticated, and a REVOKE aimed at PUBLIC cannot touch a
-- named grant. Eight functions in this repo REVOKE FROM PUBLIC and are
-- still anon-executable in production today. Always revoke the three
-- roles by name, the way 20260626000000_lockdown_internal_function_grants
-- does. Any future grant fix should copy that form, not the PUBLIC form.

-- ============================================================
-- 1. resolve_pending_connections -- caller must be the connectee
-- ============================================================
-- Was: zero auth checks, SECURITY DEFINER, and p_new_user_id supplied by
-- the caller. Anonymous callers could write bidirectional
-- piktag_connections rows, private connection_tags, and inflate
-- scan_count. The fix is the auth.uid() guard inside the body; the grant
-- change below is defence in depth, not the fix.
--
-- Body is carried over verbatim from
-- 20260513090000_vibe_tags_host_side_only.sql (the host-side-only Vibe
-- tag behaviour is unchanged) with only the guard added.

CREATE OR REPLACE FUNCTION resolve_pending_connections(
  p_new_user_id uuid,
  p_scan_session_id text
) RETURNS jsonb AS $$
DECLARE
  v_pending RECORD;
  v_session RECORD;
  v_conn_id uuid;
  v_reverse_conn_id uuid;
  v_result jsonb := '[]'::jsonb;
BEGIN
  -- SECURITY (2026-09-09): this function is SECURITY DEFINER and writes
  -- BOTH sides of a connection, so it must never trust a caller-supplied
  -- identity. p_new_user_id stays in the signature so existing call sites
  -- keep working, but it now has to BE the caller. Without this check,
  -- anyone holding a scan session id could attach arbitrary users to a
  -- host -- and those ids are printed in public share links, so "holding
  -- one" is not a meaningful barrier. Revoking anon alone would not close
  -- it either: any logged-in user could still pass someone else's uuid.
  IF auth.uid() IS NULL OR auth.uid() <> p_new_user_id THEN
    RAISE EXCEPTION 'resolve_pending_connections: caller must be p_new_user_id'
      USING ERRCODE = '42501';
  END IF;

  -- Find matching pending connection
  SELECT * INTO v_pending
  FROM piktag_pending_connections
  WHERE scan_session_id = p_scan_session_id
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pending IS NULL THEN
    RETURN v_result;
  END IF;

  -- Don't connect with yourself
  IF v_pending.host_user_id = p_new_user_id THEN
    RETURN v_result;
  END IF;

  -- Check if connection already exists
  IF EXISTS (
    SELECT 1 FROM piktag_connections
    WHERE user_id = p_new_user_id AND connected_user_id = v_pending.host_user_id
  ) THEN
    UPDATE piktag_pending_connections
    SET status = 'resolved', scanner_user_id = p_new_user_id, resolved_at = now()
    WHERE id = v_pending.id;
    RETURN v_result;
  END IF;

  -- Get scan session details
  SELECT * INTO v_session
  FROM piktag_scan_sessions
  WHERE id::text = p_scan_session_id;

  -- Create connection (new user → host) — scanner's view of host
  INSERT INTO piktag_connections (
    user_id, connected_user_id, met_at, met_location, note, scan_session_id
  ) VALUES (
    p_new_user_id,
    v_pending.host_user_id,
    now(),
    COALESCE(v_session.event_location, ''),
    COALESCE(v_session.event_date, '') || CASE WHEN v_session.event_location IS NOT NULL THEN ' · ' || v_session.event_location ELSE '' END,
    p_scan_session_id
  )
  RETURNING id INTO v_conn_id;

  -- Create reverse connection (host → new user) — host's view of scanner
  INSERT INTO piktag_connections (
    user_id, connected_user_id, met_at, met_location, note, scan_session_id
  ) VALUES (
    v_pending.host_user_id,
    p_new_user_id,
    now(),
    COALESCE(v_session.event_location, ''),
    COALESCE(v_session.event_date, '') || CASE WHEN v_session.event_location IS NOT NULL THEN ' · ' || v_session.event_location ELSE '' END,
    p_scan_session_id
  )
  ON CONFLICT (user_id, connected_user_id) DO NOTHING
  RETURNING id INTO v_reverse_conn_id;

  -- ✱ KEY CHANGE: attach Vibe tags ONLY to the reverse connection
  -- (host's view of the new user). The forward connection
  -- (v_conn_id) is the scanner's view of the host — and the host
  -- is NOT what the Vibe's tags describe, so we never auto-apply
  -- there. The scanner can still add tags manually via the picker.
  IF v_session IS NOT NULL AND v_session.event_tags IS NOT NULL AND v_reverse_conn_id IS NOT NULL THEN
    DECLARE
      v_tag_name text;
      v_tag_id uuid;
    BEGIN
      FOREACH v_tag_name IN ARRAY v_session.event_tags
      LOOP
        v_tag_name := LTRIM(v_tag_name, '#');

        SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name;
        IF v_tag_id IS NULL THEN
          INSERT INTO piktag_tags (name) VALUES (v_tag_name) RETURNING id INTO v_tag_id;
        END IF;

        -- Only the HOST-side row gets tagged.
        IF v_tag_id IS NOT NULL THEN
          INSERT INTO piktag_connection_tags (connection_id, tag_id, is_private)
          VALUES (v_reverse_conn_id, v_tag_id, true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END;
  END IF;

  -- Mark pending connection as resolved
  UPDATE piktag_pending_connections
  SET status = 'resolved', scanner_user_id = p_new_user_id, resolved_at = now()
  WHERE id = v_pending.id;

  -- Increment scan count
  IF v_session IS NOT NULL THEN
    UPDATE piktag_scan_sessions SET scan_count = scan_count + 1 WHERE id = v_session.id;
  END IF;

  v_result := jsonb_build_array(jsonb_build_object(
    'connection_id', v_conn_id,
    'host_user_id', v_pending.host_user_id,
    'scan_session_id', p_scan_session_id
  ));

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- CREATE OR REPLACE resets proconfig, so the search_path pin from
-- 20260429190000_security_advisor_fixes.sql has to be re-applied here.
ALTER FUNCTION public.resolve_pending_connections(p_new_user_id uuid, p_scan_session_id text)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.resolve_pending_connections(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pending_connections(uuid, text)
  TO authenticated, postgres, service_role;

-- ============================================================
-- 2. select_tag_nudge_due_users -- cron-only, never client-callable
-- ============================================================
-- Returns push_token, bio and full_name with a caller-controlled p_limit.
-- It already GRANTed only to postgres/service_role, and its only caller
-- (supabase/functions/notification-tag-suggest) uses the service role key
-- -- but the REVOKE was aimed at PUBLIC, so anon/authenticated kept the
-- default grant and the function stayed an anonymous user-data export.
-- No behaviour change for the edge function.
REVOKE EXECUTE ON FUNCTION public.select_tag_nudge_due_users(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_tag_nudge_due_users(int)
  TO postgres, service_role;

-- ============================================================
-- 3. get_tribe_size -- deliberately re-opened to anon
-- ============================================================
-- 20260626000000 revoked this as "retired Tribe lineage (callers removed
-- 2026-06-25)". That was true of the mobile app but not of the web: the
-- public profile page still calls it with the anon key
-- (landing/api/u/[username].js). Because that call site treats tribe size
-- as decorative and swallows its errors, it has been failing silently
-- ever since instead of surfacing as a bug.
--
-- Founder's call 2026-09-09: keep the feature, restore the grant. This
-- returns it to exactly the grant it had at 20260513040000:201.
GRANT EXECUTE ON FUNCTION public.get_tribe_size(uuid) TO anon, authenticated;
