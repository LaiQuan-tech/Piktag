-- =============================================================================
-- fix(contact-sync): E.164-aware phone matching to eliminate cross-country FPs
--
-- Problem: the prior implementation matched phones by the last 9 digits only,
-- which caused cross-country false positives. Example:
--
--   input     : +1-555-123-4567   (US)            digits = 15551234567
--   candidate : +82-10-555-1234567 (KR biolink)   digits = 82105551234567
--   last9 of both = '551234567'  → spurious match
--
-- Fix: use a hybrid heuristic that respects the E.164 `+` prefix.
--
--   1. If BOTH sides start with '+' (i.e. both are full E.164), require an
--      EXACT match on the digit-only normalized form. This makes country
--      codes load-bearing — different CC means different number.
--
--   2. Otherwise (at least one side is local format without '+'), fall back
--      to last-9-digit matching. This preserves the legacy UX where a user's
--      local-format contact like '0912-345-678' still matches a profile that
--      stored '+886912345678' as a biolink (last9 = '912345678' on both).
--
-- Why not strictly last-10? Because TW local '0912345678' (10 digits) vs
-- '+886912345678' (12 digits) → last10 differ ('0912345678' vs '6912345678'),
-- which would break the most common real-world case in this product.
--
-- The user-facing biolink editor stores phones in E.164 (+886...), so
-- candidate rows almost always have '+'. Inputs from the device address
-- book are mixed: locals without '+' fall back to last9 (good), full E.164
-- inputs go through exact-match (good — kills the cross-country FP).
--
-- Same RPC signature; DROP + CREATE for shape safety. SECURITY DEFINER +
-- STABLE preserved. Idempotent.
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
    -- For each input phone, capture two normalized forms:
    --   has_plus    : did the raw string contain a '+'? (E.164 marker)
    --   digits_full : the entire digit-only sequence (e.g. '15551234567')
    --   last9       : right 9 digits, used for the legacy fallback path
    -- We keep entries with >= 9 digits so noise (extensions etc.) is ignored.
    input_phones AS (
      SELECT
        (idx - 1)::integer AS input_index,
        (p_phones[idx] LIKE '+%') AS has_plus,
        regexp_replace(p_phones[idx], '[^0-9]', '', 'g') AS digits_full,
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
    -- Candidate phones come from two sources:
    --   - piktag_profiles.phone (legacy / rare)
    --   - piktag_biolinks where platform = 'phone' (the real surface, e.g.
    --     'tel:+886...' written by EditProfileScreen).
    -- For each, capture has_plus + digits_full + last9 with the same rules.
    -- For biolinks the source string is e.g. 'tel:+886912345678'; we strip
    -- the 'tel:' scheme prefix before checking for '+' so the E.164 marker
    -- survives normalization.
    candidate_phones AS (
      SELECT id, has_plus, digits_full, last9 FROM (
        SELECT
          p.id,
          (p.phone LIKE '+%') AS has_plus,
          regexp_replace(p.phone, '[^0-9]', '', 'g') AS digits_full,
          RIGHT(regexp_replace(p.phone, '[^0-9]', '', 'g'), 9) AS last9
        FROM piktag_profiles p
        WHERE p.phone IS NOT NULL
          AND LENGTH(regexp_replace(p.phone, '[^0-9]', '', 'g')) >= 9
        UNION ALL
        SELECT
          b.user_id AS id,
          (regexp_replace(b.url, '^tel:', '') LIKE '+%') AS has_plus,
          regexp_replace(b.url, '[^0-9]', '', 'g') AS digits_full,
          RIGHT(regexp_replace(b.url, '[^0-9]', '', 'g'), 9) AS last9
        FROM piktag_biolinks b
        WHERE b.platform = 'phone'
          AND b.url IS NOT NULL
          AND LENGTH(regexp_replace(b.url, '[^0-9]', '', 'g')) >= 9
      ) src
    ),
    -- Hybrid match rule:
    --   * Both sides have '+' → exact normalized-digits equality (strict,
    --     country-code aware). This is what kills the +1 vs +82 FP.
    --   * Otherwise → last-9 fallback (preserves local-format UX).
    phone_matches AS (
      SELECT DISTINCT ON (ip.input_index)
        ip.input_index,
        cp.id AS matched_user_id,
        'phone'::text AS match_type
      FROM input_phones ip
      JOIN candidate_phones cp
        ON (
          (ip.has_plus AND cp.has_plus AND ip.digits_full = cp.digits_full)
          OR
          ((NOT ip.has_plus OR NOT cp.has_plus) AND ip.last9 = cp.last9)
        )
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
