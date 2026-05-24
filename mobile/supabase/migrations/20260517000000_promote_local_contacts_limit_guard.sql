-- 20260517000000_promote_local_contacts_limit_guard.sql
--
-- Catastrophe cap (the "C + 2-line LIMIT" decision).
--
-- promote_local_contacts_for_profile runs SYNCHRONOUSLY inside the
-- piktag_profiles AFTER INSERT/UPDATE trigger — i.e. inside the
-- signup transaction (and inside any profile-edit that touches
-- phone/email). For a normal user the matched-contact count K is
-- tiny, so this is fast. The tail risk: a "celebrity" sitting in
-- 100k+ users' address books would make signup do 100k inserts in
-- one transaction → signup hangs / times out / locks.
--
-- This is the minimal pre-launch guard: cap the loop at 200
-- matches per invocation (ORDER BY id so progress is deterministic
-- and resumable). Effects:
--   • Normal user (K « 200): byte-for-byte identical behaviour,
--     zero added latency, zero new moving parts.
--   • Pathological K: signup can NEVER do more than 200 inserts —
--     the catastrophic hang is structurally impossible.
--
-- Deliberate, accepted trade-off: a hypothetical mega-K person's
-- tail beyond 200 stays un-promoted (still promoted_to_connection_id
-- IS NULL, still in the partial index) until the proper async
-- solution ships. That is fine — such a person does not exist
-- pre-launch, and "signup never hangs" is the property that
-- actually matters at launch.
--
-- POST-LAUNCH FOLLOW-UP ("A"): replace the synchronous trigger
-- with an enqueue + pg_cron drain so the full tail is promoted
-- off the hot path. Tracked as a separate backlog task.
--
-- Everything below is byte-for-byte the live function
-- (20260508120000_promote_local_contacts_with_follow.sql) with
-- ONLY the `ORDER BY id` + `LIMIT 200` two lines added to the
-- matched-contacts SELECT. Idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.promote_local_contacts_for_profile(
  p_user_id uuid,
  p_phone text,
  p_email text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text := nullif(trim(p_phone), '');
  v_email_lower text := nullif(lower(trim(p_email)), '');
  v_local_contact record;
  v_conn_id uuid;
  v_tag_name text;
  v_tag_id uuid;
  v_promoted_count integer := 0;
BEGIN
  IF v_phone_norm IS NULL AND v_email_lower IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_local_contact IN
    SELECT *
    FROM piktag_local_contacts
    WHERE promoted_to_connection_id IS NULL
      AND owner_user_id <> p_user_id
      AND (
        (v_phone_norm IS NOT NULL AND phone_normalized = v_phone_norm)
        OR (v_email_lower IS NOT NULL AND email_lower = v_email_lower)
      )
    ORDER BY id              -- deterministic, resumable batching
    LIMIT 200                -- catastrophe cap (see header)
  LOOP
    SELECT id INTO v_conn_id
      FROM piktag_connections
     WHERE user_id = v_local_contact.owner_user_id
       AND connected_user_id = p_user_id
     LIMIT 1;

    IF v_conn_id IS NULL THEN
      INSERT INTO piktag_connections (
        user_id,
        connected_user_id,
        met_at,
        met_location,
        note,
        nickname,
        birthday,
        is_reviewed
      ) VALUES (
        v_local_contact.owner_user_id,
        p_user_id,
        COALESCE(v_local_contact.met_at, now()),
        v_local_contact.met_location,
        v_local_contact.note,
        v_local_contact.name,
        v_local_contact.birthday,
        false
      )
      RETURNING id INTO v_conn_id;

      INSERT INTO piktag_connections (
        user_id, connected_user_id, met_at, is_reviewed
      ) VALUES (
        p_user_id, v_local_contact.owner_user_id, now(), false
      )
      ON CONFLICT (user_id, connected_user_id) DO NOTHING;
    END IF;

    -- ── also create the piktag_follows row so the promoted
    -- ── connection actually shows up on the owner's home list.
    -- ── ConnectionsScreen filters `connections ∩ follows`; without
    -- ── this insert the promoted user is invisible there.
    INSERT INTO piktag_follows (follower_id, following_id)
    VALUES (v_local_contact.owner_user_id, p_user_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;

    -- Transfer tags from the array into proper piktag_tags +
    -- piktag_connection_tags rows. Each tag name is normalized
    -- (strip leading #, trim) before lookup/insert.
    IF array_length(v_local_contact.tags, 1) IS NOT NULL THEN
      FOREACH v_tag_name IN ARRAY v_local_contact.tags
      LOOP
        v_tag_name := trim(both '#' from trim(v_tag_name));
        IF v_tag_name = '' THEN CONTINUE; END IF;

        SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name LIMIT 1;
        IF v_tag_id IS NULL THEN
          BEGIN
            INSERT INTO piktag_tags (name) VALUES (v_tag_name)
            RETURNING id INTO v_tag_id;
          EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_tag_id FROM piktag_tags WHERE name = v_tag_name LIMIT 1;
          END;
        END IF;

        IF v_tag_id IS NOT NULL THEN
          INSERT INTO piktag_connection_tags (connection_id, tag_id, is_private)
          VALUES (v_conn_id, v_tag_id, true)
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;

    UPDATE piktag_local_contacts
       SET promoted_to_connection_id = v_conn_id,
           promoted_at = now()
     WHERE id = v_local_contact.id;

    v_promoted_count := v_promoted_count + 1;
  END LOOP;

  RETURN v_promoted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_local_contacts_for_profile(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_local_contacts_for_profile(uuid, text, text) TO postgres, service_role;
