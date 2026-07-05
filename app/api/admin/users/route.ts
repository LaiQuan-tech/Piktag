/**
 * GET /api/admin/users
 *
 * List users from piktag_profiles with auth.users email joined. Supports
 * pagination and simple filtering.
 *
 * Query params:
 *   q            search string (matches username / full_name, ILIKE)
 *   page         1-based page number (default 1)
 *   page_size    items per page (default 20, max 100)
 *   is_active    'true' | 'false' — filter by piktag_profiles.is_active
 *   is_verified  'true' | 'false' — filter by piktag_profiles.is_verified
 *
 * Response: PaginatedResponse<AdminUser>
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import type { AdminUser, PaginatedResponse } from '@/lib/admin-types';

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

export async function GET(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  // Cap raised to 2000 so the admin list can show every user on one page
  // (the UI dropped pagination). Bounded to keep the bulk auth join sane.
  const pageSize = Math.min(
    2000,
    Math.max(1, parseInt(url.searchParams.get('page_size') ?? '20', 10) || 20)
  );
  const isActiveParam = url.searchParams.get('is_active');
  const isVerifiedParam = url.searchParams.get('is_verified');

  const supabase = createAdminClient();

  let query = supabase
    .from('piktag_profiles')
    .select(
      'id, username, full_name, avatar_url, bio, headline, phone, is_verified, is_active, is_public, language, p_points, location, created_at, updated_at',
      { count: 'exact' }
    );

  if (q) {
    // Escape % and _ which are ILIKE wildcards; also escape commas which
    // break .or() filter syntax.
    const safe = q.replace(/[%_,]/g, (c) => `\\${c}`);
    if (q.includes('@')) {
      // Email search (2026-07-04): email lives in auth.users, not
      // piktag_profiles, so resolve matching ids server-side and filter
      // by them. Falls through to a guaranteed-empty result when the
      // email matches nobody, rather than silently matching on username.
      const { data: idRows } = await supabase.rpc('admin_search_user_ids_by_email', {
        p_query: q,
      });
      const ids = ((idRows ?? []) as Array<{ id: string }>).map((r) => r.id);
      query = query.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
    } else {
      query = query.or(`username.ilike.%${safe}%,full_name.ilike.%${safe}%`);
    }
  }
  if (isActiveParam === 'true' || isActiveParam === 'false') {
    query = query.eq('is_active', isActiveParam === 'true');
  }
  if (isVerifiedParam === 'true' || isVerifiedParam === 'false') {
    query = query.eq('is_verified', isVerifiedParam === 'true');
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data: profiles, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (profiles ?? []) as ProfileRow[];

  // Join auth.users for email / last_sign_in / provider / email_confirmed.
  // Use ONE bulk listUsers sweep (paged) into a Map instead of N per-row
  // getUserById calls — the old N+1 didn't scale past a page and would be
  // 140+ round-trips now that the UI shows everyone on one page.
  const authById = new Map<
    string,
    { email: string | null; phone: string | null; last_sign_in_at: string | null; provider: string | null; email_verified: boolean }
  >();
  for (let authPage = 1; authPage <= 20; authPage++) {
    const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({
      page: authPage,
      perPage: 1000,
    });
    if (listErr) break;
    const users = listData?.users ?? [];
    for (const u of users) {
      const provider =
        (u.app_metadata as { provider?: string } | undefined)?.provider ??
        u.identities?.[0]?.provider ??
        null;
      authById.set(u.id, {
        email: u.email ?? null,
        phone: (u.phone as string | undefined) ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        provider,
        email_verified: !!u.email_confirmed_at,
      });
    }
    if (users.length < 1000) break; // last page
  }

  const items: AdminUser[] = rows.map((p) => {
    const auth = authById.get(p.id);
    return {
      id: p.id,
      username: p.username,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      bio: p.bio,
      headline: p.headline,
      phone: p.phone ?? auth?.phone ?? null,
      email: auth?.email ?? null,
      is_verified: p.is_verified,
      is_active: p.is_active,
      is_public: p.is_public,
      language: p.language,
      p_points: p.p_points,
      location: p.location,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_sign_in_at: auth?.last_sign_in_at ?? null,
      provider: auth?.provider ?? null,
      email_verified: auth?.email_verified ?? false,
    };
  });

  const body: PaginatedResponse<AdminUser> = {
    items,
    total: count ?? items.length,
    page,
    page_size: pageSize,
  };
  return NextResponse.json(body);
}
