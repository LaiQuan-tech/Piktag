-- SearchScreen: collapse the N+1 tag-group user lookup into a single RPC.
--
-- Before: performSearch() fetched candidate tags, then for each of the
-- top 3 tags ran (sibling-tag lookup → user_tags lookup → profile join)
-- serially. With concept-aware synonyms that's 6+ round-trips per query.
--
-- After: search_users() resolves the search term into matching tag ids
-- (including sibling tags via concept_id), then returns one ranked slice
-- of public, non-blocked, non-self users with their matched tag count.
-- Used as the fast path; the legacy code is kept as a fallback.

CREATE OR REPLACE FUNCTION public.search_users(
  p_query text,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id                uuid,
  username          text,
  full_name         text,
  avatar_url        text,
  is_verified       boolean,
  matched_tag_count int,
  match_score       int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  q AS (
    SELECT btrim(replace(p_query, '#', '')) AS qtext
  ),
  -- Direct name matches.
  name_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t, q
    WHERE q.qtext <> '' AND t.name ILIKE '%' || q.qtext || '%'
    ORDER BY t.usage_count DESC
    LIMIT 30
  ),
  -- Alias matches → expand to all tags that share the alias's concept.
  alias_concepts AS (
    SELECT DISTINCT a.concept_id
    FROM tag_aliases a, q
    WHERE q.qtext <> '' AND a.alias ILIKE '%' || q.qtext || '%'
    LIMIT 10
  ),
  alias_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN alias_concepts ac ON ac.concept_id = t.concept_id
  ),
  -- Sibling expansion: any other tag sharing a concept with a name match.
  sibling_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN name_tags nt ON nt.concept_id IS NOT NULL AND nt.concept_id = t.concept_id
  ),
  matched_tags AS (
    SELECT id FROM name_tags
    UNION
    SELECT id FROM alias_tags
    UNION
    SELECT id FROM sibling_tags
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks WHERE blocked_id = auth.uid()
  ),
  candidate_tags AS (
    SELECT DISTINCT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
  ),
  per_user AS (
    SELECT user_id, COUNT(*)::int AS matched_tag_count
    FROM candidate_tags
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    pu.matched_tag_count,
    -- Verified users get a small boost; otherwise rank by tag overlap.
    pu.matched_tag_count * 10 + (CASE WHEN p.is_verified THEN 1 ELSE 0 END) AS match_score
  FROM per_user pu
  JOIN piktag_profiles p ON p.id = pu.user_id
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_users(text, int) TO authenticated;
