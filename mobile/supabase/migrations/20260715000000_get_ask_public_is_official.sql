-- 20260715000000_get_ask_public_is_official.sql
--
-- Launch-audit follow-up (founder-approved 2026-07-15): the Ask share page
-- (landing/api/a/[askId].js) decided "is this the official @piktag demo Ask?"
-- by string-matching author_username === 'piktag'. username has no DB UNIQUE
-- constraint, so that check is spoofable and drifts from the is_official
-- source of truth used everywhere else. Mirror the u/[username].js fix:
-- surface the author's is_official flag through get_ask_public so the page
-- can key on it instead of a magic username string.
--
-- RETURNS TABLE gains a column → the return type changes → CREATE OR REPLACE
-- is not allowed to alter it, so DROP first, then recreate. Both statements
-- run in the migration's single transaction, so there is no window where the
-- function is missing for live anon callers.

DROP FUNCTION IF EXISTS public.get_ask_public(uuid);

CREATE FUNCTION public.get_ask_public(p_ask_id uuid)
RETURNS TABLE(
  title text,
  body text,
  author_name text,
  author_username text,
  author_avatar_url text,
  author_is_official boolean,
  tag_names text[],
  expires_at timestamptz,
  is_expired boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.title,
    a.body,
    COALESCE(p.full_name, p.username, 'PikTag user'),
    p.username,
    p.avatar_url,
    COALESCE(p.is_official, false),
    (SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
       FROM piktag_ask_tags at2 JOIN piktag_tags t ON t.id = at2.tag_id
      WHERE at2.ask_id = a.id),
    a.expires_at,
    a.expires_at <= now()
  FROM piktag_asks a
  LEFT JOIN piktag_profiles p ON p.id = a.author_id
  WHERE a.id = p_ask_id AND a.is_active = true;
$$;
REVOKE ALL ON FUNCTION public.get_ask_public(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ask_public(uuid) TO anon, authenticated;
