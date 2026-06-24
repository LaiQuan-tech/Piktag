-- 20260625000000_friend_graph.sql
--
-- get_friend_graph() — the "how is MY network connected" view that replaces
-- the retired invite-lineage Tribe (get_tribe_lineage/get_tribe_size were
-- built on the now-dead invite-code system → near-empty + PikTag-vanity).
-- Founder 2026-06-25: users care about how their OWN people interconnect,
-- not how many they dragged into PikTag.
--
-- Returns, for auth.uid():
--   friends      : the caller's accepted friends. Identity IS returned
--                  (username/full_name/avatar) — they're the caller's own
--                  friends. Excludes @piktag official + blocked + self.
--                  `deg` = how many of the caller's OTHER friends this friend
--                  is also connected to (intra-network centrality).
--   edges        : [a,b] pairs of the caller's friends who are ALSO connected
--                  to each other — the cluster structure of the network.
--   bridges      : 2nd-degree people (friend-of-friend, NOT already the
--                  caller's friend) who connect >=2 of the caller's friends —
--                  the "you may know" connectors. Returned ANONYMOUS: id +
--                  mutual_count ONLY, no name/avatar (privacy — the client
--                  renders faceless dots). A deliberate tap routes to
--                  UserDetail, where identity + a connect action are revealed
--                  under that screen's own privacy checks. is_public only, so
--                  a tap always lands on a viewable profile.
--   bridge_edges : [bridge_id, friend_id] — which of the caller's shown
--                  friends each bridge connects to (to draw the bridge lines).
--
-- auth.uid()-guarded; SECURITY DEFINER to read the 2-hop connection graph
-- (same posture as get_friend_of_friend_ids / the recommendation cron).
-- Excludes @piktag everywhere (ranking-surface checklist #4) so the official
-- account doesn't become a universal hub that connects everyone.

create or replace function public.get_friend_graph()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with my_friends as (
    select distinct c.connected_user_id as fid
    from public.piktag_connections c
    where c.user_id = auth.uid()
      and c.connected_user_id <> auth.uid()
      and not public.is_official_user(c.connected_user_id)
      and c.connected_user_id not in (
        select blocked_id from public.piktag_blocks where blocker_id = auth.uid()
        union
        select blocker_id from public.piktag_blocks where blocked_id = auth.uid()
      )
  ),
  -- Undirected friend↔friend edges (both endpoints are my friends), deduped a<b.
  friend_edges as (
    select distinct
      least(c.user_id, c.connected_user_id)    as a,
      greatest(c.user_id, c.connected_user_id) as b
    from public.piktag_connections c
    where c.user_id in (select fid from my_friends)
      and c.connected_user_id in (select fid from my_friends)
      and c.user_id <> c.connected_user_id
  ),
  -- Intra-network degree per friend (how many of my OTHER friends they link to).
  friend_degree as (
    select mf.fid,
      (select count(*) from friend_edges fe where fe.a = mf.fid or fe.b = mf.fid) as deg
    from my_friends mf
  ),
  -- Cap to the most-connected friends so the SVG stays renderable on mobile.
  -- For the cold-start / typical user (< 60 friends) this is everyone.
  top_friends as (
    select fd.fid, fd.deg
    from friend_degree fd
    order by fd.deg desc, fd.fid
    limit 60
  ),
  -- Bridges: people my friends know, who I do NOT yet know, shared by >=2 of
  -- my friends → meaningful connectors (mirrors the recommendation >=2 floor).
  bridge_raw as (
    select c2.connected_user_id as bid, count(distinct c2.user_id) as mutual_count
    from public.piktag_connections c2
    where c2.user_id in (select fid from top_friends)
      and c2.connected_user_id <> auth.uid()
      and c2.connected_user_id not in (select fid from my_friends)
      and not public.is_official_user(c2.connected_user_id)
      and c2.connected_user_id not in (
        select blocked_id from public.piktag_blocks where blocker_id = auth.uid()
        union
        select blocker_id from public.piktag_blocks where blocked_id = auth.uid()
      )
      -- Respect negative signals (ranking-surface checklist #3): never
      -- re-surface someone the viewer has dismissed on ANY surface, even
      -- anonymized. Read-only here (the graph has no dismiss gesture in v1),
      -- so no new 'surface' value is written to the CHECK list.
      and c2.connected_user_id not in (
        select target_id from public.piktag_match_dismissals where viewer_id = auth.uid()
      )
    group by c2.connected_user_id
    having count(distinct c2.user_id) >= 2
  ),
  top_bridges as (
    select br.bid, br.mutual_count
    from bridge_raw br
    join public.piktag_profiles p on p.id = br.bid
    where coalesce(p.is_public, true) = true
    order by br.mutual_count desc, br.bid
    limit 12
  ),
  graph_bridge_edges as (
    select c2.connected_user_id as bid, c2.user_id as fid
    from public.piktag_connections c2
    where c2.connected_user_id in (select bid from top_bridges)
      and c2.user_id in (select fid from top_friends)
  )
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tf.fid,
        'username', p.username,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'deg', tf.deg
      ) order by tf.deg desc, tf.fid)
      from top_friends tf
      join public.piktag_profiles p on p.id = tf.fid
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_array(fe.a, fe.b))
      from friend_edges fe
      where fe.a in (select fid from top_friends)
        and fe.b in (select fid from top_friends)
    ), '[]'::jsonb),
    'bridges', coalesce((
      select jsonb_agg(jsonb_build_object('id', tb.bid, 'mutual_count', tb.mutual_count)
        order by tb.mutual_count desc, tb.bid)
      from top_bridges tb
    ), '[]'::jsonb),
    'bridge_edges', coalesce((
      select jsonb_agg(jsonb_build_array(be.bid, be.fid))
      from graph_bridge_edges be
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.get_friend_graph() to authenticated;
