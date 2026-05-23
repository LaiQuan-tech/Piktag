-- 20260524100000_extract_intent_rate_limit.sql
--
-- Per-user rate limit table + atomic-claim RPC for the
-- extract-search-intent edge function.
--
-- WHY: the edge function calls Gemini, which is metered by Anthropic-
-- $$$-per-token. If left unauthenticated (or just JWT-gated but
-- unlimited), a single bad actor logged into the app could mass-fire
-- the endpoint and burn the GEMINI_API_KEY quota. Pre-launch we have
-- maybe 5 testers — one bug in a retry loop is enough.
--
-- Design: single-row-per-user table, atomic upsert that resets the
-- window when the minute rolls over and increments otherwise. Returns
-- the post-increment count + the cap so the edge function can decide.
--
-- Tunable: p_max_per_minute defaults to 30 (a panicked user typing
-- one query per 2s for a minute straight). The mobile client only
-- fires recovery on submit (not per-keystroke), so 30/min is generous
-- for real usage and tight enough to cap accidental loops.

CREATE TABLE IF NOT EXISTS public.piktag_extract_intent_rate_limit (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE public.piktag_extract_intent_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.piktag_extract_intent_rate_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.piktag_extract_intent_rate_limit TO postgres, service_role;

DROP POLICY IF EXISTS extract_intent_rate_limit_service ON public.piktag_extract_intent_rate_limit;
CREATE POLICY extract_intent_rate_limit_service ON public.piktag_extract_intent_rate_limit
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── Atomic claim ───────────────────────────────────────────────
-- Returns true iff the user is still within the per-minute quota
-- after this call's increment. The edge function does:
--
--   SELECT public.try_consume_extract_intent_quota(<user_id>);
--
-- and rejects the request with HTTP 429 on false.
CREATE OR REPLACE FUNCTION public.try_consume_extract_intent_quota(
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
  -- Atomic upsert: when the window has rolled over, RESET to 1;
  -- otherwise INCREMENT. The CASE expressions inside DO UPDATE keep
  -- this single-statement (no read-then-write race window).
  INSERT INTO public.piktag_extract_intent_rate_limit (user_id, window_start, count)
  VALUES (p_user_id, v_minute, 1)
  ON CONFLICT (user_id) DO UPDATE SET
    window_start = CASE
      WHEN v_minute > public.piktag_extract_intent_rate_limit.window_start
        THEN v_minute
      ELSE public.piktag_extract_intent_rate_limit.window_start
    END,
    count = CASE
      WHEN v_minute > public.piktag_extract_intent_rate_limit.window_start
        THEN 1
      ELSE public.piktag_extract_intent_rate_limit.count + 1
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_minute;
END;
$$;

REVOKE ALL ON FUNCTION public.try_consume_extract_intent_quota(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_consume_extract_intent_quota(UUID, INTEGER) TO postgres, service_role;

-- ── Retention prune ────────────────────────────────────────────
-- Rows older than 1 hour are useless (window is per-minute). A daily
-- prune keeps the table size bounded — at scale this is "1 row per
-- active-in-the-last-day user".
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'piktag-extract-intent-rate-limit-prune';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'piktag-extract-intent-rate-limit-prune',
  '17 4 * * *',  -- 04:17 UTC daily — off-peak, not on any other cron's tick
  $cron$ DELETE FROM public.piktag_extract_intent_rate_limit WHERE window_start < now() - interval '1 hour'; $cron$
);
