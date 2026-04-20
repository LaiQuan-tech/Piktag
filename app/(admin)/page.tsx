import Link from 'next/link';
import { Activity, Flag, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// Admin dashboard should always reflect fresh data.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RecentSignup {
  id: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
}

interface RecentAuditEntry {
  id: string;
  admin_email: string;
  action: string;
  created_at: string;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  alert = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  trend?: string;
  alert?: boolean;
}) {
  const valueColor = alert && value > 0 ? 'text-red-600' : 'text-[#aa00ff]';
  const iconWrap = alert && value > 0
    ? 'bg-red-50 text-red-600'
    : 'bg-[#faf5ff] text-[#aa00ff]';
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconWrap}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-slate-600 font-medium">{label}</span>
      </div>
      <div className={`text-4xl font-bold ${valueColor}`}>{value.toLocaleString('zh-TW')}</div>
      {trend ? <p className="mt-2 text-xs text-slate-500">{trend}</p> : null}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const supabase = createAdminClient();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const todayLabel = now.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  // 1. 總用戶數
  const totalUsersRes = await supabase
    .from('piktag_profiles')
    .select('id', { count: 'exact', head: true });

  // 2. 本週活躍用戶 (distinct user_id from api usage log, last 7d)
  const activeUsersRes = await supabase
    .from('piktag_api_usage_log')
    .select('user_id')
    .gte('timestamp', sevenDaysAgo);

  // 3. 本週新增註冊
  const newUsersRes = await supabase
    .from('piktag_profiles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sevenDaysAgo);

  // 4. 待處理舉報
  const pendingReportsRes = await supabase
    .from('piktag_reports')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  // 5. 最近註冊用戶 (last 10)
  const recentSignupsRes = await supabase
    .from('piktag_profiles')
    .select('id, username, avatar_url, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  // 6. 最近操作紀錄 (last 10)
  const recentAuditRes = await supabase
    .from('admin_audit_log')
    .select('id, admin_email, action, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const totalUsers = totalUsersRes.count ?? 0;
  const newUsersThisWeek = newUsersRes.count ?? 0;
  const pendingReports = pendingReportsRes.count ?? 0;

  const activeUsersThisWeek = activeUsersRes.data
    ? new Set(
        activeUsersRes.data
          .map((row: { user_id: string | null }) => row.user_id)
          .filter((id): id is string => !!id),
      ).size
    : 0;

  const recentSignups: RecentSignup[] = (recentSignupsRes.data ?? []) as RecentSignup[];
  const recentAudit: RecentAuditEntry[] = (recentAuditRes.data ?? []) as RecentAuditEntry[];

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold text-slate-900">儀表板</h1>
        <p className="mt-1 text-sm text-slate-500">今天是 {todayLabel}</p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="總用戶數" value={totalUsers} />
        <StatCard
          icon={Activity}
          label="本週活躍用戶"
          value={activeUsersThisWeek}
          trend="過去 7 天有 API 活動"
        />
        <StatCard
          icon={UserPlus}
          label="本週新增"
          value={newUsersThisWeek}
          trend="過去 7 天註冊"
        />
        <StatCard
          icon={Flag}
          label="待處理舉報"
          value={pendingReports}
          alert
        />
      </section>

      {/* Two-column lists */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent signups */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">最近註冊用戶</h2>
            <p className="text-xs text-slate-500 mt-0.5">最近 10 位新成員</p>
          </div>
          {recentSignups.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-400">尚無紀錄</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentSignups.map((u) => {
                const display = u.username?.trim() || '未命名用戶';
                const initial = display.charAt(0).toUpperCase();
                return (
                  <li key={u.id}>
                    <Link
                      href={`/users/${u.id}`}
                      className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors"
                    >
                      {u.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatar_url}
                          alt={display}
                          className="w-9 h-9 rounded-full object-cover bg-slate-100"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#faf5ff] text-[#aa00ff] flex items-center justify-center text-sm font-semibold">
                          {initial}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{display}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(u.created_at)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent admin audit log */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">最近操作紀錄</h2>
            <p className="text-xs text-slate-500 mt-0.5">管理員後台操作</p>
          </div>
          {recentAudit.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-400">尚無紀錄</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentAudit.map((entry) => (
                <li key={entry.id} className="px-6 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {entry.admin_email}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5 truncate">{entry.action}</p>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      {formatDateTime(entry.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
