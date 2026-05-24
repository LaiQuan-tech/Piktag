-- =============================================================================
-- fix(contact-sync): match phone biolinks too, not just piktag_profiles.phone
--
-- Reported: a known PikTag user (Jeff / @fullwish) was showing as "尚未加入"
-- in another viewer's contact-sync screen even though Jeff had a phone on
-- file in the app.
--
-- Diagnosed against production: phone numbers are almost always stored in
-- `piktag_biolinks` (where platform = 'phone', url = 'tel:+886...') — that's
-- the surface EditProfileScreen's biolink editor writes to. The
-- `piktag_profiles.phone` column exists but is essentially unused (1/59
-- profiles, and that one is a test account with a fake number).
--
--   piktag_profiles.phone    → 1 / 59 profiles populated
--   piktag_biolinks (phone)  → 2 / 69 biolinks populated (real users)
--
-- The previous match_contacts_against_profiles RPC only looked at
-- piktag_profiles.phone, so it missed every real PikTag user with a
-- phone-flavored biolink. Result: contact sync looked broken to viewers
-- whose contacts are on PikTag.
--
-- Fix: extend the phone_matches CTE so the candidate phone source is the
-- UNION of piktag_profiles.phone AND piktag_biolinks (where platform =
-- 'phone'). Same last-9-digit normalization on both sides. The block
-- check + self exclusion + email path are unchanged. Same RPC signature
-- (id, name, match_type, full_name, username, avatar_url) so client code
-- doesn't need to change.
--
-- DROP + CREATE (Postgres forbids RETURNS-TABLE shape changes via CREATE
-- OR REPLACE), but signature is identical to the previous version so
-- existing callers keep compiling.
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
    -- Candidate phone source = UNION of both storage sites. profile.phone
    -- (legacy / rare) wins by ordering when both rows exist for the same
    -- user_id; the DISTINCT ON below keeps the first match per input_index
    -- so a contact never resolves to the same user twice even if both
    -- tables have a normalized last-9 hit.
    candidate_phones AS (
      SELECT id, last9 FROM (
        SELECT
          p.id,
          RIGHT(regexp_replace(p.phone, '[^0-9]', '', 'g'), 9) AS last9
        FROM piktag_profiles p
        WHERE p.phone IS NOT NULL
          AND LENGTH(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 9
        UNION ALL
        SELECT
          b.user_id AS id,
          RIGHT(regexp_replace(b.url, '[^0-9]', '', 'g'), 9) AS last9
        FROM piktag_biolinks b
        WHERE b.platform = 'phone'
          AND b.url IS NOT NULL
          AND LENGTH(regexp_replace(b.url, '[^0-9]', '', 'g')) >= 9
      ) src
    ),
    phone_matches AS (
      SELECT DISTINCT ON (ip.input_index)
        ip.input_index,
        cp.id AS matched_user_id,
        'phone'::text AS match_type
      FROM input_phones ip
      JOIN candidate_phones cp ON cp.last9 = ip.last9
      WHERE cp.id <> v_me
        AND NOT EXISTS (
          SELECT 1 FROM piktag_blocks b
          WHERE b.blocker_id = cp.id AND b.blocked_id = v_me
        )
      ORDER BY ip.input_index, cp.id
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
