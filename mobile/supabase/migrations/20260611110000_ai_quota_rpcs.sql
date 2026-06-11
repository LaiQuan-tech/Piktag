-- 20260611110000_ai_quota_rpcs.sql
--
-- Per-user rate-limit tables + atomic-claim RPCs for the suggest-tags
-- and scan-business-card edge functions.
--
-- WHY: both endpoints call Gemini, which is metered $$$-per-token. The
-- extract-search-intent path already has this guard
-- (20260524100000_extract_intent_rate_limit.sql); these two were the
-- remaining unbounded AI calls. A single bad actor logged in with a
-- valid JWT could mass-fire either endpoint and burn the GEMINI_API_KEY
-- quota (suggest-tags is text-only / cheap-ish; scan-business-card is
-- multimodal / expensive). Caps below are sized to be generous for real
-- usage and tight enough to stop loops.
--
-- Caps:
--   suggest-tags     : 60 / rolling 60s / user
--                     (per-keystroke debouncing is client-side; the worst
--                     legitimate burst is the EditProfile "AI 推薦" + Ask
--                     match + ManageTags refresh in close succession.
--                     60 has comfortable headroom; an attacker firing
--                     >1/s is clearly synthetic.)
--   scan-business-card : 30 / rolling 60s / user
--                     (a real scan is a deliberate camera-tap action; 30
--                     in a minute is already abusive but lets a tester
--                     hammer the flow without being throttled.)
--
-- Design: SAME shape as piktag_extract_intent_rate_limit — single row
-- per user, atomic INSERT…ON CONFLICT that resets the window when the
-- minute rolls over and increments otherwise. Two separate tables
-- (mirroring the existing pattern) so each cap is independent and the
-- prune cron stays simple. RPCs are SECURITY DEFINER, search_path
-- locked to public, idempotent via CREATE OR REPLACE.

-- ──────────────────────────────────────────────────────────────────
-- suggest-tags
-- ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.piktag_suggest_tags_rate_limit (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE public.piktag_suggest_tags_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.piktag_suggest_tags_rate_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.piktag_suggest_tags_rate_limit TO postgres, service_role;

DROP POLICY IF EXISTS suggest_tags_rate_limit_service ON public.piktag_suggest_tags_rate_limit;
CREATE POLICY suggest_tags_rate_limit_service ON public.piktag_suggest_tags_rate_limit
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_consume_suggest_tags_quota(
  p_user_id UUID,
  p_max_per_minute INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_minute TIMESTAMPTZ := date_trunc('minute', now());
BEGIN
  -- Atomic upsert: if the window has rolled over RESET to 1, otherwise
  -- INCREMENT. Single statement → no read-then-write race window.
  INSERT INTO public.piktag_suggest_tags_rate_limit (user_id, window_start, count)
  VALUES (p_user_id, v_minute, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE
      WHEN v_minute > public.piktag_suggest_tags_rate_limit.window_start
        THEN v_minute
      ELSE public.piktag_suggest_tags_rate_limit.window_start
    END,
    count = CASE
      WHEN v_minute > public.piktag_suggest_tags_rate_limit.window_start
        THEN 1
      ELSE public.piktag_suggest_tags_rate_limit.count + 1
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_minute;
END;
$$;

REVOKE ALL ON FUNCTION public.try_consume_suggest_tags_quota(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_consume_suggest_tags_quota(UUID, INTEGER) TO postgres, service_role;

-- ──────────────────────────────────────────────────────────────────
-- scan-business-card
-- ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.piktag_scan_card_rate_limit (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE public.piktag_scan_card_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.piktag_scan_card_rate_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.piktag_scan_card_rate_limit TO postgres, service_role;

DROP POLICY IF EXISTS scan_card_rate_limit_service ON public.piktag_scan_card_rate_limit;
CREATE POLICY scan_card_rate_limit_service ON public.piktag_scan_card_rate_limit
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.try_consume_scan_card_quota(
  p_user_id UUID,
  p_max_per_minute INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_minute TIMESTAMPTZ := date_trunc('minute', now());
BEGIN
  INSERT INTO public.piktag_scan_card_rate_limit (user_id, window_start, count)
  VALUES (p_user_id, v_minute, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE
      WHEN v_minute > public.piktag_scan_card_rate_limit.window_start
        THEN v_minute
      ELSE public.piktag_scan_card_rate_limit.window_start
    END,
    count = CASE
      WHEN v_minute > public.piktag_scan_card_rate_limit.window_start
        THEN 1
      ELSE public.piktag_scan_card_rate_limit.count + 1
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_minute;
END;
$$;

REVOKE ALL ON FUNCTION public.try_consume_scan_card_quota(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_consume_scan_card_quota(UUID, INTEGER) TO postgres, service_role;

-- ──────────────────────────────────────────────────────────────────
-- Retention prune — daily, off-peak
-- ──────────────────────────────────────────────────────────────────
-- Rows older than 1 hour are useless (window is per-minute). Two
-- separate jobs so a future cap change to one feature doesn't touch
-- the other. Times offset from the existing 04:17 extract-intent prune
-- so we don't pile on the same minute. CTE form for the unschedule
-- (the DO $$ … $$ form mis-parses in the Supabase SQL editor — see
-- the note in the extract-intent migration).

WITH existing AS (
  SELECT jobid FROM cron.job WHERE jobname = 'piktag-suggest-tags-rate-limit-prune'
)
SELECT cron.unschedule(jobid) FROM existing;

SELECT cron.schedule(
  'piktag-suggest-tags-rate-limit-prune',
  '19 4 * * *',  -- 04:19 UTC daily
  $cron$ DELETE FROM public.piktag_suggest_tags_rate_limit WHERE window_start < now() - interval '1 hour'; $cron$
);

WITH existing AS (
  SELECT jobid FROM cron.job WHERE jobname = 'piktag-scan-card-rate-limit-prune'
)
SELECT cron.unschedule(jobid) FROM existing;

SELECT cron.schedule(
  'piktag-scan-card-rate-limit-prune',
  '21 4 * * *',  -- 04:21 UTC daily
  $cron$ DELETE FROM public.piktag_scan_card_rate_limit WHERE window_start < now() - interval '1 hour'; $cron$
);
