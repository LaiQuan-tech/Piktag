-- 20260530140000_search_users_filter_dismissals_removals.sql
--
-- v3 vision pre-launch primitive #2 — wire negative signals into the
-- search_users ranking RPC. See CLAUDE.md "## v3 vision — Tag-auction
-- monetization" → "Pre-launch must-ship primitives".
--
-- WHY (the trust-violation framing). The North Star ranking-surface
-- checklist in CLAUDE.md says verbatim: *"a 'Recommendation' that
-- re-suggests a dismissed person is the single most user-trust-eroding
-- bug in this space."* That same logic applies the moment a Sponsored
-- placement re-surfaces a dismissed candidate on search. v3 will layer
-- Sponsored placement ABOVE organic search results (separate pipeline,
-- per the load-bearing "Sponsored ≠ Organic, NEVER interleave" rule),
-- but BOTH pipelines need to honor the dismissals table — otherwise
-- day-one Sponsored could re-surface someone the viewer just hid, which
-- is the worst-possible product failure. This migration ships the
-- insurance BEFORE bid storage exists, so the data path is correct
-- the first time monetization lands.
--
-- WHAT (the predicate). One new `dismissed` CTE inside search_users,
-- mirroring the pattern shipped in 20260530050000_match_dismissals.sql
-- (`match_ask_to_friends`) and 20260530120000_recommendation_cron_concept_aware.sql
-- (`enqueue_recommendation_notifications`). Filters candidates that the
-- viewer (= auth.uid() = the searcher) dismissed on the 'search' surface
-- within the last 60 days. Scope is SEARCH-SURFACE ONLY — dismissals on
-- other surfaces (ask_match, recommendation, etc.) have different
-- semantics; a user hiding someone from an ask-match candidate sheet
-- has not necessarily said "never show in search." 60-day horizon
-- matches match_ask_to_friends + the recommendation cron — consistency
-- over cleverness.
--
-- WHAT STAYS THE SAME (load-bearing — do NOT regress):
--   * CJK 2-6 char per-character decomposition.
--   * Term-resolution: name_tags + alias_tags + sibling_tags via concept_id.
--   * 4-source candidate UNION: self / friend / ask / event.
--   * Source priority cascade weighting:
--       self+friend=30, self=10, friend=6, ask=4, event=3.
--   * `endorser_counts` distinct-tagger aggregation across matched_tags.
--   * Verified +1 bonus on match_score.
--   * blocks filter (both directions).
--   * is_private = false filter on user_tags / connection_tags.
--   * ORDER BY match_score DESC, p.username + LIMIT p_limit.
--   * Return shape (8 columns: id, username, full_name, avatar_url,
--     is_verified, matched_tag_count, endorser_count, match_score).
--
-- WHAT IS DELIBERATELY NOT WIRED: piktag_tag_removals.
-- The instruction asked us to consider filtering the SEARCHER's own
-- self-unstagged tags out of their matching credit. After reading the
-- live function body (verified 2026-05-30 via Management API, no drift),
-- search_users NEVER references the searcher's own tag list. All four
-- candidate-source CTEs (self_matches / friend_matches / ask_matches /
-- event_matches) match CANDIDATES against matched_tags (derived purely
-- from the query text p_query). The searcher's tags don't enter the
-- algorithm here at all — unlike explore_users_for_tag which uses
-- `my_tag_ids` for mutual_count. So filtering piktag_tag_removals
-- (source = 'self_unstag') would have nothing to filter; skipping
-- with this explicit rationale rather than adding a no-op join.
--
-- Idempotent — CREATE OR REPLACE. Return signature unchanged so no
-- DROP-then-CREATE dance needed (cf. 20260529070000 which DROP'd
-- because it widened the TABLE shape).
--
-- Index check (2026-05-30): the predicate hits
-- piktag_match_dismissals_viewer_id_target_id_surface_key (UNIQUE on
-- (viewer_id, target_id, surface)) — perfect for the NOT EXISTS lookup.
-- No new index needed.

CREATE OR REPLACE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(
   id                uuid,
   username          text,
   full_name         text,
   avatar_url        text,
   is_verified       boolean,
   matched_tag_count integer,
   endorser_count    integer,
   match_score       integer
 )
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
  WHERE p.is_public = true
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

GRANT EXECUTE ON FUNCTION public.search_users(text, int) TO authenticated;
