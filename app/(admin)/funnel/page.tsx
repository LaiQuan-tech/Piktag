import { UserPlus, ClipboardCheck, Tag, Users2, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// Cohort activation funnel — admin_activation_funnel(p_days), one jsonb
// (20260703090000). Of the users who signed up in the window, how far
// they progressed down the North-Star path. MACRO funnel (no channel
// split — signup source isn't captured yet).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SourceRow {
  source: string;
  signed_up: number;
  activated: number;
  rate_activated: number;
}
interface Funnel {
  window_days: number;
  signed_up: number;
  onboarded: number;
  has_tag: number;
  activated: number;
  messaged: number;
  rate_onboarded: number;
  rate_has_tag: number;
  rate_activated: number;
  rate_messaged: number;
  by_source: SourceRow[];
}

const SOURCE_LABEL: Record<string, string> = {
  qr: '互掃 QR',
  web_profile: 'pikt.ag 網頁檔案',
  app_store: 'App Store 直接下載',
  play_store: 'Play 商店直接下載',
  unknown: '未歸因（舊資料）',
};
function sourceLabel(s: string): string {
  if (s.startsWith('utm:')) return `社群：${s.slice(4)}`;
  return SOURCE_LABEL[s] ?? s;
}

const WINDOW_DAYS = 30;

export default async function FunnelPage() {
  const supabase = createAdminClient();
  const res = await supabase.rpc('admin_activation_funnel', { p_days: WINDOW_DAYS });

  const f: Funnel = {
    window_days: WINDOW_DAYS,
    signed_up: 0,
    onboarded: 0,
    has_tag: 0,
    activated: 0,
    messaged: 0,
    rate_onboarded: 0,
    rate_has_tag: 0,
    rate_activated: 0,
    rate_messaged: 0,
    by_source: [],
    ...((res.data as Partial<Funnel> | null) ?? {}),
  };
  const bySource = f.by_source ?? [];

  // Each stage as a % of the signup cohort, plus the step-over-step drop.
  const stages: Array<{
    icon: LucideIcon;
    label: string;
    count: number;
    pctOfCohort: number;
    note: string;
  }> = [
    { icon: UserPlus, label: '註冊', count: f.signed_up, pctOfCohort: 100, note: `近 ${f.window_days} 天` },
    { icon: ClipboardCheck, label: '完成精靈', count: f.onboarded, pctOfCohort: f.rate_onboarded, note: '走完三步註冊精靈' },
    { icon: Tag, label: '有標籤', count: f.has_tag, pctOfCohort: f.rate_has_tag, note: '至少加了一個標籤（自我描述）' },
    { icon: Users2, label: '交到真人朋友', count: f.activated, pctOfCohort: f.rate_activated, note: '北極星：加到一個非官方好友' },
    { icon: MessageCircle, label: '發過訊息', count: f.messaged, pctOfCohort: f.rate_messaged, note: '進入聊天／再聯絡迴圈' },
  ];

  const prevCounts = [f.signed_up, f.onboarded, f.has_tag, f.activated, f.messaged];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">註冊轉換漏斗</h1>
        <p className="mt-1 text-sm text-slate-500">
          近 {f.window_days} 天註冊的人，有多少一路走到「交到真人朋友」（北極星）。看哪一階漏得最兇，就知道要修哪裡。
          <span className="text-slate-400">（此為總體漏斗；「哪個社群管道」的分解需要先埋註冊來源——見下方說明。）</span>
        </p>
      </header>

      {res.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          RPC 尚未就緒（migration 部署後即可顯示）：{res.error.message}
        </div>
      ) : null}

      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-6 space-y-5">
          {stages.map((s, i) => {
            const stepDrop =
              i > 0 && prevCounts[i - 1] > 0
                ? Math.round((100 * (prevCounts[i - 1] - s.count)) / prevCounts[i - 1])
                : 0;
            return (
              <div key={s.label}>
                <div className="flex items-center gap-3 mb-1.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#faf5ff] text-[#8c52ff] shrink-0">
                    <s.icon className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{s.label}</span>
                  <span className="text-xs text-slate-400">{s.note}</span>
                  <span className="ml-auto text-sm font-bold text-[#8c52ff]">
                    {s.count.toLocaleString('zh-TW')}
                    <span className="ml-1 text-xs font-medium text-slate-400">（{s.pctOfCohort}%）</span>
                  </span>
                </div>
                <div className="h-7 rounded-lg bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#8c52ff] transition-all flex items-center justify-end pr-2"
                    style={{ width: `${Math.max(2, s.pctOfCohort)}%` }}
                  >
                    {s.pctOfCohort >= 12 ? (
                      <span className="text-xs font-semibold text-white">{s.pctOfCohort}%</span>
                    ) : null}
                  </div>
                </div>
                {i > 0 && stepDrop > 0 ? (
                  <div className="mt-1 text-xs text-slate-400">
                    上一階流失 <span className="font-semibold text-rose-500">{stepDrop}%</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* By acquisition source — populates once the next build starts
          writing signup_source; pre-attribution rows show as 未歸因. */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">各來源轉換</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            哪個管道帶最多人、活化率多好。社群貼文的 pikt.ag 連結帶上
            <code className="mx-1 px-1 rounded bg-slate-100 text-[11px]">?utm_source=instagram</code>
            就會歸到「社群：instagram」。
          </p>
        </div>
        {bySource.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無資料</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">來源</th>
                  <th className="px-4 py-3 w-24">註冊</th>
                  <th className="px-4 py-3 w-24">活化</th>
                  <th className="px-4 py-3 w-28">活化率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bySource.map((s) => (
                  <tr key={s.source} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">{sourceLabel(s.source)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.signed_up.toLocaleString('zh-TW')}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.activated.toLocaleString('zh-TW')}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-[#faf5ff] px-2.5 py-0.5 text-xs font-semibold text-[#8c52ff]">
                        {s.rate_activated}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        「各來源轉換」從下一個 build 開始累積：App 會在註冊時記錄來源（互掃 QR／pikt.ag 網頁檔案／商店直接下載／社群 UTM）。現有的舊帳號無來源、歸在「未歸因」。要拆到「哪個社群管道」，在你分享的 pikt.ag 連結後面加 <code className="px-1 rounded bg-slate-100 text-[11px]">?utm_source=instagram&amp;utm_campaign=ep01</code> 即可。
      </div>
    </div>
  );
}
