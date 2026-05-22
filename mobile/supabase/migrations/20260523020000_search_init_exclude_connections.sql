-- 20260523020000_search_init_exclude_connections.sql
--
-- BUG: SearchScreen's "你可能想認識" (people you might want to know)
-- list surfaced people the viewer is ALREADY connected to. The
-- search_screen_init RPC builds `recommended_users` from `rec_pool` —
-- a random sample of public profiles — and that pool excluded only
-- self + blocked users, NOT the viewer's existing 1st-degree
-- connections. So a friend could (and did) appear in a list whose
-- whole purpose is discovering people you DON'T yet know.
--
-- (The other recommendation source, find_tag_similar_strangers, is
-- correct — it already filters `NOT IN friends_1`. Only the RPC fast
-- path needed fixing.)
--
-- FIX: add a `connections` CTE and exclude it from `rec_pool`.
-- CREATE OR REPLACE — idempotent, safe to re-run. Everything else in
-- the function (popular tags, category roll-up, the JSON envelope) is
-- byte-identical to 20260428p_search_init_rpc.sql.

CREATE OR REPLACE FUNCTION public.search_screen_init()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER          -- caller's RLS + auth.uid() apply
SET search_path = public
AS $$
  WITH
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks WHERE blocked_id = auth.uid()
  ),
  -- The viewer's existing 1st-degree connections. "你可能想認識" is a
  -- discovery surface — people you ALREADY know must not appear in it.
  connections AS (
    SELECT connected_user_id AS uid
    FROM piktag_connections
    WHERE user_id = auth.uid()
  ),
  popular AS (
    SELECT id, name, semantic_type, usage_count, concept_id
    FROM piktag_tags
    ORDER BY usage_count DESC NULLS LAST
    LIMIT 30
  ),
  -- Random sample of public profiles, excluding self + blocked +
  -- existing connections. TABLESAMPLE would be ideal but degrades on
  -- small tables; ORDER BY random() over a capped pool is fine here.
  rec_pool AS (
    SELECT id, username, full_name, avatar_url, bio, is_verified
    FROM piktag_profiles
    WHERE is_public = true
      AND id IS DISTINCT FROM auth.uid()
      AND id NOT IN (SELECT uid FROM blocked)
      AND id NOT IN (SELECT uid FROM connections)
    ORDER BY random()
    LIMIT 10
  ),
  -- Top concept_ids by distinct public-tagger count. We surface the
  -- canonical concept name + semantic type so the UI doesn't need a
  -- second lookup.
  cat_counts AS (
    SELECT t.concept_id, COUNT(DISTINCT ut.user_id) AS user_count
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.is_private = false
      AND t.concept_id IS NOT NULL
    GROUP BY t.concept_id
    ORDER BY user_count DESC
    LIMIT 10
  ),
  recent_cats AS (
    SELECT
      cc.concept_id,
      cc.user_count,
      tc.canonical_name,
      tc.semantic_type
    FROM cat_counts cc
    LEFT JOIN tag_concepts tc ON tc.id = cc.concept_id
    ORDER BY cc.user_count DESC
  )
  SELECT jsonb_build_object(
    'popular_tags', COALESCE(
      (SELECT jsonb_agg(to_jsonb(p)) FROM popular p),
      '[]'::jsonb
    ),
    'recommended_users', COALESCE(
      (SELECT jsonb_agg(to_jsonb(r)) FROM rec_pool r),
      '[]'::jsonb
    ),
    'recent_categories', COALESCE(
      (SELECT jsonb_agg(to_jsonb(rc)) FROM recent_cats rc),
      '[]'::jsonb
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.search_screen_init() TO authenticated;
