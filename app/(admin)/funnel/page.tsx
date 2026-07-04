import { UserPlus, ClipboardCheck, Tag, Users2, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// Cohort activation funnel — admin_activation_funnel(p_days), one jsonb
// (20260703090000). Of the users who signed up in the window, how far
// they progressed down the North-Star path. MACRO funnel (no channel
// split — signup source isn't captured yet).
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    ...((res.data as Partial<Funnel> | null) ?? {}),
  };

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

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        想知道「這些轉換各自來自哪個社群管道」，目前<strong>算不出來</strong>——App 現在沒有在註冊時記錄來源。要有這個能力，得先埋「註冊來源歸因」（landing 帶 UTM ＋ App 在註冊時把來源寫進資料）。這是上線前該做的事，之後才補就永久失去這段資料。
      </div>
    </div>
  );
}
