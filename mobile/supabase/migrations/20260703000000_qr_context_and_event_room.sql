-- 20260703000000_qr_context_and_event_room.sql
-- =============================================================================
-- Event-tag rework 方向二 + 方向三 (founder 2026-07-03).
--
-- 方向二 — event context as a temporary MODE of the personal QR:
--   piktag_profiles gains qr_context_name / qr_context_expires_at. The QR
--   sheet sets them (8h window); the connect flow (UserDetailScreen) reads
--   the scanned person's active context and applies it as a private
--   connection tag on BOTH rows. No URL change — printed QRs and the web
--   scan path pick the context up automatically, and expiry is enforced
--   by comparing expires_at at read time (no cron needed).
--
-- 方向三 — the event QR connects the ROOM, not just the host:
--   piktag_event_visibility records the attendee's explicit opt-in
--   ("讓其他參加者看到我") per scan session. RLS deny-all: the table is
--   only touched through the two SECURITY DEFINER RPCs below, which
--   enforce REAL membership (your own connection row carries the
--   session id — the same fact qr_group_members relies on — or you are
--   the host). event_attendees applies the ranking-surface checklist:
--   #3 respects piktag_match_dismissals (any surface), #4 excludes
--   is_official, and adds a reciprocity gate — you must be visible in
--   the room to see the room.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / re-runnable grants).
-- =============================================================================

-- ── 方向二: personal-QR event context ───────────────────────────────────
alter table public.piktag_profiles
  add column if not exists qr_context_name text,
  add column if not exists qr_context_expires_at timestamptz;

comment on column public.piktag_profiles.qr_context_name is
  'Active event context on the personal QR ("加上活動情境"). While qr_context_expires_at is in the future, anyone who connects via this profile''s QR gets this name applied as a private connection tag on both rows.';

-- ── 方向三: attendee visibility opt-in ──────────────────────────────────
create table if not exists public.piktag_event_visibility (
  session_id uuid not null references public.piktag_scan_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  visible    boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

-- Deny-all RLS: all access goes through the SECURITY DEFINER RPCs, which
-- carry the membership checks. (RLS enabled with no policies = no direct
-- client access even with default grants.)
alter table public.piktag_event_visibility enable row level security;

-- Caller opts in/out of being visible to other attendees of a session.
-- Membership is validated server-side: the caller's OWN connection row
-- must carry the session id (stamped by the QR connect flow), or the
-- caller is the session host.
create or replace function public.set_event_visibility(p_session_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;
  if not exists (
       select 1 from public.piktag_connections c
       where c.user_id = auth.uid()
         and c.scan_session_id = p_session_id::text
     )
     and not exists (
       select 1 from public.piktag_scan_sessions s
       where s.id = p_session_id and s.host_user_id = auth.uid()
     )
  then
    raise exception 'not a member of this event';
  end if;

  insert into public.piktag_event_visibility (session_id, user_id, visible)
  values (p_session_id, auth.uid(), p_visible)
  on conflict (session_id, user_id) do update set visible = excluded.visible;
end;
$$;

-- Opted-in attendees of a session, for the "這場的人" room list.
-- Reciprocity: the caller must themselves be visible in this session
-- (or be the host). Checklist #4: excludes @piktag/official. Checklist
-- #3: a person the viewer dismissed on ANY surface never resurfaces
-- here. (NOTE: piktag_match_dismissals.surface has a CHECK constraint —
-- if a dismiss gesture is ever added to this surface, ALTER the
-- constraint to include 'event_attendees' first.)
create or replace function public.event_attendees(p_session_id uuid)
returns table (
  user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  is_connected boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    exists (
      select 1 from public.piktag_connections cc
      where cc.user_id = auth.uid() and cc.connected_user_id = p.id
    ) as is_connected
  from public.piktag_event_visibility v
  join public.piktag_profiles p on p.id = v.user_id
  where v.session_id = p_session_id
    and v.visible = true
    and v.user_id <> auth.uid()
    and coalesce(p.is_official, false) = false
    and not exists (
      select 1 from public.piktag_match_dismissals d
      where d.viewer_id = auth.uid() and d.target_id = v.user_id
    )
    and (
      exists (
        select 1 from public.piktag_event_visibility me
        where me.session_id = p_session_id
          and me.user_id = auth.uid()
          and me.visible = true
      )
      or exists (
        select 1 from public.piktag_scan_sessions s
        where s.id = p_session_id and s.host_user_id = auth.uid()
      )
    )
  order by p.full_name nulls last, p.username;
$$;

revoke all on function public.set_event_visibility(uuid, boolean) from public, anon;
grant execute on function public.set_event_visibility(uuid, boolean) to authenticated, service_role;
revoke all on function public.event_attendees(uuid) from public, anon;
grant execute on function public.event_attendees(uuid) to authenticated, service_role;
