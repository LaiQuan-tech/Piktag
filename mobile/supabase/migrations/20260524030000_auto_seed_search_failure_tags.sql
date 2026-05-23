-- 20260524030000_auto_seed_search_failure_tags.sql
--
-- Auto-promote recurring search-recovery failures into real piktag_tags.
--
-- WHY: when a user types something like "找會 Yoga 的朋友" and the
-- existing tag pool has no `Yoga` tag, the LLM extracts the keyword
-- but the substring re-search still misses. The telemetry view
-- (search_recovery_failures) records each miss. After N misses of the
-- same keyword, we KNOW it's content-noun-grade (Gemini's extractor
-- already filtered out particles / "朋友" / etc.) — so insert it as a
-- real tag with concept_id NULL. The 5-min auto-link-concepts cron
-- then picks it up, embeds + LLM-judges it into the right concept,
-- and future identical searches go through the fast tag path.
--
-- Result: the system slowly TEACHES ITSELF the vocabulary its users
-- actually search for, without any human curation. Telemetry → tag.
--
-- Threshold = 3 occurrences in past 7 days. Pre-launch low traffic
-- means 3 is already meaningful; post-launch we may need to raise it
-- (the SQL func takes both as args so it's tunable from the schedule).
--
-- Schedule: Sunday 18:00 UTC (≈ Monday 02:00 Taipei) — a few hours
-- BEFORE the Monday-morning digest push, so the digest reflects the
-- already-promoted state rather than reporting tags we're about to
-- auto-create anyway.

CREATE OR REPLACE FUNCTION public.auto_seed_search_failure_tags(
  p_min_freq int DEFAULT 3,
  p_lookback_days int DEFAULT 7
)
RETURNS TABLE(name text, freq integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH frequent_keywords AS (
    SELECT lower(trim(kw)) AS lname, trim(kw) AS keyword, COUNT(*)::int AS freq
    FROM public.piktag_search_telemetry t,
         LATERAL unnest(t.extracted_keywords) AS kw
    WHERE t.created_at > now() - (p_lookback_days || ' days')::interval
      AND t.recovery_triggered = true
      AND t.final_tag_count = 0
      AND t.final_profile_count = 0
      AND t.final_tag_user_count = 0
      AND kw IS NOT NULL
      AND length(trim(kw)) > 0
      AND length(trim(kw)) < 50
    GROUP BY lower(trim(kw)), trim(kw)
    HAVING COUNT(*) >= p_min_freq
  ),
  -- Pick the most-frequent CASING per lowercased keyword (different
  -- users may type 'Yoga' vs 'yoga' — we want one row, prefer the
  -- visually-canonical form).
  ranked AS (
    SELECT keyword, freq,
           ROW_NUMBER() OVER (PARTITION BY lname ORDER BY freq DESC, keyword) AS rn
    FROM frequent_keywords
  ),
  -- Skip keywords already present in piktag_tags (case-insensitive,
  -- matching the unique index on lower(name)).
  novel AS (
    SELECT r.keyword, r.freq
    FROM ranked r
    WHERE r.rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.piktag_tags t
        WHERE lower(t.name) = lower(r.keyword)
      )
  ),
  inserted AS (
    INSERT INTO public.piktag_tags (name)
    SELECT keyword FROM novel
    ON CONFLICT DO NOTHING
    RETURNING name
  )
  SELECT i.name, n.freq
  FROM inserted i
  JOIN novel n ON lower(n.keyword) = lower(i.name);
$$;

REVOKE ALL ON FUNCTION public.auto_seed_search_failure_tags(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_seed_search_failure_tags(int, int) TO postgres, service_role;

-- ── Schedule: weekly Sunday 18:00 UTC ──
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'auto-seed-search-failure-tags-weekly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'auto-seed-search-failure-tags-weekly',
  '0 18 * * 0',  -- Sunday 18:00 UTC = Monday 02:00 Asia/Taipei
  $cron$ SELECT public.auto_seed_search_failure_tags(); $cron$
);
