-- 20260629010000_admin_magic_moments_rpc.sql
--
-- admin_magic_moments_7d(p_since) — the "magic moments / activation rate"
-- metric for app/api/admin/analytics/route.ts, computed in Postgres to fix
-- a silent row-cap truncation bug AND give a clean 0-100% activation funnel.
--
-- THE BUG: the route built this metric by fetching every pre-window
-- connection row (plus every in-window row) into Node to diff two Sets.
-- PostgREST caps an unbounded select at 1000 rows, so once the platform
-- passed ~1000 lifetime connections the before-window set silently
-- truncated -> users with prior connections got miscounted as first-timers
-- -> magic_moments + activation_rate inflated with no error. It was also
-- O(all-connections-ever) per dashboard load.
--
-- THE METRIC (founder 2026-06-29): a bounded activation funnel -- "of the
-- users who SIGNED UP in the last 7 days, how many made a real friend?"
--   magic_moments   = distinct in-window signups with >=1 REAL connection
--   activation_rate = magic_moments / new_signups_7d
-- Always 0-100%, because the numerator is by construction a SUBSET of the
-- in-window signups (the denominator): every counted user has
-- created_at >= p_since. This replaces the looser "first connection ever
-- in the window" definition, which could exceed 100% when an OLD user made
-- their first real friend in the window (in the numerator, but not in the
-- new-signup denominator).
--
-- @piktag exclusion (ranking-surface checklist #4): every user auto-friends
-- the official account at wizard completion (trg_add_official_friend), which
-- writes a piktag_connections row in BOTH directions. "Real connection"
-- therefore excludes the official as the counterpart -- otherwise every
-- onboarded user trivially "activates" and the rate reads ~100% always.
-- is_official_user() is the canonical helper.
--
-- SECURITY DEFINER, granted to service_role only -- called from the root
-- admin app via the service-role key (same posture as admin_overview /
-- admin_biolink_click_stats; see 20260626000000 lockdown doctrine).

CREATE OR REPLACE FUNCTION public.admin_magic_moments_7d(p_since timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.piktag_profiles p
  WHERE p.created_at >= p_since
    AND p.is_official = false
    AND EXISTS (
      -- made at least one REAL (non-official) friend. The @piktag
      -- auto-friend is excluded so it doesn't trivially "activate" everyone.
      SELECT 1
      FROM public.piktag_connections c
      WHERE c.user_id = p.id
        AND NOT public.is_official_user(c.connected_user_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.admin_magic_moments_7d(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_magic_moments_7d(timestamptz) TO postgres, service_role;
