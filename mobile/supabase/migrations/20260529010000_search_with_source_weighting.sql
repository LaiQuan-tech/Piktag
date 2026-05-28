-- 20260529010000_search_with_source_weighting.sql
--
-- North-Star tag-quality principles #1 (multi-source provenance weighting)
-- + #2 (inter-source agreement = verified). See CLAUDE.md "Tag-quality
-- principles" for the full framing.
--
-- Pre-change: search_users only looked at piktag_user_tags (self-tags).
-- Friend-endorsed public tags in piktag_connection_tags were completely
-- ignored by ranking — a real signal silently discarded. Verified
-- tags (self + friend agree) had no score boost over plain self-tags.
--
-- Post-change: the candidate-user funnel UNIONs across two sources,
-- per-(user,tag) collapses to a single row with flags has_self /
-- has_friend, then the rank formula scores per source:
--   • verified  (self + friend both endorse same tag) → 30 pts
--   • self only (target's own claim, no peer echo)   → 10 pts (unchanged)
--   • friend only (peer endorsement w/o self-claim)   → 6 pts
--   + 1-pt boost for is_verified profiles (unchanged)
--
-- Why these weights:
--   - verified at 3x self-only because consensus is the strongest
--     signal we have absent a real ground truth (Google data-labeling
--     guide §"inter-annotator agreement")
--   - friend-only at 0.6x self-only: peers may see something the
--     target doesn't self-promote, so still counts — but less than
--     a self-confirmation
--
-- All existing CJK decomposition / alias expansion / sibling concept
-- routing / block filtering / verified-profile bonus is preserved
-- verbatim; only the candidate_tags CTE and the final scoring SELECT
-- change.
--
-- Idempotent — CREATE OR REPLACE FUNCTION. Safe to re-run.

CREATE OR REPLACE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, matched_tag_count integer, match_score integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  q AS (
    SELECT btrim(replace(p_query, '#', '')) AS qtext
  ),
  raw_terms AS (
    SELECT DISTINCT btrim(piece) AS term
    FROM q,
         LATERAL regexp_split_to_table(q.qtext, '\s+') AS piece
    WHERE btrim(piece) <> ''
    LIMIT 6
  ),
  cjk_decomp AS (
    SELECT substring(rt.term FROM i FOR 1) AS term
    FROM raw_terms rt, generate_series(1, length(rt.term)) AS i
    WHERE rt.term ~ '^[一-鿿]{2,6}$'
  ),
  terms AS (
    SELECT term FROM raw_terms
    UNION
    SELECT term FROM cjk_decomp WHERE term ~ '[一-鿿]'
    LIMIT 12
  ),
  name_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE t.name ILIKE '%' || te.term || '%'
    )
    ORDER BY t.usage_count DESC
    LIMIT 30
  ),
  alias_concepts AS (
    SELECT DISTINCT a.concept_id
    FROM tag_aliases a
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE a.alias ILIKE '%' || te.term || '%'
    )
    LIMIT 10
  ),
  alias_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN alias_concepts ac ON ac.concept_id = t.concept_id
  ),
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

  -- ── NEW: candidate funnel across two sources ─────────────────────
  -- self-source: target's own public tag
  self_matches AS (
    SELECT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
  ),
  -- friend-source: anyone-tagged-target-X-with-Y via piktag_connection_tags.
  -- We're SECURITY INVOKER but the underlying tables' RLS allows reading
  -- public connection rows. Block-filter applied to the TARGET (the user
  -- who would surface in search), matching the self_matches behaviour —
  -- the tagger isn't filtered because they don't appear in the result.
  friend_matches AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
  ),
  -- Per (user, tag) presence flags — bool_or collapses duplicates from
  -- either source so verified detection is exact.
  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      bool_or(src = 'self')   AS has_self,
      bool_or(src = 'friend') AS has_friend
    FROM (
      SELECT user_id, tag_id, 'self'::text AS src FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, 'friend'::text AS src FROM friend_matches
    ) u
    GROUP BY user_id, tag_id
  ),
  scoring AS (
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE has_self AND has_friend)        ::int AS verified_count,
      COUNT(*) FILTER (WHERE has_self AND NOT has_friend)    ::int AS self_only_count,
      COUNT(*) FILTER (WHERE NOT has_self AND has_friend)    ::int AS friend_only_count,
      COUNT(*)                                                ::int AS matched_tag_count
    FROM per_user_tag
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    s.matched_tag_count,
    -- Principle #1+#2 scoring: verified weight 3x self-only, friend-only
    -- weight 0.6x self-only. Profile-verified bonus +1 unchanged.
    (s.verified_count * 30
     + s.self_only_count * 10
     + s.friend_only_count * 6
     + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_users(text, int) TO authenticated;
