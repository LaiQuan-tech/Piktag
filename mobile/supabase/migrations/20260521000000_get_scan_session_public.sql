-- 20260521000000_get_scan_session_public.sql
--
-- Anon-callable RPC that exposes ONLY the publicly-visible bits of a
-- scan session by sid: event_tags, event_location, event_date.
--
-- Why: the landing /u page renders the meeting's event tags on the
-- shared QR link. Today it reads them from the URL's ?tags=… param,
-- which is a snapshot baked in at share time. If the host later edits
-- the QR's tags in-app, the URL on already-shared messages doesn't
-- change, so the page shows stale tags (founder caught this — added
-- "#123" tag, didn't appear because the URL wasn't regenerated).
--
-- piktag_scan_sessions has hardened RLS (20260428l, H4) that locks
-- SELECT to "authenticated AND auth.uid() = host_user_id" — anon
-- can't read it directly. This RPC is SECURITY DEFINER so it can
-- read the row server-side, but it RETURNS ONLY the data anyone who
-- scans the QR will see anyway (the tags / location / date on the
-- meeting). host_user_id, scan_count, created_at etc. stay private.
--
-- Idempotent: CREATE OR REPLACE + a single, narrow GRANT.

CREATE OR REPLACE FUNCTION public.get_scan_session_public(p_sid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tags     text[];
  v_location text;
  v_date     text;
BEGIN
  SELECT event_tags, event_location, event_date
  INTO   v_tags, v_location, v_date
  FROM   public.piktag_scan_sessions
  WHERE  id = p_sid;

  -- Row not found → empty object → caller falls back to URL params.
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'event_tags',     COALESCE(v_tags, ARRAY[]::text[]),
    'event_location', v_location,
    'event_date',     v_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_scan_session_public(uuid)
  TO anon, authenticated;
