-- 20260629010000_admin_magic_moments_rpc.sql
-- =============================================================================
-- Admin-analytics fix (Phase-1 deep audit, 2026-06-29). The dashboard's
-- "magic moments / activation rate" metric was computed in Node by pulling
-- EVERY pre-window piktag_connections row (`select user_id .lt(created_at,...)`,
-- no limit) and de-duping client-side. Past PostgREST's 1000-row default cap
-- that fetch silently truncates → users who actually had a prior connection
-- get miscounted as first-timers → magic_moments + activation_rate inflate
-- with no error as the platform grows.
--
-- Replace with a server-side count (no row cap). A "magic moment" = a user
-- whose FIRST connection WITH A REAL PERSON landed in the window. We exclude
-- the @piktag official auto-friend on BOTH edges (ranking/counting-surface
-- rule #4): everyone auto-friends @piktag at wizard completion, so without the
-- exclusion every onboarded user's "first connection" is that bot edge —
-- magic_moments would just track onboarding completions and activation_rate
-- would pin near 100%. Excluding it makes the metric mean "made a first real
-- friend", which is the activation signal the dashboard wants.
--
-- Admin-only (service_role); SECURITY DEFINER reads all connections.
-- Idempotent (CREATE OR REPLACE + re-runnable grants).
-- =============================================================================

create or replace function public.admin_magic_moments_7d(p_since timestamptz)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int from (
    select c.user_id
    from public.piktag_connections c
    where not public.is_official_user(c.user_id)
      and not public.is_official_user(c.connected_user_id)
    group by c.user_id
    having min(c.created_at) >= p_since
  ) m;
$$;

revoke all on function public.admin_magic_moments_7d(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_magic_moments_7d(timestamptz) to postgres, service_role;
