import { MousePointerClick, Users2, Globe, UserPlus, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// Always show fresh counts in the admin area.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// admin_biolink_click_stats(p_days) — single jsonb blob (read-only RPC,
// 20260624000000). source = where the click happened:
//   friend_detail = a friend tapped your link (notifies you)
//   user_detail   = a stranger/scanned/public-profile viewer tapped it
//                   (the install-funnel signal; recorded, no notification)
//   web / null    = anonymous public web-profile hit
interface SourceRow { source: string; clicks: number }
interface PlatformRow { platform: string; clicks: number }
interface OwnerRow { user_id: string; username: string | null; full_name: string | null; clicks: number }
interface DailyRow { date: string; clicks: number }
interface BiolinkClickStats {
  window_days: number;
  total_clicks: number;
  clicks_in_window: number;
  unique_clickers: number;
  by_source: SourceRow[];
  by_platform: PlatformRow[];
  top_owners: OwnerRow[];
  daily: DailyRow[];
}

const SOURCE_LABEL: Record<string, string> = {
  friend_detail: '好友檔案',
  user_detail: '陌生／公開檔案',
  web: '網頁公開檔案',
};
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#faf5ff] text-[#8c52ff]">
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-slate-600 font-medium">{label}</span>
      </div>
      <div className="text-4xl font-bold text-[#8c52ff]">{value.toLocaleString('zh-TW')}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export default async function BiolinkClicksPage() {
  const supabase = createAdminClient();

  const statsRes = await supabase.rpc('admin_biolink_click_stats', { p_days: 30 });

  const stats: BiolinkClickStats = {
    window_days: 30,
    total_clicks: 0,
    clicks_in_window: 0,
    unique_clickers: 0,
    by_source: [],
    by_platform: [],
    top_owners: [],
    daily: [],
    ...((statsRes.data as Partial<BiolinkClickStats> | null) ?? {}),
  };

  const strangerClicks =
    stats.by_source.find((s) => s.source === 'user_detail')?.clicks ?? 0;
  const friendClicks =
    stats.by_source.find((s) => s.source === 'friend_detail')?.clicks ?? 0;
  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.clicks));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">連結點擊</h1>
        <p className="mt-1 text-sm text-slate-500">
          使用者在 App 內點擊個人檔案連結（biolink icon）的統計。{' '}
          <span className="text-slate-400">
            來源：好友檔案＝在好友頁點擊（會通知對方）；陌生／公開檔案＝掃碼或非好友頁點擊（install-funnel 訊號，不通知）。
          </span>
        </p>
      </header>

      {statsRes.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          統計 RPC 尚未就緒（migration 部署後即可顯示）：{statsRes.error.message}
        </div>
      ) : null}

      {/* Headline */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={MousePointerClick} label="總點擊數" value={stats.total_clicks} />
        <StatCard
          icon={Activity}
          label={`近 ${stats.window_days} 天點擊`}
          value={stats.clicks_in_window}
        />
        <StatCard icon={Users2} label="不同點擊者" value={stats.unique_clickers} hint="登入用戶去重" />
        <StatCard
          icon={UserPlus}
          label="陌生／公開檔案點擊"
          value={strangerClicks}
          hint="install-funnel：非好友看你的檔案、點你的連結"
        />
      </section>

      {/* By source — the friend-vs-stranger split (the key North-Star cut) */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">點擊來源</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard icon={Users2} label="好友檔案" value={friendClicks} />
          <StatCard icon={UserPlus} label="陌生／公開檔案" value={strangerClicks} />
          {stats.by_source
            .filter((s) => s.source !== 'friend_detail' && s.source !== 'user_detail')
            .map((s) => (
              <StatCard key={s.source} icon={Globe} label={sourceLabel(s.source)} value={s.clicks} />
            ))}
        </div>
      </section>

      {/* By platform */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">各平台點擊</h2>
          <p className="text-xs text-slate-500 mt-0.5">哪個連結平台最常被點</p>
        </div>
        {stats.by_platform.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無點擊</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-16">排名</th>
                  <th className="px-4 py-3">平台</th>
                  <th className="px-4 py-3">點擊數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.by_platform.map((p, idx) => (
                  <tr key={p.platform} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono">{idx + 1}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">{p.platform}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-[#faf5ff] px-2.5 py-0.5 text-xs font-semibold text-[#8c52ff]">
                        {p.clicks.toLocaleString('zh-TW')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Top owners — whose links get clicked most */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">連結最常被點的使用者 Top 25</h2>
          <p className="text-xs text-slate-500 mt-0.5">不含官方帳號</p>
        </div>
        {stats.top_owners.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無點擊</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-16">排名</th>
                  <th className="px-4 py-3">使用者</th>
                  <th className="px-4 py-3">被點次數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.top_owners.map((o, idx) => (
                  <tr key={o.user_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono">{idx + 1}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-slate-900">
                        {o.username ? `@${o.username}` : o.full_name || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-[#faf5ff] px-2.5 py-0.5 text-xs font-semibold text-[#8c52ff]">
                        {o.clicks.toLocaleString('zh-TW')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Daily trend — last window_days */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">近 {stats.window_days} 天每日點擊</h2>
        </div>
        {stats.daily.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無點擊</div>
        ) : (
          <div className="px-6 py-4 space-y-1.5">
            {stats.daily.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-500">{d.date}</span>
                <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#8c52ff]"
                    style={{ width: `${Math.round((d.clicks / maxDaily) * 100)}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-semibold text-slate-700">{d.clicks}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Coverage note — be honest about what is / isn't captured */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        涵蓋範圍：App 內好友檔案 + 陌生／公開檔案（掃碼）的連結點擊。網頁公開檔案（pikt.ag/使用者）的點擊目前走另一條（landing 的 web 分析），尚未併入此表。
      </div>
    </div>
  );
}
