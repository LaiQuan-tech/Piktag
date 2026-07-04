-- 20260703070000_admin_tag_suggestion_calibration.sql
--
-- CEO roadmap "do first" #1 (2026-07-04): the AI tag-suggestion accept
-- rate has been LOGGED since 20260529040000 (piktag_ai_tag_suggestions:
-- source, position_in_list, accepted) but never made VISIBLE — so
-- principle #5 calibration is dark. With tag_suggest_nudge (the every-
-- 3-day AI tag push, source='push_nudge') now live, its accept rate is
-- the single most actionable signal: a low number means the nudge is
-- noise (retune or slow it); a high number means it's building the
-- tag-graph (the moat) and feeding v3 quality-score data.
--
-- Read-only RPC → one jsonb blob: overall funnel + accept rate sliced by
-- SOURCE (which surface's suggestions land) and by POSITION (does the AI's
-- ranking correlate with accepts — if pos-0 and pos-9 convert the same,
-- the ordering is uninformative and the edge fn should return real
-- confidence). `accepted`: true=added, false=dismissed, null=shown/no
-- decision. accept_rate = accepted / shown, integer 0-100.
--
-- SECURITY DEFINER, service_role only (admin backend). Idempotent.

CREATE OR REPLACE FUNCTION public.admin_tag_suggestion_calibration(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT source, position_in_list, accepted
    FROM public.piktag_ai_tag_suggestions
    WHERE created_at > now() - make_interval(days => p_days)
  ),
  overall AS (
    SELECT
      count(*)                                    AS shown,
      count(*) FILTER (WHERE accepted IS TRUE)    AS accepted,
      count(*) FILTER (WHERE accepted IS FALSE)   AS dismissed,
      count(*) FILTER (WHERE accepted IS NULL)    AS pending
    FROM rows
  ),
  by_source AS (
    SELECT
      source,
      count(*)                                 AS shown,
      count(*) FILTER (WHERE accepted IS TRUE) AS accepted,
      CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE accepted IS TRUE) / count(*))::int
        ELSE 0 END                             AS accept_rate
    FROM rows
    GROUP BY source
    ORDER BY count(*) DESC
  ),
  by_position AS (
    SELECT
      position_in_list AS position,
      count(*)                                 AS shown,
      count(*) FILTER (WHERE accepted IS TRUE) AS accepted,
      CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE accepted IS TRUE) / count(*))::int
        ELSE 0 END                             AS accept_rate
    FROM rows
    WHERE position_in_list IS NOT NULL
    GROUP BY position_in_list
    ORDER BY position_in_list
  )
  SELECT jsonb_build_object(
    'window_days',    p_days,
    'shown',          (SELECT shown FROM overall),
    'accepted',       (SELECT accepted FROM overall),
    'dismissed',      (SELECT dismissed FROM overall),
    'pending',        (SELECT pending FROM overall),
    'accept_rate',    CASE WHEN (SELECT shown FROM overall) > 0
                        THEN round(100.0 * (SELECT accepted FROM overall) / (SELECT shown FROM overall))::int
                        ELSE 0 END,
    'by_source',      COALESCE((SELECT jsonb_agg(to_jsonb(by_source)) FROM by_source), '[]'::jsonb),
    'by_position',    COALESCE((SELECT jsonb_agg(to_jsonb(by_position)) FROM by_position), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_tag_suggestion_calibration(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tag_suggestion_calibration(int) TO postgres, service_role;
