-- 20260705010000_search_dormant_tiebreaker.sql
-- =============================================================================
-- Reactivation backlog #5 (2026-07-05). NOT a re-weighting: the founder's
-- deferred-tuning doctrine (no hand-tuned coefficients before
-- piktag_search_impressions accrues) stands. This adds a pure TIEBREAKER:
-- among results with the SAME match_score, the viewer's longest-known
-- friends rank first (vc.met_at ASC). Relevance ordering is unchanged.
-- Function body otherwise byte-identical to 20260612010000's version.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, matched_tag_count integer, endorser_count integer, match_score integer)
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
  -- NEW (v3 pre-launch primitive #2): per-viewer dismissals on the
  -- SEARCH surface. A candidate this searcher has hidden from search
  -- in the last 60 days is excluded from results. Surface-scoped to
  -- 'search' only — other surfaces' dismissals (ask_match,
  -- recommendation, etc.) carry different semantics and must not
  -- bleed across. Mirrors the predicate shape in
  -- 20260530050000_match_dismissals.sql / 20260530120000.
  dismissed AS (
    SELECT DISTINCT target_id AS uid
    FROM piktag_match_dismissals d
    WHERE d.viewer_id = auth.uid()
      AND d.surface = 'search'
      AND d.dismissed_at > now() - interval '60 days'
  ),
  self_matches AS (
    SELECT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
      AND ut.user_id NOT IN (SELECT uid FROM dismissed)
  ),
  friend_matches AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  ask_matches AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    WHERE at.tag_id IN (SELECT id FROM matched_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.author_id IS DISTINCT FROM auth.uid()
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.author_id NOT IN (SELECT uid FROM dismissed)
  ),
  event_matches AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IS DISTINCT FROM auth.uid()
      AND c.user_id NOT IN (SELECT uid FROM blocked)
      AND c.user_id NOT IN (SELECT uid FROM dismissed)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
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
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      CASE
        WHEN has_self AND has_friend                                   THEN 30
        WHEN has_self                                                  THEN 10
        WHEN has_friend                                                THEN 6
        WHEN has_ask                                                   THEN 4
        ELSE                                                                3
      END AS tag_weight
    FROM per_user_tag
  ),
  -- Distinct endorser count per target across the matched_tags set.
  -- "How many distinct people publicly endorsed this user on any of
  -- the tags this search is about." Different from friend_matches'
  -- per-tag flag — this counts UNIQUE taggers (de-duped on tagger id).
  -- Also filters dismissed targets so the count doesn't include
  -- people the viewer hid (consistency with the candidate set above).
  endorser_counts AS (
    SELECT
      c.connected_user_id AS user_id,
      COUNT(DISTINCT c.user_id) AS endorser_count
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
    GROUP BY c.connected_user_id
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
    COALESCE(ec.endorser_count, 0)::int AS endorser_count,
    (s.source_score + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  LEFT JOIN endorser_counts ec ON ec.user_id = s.user_id
  -- backlog #5 (2026-07-05): viewer's own connection row, for the dormant
  -- tiebreaker below. LEFT JOIN — strangers simply have NULL met_at.
  LEFT JOIN piktag_connections vc
    ON vc.user_id = auth.uid() AND vc.connected_user_id = p.id
  WHERE p.is_public = true
    AND COALESCE(p.is_official, false) = false
  -- Dormant-first TIEBREAKER only (deferred-tuning doctrine: main weights
  -- untouched pre-data). Among EQUAL match scores, friends the viewer has
  -- known longest rank first — reactivation-flavoured, zero relevance
  -- distortion; strangers (NULL met_at) keep their position after friends.
  ORDER BY match_score DESC, vc.met_at ASC NULLS LAST, p.username
  LIMIT p_limit;
$function$;

