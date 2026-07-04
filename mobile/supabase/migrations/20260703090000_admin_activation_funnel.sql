-- 20260703090000_admin_activation_funnel.sql
--
-- Founder ask (2026-07-04): "分析註冊轉換率". A cohort conversion funnel —
-- of the users who SIGNED UP in the window, how far did each get down the
-- North-Star path. This is the MACRO funnel (no channel breakdown —
-- signup source isn't captured yet; that's a separate, app-side build).
-- It answers "where does the funnel leak" which is what the three
-- silently-zeroed dashboard KPIs proved we couldn't trust before.
--
-- Cohort = non-official profiles created in the last p_days. Each stage
-- is a strict funnel step counted within that same cohort:
--   signed_up   : the cohort size
--   onboarded   : onboarding_completed = true
--   has_tag     : has >= 1 tag (self-description exists)
--   activated   : has >= 1 real (non-@piktag) friend  ← the North Star
--   messaged    : has sent >= 1 chat message (reactivation-loop entry)
--
-- Rates are each stage over the cohort (signed_up), integer 0-100.
-- SECURITY DEFINER, service_role only. Idempotent.

CREATE OR REPLACE FUNCTION public.admin_activation_funnel(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cohort AS (
    SELECT p.id
    FROM piktag_profiles p
    WHERE p.is_official = false
      AND p.created_at > now() - make_interval(days => p_days)
  ),
  stages AS (
    SELECT
      (SELECT count(*) FROM cohort)::int AS signed_up,
      (SELECT count(*) FROM cohort c
        JOIN piktag_profiles p ON p.id = c.id
        WHERE COALESCE(p.onboarding_completed, false))::int AS onboarded,
      (SELECT count(*) FROM cohort c
        WHERE EXISTS (SELECT 1 FROM piktag_user_tags ut WHERE ut.user_id = c.id))::int AS has_tag,
      (SELECT count(*) FROM cohort c
        WHERE EXISTS (
          SELECT 1 FROM piktag_connections cn
          WHERE cn.user_id = c.id
            AND NOT public.is_official_user(cn.connected_user_id)
        ))::int AS activated,
      (SELECT count(*) FROM cohort c
        WHERE EXISTS (SELECT 1 FROM piktag_messages m WHERE m.sender_id = c.id))::int AS messaged
  )
  SELECT jsonb_build_object(
    'window_days', p_days,
    'signed_up',   s.signed_up,
    'onboarded',   s.onboarded,
    'has_tag',     s.has_tag,
    'activated',   s.activated,
    'messaged',    s.messaged,
    'rate_onboarded', CASE WHEN s.signed_up > 0 THEN round(100.0 * s.onboarded / s.signed_up)::int ELSE 0 END,
    'rate_has_tag',   CASE WHEN s.signed_up > 0 THEN round(100.0 * s.has_tag   / s.signed_up)::int ELSE 0 END,
    'rate_activated', CASE WHEN s.signed_up > 0 THEN round(100.0 * s.activated / s.signed_up)::int ELSE 0 END,
    'rate_messaged',  CASE WHEN s.signed_up > 0 THEN round(100.0 * s.messaged  / s.signed_up)::int ELSE 0 END
  )
  FROM stages s;
$$;

REVOKE ALL ON FUNCTION public.admin_activation_funnel(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activation_funnel(int) TO postgres, service_role;
