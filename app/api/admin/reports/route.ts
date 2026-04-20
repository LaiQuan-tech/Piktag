/**
 * GET /api/admin/reports
 *
 * List user reports from `piktag_reports` with reporter + reported usernames
 * joined from `piktag_profiles`. Supports pagination and status filtering.
 *
 * Query params:
 *   status     'pending' | 'reviewed' | 'dismissed' (optional)
 *   page       1-based page number (default 1)
 *   page_size  items per page (default 20, max 100)
 *
 * Response shape (extends PaginatedResponse<AdminReport>):
 *   {
 *     items: AdminReport[],
 *     total: number,
 *     page: number,
 *     page_size: number,
 *     counts: { pending, reviewed, dismissed }
 *   }
 *
 * Default order: created_at DESC.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import type {
  AdminReport,
  PaginatedResponse,
  ReportStatus,
} from '@/lib/admin-types';

const VALID_STATUSES: ReadonlyArray<ReportStatus> = [
  'pending',
  'reviewed',
  'dismissed',
];

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  description: string | null;
  status: ReportStatus;
  created_at: string;
}

interface AdminReportsResponse extends PaginatedResponse<AdminReport> {
  counts: { pending: number; reviewed: number; dismissed: number };
}

export async function GET(req: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as ReportStatus)
      ? (statusParam as ReportStatus)
      : null;

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get('page_size') ?? '20', 10) || 20)
  );

  const supabase = createAdminClient();

  // piktag_reports.reporter_id / reported_id have FKs to auth.users(id), not
  // to piktag_profiles — so there's no PostgREST embedded-resource path from
  // reports → profiles. We fetch the report page, then resolve usernames via
  // a single batched profile lookup (piktag_profiles.id = auth.users.id).
  let query = supabase
    .from('piktag_reports')
    .select(
      'id, reporter_id, reported_id, reason, description, status, created_at',
      { count: 'exact' }
    );

  if (status) {
    query = query.eq('status', status);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ReportRow[];

  // Gather unique profile ids (reporter + reported) and look up usernames.
  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.reporter_id, r.reported_id]))
  );

  const usernameById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesErr } = await supabase
      .from('piktag_profiles')
      .select('id, username')
      .in('id', userIds);
    if (profilesErr) {
      return NextResponse.json({ error: profilesErr.message }, { status: 500 });
    }
    for (const p of (profiles ?? []) as Array<{ id: string; username: string | null }>) {
      usernameById.set(p.id, p.username);
    }
  }

  const items: AdminReport[] = rows.map((r) => ({
    id: r.id,
    reporter_id: r.reporter_id,
    reporter_username: usernameById.get(r.reporter_id) ?? null,
    reported_id: r.reported_id,
    reported_username: usernameById.get(r.reported_id) ?? null,
    reason: r.reason,
    description: r.description,
    status: r.status,
    created_at: r.created_at,
  }));

  // Per-status counts for UI badges. Use head+count so we only pull metadata.
  const [pendingRes, reviewedRes, dismissedRes] = await Promise.all([
    supabase
      .from('piktag_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('piktag_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'reviewed'),
    supabase
      .from('piktag_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'dismissed'),
  ]);

  const body: AdminReportsResponse = {
    items,
    total: count ?? items.length,
    page,
    page_size: pageSize,
    counts: {
      pending: pendingRes.count ?? 0,
      reviewed: reviewedRes.count ?? 0,
      dismissed: dismissedRes.count ?? 0,
    },
  };
  return NextResponse.json(body);
}
