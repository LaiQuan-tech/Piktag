-- 20260513190000_magic_moments_cron_schedules.sql
--
-- pg_cron schedules for the 4 magic-moment notification flows.
-- Pattern matches the existing notification-birthday / tag-
-- trending migrations: write a pure-SQL enqueue_*() function
-- that mirrors what the edge function does (find candidates +
-- format title + insert into piktag_notifications), then
-- schedule it via pg_cron.
--
-- Why SQL functions instead of HTTP-to-edge-function:
--   • One less moving part (no pg_net dependency, no auth
--     handshake against CRON_SECRET inside the DB).
--   • Atomic with the rest of the DB — when the find_*() RPC
--     returns a row, the INSERT happens in the same transaction.
--   • Mirrors how notification-birthday / tag-trending /
--     contract-expiry are already wired in this repo. Cron
--     uniformity > shaving milliseconds on a once-a-day job.
--
-- The corresponding edge functions (daily-on-this-day,
-- weekly-ask-prompt, weekly-reconnect-nudge,
-- weekly-tag-combo-digest) stay deployed for two reasons:
--   1. Manual / test triggers — calling the edge function URL
--      with the CRON_SECRET runs the same logic on-demand.
--   2. Title-formatting fidelity — the edge fns use TS string
--      templates that closely match the SQL CASEs below; if
--      the TS version drifts the SQL is the ground truth.
--
-- Schedule (all UTC, picked so the noisier social pings land
-- on weekends + the quiet memory pings land on weekday mornings):
--   • daily-on-this-day      daily   00:00 UTC  (TW 08:00)
--   • weekly-reconnect       Sat     01:00 UTC  (TW 09:00 Sat)
--   • weekly-tag-combo       Thu     01:00 UTC  (TW 09:00 Thu)
--   • weekly-ask-prompt      Sat     02:00 UTC  (TW 10:00 Sat)
-- The Ask prompt comes AFTER the reconnect nudge so a reconnect
-- on Saturday morning has an hour to land before the "today
-- want what?" prompt fires.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 1. P0 On This Day enqueue ─────────────────────────────
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
  FOR r IN SELECT * FROM public.find_on_this_day_anniversaries() LOOP
    -- Same priority order as the edge function: years > months.
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
        'vibe_name', r.vibe_name,
        'member_count', r.member_count,
        'years_ago', r.years_ago,
        'months_ago', r.months_ago
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_on_this_day_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_on_this_day_notifications() TO postgres, service_role;

-- ── 2. P1 Weekly Ask Prompt enqueue ───────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_ask_prompt_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.find_ask_prompt_targets() LOOP
    INSERT INTO public.piktag_notifications (
      user_id, type, title, data
    ) VALUES (
      r.user_id, 'ask_prompt', '今天想要什麼？發一個 Ask 讓朋友看到',
      jsonb_build_object('source', 'weekly-prompt')
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_ask_prompt_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_ask_prompt_notifications() TO postgres, service_role;

-- ── 3. #2 Anniversary Reconnect enqueue ───────────────────
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
  FOR r IN SELECT * FROM public.find_reconnect_suggestions() LOOP
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
        'friend_id', r.friend_id,
        'shared_tag_names', to_jsonb(r.shared_tag_names),
        'days_since_message', r.days_since_message
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_reconnect_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_reconnect_notifications() TO postgres, service_role;

-- ── 4. #4 Tag Combo Digest enqueue ────────────────────────
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
  FOR r IN SELECT * FROM public.find_tag_combinations() LOOP
    v_sample := COALESCE(r.sample_friend_names, ARRAY[]::text[]);
    v_tag_part := '#' || r.tag_a_name || ' + #' || r.tag_b_name;
    IF array_length(v_sample, 1) IS NOT NULL THEN
      v_title := array_to_string(v_sample, '、') || ' 都標了 ' || v_tag_part
        || '（' || r.match_count || ' 人）';
    ELSE
      v_title := '你朋友圈有 ' || r.match_count || ' 個人是 ' || v_tag_part;
    END IF;

    -- Alphabetized ref_id so (A,B) and (B,A) dedupe to one row.
    IF r.tag_a_name < r.tag_b_name THEN
      v_ref_key := 'combo:' || r.tag_a_name || '|' || r.tag_b_name;
    ELSE
      v_ref_key := 'combo:' || r.tag_b_name || '|' || r.tag_a_name;
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, ref_type, ref_id, data
    ) VALUES (
      r.user_id, 'tag_combo', v_title, 'tag_pair', v_ref_key,
      jsonb_build_object(
        'tag_names', jsonb_build_array(r.tag_a_name, r.tag_b_name),
        'match_count', r.match_count,
        'sample_friend_names', to_jsonb(v_sample)
      )
    )
    ON CONFLICT (user_id, type, ref_id) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_tag_combo_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_tag_combo_notifications() TO postgres, service_role;

-- ── pg_cron schedules ─────────────────────────────────────
-- Pattern: unschedule existing job by name → schedule fresh.
-- Idempotent on re-run.

DO $$
DECLARE v_jobid bigint;
BEGIN
  -- on_this_day: daily 00:00 UTC (TW 08:00)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'magic-on-this-day-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

  -- reconnect: Saturday 01:00 UTC
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'magic-reconnect-weekly';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

  -- tag_combo: Thursday 01:00 UTC
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'magic-tag-combo-weekly';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

  -- ask_prompt: Saturday 02:00 UTC (after reconnect lands)
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'magic-ask-prompt-weekly';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'magic-on-this-day-daily',
  '0 0 * * *',
  $cron$ SELECT public.enqueue_on_this_day_notifications(); $cron$
);

SELECT cron.schedule(
  'magic-reconnect-weekly',
  '0 1 * * 6',
  $cron$ SELECT public.enqueue_reconnect_notifications(); $cron$
);

SELECT cron.schedule(
  'magic-tag-combo-weekly',
  '0 1 * * 4',
  $cron$ SELECT public.enqueue_tag_combo_notifications(); $cron$
);

SELECT cron.schedule(
  'magic-ask-prompt-weekly',
  '0 2 * * 6',
  $cron$ SELECT public.enqueue_ask_prompt_notifications(); $cron$
);
