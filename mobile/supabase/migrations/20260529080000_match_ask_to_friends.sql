-- 20260529080000_match_ask_to_friends.sql
--
-- North-Star Phase 1: Ask direct-match. After a user posts an Ask,
-- we surface the top N of their OWN friends (1st-degree only) that
-- match the Ask's tags + concept-sibling network, ranked by the
-- same source-weighted formula search_users uses.
--
-- Layer split (CLAUDE.md tag-quality table):
--   - 1st-degree direct match  ← THIS RPC, immediate, low-risk,
--                                user-knows-them confirmation
--   - 2nd-degree IG-story      — kept, serendipity / weak-tie
--                                discovery (AskStoryRow unchanged)
--
-- Scoring uses the same priority cascade as search_users (verified
-- 30 / self-only 10 / friend-only 6 / ask-only 4 / event-only 3),
-- but scoped to friends-of-the-asker. Friends with no matching tag
-- at all are filtered out before the join.
--
-- Returns one row per matching friend with:
--   - profile fields (id, username, full_name, avatar_url, is_verified)
--   - match_score (the priority-cascade sum)
--   - matched_tag_count
--   - top_matched_tags (text[] of up to 3 tag names that drove the
--     score — fuels the "為什麼這個 match" badge in the UI)
--
-- SECURITY INVOKER — RLS naturally constrains who's a friend; auth
-- .uid() resolves to the asker since this is called from the client
-- via supabase.rpc().

CREATE OR REPLACE FUNCTION public.match_ask_to_friends(
  p_ask_id uuid,
  p_limit  int DEFAULT 5
)
RETURNS TABLE (
  id                 uuid,
  username           text,
  full_name          text,
  avatar_url         text,
  is_verified        boolean,
  matched_tag_count  int,
  match_score        int,
  top_matched_tags   text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  asker AS (SELECT auth.uid() AS uid),
  -- Ask owner must equal the asker — otherwise we'd let a user pull
  -- match data for someone else's Ask. The ask_tag_ids set is empty
  -- on mismatch, returning no rows naturally.
  ask_ownership AS (
    SELECT a.author_id
    FROM piktag_asks a, asker
    WHERE a.id = p_ask_id AND a.author_id = asker.uid
    LIMIT 1
  ),
  ask_tag_ids AS (
    SELECT at.tag_id
    FROM piktag_ask_tags at
    JOIN ask_ownership o ON true   -- gate: empty if ownership failed
    WHERE at.ask_id = p_ask_id
  ),
  -- Concept-sibling expansion: any other tag sharing concept_id with
  -- the Ask's tags is also a valid match. Mirrors search_users.
  expanded_tags AS (
    SELECT DISTINCT t.id
    FROM piktag_tags t
    WHERE t.id IN (SELECT tag_id FROM ask_tag_ids)
    UNION
    SELECT DISTINCT t2.id
    FROM piktag_tags t1
    JOIN piktag_tags t2 ON t2.concept_id IS NOT NULL AND t2.concept_id = t1.concept_id
    WHERE t1.id IN (SELECT tag_id FROM ask_tag_ids)
      AND t1.concept_id IS NOT NULL
  ),
  -- 1st-degree friends (the asker's outgoing connections — people
  -- they know).
  friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM piktag_connections c, asker
    WHERE c.user_id = asker.uid
      AND c.connected_user_id IS DISTINCT FROM asker.uid
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks, asker WHERE blocker_id = asker.uid
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks, asker WHERE blocked_id = asker.uid
  ),
  -- Same 4-source presence as search_users, scoped to friends.
  self_matches AS (
    SELECT ut.user_id, ut.tag_id, t.name AS tag_name
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.tag_id IN (SELECT id FROM expanded_tags)
      AND ut.is_private = false
      AND ut.user_id IN (SELECT friend_id FROM friends)
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
  ),
  friend_endorsed AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id, t.name AS tag_name
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    JOIN piktag_tags t ON t.id = ct.tag_id
    WHERE ct.tag_id IN (SELECT id FROM expanded_tags)
      AND ct.is_private = false
      AND c.connected_user_id IN (SELECT friend_id FROM friends)
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
  ),
  ask_authoring AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id, t.name AS tag_name
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    JOIN piktag_tags t ON t.id = at.tag_id
    WHERE at.tag_id IN (SELECT id FROM expanded_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.id <> p_ask_id  -- don't match the asker against themself via this same Ask
      AND a.author_id IN (SELECT friend_id FROM friends)
      AND a.author_id NOT IN (SELECT uid FROM blocked)
  ),
  event_attendance AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IN (SELECT friend_id FROM friends)
      AND c.user_id NOT IN (SELECT uid FROM blocked)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IN (SELECT friend_id FROM friends)
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
  ),
  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      MAX(tag_name) AS tag_name,
      bool_or(src = 'self')           AS has_self,
      bool_or(src = 'friend')         AS has_friend,
      bool_or(src = 'ask')            AS has_ask,
      bool_or(src = 'event')          AS has_event
    FROM (
      SELECT user_id, tag_id, tag_name, 'self'::text   AS src FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'friend'::text AS src FROM friend_endorsed
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'ask'::text    AS src FROM ask_authoring
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'event'::text  AS src FROM event_attendance
    ) u
    GROUP BY user_id, tag_id
  ),
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      tag_name,
      CASE
        WHEN has_self AND has_friend THEN 30
        WHEN has_self                THEN 10
        WHEN has_friend              THEN 6
        WHEN has_ask                 THEN 4
        ELSE                              3
      END AS tag_weight
    FROM per_user_tag
  ),
  scoring AS (
    SELECT
      user_id,
      COUNT(*)::int        AS matched_tag_count,
      SUM(tag_weight)::int AS source_score
    FROM tag_scored
    GROUP BY user_id
  ),
  -- For each user, pick the top 3 tag names by per-tag weight as the
  -- "why we matched" badge content.
  top_tags_per_user AS (
    SELECT
      user_id,
      ARRAY(
        SELECT t.tag_name
        FROM tag_scored t
        WHERE t.user_id = sc.user_id
        ORDER BY t.tag_weight DESC, t.tag_name
        LIMIT 3
      ) AS tags
    FROM scoring sc
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    s.matched_tag_count,
    (s.source_score + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score,
    tt.tags AS top_matched_tags
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  LEFT JOIN top_tags_per_user tt ON tt.user_id = s.user_id
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_ask_to_friends(uuid, int) TO authenticated;
