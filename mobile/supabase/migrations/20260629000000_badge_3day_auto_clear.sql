-- 20260629000000_badge_3day_auto_clear.sql
-- =============================================================================
-- Badge-fatigue relief (founder 2026-06-29): if a user hasn't opened the app
-- for 3 days, auto-clear the app-icon badge while KEEPING the notifications in
-- the feed. Badge stays cleared on reopen — only notifications created AFTER
-- the clear re-badge ("乙 / full" option).
--
-- Why this needs a server cron: the badge is set CLIENT-side at foreground and
-- the push payload deliberately omits badge (send-chat-push etc.), so the icon
-- badge never changes while the app is CLOSED. The only way to clear it while
-- the user is away is a silent push (badge:0). A daily cron edge function
-- (clear-stale-badges) claims inactive users and sends that push.
--
-- Rollout-safe: last_active_at is NULL until the badge-aware client first calls
-- touch_last_active(), and the cron skips NULL — so users on an OLD build (who
-- never report activity) are NEVER wrongly cleared.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / re-runnable grants).
-- =============================================================================

-- 1. Tracking columns on profiles.
alter table public.piktag_profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists badge_baseline_at timestamptz not null default '-infinity';

comment on column public.piktag_profiles.last_active_at is
  'Last app foreground (set by touch_last_active). NULL = never seen by the badge-aware client → the badge cron skips them (rollout safety).';
comment on column public.piktag_profiles.badge_baseline_at is
  'Notifications created at/before this do NOT count toward the app badge. Bumped to now() when the 3-day-inactivity cron clears a stale badge.';

-- 2. Client: mark the caller active (cheap; called on app foreground).
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.piktag_profiles set last_active_at = now() where id = auth.uid();
$$;

-- 3. Client: badge count that RESPECTS the per-user baseline. Caller passes the
--    known notification types (source of truth lives in the app).
create or replace function public.get_badge_count(p_types text[])
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from public.piktag_notifications n
  join public.piktag_profiles p on p.id = n.user_id
  where n.user_id = auth.uid()
    and n.is_read = false
    and n.is_dismissed = false
    and n.type = any(p_types)
    and n.created_at > p.badge_baseline_at;
$$;

-- 4. Cron: ATOMICALLY claim inactive users that still have a stale (non-zero,
--    post-baseline) badge, bump their baseline to now() (so the badge won't
--    re-appear on reopen), and return their push tokens for the edge fn.
create or replace function public.claim_stale_badge_targets(p_limit int default 500)
returns table(id uuid, push_token text)
language sql
security definer
set search_path = public
as $$
  update public.piktag_profiles p
  set badge_baseline_at = now()
  where p.id in (
    select c.id
    from public.piktag_profiles c
    where c.last_active_at is not null
      and c.last_active_at < now() - interval '3 days'
      and c.push_token is not null
      and c.badge_baseline_at < c.last_active_at
      and exists (
        select 1 from public.piktag_notifications n
        where n.user_id = c.id
          and n.is_read = false
          and n.is_dismissed = false
          and n.created_at > c.badge_baseline_at
      )
    limit p_limit
  )
  returning p.id, p.push_token;
$$;

-- Grants: client RPCs → authenticated; cron RPC → service_role only
-- (lockdown doctrine — abuse/data-exposure surface).
revoke all on function public.touch_last_active() from public;
grant execute on function public.touch_last_active() to authenticated, service_role;
revoke all on function public.get_badge_count(text[]) from public;
grant execute on function public.get_badge_count(text[]) to authenticated, service_role;
revoke all on function public.claim_stale_badge_targets(int) from public, anon, authenticated;
grant execute on function public.claim_stale_badge_targets(int) to postgres, service_role;
