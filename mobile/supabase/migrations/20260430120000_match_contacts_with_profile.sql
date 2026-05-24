-- =============================================================================
-- ContactSyncScreen v3: extend match_contacts_against_profiles to also
-- return the matched user's display profile (full_name, username,
-- avatar_url) so the new sectioned list can render the matched person
-- under their PikTag identity (e.g. `Alice Wang @alice` with a subtitle
-- `通訊錄：鍾介凡`) without a second round-trip to piktag_profiles.
--
-- Postgres forbids changing a function's return type via CREATE OR
-- REPLACE, so DROP + CREATE. Same arg signature so nothing recompiles.
-- Existing callers ignore extra columns; the React Native client picks
-- them up after the next deploy.
--
-- Idempotent.
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_contacts_against_profiles(text[], text[]);

CREATE OR REPLACE FUNCTION public.match_contacts_against_profiles(
  p_phones text[],
  p_emails text[]
)
RETURNS TABLE (
  input_index    integer,
  matched_user_id uuid,
  match_type     text,  -- 'phone' or 'email'
  full_name      text,
  username       text,
  avatar_url     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_max constant integer := 2000;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF coalesce(array_length(p_phones, 1), 0) > v_max
     OR coalesce(array_length(p_emails, 1), 0) > v_max THEN
    RAISE EXCEPTION 'too many entries (max % per call)', v_max;
  END IF;

  RETURN QUERY
  WITH
    input_phones AS (
      SELECT
        (idx - 1)::integer AS input_index,
        RIGHT(regexp_replace(p_phones[idx], '[^0-9]', '', 'g'), 9) AS last9
      FROM generate_subscripts(p_phones, 1) AS idx
      WHERE p_phones[idx] IS NOT NULL
        AND p_phones[idx] <> ''
        AND LENGTH(regexp_replace(p_phones[idx], '[^0-9]', '', 'g')) >= 9
    ),
    input_emails AS (
      SELECT
        (idx - 1)::integer AS input_index,
        LOWER(p_emails[idx]) AS email_lower
      FROM generate_subscripts(p_emails, 1) AS idx
      WHERE p_emails[idx] IS NOT NULL
        AND p_emails[idx] LIKE '%@%'
    ),
    phone_matches AS (
      SELECT DISTINCT ON (ip.input_index)
        ip.input_index,
        p.id AS matched_user_id,
        'phone'::text AS match_type
      FROM input_phones ip
      JOIN piktag_profiles p
        ON p.phone IS NOT NULL
        AND LENGTH(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 9
        AND RIGHT(regexp_replace(p.phone, '[^0-9]', '', 'g'), 9) = ip.last9
      WHERE p.id <> v_me
        AND NOT EXISTS (
          SELECT 1 FROM piktag_blocks b
          WHERE b.blocker_id = p.id AND b.blocked_id = v_me
        )
      ORDER BY ip.input_index, p.id
    ),
    email_matches AS (
      SELECT DISTINCT ON (ie.input_index)
        ie.input_index,
        au.id AS matched_user_id,
        'email'::text AS match_type
      FROM input_emails ie
      JOIN auth.users au ON LOWER(au.email) = ie.email_lower
      WHERE au.id <> v_me
        AND ie.input_index NOT IN (SELECT pm.input_index FROM phone_matches pm)
        AND NOT EXISTS (
          SELECT 1 FROM piktag_blocks b
          WHERE b.blocker_id = au.id AND b.blocked_id = v_me
        )
      ORDER BY ie.input_index, au.id
    ),
    all_matches AS (
      SELECT * FROM phone_matches
      UNION ALL
      SELECT * FROM email_matches
    )
  SELECT
    am.input_index,
    am.matched_user_id,
    am.match_type,
    pp.full_name,
    pp.username,
    pp.avatar_url
  FROM all_matches am
  LEFT JOIN piktag_profiles pp ON pp.id = am.matched_user_id
  ORDER BY am.input_index;
END;
$$;

REVOKE ALL ON FUNCTION public.match_contacts_against_profiles(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_contacts_against_profiles(text[], text[]) TO authenticated;
