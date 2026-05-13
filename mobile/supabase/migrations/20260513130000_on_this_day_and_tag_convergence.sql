-- 20260513130000_on_this_day_and_tag_convergence.sql
--
-- Two daily-return / magic-moment mechanics bundled in one
-- migration because they share notification infrastructure
-- (piktag_notifications + the existing push handler):
--
-- 1. ON THIS DAY (P0)
--    Daily edge function (daily-on-this-day) calls
--    find_on_this_day_anniversaries() to find Vibes hitting
--    today's anniversary windows (1+ years, 6 months, 1/3
--    months). Inserts one piktag_notifications row per match
--    so the user gets a push: "X 年前的今天，你建了 Vibe Y".
--
-- 2. TAG CONVERGENCE ALERT (#1)
--    AFTER INSERT trigger on piktag_user_tags fires
--    notify_tag_convergence(), which finds 1st-degree friends
--    who ALREADY have the same tag. Emits one notification per
--    pair: "你貼了 #X — 你朋友圈 N 個人也是".
--
-- Both write into the same piktag_notifications table the rest
-- of the app reads from, so no client changes are needed beyond
-- adding the new `type` values to the notification body
-- i18n templates (handled separately).

-- ── 1. piktag_notifications uniqueness for on_this_day ─────
-- Same Vibe can't double-fire on a single day even if the cron
-- retries. We allow re-fire on a DIFFERENT day (e.g. 6-months
-- window + then 1-year window down the road) — same ref_id but
-- different date_part('day', created_at) won't collide because
-- the index ignores created_at.
--
-- Note: we're indexing (user_id, type, ref_id). Some other
-- notification types ALSO insert with ref_id (e.g. ask_posted
-- with ref_id=ask_id), so this index doesn't conflict with
-- their semantics — the index is unique across the whole table
-- and each type's ref_ids live in their own namespace anyway.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_user_type_refid
  ON public.piktag_notifications (user_id, type, ref_id)
  WHERE ref_id IS NOT NULL;

-- ── 2. find_on_this_day_anniversaries() ────────────────────
-- Returns rows for Vibes whose anniversary lands today. One
-- row per Vibe per matching window — the edge function only
-- emits the highest-priority match (years > months) per Vibe.
--
-- "Anniversary windows":
--   1 / 2 / 3+ years ago: same MM-DD as today, prior year
--   6 months ago: today minus 6 calendar months
--   1, 3 months ago: today minus 1 or 3 calendar months
--
-- Member count is computed from piktag_connections joined by
-- scan_session_id (text/uuid cast for safety; we hit the same
-- type-mismatch issue across multiple RPCs already).
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
DECLARE
  today date := current_date;
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      s.id AS scan_session_id,
      s.host_user_id,
      s.name AS vibe_name,
      s.created_at::date AS created_date,
      EXTRACT(YEAR  FROM age(today, s.created_at::date))::integer  AS yrs,
      EXTRACT(MONTH FROM age(today, s.created_at::date))::integer  AS mns,
      EXTRACT(DAY   FROM age(today, s.created_at::date))::integer  AS dys
    FROM public.piktag_scan_sessions s
    WHERE s.host_user_id IS NOT NULL
  ),
  matched AS (
    SELECT
      c.scan_session_id,
      c.host_user_id,
      c.vibe_name,
      -- "X years ago today" if age = (X years, 0 months, 0 days).
      CASE
        WHEN c.yrs >= 1 AND c.mns = 0 AND c.dys = 0 THEN c.yrs
        ELSE 0
      END AS years_ago,
      -- "X months ago today" if age = (0 years, X months, 0 days)
      -- for the allowlist {1, 3, 6}. Avoids "13 days ago" noise.
      CASE
        WHEN c.yrs = 0 AND c.dys = 0 AND c.mns IN (1, 3, 6) THEN c.mns
        ELSE 0
      END AS months_ago
    FROM candidates c
  )
  SELECT
    m.scan_session_id,
    m.host_user_id,
    m.vibe_name,
    (
      SELECT COUNT(*)::integer
      FROM public.piktag_connections conn
      WHERE conn.scan_session_id::text = m.scan_session_id::text
        AND conn.user_id = m.host_user_id
    ) AS member_count,
    m.years_ago,
    m.months_ago
  FROM matched m
  WHERE m.years_ago > 0 OR m.months_ago > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.find_on_this_day_anniversaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_on_this_day_anniversaries() TO postgres, service_role;

-- ── 3. Tag Convergence Alert ───────────────────────────────
-- AFTER INSERT trigger on piktag_user_tags. When a user adds
-- a tag that ≥1 of their 1st-degree friends also has, send
-- one consolidated notification. Format:
--
--   "你貼了 #X — Alice、Bob、Charlie 也是"
--
-- Why one notification per (user, tag) and not per matched
-- friend: the magic moment is "wait, my friends are into this
-- too" — the COUNT and a few names are the punchline. N
-- separate notifications would be spammy.
--
-- Dedup: ON CONFLICT (user_id, type, ref_id) so adding +
-- removing + re-adding the same tag in quick succession
-- doesn't double-fire.
CREATE OR REPLACE FUNCTION public.notify_tag_convergence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_name text;
  v_match_count integer;
  v_preview_names text[];
  v_title text;
BEGIN
  -- Resolve the tag name once. If it doesn't exist (shouldn't
  -- happen but defensive), bail.
  SELECT name INTO v_tag_name
  FROM public.piktag_tags
  WHERE id = NEW.tag_id;
  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count 1st-degree friends (in this user's connections) who
  -- also have this tag on their profile. Plus pull up to 3
  -- names for the notification preview.
  WITH friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM public.piktag_connections c
    WHERE c.user_id = NEW.user_id
  ),
  matched AS (
    SELECT
      f.friend_id,
      p.full_name,
      p.username
    FROM friends f
    JOIN public.piktag_user_tags fut
      ON fut.user_id = f.friend_id AND fut.tag_id = NEW.tag_id
    JOIN public.piktag_profiles p ON p.id = f.friend_id
    LIMIT 50  -- cap defensive size; preview only needs 3
  )
  SELECT
    COUNT(*)::integer,
    ARRAY_AGG(COALESCE(full_name, username) ORDER BY full_name)
      FILTER (WHERE COALESCE(full_name, username) IS NOT NULL)
  INTO v_match_count, v_preview_names
  FROM matched;

  -- Nothing to surface — silent return. The user added a tag
  -- their friends don't share; no magic moment.
  IF v_match_count IS NULL OR v_match_count < 1 THEN
    RETURN NEW;
  END IF;

  -- Build the title. Examples:
  --   "你貼了 #健身 — Alice 也是"                       (1 match)
  --   "你貼了 #健身 — Alice、Bob 也是"                  (2 matches)
  --   "你貼了 #健身 — Alice、Bob、Charlie 也是"         (3 matches)
  --   "你貼了 #健身 — Alice、Bob、Charlie + 2 人"       (5 matches)
  v_title := '你貼了 #' || v_tag_name || ' — ';
  IF v_match_count = 1 THEN
    v_title := v_title || v_preview_names[1] || ' 也是';
  ELSIF v_match_count <= 3 THEN
    v_title := v_title
      || array_to_string(v_preview_names[1:v_match_count], '、')
      || ' 也是';
  ELSE
    v_title := v_title
      || array_to_string(v_preview_names[1:3], '、')
      || ' + ' || (v_match_count - 3)::text || ' 人';
  END IF;

  INSERT INTO public.piktag_notifications (
    user_id, type, title, ref_type, ref_id, data
  ) VALUES (
    NEW.user_id,
    'tag_convergence',
    v_title,
    'tag',
    NEW.tag_id,
    jsonb_build_object(
      'tag_id', NEW.tag_id,
      'tag_name', v_tag_name,
      'match_count', v_match_count,
      'preview_names', to_jsonb(v_preview_names)
    )
  )
  ON CONFLICT (user_id, type, ref_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_tag_convergence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_tag_convergence() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_tag_convergence ON public.piktag_user_tags;
CREATE TRIGGER trg_notify_tag_convergence
  AFTER INSERT ON public.piktag_user_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_tag_convergence();
