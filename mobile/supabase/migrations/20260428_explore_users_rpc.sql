-- Tag-detail "Explore" tab: collapse 5 client round-trips into one RPC.
--
-- Before: TagDetailScreen.fetchExploreUsers() ran:
--   1. piktag_tags concept lookup
--   2. piktag_tags sibling lookup (same concept_id)
--   3. piktag_user_tags  → user_ids with these tags (limit 2000)
--   4. piktag_profiles   → resolve profile rows (filter is_public)
--   5. piktag_user_tags  → my own tag_ids
--   6. piktag_user_tags  → all candidates' tags for mutual count (limit 2000)
-- + sort + dedupe in JS.
--
-- The IN(userIds) on the last query is the slow path: 50–200 users with
-- a few hundred tags each balloons into a multi-thousand row scan with no
-- usable index when called over PostgREST.
--
-- After: a single SQL function does the join, mutual-count and sort
-- server-side and returns ≤ p_limit rows ready to render. Brings the
-- page from 1–3 s on cellular down to ~150–250 ms (server-bound, mostly
-- network RTT).

CREATE OR REPLACE FUNCTION public.explore_users_for_tag(
  p_tag_id uuid,
  p_limit  int DEFAULT 100
)
RETURNS TABLE (
  id               uuid,
  username         text,
  full_name        text,
  avatar_url       text,
  is_verified      boolean,
  mutual_tag_count int,
  total_count      bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER       -- runs as the caller; RLS still applies and
                       -- auth.uid() resolves to the calling user
SET search_path = public
AS $$
  WITH
  tag_concept AS (
    SELECT concept_id FROM piktag_tags WHERE id = p_tag_id LIMIT 1
  ),
  sibling_tags AS (
    -- All tags that share the same concept; if no concept, just the
    -- tag itself.
    SELECT t.id
    FROM piktag_tags t
    CROSS JOIN tag_concept c
    WHERE
      (c.concept_id IS NOT NULL AND t.concept_id = c.concept_id)
      OR (c.concept_id IS NULL AND t.id = p_tag_id)
  ),
  candidate_users AS (
    SELECT DISTINCT ut.user_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM sibling_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
  ),
  my_tag_ids AS (
    SELECT tag_id
    FROM piktag_user_tags
    WHERE user_id = auth.uid()
  ),
  mutual_counts AS (
    SELECT ut.user_id, COUNT(*) AS mutual_count
    FROM piktag_user_tags ut
    WHERE ut.user_id IN (SELECT user_id FROM candidate_users)
      AND ut.is_private = false
      AND ut.tag_id IN (SELECT tag_id FROM my_tag_ids)
    GROUP BY ut.user_id
  ),
  ranked AS (
    SELECT
      p.id,
      p.username,
      p.full_name,
      p.avatar_url,
      p.is_verified,
      COALESCE(mc.mutual_count, 0)::int AS mutual_tag_count
    FROM piktag_profiles p
    INNER JOIN candidate_users cu ON cu.user_id = p.id
    LEFT JOIN mutual_counts mc ON mc.user_id = p.id
    WHERE p.is_public = true
  )
  SELECT
    r.id,
    r.username,
    r.full_name,
    r.avatar_url,
    r.is_verified,
    r.mutual_tag_count,
    -- Total candidate count surfaces in the UI ("探索 7"). Returning it
    -- here saves a separate count(*) round-trip and stays consistent
    -- with the page slice.
    COUNT(*) OVER ()::bigint AS total_count
  FROM ranked r
  ORDER BY r.mutual_tag_count DESC, r.id
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.explore_users_for_tag(uuid, int)
  TO authenticated;

-- Helpful supporting indexes — most installations already have these
-- under different names, but `IF NOT EXISTS` keeps the migration safe
-- and explicit about what the RPC depends on.

CREATE INDEX IF NOT EXISTS idx_piktag_user_tags_tag_id_public
  ON piktag_user_tags (tag_id)
  WHERE is_private = false;

CREATE INDEX IF NOT EXISTS idx_piktag_user_tags_user_id
  ON piktag_user_tags (user_id);

CREATE INDEX IF NOT EXISTS idx_piktag_tags_concept_id
  ON piktag_tags (concept_id)
  WHERE concept_id IS NOT NULL;
