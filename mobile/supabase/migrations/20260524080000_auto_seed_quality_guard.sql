-- 20260524080000_auto_seed_quality_guard.sql
--
-- POST-AUDIT: harden auto_seed_search_failure_tags against pre-launch
-- self-pollution.
--
-- The original 20260524030000 used COUNT(*) >= 3, meaning ONE user
-- typing the same garbage query three times in a week was enough to
-- promote it into permanent piktag_tags. Pre-launch the user base is
-- tiny (founder + a handful of testers) so one person's frustration-
-- typing or accidental keystrokes IS the dataset. A single user who
-- searches "asdf" three times unintentionally lands "asdf" in the tag
-- pool forever — the linker then embeds it, the 5-min cron mints a
-- concept, and it shows up in popular tags.
--
-- Two fixes:
--   1. COUNT(DISTINCT user_id) >= p_min_freq — require N *different*
--      humans to type the same keyword. One user can't farm a tag.
--   2. length(trim(kw)) >= 2 — single-character keywords are almost
--      always particles or junk that Gemini's filter let through.
--      Real concepts ("AI", "X" the platform) are rare edge cases and
--      can be hand-seeded if needed.
--
-- The function signature stays identical so the existing weekly cron
-- (Sunday 18:00 UTC) keeps calling it unchanged.

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
    SELECT
      lower(trim(kw)) AS lname,
      trim(kw) AS keyword,
      -- COUNT(DISTINCT user_id) — N different humans must have hit
      -- this keyword. One user repeating themselves doesn't count.
      COUNT(DISTINCT t.user_id)::int AS user_count,
      COUNT(*)::int AS freq
    FROM public.piktag_search_telemetry t,
         LATERAL unnest(t.extracted_keywords) AS kw
    WHERE t.created_at > now() - (p_lookback_days || ' days')::interval
      AND t.recovery_triggered = true
      AND t.final_tag_count = 0
      AND t.final_profile_count = 0
      AND t.final_tag_user_count = 0
      AND kw IS NOT NULL
      -- ≥2 chars: 1-char keywords are almost always noise that slipped
      -- past Gemini's particle filter (e.g. stray punctuation, single
      -- letters from typos).
      AND length(trim(kw)) >= 2
      AND length(trim(kw)) < 50
    GROUP BY lower(trim(kw)), trim(kw)
    HAVING COUNT(DISTINCT t.user_id) >= p_min_freq
  ),
  -- Pick the most-frequent CASING per lowercased keyword.
  ranked AS (
    SELECT keyword, freq,
           ROW_NUMBER() OVER (PARTITION BY lname ORDER BY freq DESC, keyword) AS rn
    FROM frequent_keywords
  ),
  -- Skip keywords already in piktag_tags.
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

-- No re-schedule needed: the cron entry from 20260524030000 still
-- points at this same function name + signature, and CREATE OR
-- REPLACE leaves the schedule in place.
