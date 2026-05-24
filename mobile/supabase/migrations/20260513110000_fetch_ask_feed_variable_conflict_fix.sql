-- 20260513110000_fetch_ask_feed_variable_conflict_fix.sql
--
-- The production `fetch_ask_feed` function silently errored on EVERY
-- mobile call with:
--   42702: column reference "ask_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- Root cause: `RETURNS TABLE (ask_id uuid, ...)` implicitly declares
-- an OUT variable named `ask_id` inside the function body. Later in
-- the same query body we reference `(SELECT ask_id FROM dismissed)`
-- and `WHERE at3.ask_id = ca.id` — Postgres can't disambiguate the
-- bare `ask_id` between the OUT variable and the CTE/table column.
--
-- The function returned a PostgrestError, which useAskFeed.ts logs
-- with console.warn but doesn't surface to the UI. So every consumer
-- (ConnectionsScreen, FriendDetailScreen, AskStoryRow) silently saw
-- an empty feed, no matter what was in piktag_asks. The bug was
-- invisible until users actually had Asks among friends — the gradient
-- avatar ring + IG-style preview chip both depend on askFeedItems,
-- and both stayed dark.
--
-- Fix: add `#variable_conflict use_column` at the top of the
-- function body. This tells PL/pgSQL "when a name could be either
-- a variable or a column, prefer the column". Safer than renaming
-- the OUT parameter (which would break the return-shape contract
-- with every client).
--
-- Same function body as 20260501160000 (no tag-overlap filter for
-- 2nd degree), just with the directive prepended. Idempotent
-- CREATE OR REPLACE — same signature.

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
#variable_conflict use_column
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
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
