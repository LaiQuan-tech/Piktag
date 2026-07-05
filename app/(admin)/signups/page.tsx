import Link from 'next/link';
import { UserPlus, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';
import SignupRowAction from '@/components/admin/SignupRowAction';
import TestAccountAction from '@/components/admin/TestAccountAction';

// Signup review panel. admin_recent_signups(p_days, p_limit) — one row
// per signup with the real/bot signals (20260703080000). The email alert
// throttles during a wave, so THIS is the founder's complete signup view.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SignupRow {
  user_id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  created_at: string;
  is_active: boolean;
  is_test_account: boolean;
  onboarding_completed: boolean;
  has_bio: boolean;
  tag_count: number;
  real_friends: number;
  same_hour_count: number;
  suspicious: boolean;
}

const WINDOW_DAYS = 7;

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'warn';
}) {
  const color = tone === 'warn' ? 'text-amber-600' : 'text-[#8c52ff]';
  const bg = tone === 'warn' ? 'bg-amber-50 text-amber-600' : 'bg-[#faf5ff] text-[#8c52ff]';
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-slate-600 font-medium">{label}</span>
      </div>
      <div className={`text-4xl font-bold ${color}`}>{value.toLocaleString('zh-TW')}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

function emailDomain(email: string | null): string {
  if (!email) return '—';
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

export default async function SignupsPage() {
  const supabase = createAdminClient();
  const res = await supabase.rpc('admin_recent_signups', { p_days: WINDOW_DAYS, p_limit: 200 });
  const rows = ((res.data as SignupRow[] | null) ?? []);

  const suspicious = rows.filter((r) => r.suspicious).length;
  const completed = rows.filter((r) => r.onboarding_completed).length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">註冊審查</h1>
        <p className="mt-1 text-sm text-slate-500">
          近 {WINDOW_DAYS} 天的註冊（不含官方帳號）。新註冊 email 通知在爆量時會改成彙總信，所以這頁才是完整名單。可疑列已標黃——同小時爆量、test/bot 型 email、或超過兩小時仍空白（無 bio 無標籤未完成精靈）。
        </p>
      </header>

      {res.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          RPC 尚未就緒（migration 部署後即可顯示）：{res.error.message}
        </div>
      ) : null}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={UserPlus} label={`近 ${WINDOW_DAYS} 天註冊`} value={rows.length} />
        <StatCard icon={AlertTriangle} label="可疑" value={suspicious} tone="warn" hint="爆量／test email／空白帳號" />
        <StatCard icon={CheckCircle2} label="完成精靈" value={completed} />
        <StatCard icon={Users} label="有交到真人朋友" value={rows.filter((r) => r.real_friends > 0).length} hint="不含官方帳號" />
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">註冊名單</h2>
          <p className="text-xs text-slate-500 mt-0.5">最新在上。點使用者看完整資料；可疑的可直接停用。</p>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">近 {WINDOW_DAYS} 天沒有註冊</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">使用者</th>
                  <th className="px-4 py-3">Email 網域</th>
                  <th className="px-4 py-3">註冊時間</th>
                  <th className="px-4 py-3">同小時</th>
                  <th className="px-4 py-3">精靈/標籤/朋友</th>
                  <th className="px-4 py-3 w-28">動作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.user_id}
                    className={
                      'transition-colors ' +
                      (r.suspicious ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50/60') +
                      (r.is_active ? '' : ' opacity-50')
                    }
                  >
                    <td className="px-4 py-3">
                      <Link href={`/users/${r.user_id}`} className="group">
                        <div className="font-medium text-slate-900 group-hover:text-[#8c52ff] group-hover:underline">
                          {r.username ? `@${r.username}` : r.full_name || r.user_id.slice(0, 8)}
                          {r.is_test_account ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                              測試
                            </span>
                          ) : null}
                          {r.suspicious ? (
                            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              可疑
                            </span>
                          ) : null}
                          {r.is_active ? null : (
                            <span className="ml-2 inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                              已停用
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{r.email ?? '—'}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-500">{emailDomain(r.email)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{fmt(r.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ' +
                          (r.same_hour_count >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')
                        }
                      >
                        {r.same_hour_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {r.onboarding_completed ? '完成' : '未完成'} · {r.tag_count} 標籤 · {r.real_friends} 朋友
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1.5">
                        <SignupRowAction userId={r.user_id} isActive={r.is_active} />
                        <TestAccountAction userId={r.user_id} isTestAccount={r.is_test_account} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
