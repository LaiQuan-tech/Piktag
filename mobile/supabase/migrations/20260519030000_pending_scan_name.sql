-- 20260519030000_pending_scan_name.sql
--
-- 絕招一 / "Magic Onboarding" — Phase 1 (DB foundation).
--
-- Today: a non-member who scans a member's QR opens the /u/<username>
-- web page, which inserts an ANONYMOUS piktag_pending_connections row
-- (host + sid only). The member never learns who scanned them; the
-- connection only materializes if/when that person installs + signs
-- up (resolve_pending_connections via sid).
--
-- This adds the missing capture: the non-member types their NAME on
-- the web page → it lands on that pending row → the member can see
-- "someone you met at <place> (#tags) — not joined yet" immediately,
-- and on the eventual sign-up the existing resolve flow still fuses
-- it (sid-keyed; UNCHANGED — name-only visitors have no phone/email,
-- so this rail, not local_contacts, is the correct one).
--
-- We do NOT mint temp auth accounts (spam / PII / account-collision).
-- The name is just text on the existing pending rail.
--
-- claim_pending_scan() is the ONLY write path for the name and is
-- abuse-hardened:
--   • host is derived from the SCAN SESSION (sid), never from client
--     input → can't be spoofed onto an arbitrary member;
--   • a row is only created/updated if sid maps to a real
--     piktag_scan_sessions row → random spam needs a real scan;
--   • name is trimmed, control-chars stripped, length-capped;
--   • dedupes on (host_user_id, scan_session_id): updates the
--     anonymous row the web page already inserted on page-load
--     rather than creating a duplicate.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.

ALTER TABLE public.piktag_pending_connections
  ADD COLUMN IF NOT EXISTS scanner_name text;

CREATE OR REPLACE FUNCTION public.claim_pending_scan(
  p_sid  text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   record;
  v_host      uuid;
  v_name      text;
  v_pending   uuid;
  v_host_name text;
BEGIN
  -- sid must be a real scan session. host comes from the session,
  -- NOT the caller — prevents pinning a name onto any member.
  SELECT * INTO v_session
  FROM piktag_scan_sessions
  WHERE id::text = btrim(p_sid)
  LIMIT 1;

  IF v_session IS NULL OR v_session.host_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_sid');
  END IF;
  v_host := v_session.host_user_id;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '[\r\n\t]+', ' ', 'g');
  v_name := nullif(left(v_name, 40), '');
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_name');
  END IF;

  -- Dedupe on (host, sid): update the row the web page's page-load
  -- insert already created; otherwise create it.
  SELECT id INTO v_pending
  FROM piktag_pending_connections
  WHERE host_user_id = v_host
    AND scan_session_id = btrim(p_sid)
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pending IS NULL THEN
    INSERT INTO piktag_pending_connections
      (host_user_id, scan_session_id, status, scanner_name)
    VALUES (v_host, btrim(p_sid), 'pending', v_name);
  ELSE
    UPDATE piktag_pending_connections
       SET scanner_name = v_name
     WHERE id = v_pending;
  END IF;

  SELECT coalesce(nullif(btrim(full_name), ''), username)
    INTO v_host_name
  FROM piktag_profiles
  WHERE id = v_host
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'host_name', v_host_name,
    'tags', coalesce(to_jsonb(v_session.event_tags), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_scan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_scan(text, text)
  TO anon, authenticated, service_role;
