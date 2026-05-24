-- =============================================================================
-- fix(ask-feed): direct friends always show, tag overlap is for discovery only
--
-- Reported: "我的好友發 Ask 後，我在首頁看不到". Confirmed against
-- production data — viewer (armand7951) had Jeff (fullwish) as a 1st-
-- degree connection, Jeff posted Asks with tags {PM, 智慧連結} while
-- viewer's user_tags were {咖啡控, 想像扶輪社, 貓奴}, no overlap, so
-- the existing fetch_ask_feed filtered them out.
--
-- The original RPC required BOTH (in network) AND (tag overlap with
-- viewer's user_tags) for every candidate. That's right for discovery
-- — surfacing 2nd-degree asks should be relevance-filtered — but
-- wrong for direct friends, who should always show regardless of tag
-- overlap (basic "see your friends' posts" expectation).
--
-- Also a side-benefit: viewers with empty user_tags previously saw an
-- empty feed always (the tag-overlap subquery returned false against
-- an empty set). Now they at least see all 1st-degree asks.
--
-- Fix: change the tag-overlap predicate from a hard AND to
-- (degree = 1) OR (degree = 2 AND tag overlap exists). 2nd-degree
-- behaviour preserved exactly. Everything else (active/expiry/blocked/
-- dismissed/self filters, mutual-friend aggregations, semantic concept
-- expansion) untouched.
--
-- Idempotent (CREATE OR REPLACE). Same signature.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fetch_ask_feed(
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  ask_id uuid,
  author_id uuid,
  author_username text,
  author_full_name text,
  author_avatar_url text,
  body text,
  title text,
  expires_at timestamptz,
  created_at timestamptz,
  ask_tag_names text[],
  degree int,
  mutual_friend_count int,
  mutual_friend_previews jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  my_tags AS (
    SELECT DISTINCT ut.tag_id
    FROM public.piktag_user_tags ut
    WHERE ut.user_id = me
  ),
  my_tags_expanded AS (
    SELECT DISTINCT tag_id FROM my_tags
    UNION
    SELECT DISTINCT sibling.id AS tag_id
    FROM my_tags mt
    JOIN public.piktag_tags orig ON orig.id = mt.tag_id AND orig.concept_id IS NOT NULL
    JOIN public.piktag_tags sibling ON sibling.concept_id = orig.concept_id
  ),
  friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM public.piktag_connections c
    WHERE c.user_id = me
  ),
  friends_2 AS (
    SELECT DISTINCT c2.connected_user_id AS uid
    FROM friends_1 f1
    JOIN public.piktag_connections c2
      ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> me
      AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
  ),
  network AS (
    SELECT uid, 1 AS deg FROM friends_1
    UNION ALL
    SELECT uid, 2 AS deg FROM friends_2
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM public.piktag_blocks WHERE blocker_id = me
    UNION
    SELECT blocker_id AS uid FROM public.piktag_blocks WHERE blocked_id = me
  ),
  dismissed AS (
    SELECT d.ask_id
    FROM public.piktag_ask_dismissals d
    WHERE d.user_id = me
  ),
  candidate_asks AS (
    SELECT
      a.id,
      a.author_id,
      a.body,
      a.title,
      a.expires_at,
      a.created_at,
      n.deg
    FROM public.piktag_asks a
    JOIN network n ON n.uid = a.author_id
    WHERE a.is_active = true
      AND a.expires_at > now()
      AND a.author_id <> me
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.id NOT IN (SELECT ask_id FROM dismissed)
      -- Direct friends (degree 1) always show — the "see your friends'
      -- posts" expectation outranks tag relevance. Tag overlap stays
      -- as a relevance filter for 2nd-degree (friends-of-friends),
      -- which is where the discovery framing actually applies.
      AND (
        n.deg = 1
        OR EXISTS (
          SELECT 1
          FROM public.piktag_ask_tags at2
          WHERE at2.ask_id = a.id
            AND (
              at2.tag_id IN (SELECT tag_id FROM my_tags_expanded)
              OR EXISTS (
                SELECT 1
                FROM public.piktag_tags ask_tag
                JOIN public.piktag_tags viewer_tag ON viewer_tag.concept_id = ask_tag.concept_id
                  AND ask_tag.concept_id IS NOT NULL
                JOIN my_tags mt2 ON mt2.tag_id = viewer_tag.id
                WHERE ask_tag.id = at2.tag_id
              )
            )
        )
      )
    ORDER BY a.created_at DESC
    LIMIT p_limit
  )
  SELECT
    ca.id              AS ask_id,
    ca.author_id       AS author_id,
    p.username          AS author_username,
    p.full_name         AS author_full_name,
    p.avatar_url        AS author_avatar_url,
    ca.body            AS body,
    ca.title           AS title,
    ca.expires_at      AS expires_at,
    ca.created_at      AS created_at,
    (
      SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
      FROM public.piktag_ask_tags at3
      JOIN public.piktag_tags t ON t.id = at3.tag_id
      WHERE at3.ask_id = ca.id
    )                   AS ask_tag_names,
    ca.deg              AS degree,
    (
      SELECT COUNT(*)::int
      FROM friends_1 f
      JOIN public.piktag_connections c3
        ON c3.user_id = ca.author_id AND c3.connected_user_id = f.uid
    )                   AS mutual_friend_count,
    (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', mp.id,
          'username', mp.username,
          'full_name', mp.full_name,
          'avatar_url', mp.avatar_url
        )
      ), '[]'::jsonb)
      FROM (
        SELECT pp.id, pp.username, pp.full_name, pp.avatar_url
        FROM friends_1 f
        JOIN public.piktag_connections c4
          ON c4.user_id = ca.author_id AND c4.connected_user_id = f.uid
        JOIN public.piktag_profiles pp ON pp.id = f.uid
        LIMIT 3
      ) mp
    )                   AS mutual_friend_previews
  FROM candidate_asks ca
  LEFT JOIN public.piktag_profiles p ON p.id = ca.author_id
  ORDER BY ca.created_at DESC;
END;
$$;
