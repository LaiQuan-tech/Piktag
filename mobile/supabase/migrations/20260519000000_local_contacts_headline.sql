-- 20260519000000_local_contacts_headline.sql
--
-- WHY: manual local-contact entry is a cold-start compromise. For the
-- data to "fuse" cleanly when that person later registers, the
-- local-contact schema must mirror the MEMBER profile schema
-- (piktag_profiles) field-for-field — not dump structured fields into
-- a generic free-text column.
--
-- piktag_profiles identity columns: full_name · username · headline ·
-- bio · phone · email · birthday · avatar_url. The mirrorable subset
-- for a not-yet-member contact is: name · headline · phone · email ·
-- birthday (username is system-assigned; bio is the person's OWN
-- self-description so an owner can't author it — the private #tags
-- layer is the owner's impression; biolinks are the person's own).
--
-- piktag_local_contacts already had name/phone/email/birthday/tags but
-- was MISSING `headline`. A prior change piggybacked the scanned job
-- title onto the `note` column — functional, but not schema-aligned.
-- This migration adds the real, structured column so the local-contact
-- format genuinely maps back to the member format.
--
-- FUSION MAPPING (deliberate, documented — not a hack):
--   piktag_connections has NO headline column ON PURPOSE. Once the
--   person is a member, their authoritative headline lives on THEIR
--   piktag_profiles row; duplicating it onto every owner's connection
--   edge would denormalize + go stale. So the owner's pre-registration
--   headline guess is carried into connection.note (owner-private CRM
--   context), preferring any genuine legacy note text if one exists.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Safe to re-run. Existing rows: `headline` defaults NULL; legacy
-- text that lived in `note` is untouched and still promotes via the
-- COALESCE below, so nothing is lost.

ALTER TABLE public.piktag_local_contacts
  ADD COLUMN IF NOT EXISTS headline text;

-- Re-define the promote function. Byte-for-byte the live function
-- (20260517000000_promote_local_contacts_limit_guard.sql) with ONLY
-- the connection.note source changed from `v_local_contact.note` to
-- COALESCE(NULLIF(note,''), headline) so the structured headline is
-- carried on fusion. ORDER BY id + LIMIT 200 catastrophe cap retained.

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
        -- Structured headline carries onto fusion as owner-private
        -- context; legacy free-text note (if any) wins when present.
        COALESCE(NULLIF(v_local_contact.note, ''), v_local_contact.headline),
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
