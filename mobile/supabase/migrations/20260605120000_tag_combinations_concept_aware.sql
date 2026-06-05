-- 20260605120000_tag_combinations_concept_aware.sql
--
-- Cross-language fix for the weekly tag-combination magic moment.
--
-- find_tag_combinations (def 20260513180000) paired tags by LITERAL
-- tag_id (ft1.tag_id < ft2.tag_id) and counted distinct friends per
-- (tag_a, tag_b). So "N friends are #台北 + #攝影" never counted a
-- friend tagged #台北 + #拍照 (拍照 is a 攝影 sibling) — cross-language /
-- cross-wording co-occurrence was invisible, the same concept-layer gap
-- the other magic moments had.
--
-- FIX: pair by CONCEPT KEY (COALESCE(concept_id::text,'tag:'||tag_id::text)),
-- deduped per friend so a friend's two sibling tags collapse to one
-- concept. Each friend contributes each concept-pair once; the ≥2-friend
-- threshold and novelty filter (drop pairs the viewer already self-holds)
-- now operate on concepts. An unlinked tag keeps its own 'tag:<id>' key,
-- so it only pairs with identical unlinked tags until the linker assigns
-- a concept — no regression. Representative tag names (a friend's own
-- wording, min() for determinism) fill the existing tag_a_name /
-- tag_b_name return columns, so the enqueue wrapper (20260531030000) and
-- its notification copy are unchanged.
--
-- #variable_conflict use_column directive + RETURNS TABLE shape + grants
-- preserved.
--
-- NOTE: find_tag_similar_strangers (same 2026-05-13 file) is also
-- literal-tag-id, but it is NO LONGER called from the client (the search
-- redesign removed the recommendedUsers surface). Left untouched on
-- purpose — fixing dead code adds no value; revisit IF that surface
-- returns.

CREATE OR REPLACE FUNCTION public.find_tag_combinations()
RETURNS TABLE (
  user_id uuid,
  tag_a_name text,
  tag_b_name text,
  match_count integer,
  sample_friend_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  friends AS (
    SELECT c.user_id AS viewer_id, c.connected_user_id AS friend_id
    FROM public.piktag_connections c
  ),
  -- Every (viewer, friend, concept) edge with a representative name.
  friend_tags AS (
    SELECT f.viewer_id, f.friend_id,
      COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS ckey,
      t.name
    FROM friends f
    JOIN public.piktag_user_tags ut ON ut.user_id = f.friend_id
    JOIN public.piktag_tags t ON t.id = ut.tag_id
  ),
  -- Collapse a friend's sibling tags to ONE concept (one name).
  friend_concepts AS (
    SELECT DISTINCT ON (viewer_id, friend_id, ckey)
      viewer_id, friend_id, ckey, name
    FROM friend_tags
    ORDER BY viewer_id, friend_id, ckey, name
  ),
  -- Unordered concept pairs each friend carries (cka < ckb).
  friend_pairs AS (
    SELECT fc1.viewer_id, fc1.friend_id,
      fc1.ckey AS cka, fc2.ckey AS ckb,
      fc1.name AS na, fc2.name AS nb
    FROM friend_concepts fc1
    JOIN friend_concepts fc2
      ON fc1.viewer_id = fc2.viewer_id
     AND fc1.friend_id = fc2.friend_id
     AND fc1.ckey < fc2.ckey
  ),
  -- The viewer's own concepts (to filter self-identified pairs).
  viewer_concepts AS (
    SELECT ut.user_id AS viewer_id,
      COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS ckey
    FROM public.piktag_user_tags ut
    JOIN public.piktag_tags t ON t.id = ut.tag_id
  ),
  combos AS (
    SELECT
      fp.viewer_id,
      fp.cka,
      fp.ckb,
      min(fp.na) AS tag_a_name,
      min(fp.nb) AS tag_b_name,
      COUNT(DISTINCT fp.friend_id)::integer AS match_count,
      array_agg(DISTINCT COALESCE(p.full_name, p.username) ORDER BY COALESCE(p.full_name, p.username))
        FILTER (WHERE COALESCE(p.full_name, p.username) IS NOT NULL) AS friend_names
    FROM friend_pairs fp
    JOIN public.piktag_profiles p ON p.id = fp.friend_id
    GROUP BY fp.viewer_id, fp.cka, fp.ckb
    HAVING COUNT(DISTINCT fp.friend_id) >= 2
  ),
  novel_combos AS (
    SELECT c.*
    FROM combos c
    WHERE NOT EXISTS (
      SELECT 1 FROM viewer_concepts vc
      WHERE vc.viewer_id = c.viewer_id AND vc.ckey = c.cka
    )
    OR NOT EXISTS (
      SELECT 1 FROM viewer_concepts vc
      WHERE vc.viewer_id = c.viewer_id AND vc.ckey = c.ckb
    )
  ),
  ranked AS (
    SELECT nc.*,
      ROW_NUMBER() OVER (
        PARTITION BY nc.viewer_id
        ORDER BY nc.match_count DESC, nc.tag_a_name, nc.tag_b_name
      ) AS rk
    FROM novel_combos nc
  )
  SELECT
    r.viewer_id, r.tag_a_name, r.tag_b_name, r.match_count,
    (r.friend_names)[1:3]
  FROM ranked r
  WHERE r.rk = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_tag_combinations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_tag_combinations() TO postgres, service_role;
