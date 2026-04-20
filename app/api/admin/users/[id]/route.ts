/**
 * /api/admin/users/[id]
 *
 *   GET    → full AdminUserDetail (profile + auth + counts + recent activity)
 *   DELETE → permanently remove user + cascaded rows
 *
 * Both methods require an admin caller (requireAdmin) and both write an
 * audit-log entry BEFORE performing their primary action.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import { logAdminAction } from '@/lib/audit';
import type { AdminUserDetail } from '@/lib/admin-types';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface ProfileRow {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  headline: string | null;
  phone: string | null;
  is_verified: boolean;
  is_active: boolean;
  is_public: boolean;
  language: string | null;
  p_points: number | null;
  location: string | null;
  created_at: string;
  updated_at: string | null;
}

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;

  const supabase = createAdminClient();

  // Fire every independent read in parallel. `head: true, count: 'exact'`
  // asks Postgres for the row count only (no payload) which is cheap.
  const [
    profileRes,
    authRes,
    connectionsCountRes,
    userTagsRes,
    biolinksRes,
    reportsFiledRes,
    reportsReceivedRes,
    scanSessionsCountRes,
    recentConnectionsRes,
    recentPointsRes,
  ] = await Promise.all([
    supabase
      .from('piktag_profiles')
      .select(
        'id, username, full_name, avatar_url, bio, headline, phone, is_verified, is_active, is_public, language, p_points, location, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase.auth.admin.getUserById(id),
    supabase
      .from('piktag_connections')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', id),
    supabase
      .from('piktag_user_tags')
      .select('tag_id, is_pinned, piktag_tags(id, name)')
      .eq('user_id', id),
    supabase
      .from('piktag_biolinks')
      .select('id, platform, url, label, visibility, is_active')
      .eq('user_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('piktag_reports')
      .select('id', { count: 'exact', head: true })
      .eq('reporter_id', id),
    supabase
      .from('piktag_reports')
      .select('id', { count: 'exact', head: true })
      .eq('reported_id', id),
    supabase
      .from('piktag_scan_sessions')
      .select('host_user_id', { count: 'exact', head: true })
      .eq('host_user_id', id),
    supabase
      .from('piktag_connections')
      .select('id, connected_user_id, nickname, met_at, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('piktag_points_ledger')
      .select('id, delta, balance_after, reason, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (profileRes.error) {
    return NextResponse.json({ error: profileRes.error.message }, { status: 500 });
  }
  const profile = profileRes.data as ProfileRow | null;
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await logAdminAction({
    adminEmail: gate.adminEmail,
    action: 'view_user',
    targetType: 'user',
    targetId: id,
  });

  const authUser = authRes.data?.user ?? null;

  // Shape nested tag join → flat { id, name, is_pinned }. Supabase's
  // relational select returns the joined table either as an object or a
  // single-element array depending on FK cardinality; handle both.
  type UserTagRow = {
    tag_id: string;
    is_pinned: boolean;
    piktag_tags:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  };
  const tags: AdminUserDetail['tags'] = ((userTagsRes.data ?? []) as UserTagRow[])
    .map((row) => {
      const t = Array.isArray(row.piktag_tags) ? row.piktag_tags[0] : row.piktag_tags;
      if (!t) return null;
      return { id: t.id, name: t.name, is_pinned: row.is_pinned };
    })
    .filter((x): x is { id: string; name: string; is_pinned: boolean } => x !== null);

  const biolinks: AdminUserDetail['biolinks'] = (biolinksRes.data ?? []).map(
    (b: {
      id: string;
      platform: string;
      url: string;
      label: string | null;
      visibility: string;
    }) => ({
      id: b.id,
      platform: b.platform,
      url: b.url,
      label: b.label,
      visibility: b.visibility,
    })
  );

  const recentConnections: AdminUserDetail['recent_connections'] = (
    recentConnectionsRes.data ?? []
  ).map(
    (c: {
      id: string;
      connected_user_id: string;
      nickname: string | null;
      met_at: string | null;
      created_at: string;
    }) => ({
      id: c.id,
      connected_user_id: c.connected_user_id,
      nickname: c.nickname,
      met_at: c.met_at,
      created_at: c.created_at,
    })
  );

  const recentPoints: AdminUserDetail['recent_points'] = (recentPointsRes.data ?? []).map(
    (p: {
      id: number;
      delta: number;
      balance_after: number;
      reason: string;
      created_at: string;
    }) => ({
      id: p.id,
      delta: p.delta,
      balance_after: p.balance_after,
      reason: p.reason,
      created_at: p.created_at,
    })
  );

  const body: AdminUserDetail = {
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
    headline: profile.headline,
    phone: profile.phone ?? authUser?.phone ?? null,
    email: authUser?.email ?? null,
    is_verified: profile.is_verified,
    is_active: profile.is_active,
    is_public: profile.is_public,
    language: profile.language,
    p_points: profile.p_points,
    location: profile.location,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_sign_in_at: authUser?.last_sign_in_at ?? null,
    connections_count: connectionsCountRes.count ?? 0,
    tags_count: tags.length,
    biolinks_count: biolinks.length,
    scan_sessions_count: scanSessionsCountRes.count ?? 0,
    reports_filed: reportsFiledRes.count ?? 0,
    reports_received: reportsReceivedRes.count ?? 0,
    tags,
    biolinks,
    recent_connections: recentConnections,
    recent_points: recentPoints,
  };

  return NextResponse.json(body);
}

/**
 * DELETE /api/admin/users/[id]
 *
 * Hard-delete a user. We call `supabase.auth.admin.deleteUser(id)` which
 * cascades auth + any FK-linked rows with ON DELETE CASCADE, then manually
 * scrub tables that may not have cascade configured.
 *
 * Note: there is a self-delete Edge Function at
 *   https://<project>.supabase.co/functions/v1/delete-user
 * which currently only permits self-delete. Once it's extended to accept
 * { user_id, admin_action, admin_email }, prefer calling it here with the
 * service-role key as the Bearer token so deletion logic lives in one place.
 */
export async function DELETE(_req: Request, ctx: RouteCtx): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;
  const { id } = await ctx.params;

  const supabase = createAdminClient();

  await logAdminAction({
    adminEmail: gate.adminEmail,
    action: 'delete_user',
    targetType: 'user',
    targetId: id,
  });

  // Manual cascade first, in case FK cascade isn't configured on every
  // table. Errors are captured but we still attempt auth.deleteUser below.
  const cascadeErrors: string[] = [];
  const cascade = await Promise.all([
    supabase.from('piktag_connections').delete().eq('user_id', id),
    supabase.from('piktag_connections').delete().eq('connected_user_id', id),
    supabase.from('piktag_user_tags').delete().eq('user_id', id),
    supabase.from('piktag_biolinks').delete().eq('user_id', id),
    supabase.from('piktag_follows').delete().eq('follower_id', id),
    supabase.from('piktag_follows').delete().eq('following_id', id),
    supabase.from('piktag_blocks').delete().eq('blocker_id', id),
    supabase.from('piktag_blocks').delete().eq('blocked_id', id),
    supabase.from('piktag_points_ledger').delete().eq('user_id', id),
    supabase.from('piktag_reports').delete().eq('reporter_id', id),
    supabase.from('piktag_reports').delete().eq('reported_id', id),
  ]);
  cascade.forEach((res: { error: { message: string } | null }) => {
    if (res.error) cascadeErrors.push(res.error.message);
  });

  const { error: authErr } = await supabase.auth.admin.deleteUser(id);
  if (authErr) {
    return NextResponse.json(
      { error: authErr.message, cascade_errors: cascadeErrors },
      { status: 500 }
    );
  }

  // Profile row — normally FK-cascaded from auth.users, but delete
  // explicitly for safety.
  await supabase.from('piktag_profiles').delete().eq('id', id);

  return NextResponse.json({ success: true });
}
