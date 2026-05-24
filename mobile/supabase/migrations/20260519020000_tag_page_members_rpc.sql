-- 20260519020000_tag_page_members_rpc.sql
--
-- WHY: the public SEO tag page (landing/api/tag/[tagname].js → e.g.
-- pikt.ag/tag/產品經理) did a RAW exact lookup:
--     piktag_tags.name = <tag>  →  piktag_user_tags.tag_id = <id>
-- So it never reflected the semantic-concept layer that the app's
-- search_users / fetch_ask_feed already use: #產品經理 ≈ #ProductManager
-- ≈ #プロダクトマネージャー (shared concept_id) did NOT aggregate here.
-- It also filtered NEITHER is_private (tag-level) NOR is_public
-- (profile-level), so private tags / non-public profiles could leak
-- onto a public, crawlable page.
--
-- This RPC replaces those four anon REST round-trips with ONE call
-- that mirrors the canonical app pattern (20260518000000 search_users):
--   • expand the seed tag to all tags sharing its concept_id
--     (concept_id NULL → just the seed tag, exactly as before — no
--     regression for not-yet-linked tags; the auto-link-concepts
--     pg_cron, made reliable in 20260519010000, keeps that set fresh)
--   • only public tags (ut.is_private = false)
--   • only public profiles (p.is_public = true)
-- Net: cross-language results AND a privacy tightening vs. the old
-- page, in a single cached call.
--
-- Returns one jsonb object the serverless consumes directly:
--   { tag_name, usage_count, members:[{username,full_name,avatar_url,
--     headline,is_verified,tags:[...]}, ...] }
-- Tag not found → NULL (page renders 404, same as the old
-- tags.length===0 branch). Found but no public members →
-- usage_count 0 / members [] (page renders the empty state).
--
-- SECURITY DEFINER + explicit public-only filters: this is strictly
-- LESS exposure than the page already had via anon REST, and the
-- filters are the authoritative gate regardless of RLS. anon needs
-- EXECUTE (landing calls it with the anon key).
--
-- Idempotent CREATE OR REPLACE. Safe to re-run.

CREATE OR REPLACE FUNCTION public.tag_page_members(
  p_tag text,
  p_limit int DEFAULT 60
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH seed AS (
    -- lower(name) match rides the existing functional unique index
    -- (20260425_tag_name_unique) and tolerates URL-case variations.
    SELECT id, name, concept_id, usage_count
    FROM piktag_tags
    WHERE lower(name) = lower(btrim(replace(p_tag, '#', '')))
    ORDER BY usage_count DESC NULLS LAST
    LIMIT 1
  ),
  -- Concept-sibling expansion when linked; else just the seed tag.
  expanded_tags AS (
    SELECT t.id
    FROM piktag_tags t
    JOIN seed s
      ON (s.concept_id IS NOT NULL AND t.concept_id = s.concept_id)
      OR  t.id = s.id
  ),
  -- Distinct public members holding any expanded tag (public tags).
  member_ids AS (
    SELECT DISTINCT ut.user_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM expanded_tags)
      AND ut.is_private = false
  ),
  pub AS (
    SELECT p.id, p.username, p.full_name, p.avatar_url,
           p.headline, p.is_verified
    FROM piktag_profiles p
    JOIN member_ids m ON m.user_id = p.id
    WHERE p.is_public = true
    ORDER BY p.is_verified DESC NULLS LAST, p.username
    LIMIT GREATEST(p_limit, 1)
  ),
  member_tags AS (
    SELECT pu.id AS user_id,
           COALESCE((
             SELECT jsonb_agg(x.name ORDER BY x.position)
             FROM (
               SELECT t.name, ut.position
               FROM piktag_user_tags ut
               JOIN piktag_tags t ON t.id = ut.tag_id
               WHERE ut.user_id = pu.id
                 AND ut.is_private = false
               ORDER BY ut.position
               LIMIT 15
             ) x
           ), '[]'::jsonb) AS tags
    FROM pub pu
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM seed) THEN NULL
    ELSE jsonb_build_object(
      'tag_name',    (SELECT name FROM seed),
      'usage_count', (SELECT count(*)::int FROM member_ids),
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'username',    pu.username,
          'full_name',   pu.full_name,
          'avatar_url',  pu.avatar_url,
          'headline',    pu.headline,
          'is_verified', COALESCE(pu.is_verified, false),
          'tags',        mt.tags
        ))
        FROM pub pu
        JOIN member_tags mt ON mt.user_id = pu.id
      ), '[]'::jsonb)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.tag_page_members(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tag_page_members(text, int)
  TO anon, authenticated, service_role;
