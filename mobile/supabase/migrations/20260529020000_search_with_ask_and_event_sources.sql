-- 20260529020000_search_with_ask_and_event_sources.sql
--
-- North-Star tag-quality principles #1 (multi-source) continued + #4
-- (temporal decay) local application. See CLAUDE.md "Tag-quality
-- principles". This commit extends search_users from 2 sources
-- (self / friend, shipped in 20260529010000) to all 4 public sources:
--
--   self    — piktag_user_tags (target's own claim)
--   friend  — piktag_connection_tags (peer endorsement)
--   ask     — piktag_ask_tags via piktag_asks (current intent, LIVE only)
--   event   — piktag_scan_sessions.event_tags via piktag_connections
--             (factual record of where the user showed up)
--
-- Why "LIVE only" for ask source (principle #4 temporal decay applied
-- locally): an Ask is intent that EXPIRES with the Ask itself. A
-- 3-day-old expired Ask saying "find me a designer" doesn't help a
-- searcher who's looking for designers TODAY — the seeker has moved
-- on, the seeker is no longer reachable for this topic. So expired
-- asks are excluded entirely from this signal (decay → 0). Full
-- principle-#4 decay across all sources is a post-launch upgrade
-- (different decay functions per source); here we apply the most
-- obvious one inline.
--
-- Source priority cascade in scoring — each (user, tag) pair counts
-- ONCE at the highest applicable weight, never double-counted:
--
--   verified (self + friend both endorse)  → 30
--   self only (target's own claim)         → 10
--   friend only (peer w/o self echo)       → 6
--   ask only (live ask, current intent)    → 4
--   event only (factual record)            → 3
--
-- Why the cascade vs additive: a user who has #PM as self AND in an
-- ask shouldn't get self+ask points (would double-count the same
-- signal — they're saying the same thing twice). Treating "verified"
-- as the only multi-source bonus keeps the formula honest. Ask and
-- event come into play only when neither self nor friend has the tag,
-- making them genuine NEW coverage for thin-data users (cold-start).
--
-- Performance: 4 source CTEs are bounded by the matched_tags filter
-- (typically <30 tag ids after CJK + alias + sibling expansion), so
-- each branch is a small index lookup. The (user_id, tag_id) collapse
-- in per_user_tag does the dedup at SQL level.
--
-- Idempotent CREATE OR REPLACE FUNCTION. CI auto-applies on push.

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

  -- ── Four-source candidate funnel ─────────────────────────────────
  self_matches AS (
    SELECT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
  ),
  friend_matches AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
  ),
  -- LIVE asks only — see header note re: principle #4 inline decay.
  ask_matches AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    WHERE at.tag_id IN (SELECT id FROM matched_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.author_id IS DISTINCT FROM auth.uid()
      AND a.author_id NOT IN (SELECT uid FROM blocked)
  ),
  -- event_tags on scan_sessions is text[] (tag NAMES, not ids), so we
  -- resolve via tag name match against the matched_tags set. Both
  -- sides of the connection (host + scanner) get tagged with the
  -- event — they were both there.
  event_matches AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IS DISTINCT FROM auth.uid()
      AND c.user_id NOT IN (SELECT uid FROM blocked)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
  ),

  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      bool_or(src = 'self')   AS has_self,
      bool_or(src = 'friend') AS has_friend,
      bool_or(src = 'ask')    AS has_ask,
      bool_or(src = 'event')  AS has_event
    FROM (
      SELECT user_id, tag_id, 'self'::text   AS src FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, 'friend'::text AS src FROM friend_matches
      UNION ALL
      SELECT user_id, tag_id, 'ask'::text    AS src FROM ask_matches
      UNION ALL
      SELECT user_id, tag_id, 'event'::text  AS src FROM event_matches
    ) u
    GROUP BY user_id, tag_id
  ),
  -- Source-priority cascade: each (user, tag) earns the highest
  -- applicable weight only, never double-counted.
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      CASE
        WHEN has_self AND has_friend                                   THEN 30  -- verified
        WHEN has_self                                                  THEN 10  -- self only
        WHEN has_friend                                                THEN 6   -- friend only
        WHEN has_ask                                                   THEN 4   -- ask only
        ELSE                                                                3   -- event only (implied by row's existence)
      END AS tag_weight
    FROM per_user_tag
  ),
  scoring AS (
    SELECT
      user_id,
      COUNT(*)::int           AS matched_tag_count,
      SUM(tag_weight)::int    AS source_score
    FROM tag_scored
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    s.matched_tag_count,
    (s.source_score + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_users(text, int) TO authenticated;
