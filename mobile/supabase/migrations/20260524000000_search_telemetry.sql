-- 20260524000000_search_telemetry.sql
--
-- Search telemetry — capture every committed search the user runs so
-- we can see where the search engine still falls short post-launch:
--   • What query did the user type?
--   • Did the normal substring + stopword path produce results, or did
--     the LLM recovery fire?
--   • If recovery fired, what content nouns did Gemini extract?
--   • Did the final search (after recovery) still come up empty?
--
-- The actionable signal is the LAST point: "recovery fired AND
-- final_tag_count = 0" — those are queries where Gemini's extraction
-- didn't match any existing tag. The fix is to either seed those
-- terms into tag_aliases (so future searches skip the LLM cost) OR
-- to nudge users toward creating those tags.
--
-- Privacy: RLS owner-only. We retain 30 days then auto-delete via
-- pg_cron — telemetry is for trend analysis, not user history.

CREATE TABLE IF NOT EXISTS public.piktag_search_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  -- Did the regular substring + stopword search produce ANY result
  -- before recovery had to run? When true, recovery never fired.
  direct_hit BOOLEAN NOT NULL DEFAULT false,
  -- Did the zero-results LLM recovery path actually run?
  recovery_triggered BOOLEAN NOT NULL DEFAULT false,
  -- Keywords Gemini extracted, if recovery ran. NULL if it didn't.
  extracted_keywords TEXT[],
  -- Final outcomes. final_tag_count is what performSearch ends with
  -- (post-recovery if it fired). The private-world effect surfaces
  -- additional people async via name/headline/nickname matches that
  -- aren't reflected here — acceptable approximation for v1.
  final_tag_count INTEGER NOT NULL DEFAULT 0,
  final_profile_count INTEGER NOT NULL DEFAULT 0,
  final_tag_user_count INTEGER NOT NULL DEFAULT 0,
  -- Per-locale failure analysis (different stopword stripping coverage
  -- for en / zh; the other 17 locales rely entirely on LLM recovery).
  locale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_piktag_search_telemetry_user_created
  ON public.piktag_search_telemetry (user_id, created_at DESC);

-- "Recovery fired but final outcome is still empty" — the single most
-- valuable diagnostic. A partial index keeps this scan cheap.
CREATE INDEX IF NOT EXISTS idx_piktag_search_telemetry_recovery_fail
  ON public.piktag_search_telemetry (created_at DESC)
  WHERE recovery_triggered = true
    AND final_tag_count = 0
    AND final_profile_count = 0
    AND final_tag_user_count = 0;

-- ── RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.piktag_search_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS search_telemetry_owner_insert ON public.piktag_search_telemetry;
CREATE POLICY search_telemetry_owner_insert ON public.piktag_search_telemetry
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS search_telemetry_owner_read ON public.piktag_search_telemetry;
CREATE POLICY search_telemetry_owner_read ON public.piktag_search_telemetry
  FOR SELECT USING (user_id = auth.uid());

-- ── Convenience view ────────────────────────────────────────────
-- The thing you actually want to look at: "queries where recovery
-- fired but we STILL surfaced nothing". Each row is a candidate for
-- a new tag_aliases seed entry (or a real new tag).
CREATE OR REPLACE VIEW public.search_recovery_failures AS
SELECT
  t.created_at,
  t.locale,
  t.query,
  t.extracted_keywords,
  t.user_id
FROM public.piktag_search_telemetry t
WHERE t.recovery_triggered = true
  AND t.final_tag_count = 0
  AND t.final_profile_count = 0
  AND t.final_tag_user_count = 0
ORDER BY t.created_at DESC;

GRANT SELECT ON public.search_recovery_failures TO authenticated;

-- ── Retention: prune > 30 days ──────────────────────────────────
-- Telemetry is for trends, not history. pg_cron handles it; the job
-- is idempotent (unschedule-guard) so this migration is safe to
-- re-run.
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'piktag-search-telemetry-prune';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'piktag-search-telemetry-prune',
  '0 3 * * *',  -- 03:00 UTC daily
  $cron$ DELETE FROM public.piktag_search_telemetry WHERE created_at < now() - interval '30 days'; $cron$
);
