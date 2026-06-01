-- 20260531030000_magic_moments_consolidate_per_user.sql
--
-- Cap the three magic-moments helpers to ONE row per user per cycle.
-- Continuation of 方案 3 — per-category caps + same-type consolidation.
-- tag_trending shipped in 6ae6031 (20260531010000), recommendation in
-- 983aa56 (20260531020000); this migration handles the remaining
-- spam-prone helpers in the magic-moments suite:
--
--   - enqueue_on_this_day_notifications()    daily   → 24h cap
--   - enqueue_tag_combo_notifications()      weekly  →  7d cap
--   - enqueue_reconnect_notifications()      weekly  →  7d cap
--
-- Pattern (lighter than the tag_trending/recommendation aggregation):
-- the `find_*` helper already returns N candidates per user; we just
-- pick the TOP-RANKED one per user (ROW_NUMBER OVER PARTITION BY) and
-- skip the user entirely if a same-type notification was already
-- inserted within the cycle window. Pre-launch this is "good enough"
-- restraint without rewriting the body-shape contract — the title
-- format the client already renders stays identical for the chosen
-- candidate; the other candidates are silently dropped this cycle.
--
-- Ranking heuristic per type:
--   - on_this_day:       years_ago DESC, months_ago DESC, scan_session_id
--     (the most "milestone-y" anniversary wins — 5-year over 1-year)
--   - tag_combo:         match_count DESC, ref_key
--     (the highest-overlap pair wins)
--   - reconnect_suggest: days_since_message DESC, friend_id
--     (the most dormant friend wins)
--
-- Idempotent: CREATE OR REPLACE.

-- ── on_this_day: max 1/user/day ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_on_this_day_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_title text;
BEGIN
  FOR r IN
    WITH ranked AS (
      SELECT
        a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.host_user_id
          ORDER BY a.years_ago DESC NULLS LAST,
                   a.months_ago DESC NULLS LAST,
                   a.scan_session_id
        ) AS rn
      FROM public.find_on_this_day_anniversaries() a
    )
    SELECT *
    FROM ranked
    WHERE rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.piktag_notifications n
         WHERE n.user_id    = ranked.host_user_id
           AND n.type       = 'on_this_day'
           AND n.created_at > now() - interval '24 hours'
      )
  LOOP
    v_title :=
      CASE
        WHEN r.years_ago = 1 THEN '一年前的今天'
        WHEN r.years_ago > 1 THEN r.years_ago || ' 年前的今天'
        WHEN r.months_ago = 6 THEN '半年前的今天'
        WHEN r.months_ago > 0 THEN r.months_ago || ' 個月前的今天'
        ELSE '回到那一天'
      END;
    INSERT INTO public.piktag_notifications (
      user_id, type, title, ref_type, ref_id, data
    ) VALUES (
      r.host_user_id, 'on_this_day', v_title, 'scan_session',
      r.scan_session_id::text,
      jsonb_build_object(
        'scan_session_id', r.scan_session_id,
        'vibe_name',       r.vibe_name,
        'member_count',    r.member_count,
        'years_ago',       r.years_ago,
        'months_ago',      r.months_ago
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;

-- ── tag_combo: max 1/user/week ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_tag_combo_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_sample text[];
  v_tag_part text;
  v_title text;
  v_ref_key text;
BEGIN
  FOR r IN
    WITH src AS (
      SELECT
        c.*,
        CASE WHEN c.tag_a_name < c.tag_b_name
             THEN 'combo:' || c.tag_a_name || '|' || c.tag_b_name
             ELSE 'combo:' || c.tag_b_name || '|' || c.tag_a_name
        END AS ref_key
      FROM public.find_tag_combinations() c
    ),
    ranked AS (
      SELECT
        s.*,
        ROW_NUMBER() OVER (
          PARTITION BY s.user_id
          ORDER BY s.match_count DESC, s.ref_key
        ) AS rn
      FROM src s
    )
    SELECT *
    FROM ranked
    WHERE rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.piktag_notifications n
         WHERE n.user_id    = ranked.user_id
           AND n.type       = 'tag_combo'
           AND n.created_at > now() - interval '7 days'
      )
  LOOP
    v_sample := COALESCE(r.sample_friend_names, ARRAY[]::text[]);
    v_tag_part := '#' || r.tag_a_name || ' + #' || r.tag_b_name;
    IF array_length(v_sample, 1) IS NOT NULL THEN
      v_title := array_to_string(v_sample, '、') || ' 都標了 ' || v_tag_part
        || '（' || r.match_count || ' 人）';
    ELSE
      v_title := '你朋友圈有 ' || r.match_count || ' 個人是 ' || v_tag_part;
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, ref_type, ref_id, data
    ) VALUES (
      r.user_id, 'tag_combo', v_title, 'tag_pair', r.ref_key,
      jsonb_build_object(
        'tag_names',           jsonb_build_array(r.tag_a_name, r.tag_b_name),
        'match_count',         r.match_count,
        'sample_friend_names', to_jsonb(v_sample)
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;

-- ── reconnect_suggest: max 1/user/week ──────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_reconnect_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
  v_friend_name text;
  v_tags_for_title text;
  v_recency text;
  v_title text;
BEGIN
  FOR r IN
    WITH ranked AS (
      SELECT
        f.*,
        ROW_NUMBER() OVER (
          PARTITION BY f.user_id
          ORDER BY f.days_since_message DESC NULLS LAST, f.friend_id
        ) AS rn
      FROM public.find_reconnect_suggestions() f
    )
    SELECT *
    FROM ranked
    WHERE rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.piktag_notifications n
         WHERE n.user_id    = ranked.user_id
           AND n.type       = 'reconnect_suggest'
           AND n.created_at > now() - interval '7 days'
      )
  LOOP
    v_friend_name := COALESCE(r.friend_full_name, r.friend_username, '一位朋友');
    v_tags_for_title := (
      SELECT string_agg('#' || tag, ' ')
      FROM unnest((r.shared_tag_names)[1:3]) AS tag
    );
    v_recency :=
      CASE
        WHEN r.days_since_message >= 365 THEN '一年沒聊了'
        WHEN r.days_since_message >= 180 THEN '半年沒聊了'
        WHEN r.days_since_message >= 60  THEN (r.days_since_message / 30) || ' 個月沒聊了'
        ELSE '很久沒聊了'
      END;
    v_title := v_friend_name || ' 也標了 ' || v_tags_for_title || ' — 你們' || v_recency;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, ref_type, ref_id, data
    ) VALUES (
      r.user_id, 'reconnect_suggest', v_title, 'user',
      r.friend_id::text,
      jsonb_build_object(
        'friend_id',         r.friend_id,
        'shared_tag_names',  to_jsonb(r.shared_tag_names),
        'days_since_message', r.days_since_message
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;
