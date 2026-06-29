-- 20260629020000_admin_magic_moments_bounded_funnel.sql
-- =============================================================================
-- Reshape admin_magic_moments_7d (added in 20260629010000) into a bounded
-- 0-100% activation funnel. Founder 2026-06-29.
--
-- The predecessor counted users whose FIRST real connection landed in the
-- window (`group by user_id having min(created_at) >= p_since`). That can
-- exceed 100%: an OLD user who only ever had the @piktag auto-friend and
-- made their first REAL friend this week lands in the numerator, but is not
-- in the new-signup denominator (activation_rate = magic_moments /
-- new_signups_7d) — so the ratio overshoots during reactivation.
--
-- New definition: "of the users who SIGNED UP in the last 7 days, how many
-- made a real friend?" The numerator is by construction a SUBSET of the
-- in-window signups (every counted profile has created_at >= p_since, the
-- same predicate route.ts uses for new_signups_7d), so the rate is always
-- 0-100%.
--
-- @piktag exclusion unchanged (ranking/counting-surface rule #4): "real
-- friend" excludes the official auto-friend as the counterpart, else every
-- onboarded user trivially activates. Excluding the official profile itself
-- from the signup population keeps numerator ⊆ denominator clean.
--
-- Same signature / return type / grants as 20260629010000, so route.ts needs
-- no change (it already calls admin_magic_moments_7d(p_since) and reads the
-- scalar). CREATE OR REPLACE — idempotent, re-runnable grants.
-- =============================================================================

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
