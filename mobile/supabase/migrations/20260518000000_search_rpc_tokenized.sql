-- 20260518000000_search_rpc_tokenized.sql
--
-- Multi-keyword search fix (audit HIGH).
--
-- search_users() matched the WHOLE query as one substring:
--     t.name  ILIKE '%' || qtext || '%'
--     a.alias ILIKE '%' || qtext || '%'
-- So a single keyword ("designer") worked, but a real multi-word
-- query ("designer taipei") became `ILIKE '%designer taipei%'`,
-- which matches essentially no tag/alias → zero people. The mobile
-- client only ever passed keywords[0] to dodge this, so multi-word
-- people-search silently ignored every word after the first.
--
-- Fix: tokenize the query on whitespace and match a tag/alias if it
-- contains ANY token (OR semantics). User ranking is unchanged —
-- per_user.matched_tag_count still counts distinct matched tags, so
-- someone whose tags hit BOTH "designer" and "taipei" naturally
-- outranks someone who hits only one. Single-token queries behave
-- exactly as before (one term → one ILIKE). Empty query → no rows
-- (same as before: the terms CTE is empty, the EXISTS guards fail).
--
-- Everything else (alias→concept expansion, sibling expansion,
-- block filtering, self-exclusion, scoring, LIMITs, signature,
-- return columns, GRANT, SECURITY INVOKER, search_path) is
-- byte-for-byte the previous behaviour. Idempotent CREATE OR
-- REPLACE — safe to run multiple times.

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
  -- Split the query into whitespace-separated terms. DISTINCT +
  -- LIMIT bounds the ILIKE fan-out for pathological inputs; empty
  -- pieces (leading/trailing/multiple spaces) are dropped, so an
  -- empty query yields zero terms → zero results, as before.
  terms AS (
    SELECT DISTINCT btrim(piece) AS term
    FROM q,
         LATERAL regexp_split_to_table(q.qtext, '\s+') AS piece
    WHERE btrim(piece) <> ''
    LIMIT 6
  ),
  -- Direct name matches: tag name contains ANY term.
  name_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE t.name ILIKE '%' || te.term || '%'
    )
    ORDER BY t.usage_count DESC
    LIMIT 30
  ),
  -- Alias matches → expand to all tags sharing the alias's concept.
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
