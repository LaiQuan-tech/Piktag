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
  const pageSize = Math.min(
    100,
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
    query = query.or(`username.ilike.%${safe}%,full_name.ilike.%${safe}%`);
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

  // Join auth.users for email/last_sign_in_at per profile. There's no bulk
  // getByIds API on supabase-js, so we fire these in parallel. Page size is
  // capped at 100 so this stays bounded.
  const authLookups = await Promise.all(
    rows.map((p) => supabase.auth.admin.getUserById(p.id))
  );

  const items: AdminUser[] = rows.map((p, i) => {
    const authUser = authLookups[i]?.data?.user ?? null;
    return {
      id: p.id,
      username: p.username,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      bio: p.bio,
      headline: p.headline,
      phone: p.phone ?? authUser?.phone ?? null,
      email: authUser?.email ?? null,
      is_verified: p.is_verified,
      is_active: p.is_active,
      is_public: p.is_public,
      language: p.language,
      p_points: p.p_points,
      location: p.location,
      created_at: p.created_at,
      updated_at: p.updated_at,
      last_sign_in_at: authUser?.last_sign_in_at ?? null,
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
