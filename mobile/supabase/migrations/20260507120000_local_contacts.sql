-- 20260507120000_local_contacts.sql
--
-- "Local contacts" — a user's CRM-style address book of people they
-- want to tag, BUT who haven't registered PikTag yet. Day-1 value
-- prop for cold-start users: tag your 100 contacts even when nobody
-- you know is on the app, then auto-promote those tags to real
-- piktag_connections when contacts later sign up.
--
-- Schema mirrors piktag_connections' CRM fields (met_at, met_location,
-- note, nickname/name, birthday, is_reviewed) plus identity columns
-- (phone_normalized, email_lower) used by the promotion trigger to
-- match against piktag_profiles when a contact registers.
--
-- Promotion lifecycle:
--   1. Owner imports contacts → rows inserted with phone/email + tags.
--   2. New user signs up → AFTER INSERT trigger on piktag_profiles
--      pulls their email from auth.users + their phone from the new
--      profile row, calls promote_local_contacts_for_profile().
--   3. The function finds matching local_contacts (any owner whose
--      phone_normalized or email_lower matches the new user) and:
--        - INSERTs a piktag_connections row (owner → new user)
--        - INSERTs the mirror row (new user → owner) for bilateral
--        - Copies the local_contact's `tags` array into
--          piktag_connection_tags (creating piktag_tags rows as
--          needed, all marked is_private=true since they were the
--          owner's private CRM tags pre-registration)
--        - Marks the local_contact promoted via promoted_to_connection_id
--   4. Owner sees the new user appear on their Connections list with
--      tags already applied — no manual re-tagging needed.

CREATE TABLE IF NOT EXISTS public.piktag_local_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Identity. At least one of (phone_normalized, email_lower, name)
  -- has a value; promotion triggers only on phone/email matches.
  -- phone_normalized is E.164 ("+886912345678"); the client
  -- normalizes via libphonenumber before insert.
  phone_normalized text,
  email_lower text,
  name text NOT NULL,
  avatar_url text,
  -- CRM metadata — same shape as piktag_connections so the JOIN at
  -- promotion time can copy values directly.
  met_at timestamptz,
  met_location text,
  note text,
  birthday text,
  -- Tags as a flat string array (unlike piktag_connection_tags' join
  -- table — local contacts don't need the join overhead, and the
  -- promotion trigger expands the array into proper rows on match).
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Lifecycle
  promoted_to_connection_id uuid REFERENCES public.piktag_connections(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Same owner can't have two rows for the same identity. NULLs are
  -- distinct in Postgres unique constraints by default, so a user
  -- adding a name-only contact twice will succeed (de-dup is a
  -- client concern in that case).
  CONSTRAINT piktag_local_contacts_unique UNIQUE (owner_user_id, phone_normalized, email_lower, name)
);

CREATE INDEX IF NOT EXISTS idx_local_contacts_owner
  ON public.piktag_local_contacts (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_local_contacts_phone_unpromoted
  ON public.piktag_local_contacts (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND promoted_to_connection_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_local_contacts_email_unpromoted
  ON public.piktag_local_contacts (email_lower)
  WHERE email_lower IS NOT NULL AND promoted_to_connection_id IS NULL;

-- ── RLS ────────────────────────────────────────────────────────────
-- Strictly owner-only. No mirror visibility — a local contact for
-- user A is invisible to anyone else, including the contact subject.
ALTER TABLE public.piktag_local_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS local_contacts_owner ON public.piktag_local_contacts;
CREATE POLICY local_contacts_owner ON public.piktag_local_contacts
  FOR ALL
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- ── Promotion function ────────────────────────────────────────────
-- Called from the piktag_profiles AFTER INSERT/UPDATE trigger below.
-- Finds all local_contacts that match the new profile's phone_norm
-- or email_lower and turns them into real piktag_connections rows
-- with tags transferred. Idempotent: re-running for an already-
-- promoted contact is a no-op.

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
  LOOP
    -- If a connection already exists, just mark the local_contact
    -- promoted (still copy tags below, in case the connection row
    -- pre-existed with no tags).
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

      -- Mirror connection so the new user also sees the tagger.
      INSERT INTO piktag_connections (
        user_id, connected_user_id, met_at, is_reviewed
      ) VALUES (
        p_user_id, v_local_contact.owner_user_id, now(), false
      )
      ON CONFLICT (user_id, connected_user_id) DO NOTHING;
    END IF;

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

-- ── Trigger wrapper ───────────────────────────────────────────────
-- Fires on INSERT or UPDATE-of-phone on piktag_profiles. Pulls the
-- email from auth.users (not stored on piktag_profiles) so the
-- promotion can match local_contacts saved with email_lower.

CREATE OR REPLACE FUNCTION public.trg_promote_local_contacts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.id LIMIT 1;
  PERFORM public.promote_local_contacts_for_profile(NEW.id, NEW.phone, v_email);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_promote_local_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_promote_local_contacts() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_promote_local_contacts ON public.piktag_profiles;
CREATE TRIGGER trg_promote_local_contacts
AFTER INSERT OR UPDATE OF phone ON public.piktag_profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_promote_local_contacts();
