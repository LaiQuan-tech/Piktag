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

type ScalarResult = { data: number | null; error: { message: string } | null };

function scalarOrZero(res: ScalarResult, label: string): number {
  if (res.error) {
    console.error(`[admin/analytics] ${label} rpc failed:`, res.error.message);
    return 0;
  }
  return typeof res.data === 'number' ? res.data : 0;
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

  // Closed-test tester accounts are excluded from the "real data" the
  // founder reviews. Profile-count queries filter inline via
  // .eq('is_test_account', false); the cross-table counts below key on a
  // user/host id, so pull the tester id list once up front. Fetching it
  // here (not inside Promise.all) also keeps the active-user dedup in sync
  // with the dashboard, which strips the same set — the two pages must
  // agree on 本週活躍用戶.
  const testerIdsRes = await supabase
    .from('piktag_profiles')
    .select('id')
    .eq('is_test_account', true);
  const testerIds = ((testerIdsRes.data ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  );
  const testerIdSet = new Set(testerIds);
  // An empty IN-list is invalid PostgREST syntax, so only attach the
  // not-in filter when there is at least one tester.
  const testerInList = testerIds.length > 0 ? `(${testerIds.join(',')})` : null;

  let connectionsQ = supabase
    .from('piktag_connections')
    .select('*', { count: 'exact', head: true });
  if (testerInList) connectionsQ = connectionsQ.not('user_id', 'in', testerInList);

  let tagsQ = supabase
    .from('piktag_user_tags')
    .select('*', { count: 'exact', head: true });
  if (testerInList) tagsQ = tagsQ.not('user_id', 'in', testerInList);

  let qrScansQ = supabase
    .from('piktag_scan_sessions')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo);
  if (testerInList) qrScansQ = qrScansQ.not('host_user_id', 'in', testerInList);

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
    // Magic moments = users whose first REAL connection (excluding the
    // @piktag auto-friend) landed in the 7-day window. Counted server-side
    // (admin_magic_moments_7d) so it never hits PostgREST's 1000-row cap the
    // way the old client-side set-difference did.
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
    // ── Algo health (2026-07-05): moat metrics + replay funnel ──
    conceptCoverageRes,
    crossLanguageRes,
    searchFunnelRes,
  ] = await Promise.all([
    supabase
      .from('piktag_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_test_account', false),
    connectionsQ,
    tagsQ,
    supabase
      .from('piktag_reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('piktag_profiles')
      .select('created_at')
      .eq('is_test_account', false)
      .gte('created_at', thirtyDaysAgo),
    // No distinct-count RPC exists; pull the user_id column for the last
    // 7 days and dedup client-side via a Set. The BRIN index on
    // created_at keeps this bounded, and 7 days of usage rows is small.
    supabase
      .from('piktag_api_usage_log')
      .select('user_id')
      .gte('created_at', sevenDaysAgo),
    qrScansQ,
    supabase
      .from('piktag_tags')
      .select('name, usage_count')
      .order('usage_count', { ascending: false })
      .limit(20),
    // Growth — new signups in 7d window (real users only)
    supabase
      .from('piktag_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_test_account', false)
      .gte('created_at', sevenDaysAgo),
    // Growth — magic moments (server-side count; no 1000-row cap). Users
    // whose first non-official connection landed in the window.
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
    // Algo health RPCs (migration 20260705020000; service_role-only —
    // the admin client here IS service-role). Coverage is all-time by
    // design (it's a stock, not a flow); the other two use 30d windows.
    supabase.rpc('admin_concept_coverage'),
    supabase.rpc('admin_cross_language_match_rate', { p_days: 30 }),
    supabase.rpc('admin_search_funnel', { p_days: 30 }),
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
    if (row.user_id && !testerIdSet.has(row.user_id)) {
      distinctActiveUserIds.add(row.user_id);
    }
  }
  const activeUsersLast7d = distinctActiveUserIds.size;

  const topTags = topTagsRows.map((t) => ({
    name: t.name,
    usage_count: t.usage_count ?? 0,
  }));

  // ── Growth pulse derivations ────────────────────────────────
  const newSignups7d = countOrZero(newSignups7dRes as CountResult, 'new_signups_last_7d');

  // Magic moments: users whose first non-official connection landed in the
  // 7-day window — counted server-side (admin_magic_moments_7d) so it never
  // truncates at PostgREST's 1000-row cap the way the old client-side
  // set-difference did, and excludes the @piktag auto-friend so it tracks
  // real activation rather than onboarding completion.
  const magicMoments7d = scalarOrZero(
    magicMoments7dRes as ScalarResult,
    'magic_moments_last_7d',
  );
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

  // ── Algo health (moat metrics + replay funnel) ──────────────
  // PostgREST serializes bigint/numeric as JSON numbers, but wrap in
  // Number() defensively so a string never leaks into toLocaleString.
  type CoverageRow = {
    total_tags: unknown;
    linked_tags: unknown;
    tag_coverage_pct: unknown;
    total_instances: unknown;
    linked_instances: unknown;
    instance_coverage_pct: unknown;
  };
  const coverageRow = rowsOrEmpty<CoverageRow>(
    conceptCoverageRes as RowsResult<CoverageRow>,
    'algo_concept_coverage',
  )[0];
  const algoConceptCoverage = coverageRow
    ? {
        total_tags: Number(coverageRow.total_tags ?? 0),
        linked_tags: Number(coverageRow.linked_tags ?? 0),
        tag_coverage_pct: Number(coverageRow.tag_coverage_pct ?? 0),
        total_instances: Number(coverageRow.total_instances ?? 0),
        linked_instances: Number(coverageRow.linked_instances ?? 0),
        instance_coverage_pct: Number(coverageRow.instance_coverage_pct ?? 0),
      }
    : null;

  type CrossLangRow = {
    total_clicks: unknown;
    cross_script_clicks: unknown;
    cross_rate_pct: unknown;
  };
  const crossLangRow = rowsOrEmpty<CrossLangRow>(
    crossLanguageRes as RowsResult<CrossLangRow>,
    'algo_cross_language',
  )[0];
  const algoCrossLanguage = crossLangRow
    ? {
        total_clicks: Number(crossLangRow.total_clicks ?? 0),
        cross_script_clicks: Number(crossLangRow.cross_script_clicks ?? 0),
        cross_rate_pct: Number(crossLangRow.cross_rate_pct ?? 0),
      }
    : null;

  type FunnelRow = {
    rank_position: unknown;
    impressions: unknown;
    clicks: unknown;
    ctr_pct: unknown;
  };
  const algoSearchFunnel = rowsOrEmpty<FunnelRow>(
    searchFunnelRes as RowsResult<FunnelRow>,
    'algo_search_funnel',
  ).map((r) => ({
    rank_position: Number(r.rank_position ?? 0),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    ctr_pct: Number(r.ctr_pct ?? 0),
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
    new_signups_last_7d: newSignups7d,
    magic_moments_last_7d: magicMoments7d,
    activation_rate_pct_last_7d: activationRate7d,
    search_total_last_7d: searchTotal7d,
    search_recovery_pct_last_7d: searchRecoveryPct7d,
    search_empty_pct_last_7d: searchEmptyPct7d,
    search_recovery_pct_prior_7d: searchRecoveryPctPrior7d,
    search_empty_pct_prior_7d: searchEmptyPctPrior7d,
    failed_search_keywords_last_7d: failedSearchKeywords,
    algo_concept_coverage: algoConceptCoverage,
    algo_cross_language_30d: algoCrossLanguage,
    algo_search_funnel_30d: algoSearchFunnel,
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
}
