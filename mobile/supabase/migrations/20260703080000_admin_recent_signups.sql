-- 20260703080000_admin_recent_signups.sql
--
-- CEO roadmap "do first" #2 (2026-07-04): a signup REVIEW panel. The
-- new-signup email alert (20260703030000) throttles during a wave (so it
-- doesn't amplify a bot flood into the inbox) — which means the admin
-- backend is the founder's only complete view of who's registering. A
-- wave of faker-named gmail signups sat unnoticed for days; this RPC
-- makes the whole cohort reviewable at a glance.
--
-- Per-signup row with the signals that separate a real user from a bot:
-- onboarding completed? has bio / tags / a real (non-@piktag) friend? how
-- many OTHER signups landed in the same clock-hour (burst detection)? A
-- computed `suspicious` flag pre-highlights the likely junk — it never
-- auto-acts, it just sorts the founder's eyes. email comes from
-- auth.users (readable here via SECURITY DEFINER).
--
-- service_role only. Idempotent.

CREATE OR REPLACE FUNCTION public.admin_recent_signups(
  p_days  int DEFAULT 7,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  user_id              uuid,
  username             text,
  full_name            text,
  email                text,
  created_at           timestamptz,
  is_active            boolean,
  onboarding_completed boolean,
  has_bio              boolean,
  tag_count            int,
  real_friends         int,
  same_hour_count      int,
  suspicious           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.id,
      p.username,
      p.full_name,
      u.email,
      p.created_at,
      COALESCE(p.is_active, true)                                   AS is_active,
      COALESCE(p.onboarding_completed, false)                       AS onboarding_completed,
      (COALESCE(btrim(p.bio), '') <> '')                            AS has_bio,
      (SELECT count(*) FROM piktag_user_tags ut WHERE ut.user_id = p.id)::int AS tag_count,
      (SELECT count(*) FROM piktag_connections c
         WHERE c.user_id = p.id
           AND NOT public.is_official_user(c.connected_user_id))::int AS real_friends,
      count(*) OVER (PARTITION BY date_trunc('hour', p.created_at))::int AS same_hour_count
    FROM piktag_profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.is_official = false
      AND p.created_at > now() - make_interval(days => p_days)
  )
  SELECT
    b.id,
    b.username,
    b.full_name,
    b.email,
    b.created_at,
    b.is_active,
    b.onboarding_completed,
    b.has_bio,
    b.tag_count,
    b.real_friends,
    b.same_hour_count,
    (
      -- Dead account: never finished onboarding, no bio, no tags, and
      -- old enough that a real user would have (2h grace).
      (NOT b.onboarding_completed AND b.tag_count = 0 AND NOT b.has_bio
        AND b.created_at < now() - interval '2 hours')
      -- Obvious test/bot email shapes.
      OR (b.email IS NOT NULL AND b.email ~* '(test|demo|fake|bot|qa|\+smoke)')
      -- Burst: 10+ signups sharing the same clock-hour.
      OR b.same_hour_count >= 10
    ) AS suspicious
  FROM base b
  ORDER BY b.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.admin_recent_signups(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_signups(int, int) TO postgres, service_role;
