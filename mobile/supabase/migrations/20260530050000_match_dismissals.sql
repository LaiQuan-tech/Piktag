-- 20260530050000_match_dismissals.sql
--
-- Lesson #2(a) — negative signals into ranking (Meta ranking, 2026-05-30).
--
-- Meta reduces post distribution based on user-initiated dismiss
-- signals (hide / snooze / unsubscribe / angry / report). PikTag
-- captures some negatives in piktag_tag_removals (self-unstag,
-- friend-withdraw, ai-dismissed) but NO ranking RPC reads them.
--
-- This migration adds the canonical per-viewer / per-target /
-- per-surface dismissal log and rewires match_ask_to_friends to
-- respect it. NotificationsScreen swipe-dismiss + AskMatchSheet
-- close-without-message become the two write surfaces (client
-- side).
--
-- Why a NEW table rather than reusing piktag_ask_dismissals:
--   * piktag_ask_dismissals = "this ASK isn't for me" (user
--     dismissed the Ask itself in the feed). Per-Ask, not
--     per-person.
--   * piktag_match_dismissals = "this PERSON isn't a match for
--     me on THIS surface". Per-person, per-surface.
-- Different shape, different consumers. Conflating would break
-- both.

CREATE TABLE IF NOT EXISTS public.piktag_match_dismissals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Surface taxonomy mirrors the notification categorization and the
  -- "Adding a new ranking surface" checklist in CLAUDE.md. When you
  -- add a new ranking surface, ADD its name here AND wire its dismiss
  -- gesture, OR no negative signal will ever feed back.
  surface       text NOT NULL CHECK (surface IN (
                  'ask_match',
                  'recommendation',
                  'reconnect_suggest',
                  'tag_combo',
                  'tag_convergence',
                  'ask_bridge',
                  'search',
                  'tag_explore'
                )),
  dismissed_at  timestamptz NOT NULL DEFAULT now(),

  -- One dismissal per (viewer, target, surface). Re-dismissal is a
  -- no-op (ON CONFLICT DO NOTHING from the client). Prevents the
  -- table from ballooning if a user repeatedly hides the same person.
  UNIQUE (viewer_id, target_id, surface)
);

CREATE INDEX IF NOT EXISTS idx_match_dismissals_viewer_target
  ON public.piktag_match_dismissals (viewer_id, target_id);
CREATE INDEX IF NOT EXISTS idx_match_dismissals_recent
  ON public.piktag_match_dismissals (viewer_id, dismissed_at DESC);

ALTER TABLE public.piktag_match_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_dismissals_insert_own" ON public.piktag_match_dismissals;
CREATE POLICY "match_dismissals_insert_own" ON public.piktag_match_dismissals
  FOR INSERT WITH CHECK (viewer_id = auth.uid());

DROP POLICY IF EXISTS "match_dismissals_select_own" ON public.piktag_match_dismissals;
CREATE POLICY "match_dismissals_select_own" ON public.piktag_match_dismissals
  FOR SELECT USING (viewer_id = auth.uid());

DROP POLICY IF EXISTS "match_dismissals_service" ON public.piktag_match_dismissals;
CREATE POLICY "match_dismissals_service" ON public.piktag_match_dismissals
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── Wire match_ask_to_friends to respect dismissals ────────────
--
-- Re-creates the function with the same signature and body PLUS
-- an additional NOT EXISTS guard against piktag_match_dismissals
-- for surfaces the asker might have dismissed this candidate on.
-- Lookback 60 days — long enough that a dismissal is meaningful,
-- short enough that someone's tag profile may have substantively
-- changed by then and they deserve another chance.
--
-- Functionally identical to 20260529080000 EXCEPT for the new
-- AND NOT EXISTS clause inside `scoring`. All other behavior
-- (4-source priority cascade, concept-sibling expansion, blocks,
-- friend-only scope, top_matched_tags) is preserved verbatim.

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
  ask_ownership AS (
    SELECT a.author_id
    FROM piktag_asks a, asker
    WHERE a.id = p_ask_id AND a.author_id = asker.uid
    LIMIT 1
  ),
  ask_tag_ids AS (
    SELECT at.tag_id
    FROM piktag_ask_tags at
    JOIN ask_ownership o ON true
    WHERE at.ask_id = p_ask_id
  ),
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
  -- NEW (Lesson #2a): per-viewer dismissals on Ask-related surfaces.
  -- A candidate the asker has hidden on ANY Ask/recommendation
  -- surface in the last 60 days is excluded from this Ask's matches.
  dismissed AS (
    SELECT DISTINCT target_id AS uid
    FROM piktag_match_dismissals d, asker
    WHERE d.viewer_id = asker.uid
      AND d.surface IN ('ask_match','recommendation','reconnect_suggest',
                        'ask_bridge','tag_convergence','tag_combo')
      AND d.dismissed_at > now() - interval '60 days'
  ),
  self_matches AS (
    SELECT ut.user_id, ut.tag_id, t.name AS tag_name
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.tag_id IN (SELECT id FROM expanded_tags)
      AND ut.is_private = false
      AND ut.user_id IN (SELECT friend_id FROM friends)
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
      AND ut.user_id NOT IN (SELECT uid FROM dismissed)
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
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  ask_authoring AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id, t.name AS tag_name
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    JOIN piktag_tags t ON t.id = at.tag_id
    WHERE at.tag_id IN (SELECT id FROM expanded_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.id <> p_ask_id
      AND a.author_id IN (SELECT friend_id FROM friends)
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.author_id NOT IN (SELECT uid FROM dismissed)
  ),
  event_attendance AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IN (SELECT friend_id FROM friends)
      AND c.user_id NOT IN (SELECT uid FROM blocked)
      AND c.user_id NOT IN (SELECT uid FROM dismissed)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IN (SELECT friend_id FROM friends)
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      MAX(tag_name) AS tag_name,
      bool_or(src = 'self')   AS has_self,
      bool_or(src = 'friend') AS has_friend,
      bool_or(src = 'ask')    AS has_ask,
      bool_or(src = 'event')  AS has_event
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
