-- 20260427_ask_feature.sql
--
-- "Ask" feature for PikTag.
--
-- An Ask is a short, time-limited question a user broadcasts to their
-- network.  It appears in the feeds of 1st-degree and 2nd-degree
-- friends whose tags overlap with the ask's tags — surfacing relevant
-- asks to people who are likely able to help.
--
-- Tables:
--   * piktag_asks       – the ask itself (body, expiry, author)
--   * piktag_ask_tags   – junction: which tags are attached to an ask
--   * piktag_ask_dismissals – per-user dismissals so dismissed asks
--                             don't reappear in the feed
--
-- RPCs:
--   * fetch_ask_feed(p_limit)   – ask feed for the viewer, filtered by
--                                  friend-degree + tag overlap + blocks
--   * fetch_my_active_ask()     – the viewer's own active, non-expired ask
--
-- Realtime: piktag_asks is published so clients can subscribe to
-- changes (new asks, deactivations, title updates from AI).

-- =============================================================================
-- Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.piktag_asks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 150),
  title text CHECK (title IS NULL OR char_length(title) <= 60),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.piktag_ask_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id uuid NOT NULL REFERENCES public.piktag_asks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.piktag_tags(id) ON DELETE CASCADE,
  UNIQUE (ask_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.piktag_ask_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ask_id uuid NOT NULL REFERENCES public.piktag_asks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ask_id)
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- Feed queries filter by is_active = true, so partial indexes keep the
-- working set small once asks expire / get deactivated.

CREATE INDEX IF NOT EXISTS idx_asks_author_active
  ON public.piktag_asks (author_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_asks_expires_active
  ON public.piktag_asks (expires_at)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_asks_created_active
  ON public.piktag_asks (created_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ask_tags_ask
  ON public.piktag_ask_tags (ask_id);

CREATE INDEX IF NOT EXISTS idx_ask_tags_tag
  ON public.piktag_ask_tags (tag_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE public.piktag_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piktag_ask_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piktag_ask_dismissals ENABLE ROW LEVEL SECURITY;

-- ── piktag_asks ──────────────────────────────────────────────────────────────

-- Authenticated users can read asks that are active and not yet expired.
DROP POLICY IF EXISTS "asks_select" ON public.piktag_asks;
CREATE POLICY "asks_select" ON public.piktag_asks
  FOR SELECT
  USING (
    is_active = true
    AND expires_at > now()
  );

-- Author can insert their own asks.
DROP POLICY IF EXISTS "asks_insert" ON public.piktag_asks;
CREATE POLICY "asks_insert" ON public.piktag_asks
  FOR INSERT
  WITH CHECK (author_id = auth.uid());

-- Author can update their own asks (e.g. deactivate, AI title backfill).
DROP POLICY IF EXISTS "asks_update" ON public.piktag_asks;
CREATE POLICY "asks_update" ON public.piktag_asks
  FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Author can delete their own asks.
DROP POLICY IF EXISTS "asks_delete" ON public.piktag_asks;
CREATE POLICY "asks_delete" ON public.piktag_asks
  FOR DELETE
  USING (author_id = auth.uid());

-- ── piktag_ask_tags ──────────────────────────────────────────────────────────

-- Readable if the parent ask is active and not expired.
DROP POLICY IF EXISTS "ask_tags_select" ON public.piktag_ask_tags;
CREATE POLICY "ask_tags_select" ON public.piktag_ask_tags
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.piktag_asks a
      WHERE a.id = piktag_ask_tags.ask_id
        AND a.is_active = true
        AND a.expires_at > now()
    )
  );

-- Author of the parent ask can insert tags.
DROP POLICY IF EXISTS "ask_tags_insert" ON public.piktag_ask_tags;
CREATE POLICY "ask_tags_insert" ON public.piktag_ask_tags
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.piktag_asks a
      WHERE a.id = piktag_ask_tags.ask_id
        AND a.author_id = auth.uid()
    )
  );

-- ── piktag_ask_dismissals ────────────────────────────────────────────────────

-- Users can read their own dismissals.
DROP POLICY IF EXISTS "dismissals_select" ON public.piktag_ask_dismissals;
CREATE POLICY "dismissals_select" ON public.piktag_ask_dismissals
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own dismissals.
DROP POLICY IF EXISTS "dismissals_insert" ON public.piktag_ask_dismissals;
CREATE POLICY "dismissals_insert" ON public.piktag_ask_dismissals
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- Realtime publication
-- =============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.piktag_asks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- RPC: fetch_ask_feed
-- =============================================================================
-- Returns asks from 1st and 2nd degree friends whose ask-tags overlap
-- with the viewer's own user-tags.
--
-- Excludes:
--   * The viewer's own asks
--   * Asks the viewer has dismissed
--   * Asks authored by users the viewer has blocked (either direction)
--   * Expired or inactive asks
--
-- For each ask we also compute:
--   * degree (1 = direct friend, 2 = friend-of-friend)
--   * mutual_friend_count  – how many of the viewer's friends are also
--     friends with the ask author
--   * mutual_friend_previews – JSONB array of up to 3 mutual-friend
--     profiles (id, username, full_name, avatar_url) for UI preview
--
-- Ordered by created_at DESC, limited to p_limit rows.

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
  -- Viewer's tag IDs (public + private — we want full overlap).
  my_tags AS (
    SELECT DISTINCT ut.tag_id
    FROM public.piktag_user_tags ut
    WHERE ut.user_id = me
  ),

  -- 1st-degree friends (direct connections).
  friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM public.piktag_connections c
    WHERE c.user_id = me
  ),

  -- 2nd-degree friends: friends of my friends, excluding me and my
  -- direct friends (so we don't double-count).
  friends_2 AS (
    SELECT DISTINCT c2.connected_user_id AS uid
    FROM friends_1 f1
    JOIN public.piktag_connections c2
      ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> me
      AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
  ),

  -- Union with degree label.
  network AS (
    SELECT uid, 1 AS deg FROM friends_1
    UNION ALL
    SELECT uid, 2 AS deg FROM friends_2
  ),

  -- Blocked user IDs (both directions).
  blocked AS (
    SELECT blocked_id AS uid FROM public.piktag_blocks WHERE blocker_id = me
    UNION
    SELECT blocker_id AS uid FROM public.piktag_blocks WHERE blocked_id = me
  ),

  -- Dismissed ask IDs.
  dismissed AS (
    SELECT d.ask_id
    FROM public.piktag_ask_dismissals d
    WHERE d.user_id = me
  ),

  -- Candidate asks: active, not expired, not own, not blocked, not dismissed,
  -- authored by someone in our network, and sharing at least one tag with us.
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
      -- Tag overlap: at least one ask-tag matches one of the viewer's tags.
      AND EXISTS (
        SELECT 1
        FROM public.piktag_ask_tags at2
        JOIN my_tags mt ON mt.tag_id = at2.tag_id
        WHERE at2.ask_id = a.id
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
    -- Aggregate tag names for this ask.
    (
      SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
      FROM public.piktag_ask_tags at3
      JOIN public.piktag_tags t ON t.id = at3.tag_id
      WHERE at3.ask_id = ca.id
    )                   AS ask_tag_names,
    ca.deg              AS degree,
    -- Mutual friend count: how many of my direct friends are also
    -- direct friends of the ask author.
    (
      SELECT COUNT(*)::int
      FROM friends_1 f
      JOIN public.piktag_connections c3
        ON c3.user_id = ca.author_id AND c3.connected_user_id = f.uid
    )                   AS mutual_friend_count,
    -- Preview of up to 3 mutual friends.
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

GRANT EXECUTE ON FUNCTION public.fetch_ask_feed(int) TO authenticated;

-- =============================================================================
-- RPC: fetch_my_active_ask
-- =============================================================================
-- Returns the caller's own active, non-expired ask (at most one row),
-- together with the tag names attached to it.

CREATE OR REPLACE FUNCTION public.fetch_my_active_ask()
RETURNS TABLE (
  id uuid,
  body text,
  title text,
  expires_at timestamptz,
  created_at timestamptz,
  tag_names text[]
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
  SELECT
    a.id,
    a.body,
    a.title,
    a.expires_at,
    a.created_at,
    (
      SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
      FROM public.piktag_ask_tags at2
      JOIN public.piktag_tags t ON t.id = at2.tag_id
      WHERE at2.ask_id = a.id
    ) AS tag_names
  FROM public.piktag_asks a
  WHERE a.author_id = me
    AND a.is_active = true
    AND a.expires_at > now()
  ORDER BY a.created_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_my_active_ask() TO authenticated;
