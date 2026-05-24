-- SearchScreen initial load: collapse three independent client queries
-- (popular tags, recommended users, category roll-up) into a single RPC.
--
-- Before: SearchScreen mount fired 3+ parallel requests over PostgREST,
-- each paying TLS + auth + planner overhead. On cellular this stacks up
-- to 1–3 s of perceived load.
--
-- After: one round-trip returns a JSON envelope with all three slices,
-- ready for the screen to hydrate. The legacy code paths remain as
-- a fallback for deploys where this migration hasn't run yet.

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
  popular AS (
    SELECT id, name, semantic_type, usage_count, concept_id
    FROM piktag_tags
    ORDER BY usage_count DESC NULLS LAST
    LIMIT 30
  ),
  -- Random sample of public profiles, excluding self + blocked.
  -- TABLESAMPLE would be ideal but degrades on small tables; ORDER BY
  -- random() over a capped pool is fine at this size.
  rec_pool AS (
    SELECT id, username, full_name, avatar_url, bio, is_verified
    FROM piktag_profiles
    WHERE is_public = true
      AND id IS DISTINCT FROM auth.uid()
      AND id NOT IN (SELECT uid FROM blocked)
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
