/**
 * GET /api/admin/analytics
 *
 * Aggregate dashboard metrics for the admin panel. Read-only and
 * intentionally not audit-logged — it's called on every dashboard
 * load and the noise would drown out real admin actions.
 *
 * All queries run in parallel via Promise.all. If any single query
 * fails we swallow the error, log to console.error and return a
 * zero/empty fallback for that metric so the dashboard stays usable.
 *
 * Response: AdminAnalytics
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/require-admin';
import type { AdminAnalytics } from '@/lib/admin-types';

type CountResult = { count: number | null; error: { message: string } | null };
type RowsResult<T> = { data: T[] | null; error: { message: string } | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function countOrZero(res: CountResult, label: string): number {
  if (res.error) {
    console.error(`[admin/analytics] ${label} count failed:`, res.error.message);
    return 0;
  }
  return res.count ?? 0;
}

function rowsOrEmpty<T>(res: RowsResult<T>, label: string): T[] {
  if (res.error) {
    console.error(`[admin/analytics] ${label} query failed:`, res.error.message);
    return [];
  }
  return res.data ?? [];
}

/**
 * Bucket ISO-timestamp rows by YYYY-MM-DD and fill in zeros for days
 * with no signups so the chart has exactly 30 contiguous entries.
 */
function bucketSignupsByDay(
  rows: Array<{ created_at: string }>,
  days: number,
  now: Date,
): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = new Date(row.created_at).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Walk backwards from today, oldest-first in the result.
  const out: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export async function GET(): Promise<Response> {
  const gate = await requireAdmin();
  if (gate instanceof Response) return gate;

  const supabase = createAdminClient();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const [
    totalUsersRes,
    totalConnectionsRes,
    totalTagsCreatedRes,
    pendingReportsRes,
    signupsRawRes,
    activeUsersRawRes,
    qrScans7dRes,
    topTagsRes,
  ] = await Promise.all([
    supabase
      .from('piktag_profiles')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('piktag_connections')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('piktag_user_tags')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('piktag_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('piktag_profiles')
      .select('created_at')
      .gte('created_at', thirtyDaysAgo),
    // No distinct-count RPC exists; pull the user_id column for the last
    // 7 days and dedup client-side via a Set. The BRIN index on
    // created_at keeps this bounded, and 7 days of usage rows is small.
    supabase
      .from('piktag_api_usage_log')
      .select('user_id')
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('piktag_scan_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('piktag_tags')
      .select('name, usage_count')
      .order('usage_count', { ascending: false })
      .limit(20),
  ]);

  const totalUsers = countOrZero(totalUsersRes as CountResult, 'total_users');
  const totalConnections = countOrZero(
    totalConnectionsRes as CountResult,
    'total_connections',
  );
  const totalTagsCreated = countOrZero(
    totalTagsCreatedRes as CountResult,
    'total_tags_created',
  );
  const pendingReports = countOrZero(
    pendingReportsRes as CountResult,
    'pending_reports',
  );
  const qrScans7d = countOrZero(qrScans7dRes as CountResult, 'qr_scans_last_7d');

  const signupsRows = rowsOrEmpty<{ created_at: string }>(
    signupsRawRes as RowsResult<{ created_at: string }>,
    'signups_last_30d',
  );
  const activeUserRows = rowsOrEmpty<{ user_id: string | null }>(
    activeUsersRawRes as RowsResult<{ user_id: string | null }>,
    'active_users_last_7d',
  );
  const topTagsRows = rowsOrEmpty<{ name: string; usage_count: number | null }>(
    topTagsRes as RowsResult<{ name: string; usage_count: number | null }>,
    'top_tags',
  );

  const signupsLast30d = bucketSignupsByDay(signupsRows, 30, now);

  const distinctActiveUserIds = new Set<string>();
  for (const row of activeUserRows) {
    if (row.user_id) distinctActiveUserIds.add(row.user_id);
  }
  const activeUsersLast7d = distinctActiveUserIds.size;

  const topTags = topTagsRows.map((t) => ({
    name: t.name,
    usage_count: t.usage_count ?? 0,
  }));

  const body: AdminAnalytics = {
    total_users: totalUsers,
    total_active_users: activeUsersLast7d,
    total_connections: totalConnections,
    total_tags_created: totalTagsCreated,
    pending_reports: pendingReports,
    signups_last_30d: signupsLast30d,
    active_users_last_7d: activeUsersLast7d,
    qr_scans_last_7d: qrScans7d,
    top_tags: topTags,
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
}
