-- 20260513020000_find_connections_by_tag.sql
--
-- P2 of the "Vibes" feature line — Cross-Vibe matching.
--
-- Use case: the user is working on something and needs to find
-- someone in their network with a specific skill/interest, even
-- if they met that person months ago at an unrelated Vibe. They
-- type "react" → this RPC scans every connection across every
-- Vibe and returns matches with their originating Vibe context.
--
-- Example: a year ago you met Alice at a diving Vibe. Today she
-- updated her profile tags to include "React Native". You type
-- "react" in the Vibes tab search → Alice surfaces with the
-- subtitle "met at 龍洞潛水 · 2025-05".
--
-- Ranking: exact match > prefix match > substring match. Within
-- the same score bucket, ties break on met_at DESC (recent
-- connections first).
--
-- Security: SECURITY DEFINER + explicit `c.user_id = auth.uid()`
-- guard inside the CTE — only your own connections are scanned.

CREATE OR REPLACE FUNCTION public.find_connections_by_tag(p_tag_query text)
RETURNS TABLE (
  connection_id uuid,
  connected_user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  met_at timestamptz,
  vibe_id uuid,
  vibe_name text,
  matched_tag text,
  match_score integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH
    -- Normalize: strip leading #, trim, lowercase. So "#React",
    -- "  react  ", and "React" all hit the same matches.
    query_norm AS (
      SELECT lower(trim(both '#' from trim(coalesce(p_tag_query, '')))) AS q
    ),
    -- Per-connection-per-matching-tag rows. Joins:
    --   piktag_connections (my friends)
    --     → piktag_user_tags  (their current profile tags)
    --     → piktag_tags        (tag names)
    -- The tag filter uses LIKE '%q%' so the search is a substring
    -- match; the CASE expression ranks exactness so exact matches
    -- come up first.
    matches AS (
      SELECT
        c.id AS connection_id,
        c.connected_user_id,
        c.met_at,
        c.scan_session_id,
        t.name AS matched_tag,
        CASE
          WHEN lower(t.name) = (SELECT q FROM query_norm) THEN 3
          WHEN lower(t.name) LIKE (SELECT q || '%' FROM query_norm) THEN 2
          ELSE 1
        END AS match_score
      FROM piktag_connections c
      JOIN piktag_user_tags ut ON ut.user_id = c.connected_user_id
      JOIN piktag_tags t ON t.id = ut.tag_id
      CROSS JOIN query_norm qn
      WHERE c.user_id = auth.uid()
        AND length(qn.q) >= 1
        AND lower(t.name) LIKE '%' || qn.q || '%'
    )
  SELECT DISTINCT ON (m.connection_id)
    m.connection_id,
    m.connected_user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    m.met_at,
    s.id AS vibe_id,
    s.name AS vibe_name,
    m.matched_tag,
    m.match_score
  FROM matches m
  JOIN piktag_profiles p ON p.id = m.connected_user_id
  -- LEFT JOIN so connections with a missing/legacy scan_session_id
  -- still appear (just without Vibe context). Cast both sides to
  -- text — same type-tolerance reason as 20260513010000.
  LEFT JOIN piktag_scan_sessions s
    ON s.id::text = m.scan_session_id::text
  -- DISTINCT ON (connection_id) collapses people who match on
  -- multiple of their tags into one row. ORDER BY puts the
  -- best-scoring match per person first within that DISTINCT.
  ORDER BY m.connection_id, m.match_score DESC, m.met_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.find_connections_by_tag(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_connections_by_tag(text) TO authenticated;
