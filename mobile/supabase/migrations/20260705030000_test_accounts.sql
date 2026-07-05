-- 20260705030000_test_accounts.sql
--
-- Mark the closed-test / QA tester accounts with a reversible
-- is_test_account flag and exclude them from real metrics.
--
-- Structure:
--   1. is_test_account column (idempotent).
--   2. ONE-TIME backfill of the CURRENT tester rows (NOT a trigger — a
--      future real user with a similar email is never auto-marked).
--   3. is_test_account_user() helper (mirrors is_official_user).
--   4. CREATE OR REPLACE the 5 metric/feed RPCs to respect the flag —
--      each reproduced VERBATIM from its current migration with exactly
--      ONE added filter (except admin_recent_signups, which SURFACES the
--      flag as a column so the review panel still shows testers).
--
-- Reversible: toggle is_test_account from the admin backend.

-- ── 1. Column ────────────────────────────────────────────────────────
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.piktag_profiles.is_test_account IS
  'Closed-test / QA tester account, excluded from real metrics. Reversible flag toggled from the admin backend.';

-- ── 2. One-time backfill (current tester rows only) ──────────────────
-- Verified to match exactly the 103 tester accounts and zero
-- real/activated users. This runs once; it is NOT a trigger.
UPDATE public.piktag_profiles p
SET is_test_account = true
FROM auth.users u
WHERE u.id = p.id
  AND p.is_official = false
  AND (
    u.email IN (
      'elzsaflw5bnueihfd6ib42g754-00@cloudtestlabaccounts.com',
      'newexplorer12345@example.com','newtest@example.com','newtestuser999@example.com',
      'newuser999@example.com','newuser@example.com',
      'piktag-diag-1781621913@gmail.com','piktag-diag2-1781621984@gmail.com','piktag-diag3-1781622201@gmail.com',
      'test@example.com','testuser@example.com'
    )
    OR u.email ~* '^[a-z]+\.[0-9]{3,5}@gmail\.com$'
    OR u.email ~* '@example\.com$'
    OR u.email ~* 'piktag[.-](tester|diag)'
  );

-- ── 3. Helper: is_test_account_user (mirror is_official_user) ────────
CREATE OR REPLACE FUNCTION public.is_test_account_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_test_account FROM public.piktag_profiles WHERE id = p_user_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_test_account_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_test_account_user(uuid) TO postgres, service_role, authenticated;

-- ── 4a. admin_activation_funnel — exclude testers from cohort + by_source
-- Verbatim from 20260703090000_admin_activation_funnel.sql, plus
-- `AND COALESCE(p.is_test_account, false) = false` on BOTH the cohort
-- CTE WHERE and the by_source CTE WHERE.
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
      AND COALESCE(p.is_test_account, false) = false
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
  ),
  by_source AS (
    SELECT
      COALESCE(p.signup_source, 'unknown') AS source,
      count(*)::int AS signed_up,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM piktag_connections cn
        WHERE cn.user_id = p.id
          AND NOT public.is_official_user(cn.connected_user_id)
      ))::int AS activated
    FROM piktag_profiles p
    WHERE p.is_official = false
      AND COALESCE(p.is_test_account, false) = false
      AND p.created_at > now() - make_interval(days => p_days)
    GROUP BY COALESCE(p.signup_source, 'unknown')
    ORDER BY count(*) DESC
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
    'rate_messaged',  CASE WHEN s.signed_up > 0 THEN round(100.0 * s.messaged  / s.signed_up)::int ELSE 0 END,
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', bs.source,
        'signed_up', bs.signed_up,
        'activated', bs.activated,
        'rate_activated', CASE WHEN bs.signed_up > 0 THEN round(100.0 * bs.activated / bs.signed_up)::int ELSE 0 END
      )) FROM by_source bs
    ), '[]'::jsonb)
  )
  FROM stages s;
$$;

REVOKE ALL ON FUNCTION public.admin_activation_funnel(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activation_funnel(int) TO postgres, service_role;

-- ── 4b. admin_magic_moments_7d — exclude testers ────────────────────
-- Verbatim from 20260629020000_admin_magic_moments_bounded_funnel.sql
-- (the LATER/bounded version), plus `and p.is_test_account IS NOT TRUE`
-- next to the existing `p.is_official = false`.
create or replace function public.admin_magic_moments_7d(p_since timestamptz)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from public.piktag_profiles p
  where p.created_at >= p_since
    and p.is_official = false
    and p.is_test_account IS NOT TRUE
    and exists (
      -- made at least one REAL (non-@piktag) friend
      select 1
      from public.piktag_connections c
      where c.user_id = p.id
        and not public.is_official_user(c.connected_user_id)
    );
$$;

revoke all on function public.admin_magic_moments_7d(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_magic_moments_7d(timestamptz) to postgres, service_role;

-- ── 4c. admin_recent_signups — SURFACE the flag (do NOT exclude) ─────
-- Verbatim from 20260703080000_admin_recent_signups.sql. This review
-- panel MUST still show testers, so instead of filtering we add
-- `is_test_account boolean` to RETURNS TABLE (right after is_active)
-- and select `p.is_test_account` in the base CTE + final SELECT.
--
-- The RETURNS TABLE shape CHANGES (a new column), and CREATE OR REPLACE
-- cannot change a function's return type (42P13). DROP the exact-signature
-- function first — nothing else in the DB depends on it (client-only RPC).
DROP FUNCTION IF EXISTS public.admin_recent_signups(int, int);
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
  is_test_account      boolean,
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
      COALESCE(p.is_test_account, false)                           AS is_test_account,
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
    b.is_test_account,
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

-- ── 4d. admin_tag_suggestion_calibration — exclude testers ──────────
-- Verbatim from 20260703070000_admin_tag_suggestion_calibration.sql.
-- The rows CTE now JOINs piktag_profiles and adds
-- `AND COALESCE(p.is_test_account, false) = false` (columns qualified to
-- avoid ambiguity across the join).
CREATE OR REPLACE FUNCTION public.admin_tag_suggestion_calibration(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT s.source, s.position_in_list, s.accepted
    FROM public.piktag_ai_tag_suggestions s
    JOIN public.piktag_profiles p ON p.id = s.user_id
    WHERE s.created_at > now() - make_interval(days => p_days)
      AND COALESCE(p.is_test_account, false) = false
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

-- ── 4e. select_tag_nudge_due_users — exclude testers from the feed ──
-- Verbatim from 20260702170000_tag_suggest_nudge.sql, plus
-- `AND COALESCE(p.is_test_account, false) = false` in the main WHERE
-- (next to `p.is_official = false`) so testers don't burn Gemini quota.
CREATE OR REPLACE FUNCTION public.select_tag_nudge_due_users(p_limit int DEFAULT 50)
RETURNS TABLE (
  user_id          uuid,
  bio              text,
  full_name        text,
  headline         text,
  language         text,
  push_token       text,
  existing_tags    text[],
  removed_tags     text[],
  recent_suggested text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.bio,
    p.full_name,
    p.headline,
    COALESCE(p.language, 'en'),
    p.push_token,
    COALESCE((
      SELECT array_agg(DISTINCT t.name)
      FROM piktag_user_tags ut
      JOIN piktag_tags t ON t.id = ut.tag_id
      WHERE ut.user_id = p.id
    ), '{}'::text[]),
    COALESCE((
      SELECT array_agg(DISTINCT t2.name)
      FROM piktag_tag_removals r
      JOIN piktag_tags t2 ON t2.id = r.tag_id
      WHERE r.user_id = p.id
        AND r.source IN ('self_unstag', 'ai_dismissed')
    ), '{}'::text[]),
    COALESCE((
      SELECT array_agg(DISTINCT s.tag_name)
      FROM piktag_ai_tag_suggestions s
      WHERE s.user_id = p.id
        AND s.source = 'push_nudge'
        AND s.created_at > now() - interval '30 days'
    ), '{}'::text[])
  FROM piktag_profiles p
  WHERE p.is_official = false
    AND COALESCE(p.is_test_account, false) = false
    AND p.onboarding_completed = true
    -- New-user grace: day-one users are still in the cold-start card
    -- flow; let the product breathe before the first nudge.
    AND p.created_at < now() - interval '2 days'
    -- SPEND GUARD: an opted-out user's INSERT is silently cancelled by
    -- the category gate, so they never accrue a pacing row — without
    -- this pre-filter they'd be selected (and Gemini-billed) EVERY day
    -- forever. Mirror the gate's memories mapping here.
    AND COALESCE(p.notif_memories, true) = true
    -- Tag-cap guard: EditProfile hides the AI chip row at 10 tags, so
    -- a nudge for a capped user lands on chips whose tap can't add.
    AND (
      SELECT COUNT(*) FROM piktag_user_tags ut2 WHERE ut2.user_id = p.id
    ) < 10
    -- Quality floor (NOT profile-health gating): the person prompt with
    -- only a name manufactures junk. Require at least a bio or one
    -- public tag so the model has something real to work from.
    AND (
      COALESCE(btrim(p.bio), '') <> ''
      OR EXISTS (
        SELECT 1 FROM piktag_user_tags ut3
        WHERE ut3.user_id = p.id AND ut3.is_private = false
      )
    )
    -- Pacing: every 3 days per user.
    AND NOT EXISTS (
      SELECT 1 FROM piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'tag_suggest_nudge'
        AND n.created_at > now() - interval '3 days'
    )
  -- Fair rotation: least-recently-nudged first (never-nudged before
  -- everyone), so users whose suggestions all filtered out (they leave
  -- no pacing row) can't permanently starve the back of the queue.
  ORDER BY (
    SELECT max(n2.created_at) FROM piktag_notifications n2
    WHERE n2.user_id = p.id AND n2.type = 'tag_suggest_nudge'
  ) ASC NULLS FIRST, p.created_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.select_tag_nudge_due_users(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_tag_nudge_due_users(int)
  TO postgres, service_role;
