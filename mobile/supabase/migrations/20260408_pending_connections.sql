-- Pending connections: records when non-members scan a QR code
-- so we can auto-create the connection when they sign up later

CREATE TABLE IF NOT EXISTS piktag_pending_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  host_user_id uuid NOT NULL REFERENCES piktag_profiles(id) ON DELETE CASCADE,
  scan_session_id text NOT NULL,
  scanner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'expired')),
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- Index for looking up pending connections by host
CREATE INDEX IF NOT EXISTS idx_pending_conn_host ON piktag_pending_connections(host_user_id);

-- Index for looking up by scan_session_id
CREATE INDEX IF NOT EXISTS idx_pending_conn_session ON piktag_pending_connections(scan_session_id);

-- Index for looking up unresolved pending connections
CREATE INDEX IF NOT EXISTS idx_pending_conn_status ON piktag_pending_connections(status) WHERE status = 'pending';

-- RLS: allow anonymous inserts (from web page), authenticated reads
ALTER TABLE piktag_pending_connections ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (web page creates pending records for non-members)
CREATE POLICY "anon_insert_pending_connections"
  ON piktag_pending_connections FOR INSERT
  WITH CHECK (true);

-- Authenticated users can read their own pending connections (as host)
CREATE POLICY "auth_read_own_pending_connections"
  ON piktag_pending_connections FOR SELECT
  USING (auth.uid() = host_user_id);

-- Authenticated users can update pending connections they're involved in
CREATE POLICY "auth_update_pending_connections"
  ON piktag_pending_connections FOR UPDATE
  USING (auth.uid() = host_user_id OR auth.uid() = scanner_user_id);

-- Function to resolve pending connections when a new user signs up
-- Called from the app after registration
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
    -- Mark as resolved even if connection exists
    UPDATE piktag_pending_connections
    SET status = 'resolved', scanner_user_id = p_new_user_id, resolved_at = now()
    WHERE id = v_pending.id;
    RETURN v_result;
  END IF;

  -- Get scan session details
  SELECT * INTO v_session
  FROM piktag_scan_sessions
  WHERE id::text = p_scan_session_id;

  -- Create connection (new user → host)
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

  -- Create reverse connection (host → new user)
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

  -- Save event_tags as private connection tags (both sides)
  IF v_session IS NOT NULL AND v_session.event_tags IS NOT NULL THEN
    DECLARE
      v_tag_name text;
      v_tag_id uuid;
    BEGIN
      FOREACH v_tag_name IN ARRAY v_session.event_tags
      LOOP
        -- Strip # prefix if present
        v_tag_name := LTRIM(v_tag_name, '#');

        -- Find or create tag
        SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name;
        IF v_tag_id IS NULL THEN
          INSERT INTO piktag_tags (name) VALUES (v_tag_name) RETURNING id INTO v_tag_id;
        END IF;

        -- Insert connection tags for both sides
        IF v_conn_id IS NOT NULL AND v_tag_id IS NOT NULL THEN
          INSERT INTO piktag_connection_tags (connection_id, tag_id, is_private)
          VALUES (v_conn_id, v_tag_id, true)
          ON CONFLICT DO NOTHING;
        END IF;
        IF v_reverse_conn_id IS NOT NULL AND v_tag_id IS NOT NULL THEN
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
