-- 20260529070000_search_and_explore_with_endorser_count.sql
--
-- North-Star tag-quality principle #2 (inter-source agreement =
-- verified) — surface the consensus signal at the decision point.
-- See CLAUDE.md "Tag-quality principles".
--
-- Founder feedback (2026-05-29): a ✓ icon ON THE TAGCHIP itself
-- doubles up with the existing # affordance and reads as visual
-- noise. The right surface is the CANDIDATE LIST — the moment the
-- viewer is deciding "who should I connect with?" — not the
-- profile-consumption moment. Two such list contexts exist:
--
--   1. TagDetailScreen explore tab  (explore_users_for_tag RPC)
--      — opened when the viewer taps a tag on a friend's profile.
--      Shows everyone else with the same tag.
--   2. SearchScreen results          (search_users RPC,
--      most recently updated by 20260529020000 to weight by source)
--      — global tag-search funnel.
--
-- Both RPCs now return an extra `endorser_count` int per row:
--   distinct count of taggers who publicly endorsed the target user
--   with any of the matched / sibling tags. "How many people are
--   willing to say this about them" — informational, not a binary
--   verified-or-not flag.
--
-- Scope (founder, 2026-05-29): plain numeric count, no color/weight
-- tiering yet. Just facts the user can act on.

-- ─── explore_users_for_tag — extended ─────────────────────────────
-- The TABLE return shape grows by one column (endorser_count). Postgres
-- forbids changing a function's return signature via CREATE OR REPLACE
-- ("cannot change return type of existing function" — SQLSTATE 42P13),
-- so DROP first then CREATE. Both client call sites (TagDetailScreen
-- explore tab + post-launch SearchScreen) are SECURITY INVOKER RPC
-- callers; nothing in the DB references this function (no triggers /
-- views / other functions wrap it), so DROP w/o CASCADE is safe.
DROP FUNCTION IF EXISTS public.explore_users_for_tag(uuid, int);
CREATE FUNCTION public.explore_users_for_tag(
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
  endorser_count   int,
  total_count      bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  tag_concept AS (
    SELECT concept_id FROM piktag_tags WHERE id = p_tag_id LIMIT 1
  ),
  sibling_tags AS (
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
  -- New: per-candidate distinct count of public endorsers (any
  -- sibling tag). "How many people say this about them."
  endorser_counts AS (
    SELECT
      c.connected_user_id AS user_id,
      COUNT(DISTINCT c.user_id) AS endorser_count
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM sibling_tags)
      AND ct.is_private = false
      AND c.connected_user_id IN (SELECT user_id FROM candidate_users)
    GROUP BY c.connected_user_id
  ),
  ranked AS (
    SELECT
      p.id,
      p.username,
      p.full_name,
      p.avatar_url,
      p.is_verified,
      COALESCE(mc.mutual_count,  0)::int AS mutual_tag_count,
      COALESCE(ec.endorser_count, 0)::int AS endorser_count
    FROM piktag_profiles p
    INNER JOIN candidate_users cu ON cu.user_id = p.id
    LEFT JOIN mutual_counts   mc ON mc.user_id = p.id
    LEFT JOIN endorser_counts ec ON ec.user_id = p.id
    WHERE p.is_public = true
  )
  SELECT
    r.id,
    r.username,
    r.full_name,
    r.avatar_url,
    r.is_verified,
    r.mutual_tag_count,
    r.endorser_count,
    COUNT(*) OVER ()::bigint AS total_count
  FROM ranked r
  ORDER BY r.mutual_tag_count DESC, r.endorser_count DESC, r.id
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.explore_users_for_tag(uuid, int)
  TO authenticated;

-- ─── search_users — add endorser_count column ─────────────────────
-- Same shape as 20260529020000 (4-source weighting + priority
-- cascade) plus an extra endorser_count int column. Endorser count
-- is computed across ALL matched_tags (name + alias + sibling),
-- de-duped on the tagger identity.
--
-- DROP-then-CREATE for the same reason as explore_users_for_tag
-- above — the TABLE return shape is widening by one column.
DROP FUNCTION IF EXISTS public.search_users(text, int);
CREATE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
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
