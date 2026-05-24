-- 20260513090000_vibe_tags_host_side_only.sql
--
-- Fix the symmetric-tagging mistake: Vibe event_tags + date +
-- location should ONLY be auto-attached to the HOST's view of the
-- scanner, NEVER to the scanner's view of the host.
--
-- Why this matters — canonical example from a real test:
--   I create a Vibe "find a patent attorney" tagged #專利師 #商標.
--   The attorney scans my QR. With the old both-sides attach, the
--   attorney's view of MY profile got #專利師 #商標 silently
--   applied — labeling me as a patent attorney even though I'm
--   the one SEEKING one. And every future client of the attorney
--   scanning a Vibe with #商標 would compound the same noise on
--   his side until every meeting carries the same tag = zero
--   signal value.
--
-- The principle (post-rename to Vibes): a Vibe's tags describe
-- the kind of PERSON the Vibe is for, not the host who created
-- it. They belong on the scanner from the host's POV — that's
-- it. If the scanner wants to label the host with anything,
-- that's the scanner's manual job via the tag picker.
--
-- This migration covers the SERVER-side path (new user signing up
-- after scanning a Vibe QR). The CLIENT-side path (already-member
-- scanning) was fixed in the same commit's UserDetailScreen.tsx
-- edit.

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

-- ── Optional cleanup of already-applied bad data ─────────────
-- Removes auto-applied Vibe tags from FORWARD (scanner-side)
-- connections. Criteria for "this was an auto-apply, not a manual
-- one":
--   1. The connection_tags row is private (is_private = true) —
--      matches how the auto-apply path inserts them
--   2. The host of the Vibe is NOT the connection's user_id
--      (i.e. it's the scanner-side row, not the host-side)
--   3. The tag's name appears in the Vibe's own event_tags array
--      (case-insensitive, # stripped) — narrows it to tags that
--      came from the Vibe rather than user-typed coincidences
--
-- Edge case acknowledged: if a scanner happened to ALSO manually
-- add a tag that matches the Vibe's event_tags, that manual entry
-- is collateral damage here. Judged acceptable because: (a) the
-- overlap is rare, (b) the user can re-add via the picker, and
-- (c) the alternative — leaving the noise in place — is worse
-- given the user's explicit complaint.

DELETE FROM piktag_connection_tags ct
USING piktag_connections c, piktag_scan_sessions s, piktag_tags t
WHERE ct.connection_id = c.id
  AND c.scan_session_id::text = s.id::text
  AND ct.tag_id = t.id
  AND ct.is_private = true
  AND c.user_id <> s.host_user_id       -- scanner-side only
  AND LOWER(LTRIM(t.name, '#')) = ANY (
    SELECT LOWER(LTRIM(unnest(s.event_tags), '#'))
  );
