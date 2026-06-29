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
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS).toISOString();
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
    // ── Growth pulse queries (2026-05-27) ─────────────────────
    newSignups7dRes,
    // Magic moments = in-window signups who made a real friend, i.e. the
    // activation funnel "of users who signed up in the last 7 days, how many
    // connected to a real person?". Computed in Postgres via
    // admin_magic_moments_7d (the @piktag auto-friend is excluded as a
    // counterpart). The old approach pulled every pre-window connection row
    // into Node to diff Sets, which silently truncated at PostgREST's
    // 1000-row cap once the platform passed ~1000 lifetime connections
    // (→ inflated magic_moments / activation_rate).
    magicMoments7dRes,
    // Search telemetry: total + recovery-fired + all-empty in
    // window. recovery_pct = recovery/total, empty_pct = empty/total.
    searchTotal7dRes,
    searchRecovery7dRes,
    searchEmpty7dRes,
    // Prior 7-day window (days 8–14 ago) for the vs-last-week trend.
    searchTotalPrior7dRes,
    searchRecoveryPrior7dRes,
    searchEmptyPrior7dRes,
    // Recovery-fired-but-still-empty rows → aggregate top failing keywords.
    searchFailedKeywords7dRes,
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
    // Growth — new signups in 7d window
    supabase
      .from('piktag_profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),
    // Growth — magic moments. In-window signups who made a real friend,
    // computed Postgres-side (@piktag excluded as a counterpart). Replaces
    // two unbounded full-table fetches that truncated at PostgREST's
    // 1000-row cap. Returns a scalar integer.
    supabase.rpc('admin_magic_moments_7d', { p_since: sevenDaysAgo }),
    // Search telemetry health
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .eq('recovery_triggered', true)
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .eq('final_tag_count', 0)
      .eq('final_profile_count', 0)
      .eq('final_tag_user_count', 0)
      .gte('created_at', sevenDaysAgo),
    // Prior window (days 8–14): total / recovery / empty for the trend.
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo),
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .eq('recovery_triggered', true)
      .gte('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo),
    supabase
      .from('piktag_search_telemetry')
      .select('*', { count: 'exact', head: true })
      .eq('final_tag_count', 0)
      .eq('final_profile_count', 0)
      .eq('final_tag_user_count', 0)
      .gte('created_at', fourteenDaysAgo)
      .lt('created_at', sevenDaysAgo),
    // Recovery fired (Gemini extracted keywords) but still no match → the
    // actionable "missing tag" rows. Pull keywords to aggregate in JS.
    supabase
      .from('piktag_search_telemetry')
      .select('extracted_keywords')
      .eq('recovery_triggered', true)
      .eq('final_tag_count', 0)
      .eq('final_profile_count', 0)
      .eq('final_tag_user_count', 0)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(200),
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

  // ── Growth pulse derivations ────────────────────────────────
  const newSignups7d = countOrZero(newSignups7dRes as CountResult, 'new_signups_last_7d');

  // Magic moments: in-window signups who made at least one real friend,
  // computed by admin_magic_moments_7d (Postgres-side, @piktag auto-friend
  // excluded as a counterpart). The numerator is a subset of new_signups_7d,
  // so activation_rate stays within 0-100%. Returns a scalar integer.
  const magicMomentsRes = magicMoments7dRes as {
    data: number | null;
    error: { message: string } | null;
  };
  let magicMoments7d = 0;
  if (magicMomentsRes.error) {
    console.error(
      '[admin/analytics] magic_moments_last_7d rpc failed:',
      magicMomentsRes.error.message,
    );
  } else {
    magicMoments7d = magicMomentsRes.data ?? 0;
  }
  const activationRate7d =
    newSignups7d > 0 ? Math.round((magicMoments7d * 100) / newSignups7d) : 0;

  // Search health
  const searchTotal7d = countOrZero(searchTotal7dRes as CountResult, 'search_total');
  const searchRecovery7d = countOrZero(searchRecovery7dRes as CountResult, 'search_recovery');
  const searchEmpty7d = countOrZero(searchEmpty7dRes as CountResult, 'search_empty');
  const searchRecoveryPct7d =
    searchTotal7d > 0 ? Math.round((searchRecovery7d * 100) / searchTotal7d) : 0;
  const searchEmptyPct7d =
    searchTotal7d > 0 ? Math.round((searchEmpty7d * 100) / searchTotal7d) : 0;

  // Prior-window (days 8–14) recovery/empty % for the vs-last-week trend.
  const searchTotalPrior7d = countOrZero(searchTotalPrior7dRes as CountResult, 'search_total_prior');
  const searchRecoveryPrior7d = countOrZero(searchRecoveryPrior7dRes as CountResult, 'search_recovery_prior');
  const searchEmptyPrior7d = countOrZero(searchEmptyPrior7dRes as CountResult, 'search_empty_prior');
  const searchRecoveryPctPrior7d =
    searchTotalPrior7d > 0 ? Math.round((searchRecoveryPrior7d * 100) / searchTotalPrior7d) : 0;
  const searchEmptyPctPrior7d =
    searchTotalPrior7d > 0 ? Math.round((searchEmptyPrior7d * 100) / searchTotalPrior7d) : 0;

  // Top recurring keywords from recovery-fired-but-still-empty searches —
  // the actionable "missing tag" signal (same aggregation the retired
  // weekly digest used). Aggregate the extracted_keywords arrays in JS.
  const failedKwRows = rowsOrEmpty<{ extracted_keywords: string[] | null }>(
    searchFailedKeywords7dRes as RowsResult<{ extracted_keywords: string[] | null }>,
    'failed_search_keywords',
  );
  const failedKwCounts = new Map<string, number>();
  for (const row of failedKwRows) {
    for (const kw of row.extracted_keywords ?? []) {
      if (typeof kw === 'string' && kw.trim()) {
        const k = kw.trim();
        failedKwCounts.set(k, (failedKwCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const failedSearchKeywords = [...failedKwCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([keyword, frequency]) => ({ keyword, frequency }));

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
    new_signups_last_7d: newSignups7d,
    magic_moments_last_7d: magicMoments7d,
    activation_rate_pct_last_7d: activationRate7d,
    search_total_last_7d: searchTotal7d,
    search_recovery_pct_last_7d: searchRecoveryPct7d,
    search_empty_pct_last_7d: searchEmptyPct7d,
    search_recovery_pct_prior_7d: searchRecoveryPctPrior7d,
    search_empty_pct_prior_7d: searchEmptyPctPrior7d,
    failed_search_keywords_last_7d: failedSearchKeywords,
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
}
