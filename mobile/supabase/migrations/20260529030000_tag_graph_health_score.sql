-- 20260529030000_tag_graph_health_score.sql
--
-- North-Star tag-quality principle #7 — Interest-graph coverage as a
-- user-visible metric. See CLAUDE.md "Tag-quality principles".
--
-- Computes a 0-100 "tag-graph health" score per user, returned as a
-- JSON object with both the score AND the components so the UI can
-- show "what's missing" hints to under-tagged users (LinkedIn
-- "Profile strength" analog).
--
-- Components & weights (sum = 100):
--   has_self            (≥1 public self-tag)              25
--   has_friend          (≥1 friend public-endorsed)       25
--   has_ask             (ever posted an Ask)              15
--   has_event           (was in a scanned-event QR)       15
--   concept_diversity   (2 pts per distinct concept,      20
--                        capped at 10 concepts = 20 pts)
--
-- Rationale for the weights: self + friend together = 50 (the
-- canonical "self-claim verified by peer" axis from principles #1
-- and #2, the most important signal). Ask + event = 30 (current
-- intent + factual context — important but volatile and
-- circumstantial). Concept diversity = 20 (rewards a rich graph
-- with breadth, but anyone with 10+ distinct concepts already maxes
-- it; further tags add nothing — avoids tag-spamming behaviour).
--
-- SECURITY INVOKER so RLS still applies: a user can compute their
-- own health, the RPC reads only public_tags / public_endorsements
-- per existing policies. p_user_id defaults to auth.uid() so the
-- common case is parameter-less. Public users could in theory ask
-- about another user's score; that's fine — the score doesn't leak
-- anything not already inferrable from their public profile.

CREATE OR REPLACE FUNCTION public.get_tag_graph_health(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  target AS (
    SELECT COALESCE(p_user_id, auth.uid()) AS user_id
  ),
  flags AS (
    SELECT
      EXISTS(
        SELECT 1 FROM piktag_user_tags ut, target t
        WHERE ut.user_id = t.user_id AND ut.is_private = false
        LIMIT 1
      ) AS has_self,
      EXISTS(
        SELECT 1 FROM piktag_connection_tags ct
        JOIN piktag_connections c ON c.id = ct.connection_id
        JOIN target t ON t.user_id = c.connected_user_id
        WHERE ct.is_private = false
        LIMIT 1
      ) AS has_friend,
      EXISTS(
        SELECT 1 FROM piktag_asks a, target t
        WHERE a.author_id = t.user_id
        LIMIT 1
      ) AS has_ask,
      EXISTS(
        SELECT 1 FROM piktag_connections c, target t
        WHERE (c.user_id = t.user_id OR c.connected_user_id = t.user_id)
          AND c.scan_session_id IS NOT NULL
        LIMIT 1
      ) AS has_event,
      (
        SELECT COUNT(DISTINCT pt.concept_id)::int
        FROM piktag_user_tags ut
        JOIN piktag_tags pt ON pt.id = ut.tag_id
        JOIN target t ON t.user_id = ut.user_id
        WHERE ut.is_private = false AND pt.concept_id IS NOT NULL
      ) AS distinct_concepts
  )
  SELECT jsonb_build_object(
    'score',
        (CASE WHEN flags.has_self   THEN 25 ELSE 0 END)
      + (CASE WHEN flags.has_friend THEN 25 ELSE 0 END)
      + (CASE WHEN flags.has_ask    THEN 15 ELSE 0 END)
      + (CASE WHEN flags.has_event  THEN 15 ELSE 0 END)
      + LEAST(flags.distinct_concepts * 2, 20),
    'components', jsonb_build_object(
      'has_self',          flags.has_self,
      'has_friend',        flags.has_friend,
      'has_ask',           flags.has_ask,
      'has_event',         flags.has_event,
      'distinct_concepts', flags.distinct_concepts
    )
  )
  FROM flags;
$$;

GRANT EXECUTE ON FUNCTION public.get_tag_graph_health(uuid) TO authenticated;
