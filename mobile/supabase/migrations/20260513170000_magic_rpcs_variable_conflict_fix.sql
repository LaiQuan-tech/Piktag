-- 20260513170000_magic_rpcs_variable_conflict_fix.sql
--
-- Same gotcha that bit fetch_ask_feed back in
-- 20260513110000_fetch_ask_feed_variable_conflict_fix.sql —
-- now hitting the 3 RPCs we just added in
-- 20260513130000 / 140000 / 150000:
--
--   42702: column reference "host_user_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a
--   table column.
--
-- Root cause: `RETURNS TABLE (foo uuid, bar text)` implicitly
-- declares OUT variables foo + bar inside the function body. If
-- the body's query joins / filters against a table column with
-- the same name (which is exactly what we want — these RPCs
-- return shaped rows from real tables), Postgres can't tell.
--
-- Fix: `#variable_conflict use_column` directive at the top of
-- the function body. Tells PL/pgSQL "when a name could be both
-- a declared variable and a column, resolve to the column".
-- Safer than renaming the OUT parameters (which would break the
-- return-shape contract with the edge functions / mobile
-- callers).
--
-- Also bumps find_ask_prompt_targets from LANGUAGE sql to
-- LANGUAGE plpgsql so the directive can live in its body
-- (sql functions don't support directives). The body is
-- exactly equivalent — one SELECT, no new logic.

CREATE OR REPLACE FUNCTION public.find_on_this_day_anniversaries()
RETURNS TABLE (
  scan_session_id uuid,
  host_user_id uuid,
  vibe_name text,
  member_count integer,
  years_ago integer,
  months_ago integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  today date := current_date;
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT s.id, s.host_user_id, s.name,
      EXTRACT(YEAR  FROM age(today, s.created_at::date))::integer AS yrs,
      EXTRACT(MONTH FROM age(today, s.created_at::date))::integer AS mns,
      EXTRACT(DAY   FROM age(today, s.created_at::date))::integer AS dys
    FROM public.piktag_scan_sessions s
    WHERE s.host_user_id IS NOT NULL
  ),
  matched AS (
    SELECT id, host_user_id, name,
      CASE WHEN yrs >= 1 AND mns = 0 AND dys = 0 THEN yrs ELSE 0 END AS years_ago,
      CASE WHEN yrs = 0 AND dys = 0 AND mns IN (1, 3, 6) THEN mns ELSE 0 END AS months_ago
    FROM candidates
  )
  SELECT m.id, m.host_user_id, m.name,
    (
      SELECT COUNT(*)::integer
      FROM public.piktag_connections c
      WHERE c.scan_session_id::text = m.id::text
        AND c.user_id = m.host_user_id
    ),
    m.years_ago, m.months_ago
  FROM matched m
  WHERE m.years_ago > 0 OR m.months_ago > 0;
END;
$$;


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
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH pairs AS (
    SELECT c1.user_id, c1.connected_user_id AS friend_id
    FROM public.piktag_connections c1
    WHERE EXISTS (
      SELECT 1 FROM public.piktag_connections c2
      WHERE c2.user_id = c1.connected_user_id
        AND c2.connected_user_id = c1.user_id
    )
  ),
  overlap AS (
    SELECT p.user_id, p.friend_id,
      array_agg(t.name ORDER BY t.name) AS shared_tag_names,
      COUNT(*)::integer AS shared_tag_count
    FROM pairs p
    JOIN public.piktag_user_tags my ON my.user_id = p.user_id
    JOIN public.piktag_user_tags th ON th.user_id = p.friend_id AND th.tag_id = my.tag_id
    JOIN public.piktag_tags t ON t.id = my.tag_id
    GROUP BY p.user_id, p.friend_id
    HAVING COUNT(*) >= 2
  ),
  last_msg AS (
    SELECT
      LEAST(participant_a, participant_b)    AS a,
      GREATEST(participant_a, participant_b) AS b,
      MAX(last_message_at)                   AS ts
    FROM public.piktag_conversations
    GROUP BY 1, 2
  ),
  scored AS (
    SELECT o.user_id, o.friend_id, o.shared_tag_names, o.shared_tag_count,
      COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0)::numeric AS days_since,
      (
        o.shared_tag_count::numeric
        / (COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0) + 1)
        + CASE WHEN lm.ts IS NULL THEN 0.5 ELSE 0 END
      ) AS score
    FROM overlap o
    LEFT JOIN last_msg lm
      ON lm.a = LEAST(o.user_id, o.friend_id)
     AND lm.b = GREATEST(o.user_id, o.friend_id)
    WHERE lm.ts IS NULL OR lm.ts < now() - interval '60 days'
  ),
  ranked AS (
    SELECT s.*,
      ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC) AS rk
    FROM scored s
  )
  SELECT r.user_id, r.friend_id, r.shared_tag_names, r.days_since::integer,
    p.full_name, p.username
  FROM ranked r
  JOIN public.piktag_profiles p ON p.id = r.friend_id
  WHERE r.rk = 1;
END;
$$;


-- Was LANGUAGE sql — switched to plpgsql so we can carry the
-- #variable_conflict directive. Body is otherwise identical.
CREATE OR REPLACE FUNCTION public.find_ask_prompt_targets()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT p.id
  FROM public.piktag_profiles p
  WHERE
    (SELECT COUNT(*) FROM public.piktag_connections c WHERE c.user_id = p.id) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_asks a
      WHERE a.author_id = p.id
        AND a.is_active = true
        AND a.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'ask_prompt'
        AND n.created_at > now() - interval '6 days'
    );
END;
$$;
