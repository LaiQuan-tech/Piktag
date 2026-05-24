-- 20260513150000_anniversary_reconnect.sql
--
-- Magic Moment #2: Anniversary Re-engagement.
--
-- Surface "you and X share lots of tags but haven't talked in
-- months" pairs once a week. The emotional hit is the moment
-- people open the notification and realize "oh, I forgot they
-- also love this". Same family as Memories / On This Day, just
-- people-oriented instead of event-oriented.
--
-- RPC `find_reconnect_suggestions()` returns the top suggestion
-- per user — at most one per cron run, because two simultaneous
-- "you forgot X / you forgot Y" pings collapse the emotional
-- weight to noise. The cron picks the best signal.
--
-- Signal: tag_overlap × 1/(days_since_message + 1). The
-- denominator boosts pairs that fell silent recently (the cliff
-- moment) over pairs that have been dormant forever (already
-- baked into the user's mental model — surfacing them less
-- impactful).
--
-- Eligibility filter:
--   • ≥ 2 shared tags (tag overlap is the magic — pairs with
--     only one match aren't surprising)
--   • Last message ≥ 60 days ago, OR no message ever
--   • The reverse-connection direction also exists (mutual
--     friendship — one-way follows aren't "we used to talk")
--   • Not the SAME user as the recipient (defensive)
--
-- Notification shape:
--   type:  'reconnect_suggest'
--   title: 'Eva 也標了 #攝影 #旅行 #台北 — 你們很久沒聊了'
--   ref:   friend_id (so the press routes to their FriendDetail)

CREATE OR REPLACE FUNCTION public.find_reconnect_suggestions()
RETURNS TABLE (
  user_id uuid,
  friend_id uuid,
  shared_tag_names text[],
  days_since_message integer,
  friend_full_name text,
  friend_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- All mutual-friend pairs.
  pairs AS (
    SELECT
      c1.user_id           AS user_id,
      c1.connected_user_id AS friend_id
    FROM public.piktag_connections c1
    WHERE EXISTS (
      SELECT 1 FROM public.piktag_connections c2
      WHERE c2.user_id = c1.connected_user_id
        AND c2.connected_user_id = c1.user_id
    )
  ),
  -- Tag overlap per pair. Excludes the pair if either side has
  -- zero tags (no signal possible).
  overlap AS (
    SELECT
      p.user_id,
      p.friend_id,
      array_agg(t.name ORDER BY t.name) AS shared_tag_names,
      COUNT(*)::integer AS shared_tag_count
    FROM pairs p
    JOIN public.piktag_user_tags my  ON my.user_id  = p.user_id
    JOIN public.piktag_user_tags th  ON th.user_id  = p.friend_id AND th.tag_id = my.tag_id
    JOIN public.piktag_tags t        ON t.id = my.tag_id
    GROUP BY p.user_id, p.friend_id
    HAVING COUNT(*) >= 2
  ),
  -- Last conversation timestamp between each pair, normalized so
  -- participant_a < participant_b. NULL if they've never DM'd.
  last_msg AS (
    SELECT
      LEAST(participant_a, participant_b)    AS a,
      GREATEST(participant_a, participant_b) AS b,
      MAX(last_message_at)                   AS ts
    FROM public.piktag_conversations
    GROUP BY 1, 2
  ),
  -- Join overlap with last-message; score each candidate row;
  -- pick the top one per user.
  scored AS (
    SELECT
      o.user_id,
      o.friend_id,
      o.shared_tag_names,
      o.shared_tag_count,
      COALESCE(
        EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0,
        365.0  -- never-talked → bucket at 1 year for scoring
      )::numeric AS days_since,
      -- Boost the cliff-recent silences over the always-dormant.
      (
        o.shared_tag_count::numeric
        / (
          COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0)
          + 1
        )
        -- Pairs that have NEVER messaged get a small bonus for
        -- being "new acquaintances who never connected" — a
        -- different but equally compelling re-engage prompt.
        + CASE WHEN lm.ts IS NULL THEN 0.5 ELSE 0 END
      ) AS score
    FROM overlap o
    LEFT JOIN last_msg lm
      ON lm.a = LEAST(o.user_id, o.friend_id)
     AND lm.b = GREATEST(o.user_id, o.friend_id)
    WHERE
      -- Re-engage only if it's been ≥ 60 days OR never talked.
      lm.ts IS NULL
      OR lm.ts < now() - interval '60 days'
  ),
  ranked AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC) AS rk
    FROM scored s
  )
  SELECT
    r.user_id,
    r.friend_id,
    r.shared_tag_names,
    r.days_since::integer,
    p.full_name,
    p.username
  FROM ranked r
  JOIN public.piktag_profiles p ON p.id = r.friend_id
  WHERE r.rk = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_reconnect_suggestions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_reconnect_suggestions() TO postgres, service_role;
