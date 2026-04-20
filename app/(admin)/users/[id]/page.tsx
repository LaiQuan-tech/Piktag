import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tag, Link2, Users } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';
import type { AdminUserDetail } from '@/lib/admin-types';
import UserActionsBar from '@/components/admin/UserActionsBar';

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return '—';
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getInitials(fullName: string | null, username: string | null): string {
  const source = fullName || username || '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.trim().slice(0, 2).toUpperCase();
}

async function loadUserDetail(id: string): Promise<AdminUserDetail | null> {
  const supabase = createAdminClient();

  const { data: profile, error: profileErr } = await supabase
    .from('piktag_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (profileErr || !profile) return null;

  // Fetch auth email + last sign-in
  let email: string | null = profile.email ?? null;
  let lastSignInAt: string | null = profile.last_sign_in_at ?? null;
  try {
    const { data: authUser } = await supabase.auth.admin.getUserById(id);
    if (authUser?.user) {
      email = authUser.user.email ?? email;
      lastSignInAt = authUser.user.last_sign_in_at ?? lastSignInAt;
    }
  } catch {
    // non-fatal
  }

  // Parallel: counts + related lists
  const [
    connectionsCount,
    tagsCount,
    biolinksCount,
    scanSessionsCount,
    reportsFiled,
    reportsReceived,
    tagsList,
    biolinksList,
    recentConnections,
    recentPoints,
  ] = await Promise.all([
    supabase.from('piktag_connections').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase.from('piktag_tags').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase.from('piktag_biolinks').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase.from('piktag_scan_sessions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase.from('piktag_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', id),
    supabase.from('piktag_reports').select('id', { count: 'exact', head: true }).eq('reported_id', id),
    supabase.from('piktag_tags').select('id, name, is_pinned').eq('user_id', id).order('is_pinned', { ascending: false }).limit(50),
    supabase.from('piktag_biolinks').select('id, platform, url, label, visibility').eq('user_id', id).limit(50),
    supabase.from('piktag_connections').select('id, connected_user_id, nickname, met_at, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('piktag_points_ledger').select('id, delta, balance_after, reason, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(10),
  ]);

  const detail: AdminUserDetail = {
    id: profile.id,
    username: profile.username ?? null,
    full_name: profile.full_name ?? null,
    avatar_url: profile.avatar_url ?? null,
    bio: profile.bio ?? null,
    headline: profile.headline ?? null,
    phone: profile.phone ?? null,
    email,
    is_verified: !!profile.is_verified,
    is_active: profile.is_active ?? true,
    is_public: !!profile.is_public,
    language: profile.language ?? null,
    p_points: profile.p_points ?? 0,
    location: profile.location ?? null,
    created_at: profile.created_at,
    updated_at: profile.updated_at ?? null,
    last_sign_in_at: lastSignInAt,
    connections_count: connectionsCount.count ?? 0,
    tags_count: tagsCount.count ?? 0,
    biolinks_count: biolinksCount.count ?? 0,
    scan_sessions_count: scanSessionsCount.count ?? 0,
    reports_filed: reportsFiled.count ?? 0,
    reports_received: reportsReceived.count ?? 0,
    tags: (tagsList.data ?? []) as AdminUserDetail['tags'],
    biolinks: (biolinksList.data ?? []) as AdminUserDetail['biolinks'],
    recent_connections: (recentConnections.data ?? []) as AdminUserDetail['recent_connections'],
    recent_points: (recentPoints.data ?? []) as AdminUserDetail['recent_points'],
  };

  return detail;
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await loadUserDetail(id);

  if (!user) {
    notFound();
  }

  const displayUsername = user.username ?? user.id.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-slate-500">
        <Link href="/users" className="hover:text-slate-900 hover:underline">
          用戶
        </Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">@{displayUsername}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-5 min-w-0">
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt={user.username ?? ''}
                className="w-24 h-24 rounded-full object-cover bg-slate-100 flex-shrink-0"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center text-2xl font-semibold text-slate-600 flex-shrink-0">
                {getInitials(user.full_name, user.username)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold text-slate-900 truncate">
                  {user.full_name ?? '(未設定)'}
                </h1>
                {user.is_verified && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                    已驗證
                  </span>
                )}
                {user.is_active ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ACTIVE
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                    DEACTIVATED
                  </span>
                )}
              </div>
              <p className="text-slate-500 mt-1">@{displayUsername}</p>
              {user.headline && (
                <p className="text-sm text-slate-700 mt-2">{user.headline}</p>
              )}
            </div>
          </div>
          <UserActionsBar
            userId={user.id}
            username={displayUsername}
            isActive={user.is_active}
          />
        </div>
      </div>

      {/* Info grid */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">基本資料</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <InfoRow label="Email" value={user.email ?? '—'} />
          <InfoRow label="Phone" value={user.phone ?? '—'} />
          <InfoRow label="Language" value={user.language ?? '—'} />
          <InfoRow label="Location" value={user.location ?? '—'} />
          <InfoRow label="Bio" value={user.bio ?? '—'} wide />
          <InfoRow label="Headline" value={user.headline ?? '—'} wide />
          <InfoRow label="註冊時間" value={formatDateTime(user.created_at)} />
          <InfoRow label="最後登入時間" value={formatDateTime(user.last_sign_in_at)} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="連接數" value={user.connections_count} />
        <StatCard label="標籤數" value={user.tags_count} />
        <StatCard label="Biolinks" value={user.biolinks_count} />
        <StatCard label="掃描次數" value={user.scan_sessions_count} />
        <StatCard label="被舉報數" value={user.reports_received} />
      </div>

      {/* Tabs (stacked sections) */}
      <Section title="標籤" icon={<Tag className="w-4 h-4" />}>
        {user.tags.length === 0 ? (
          <EmptyRow>尚無標籤</EmptyRow>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.tags.map((t) => (
              <span
                key={t.id}
                className={
                  'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ' +
                  (t.is_pinned
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-slate-50 border-slate-200 text-slate-700')
                }
              >
                {t.is_pinned && <span className="mr-1">📌</span>}
                {t.name}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section title="社群連結" icon={<Link2 className="w-4 h-4" />}>
        {user.biolinks.length === 0 ? (
          <EmptyRow>尚無社群連結</EmptyRow>
        ) : (
          <ul className="divide-y divide-slate-100">
            {user.biolinks.map((b) => (
              <li key={b.id} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {b.label || b.platform}
                    <span className="ml-2 text-xs text-slate-500">{b.platform}</span>
                  </div>
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#aa00ff] hover:underline break-all"
                  >
                    {b.url}
                  </a>
                </div>
                <span className="text-xs text-slate-400">{b.visibility}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="最近連接" icon={<Users className="w-4 h-4" />}>
        {user.recent_connections.length === 0 ? (
          <EmptyRow>尚無連接紀錄</EmptyRow>
        ) : (
          <ul className="divide-y divide-slate-100">
            {user.recent_connections.map((c) => (
              <li key={c.id} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-slate-900 truncate">
                    {c.nickname || c.connected_user_id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.met_at ? `相遇於 ${c.met_at}` : '—'}
                  </div>
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {relativeTime(c.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Points 紀錄">
        {user.recent_points.length === 0 ? (
          <EmptyRow>尚無 Points 紀錄</EmptyRow>
        ) : (
          <ul className="divide-y divide-slate-100">
            {user.recent_points.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-slate-900">{p.reason}</div>
                  <div className="text-xs text-slate-500">
                    {relativeTime(p.created_at)} · 餘額 {p.balance_after}
                  </div>
                </div>
                <span
                  className={
                    'text-sm font-semibold tabular-nums ' +
                    (p.delta >= 0 ? 'text-emerald-600' : 'text-rose-600')
                  }
                >
                  {p.delta >= 0 ? '+' : ''}
                  {p.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function InfoRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900 break-words">{value}</dd>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 py-2">{children}</p>;
}
