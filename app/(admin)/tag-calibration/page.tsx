import { Sparkles, Check, X, Clock, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// AI tag-suggestion calibration (principle #5). Reads
// admin_tag_suggestion_calibration(p_days) — one jsonb blob
// (20260703070000). accepted: true=added, false=dismissed, null=shown.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SliceRow {
  source?: string;
  position?: number;
  shown: number;
  accepted: number;
  accept_rate: number;
}
interface Calibration {
  window_days: number;
  shown: number;
  accepted: number;
  dismissed: number;
  pending: number;
  accept_rate: number;
  by_source: SliceRow[];
  by_position: SliceRow[];
}

// Human labels for the logged `source` values (CHECK-constrained).
const SOURCE_LABEL: Record<string, string> = {
  push_nudge: '每 3 天標籤推播',
  bio_extract: '編輯檔案（依簡介）',
  card_scan: '名片掃描',
  suggest_tags_rpc: '活動 QR / Ask',
  connection_context: '加好友後建議',
};
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  suffix,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  suffix?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#faf5ff] text-[#8c52ff]">
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-slate-600 font-medium">{label}</span>
      </div>
      <div className="text-4xl font-bold text-[#8c52ff]">
        {value.toLocaleString('zh-TW')}
        {suffix ? <span className="text-2xl">{suffix}</span> : null}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

function RateBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden min-w-[80px]">
        <div className="h-full bg-[#8c52ff]" style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right font-semibold text-slate-700">{rate}%</span>
    </div>
  );
}

export default async function TagCalibrationPage() {
  const supabase = createAdminClient();
  const res = await supabase.rpc('admin_tag_suggestion_calibration', { p_days: 30 });

  const c: Calibration = {
    window_days: 30,
    shown: 0,
    accepted: 0,
    dismissed: 0,
    pending: 0,
    accept_rate: 0,
    by_source: [],
    by_position: [],
    ...((res.data as Partial<Calibration> | null) ?? {}),
  };

  const pushRow = c.by_source.find((s) => s.source === 'push_nudge');

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">標籤建議校準</h1>
        <p className="mt-1 text-sm text-slate-500">
          AI 推薦的標籤有多少被使用者真的加上（近 {c.window_days} 天）。接受率高＝建議準、在長標籤圖護城河；低＝該重訓或放慢推播。這批資料也直接餵未來的標籤競價 Quality Score。
        </p>
      </header>

      {res.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          校準 RPC 尚未就緒（migration 部署後即可顯示）：{res.error.message}
        </div>
      ) : null}

      {/* Headline funnel */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Sparkles} label="總接受率" value={c.accept_rate} suffix="%" hint={`${c.accepted.toLocaleString('zh-TW')} / ${c.shown.toLocaleString('zh-TW')} 被採用`} />
        <StatCard icon={Check} label="已採用" value={c.accepted} />
        <StatCard icon={X} label="被略過（明確拒絕）" value={c.dismissed} />
        <StatCard icon={Clock} label="顯示未決" value={c.pending} hint="看到但沒加也沒明確拒絕" />
      </section>

      {pushRow ? (
        <div className="rounded-lg border border-[#e9d5ff] bg-[#faf5ff] px-4 py-3 text-sm text-[#6b21a8]">
          每 3 天標籤推播的接受率：<strong>{pushRow.accept_rate}%</strong>（{pushRow.accepted} / {pushRow.shown}）。
          {pushRow.accept_rate < 15
            ? ' 偏低——考慮調整提示詞或放慢頻率。'
            : pushRow.accept_rate >= 40
              ? ' 表現好——推播確實在幫使用者長標籤。'
              : ' 中間帶——持續觀察。'}
        </div>
      ) : null}

      {/* By source */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">各來源接受率</h2>
          <p className="text-xs text-slate-500 mt-0.5">哪個介面的 AI 建議最被接受</p>
        </div>
        {c.by_source.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無資料</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">來源</th>
                  <th className="px-4 py-3 w-24">顯示</th>
                  <th className="px-4 py-3 w-24">採用</th>
                  <th className="px-4 py-3 w-64">接受率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.by_source.map((s) => (
                  <tr key={s.source} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-900">{sourceLabel(s.source ?? '')}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.shown.toLocaleString('zh-TW')}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.accepted.toLocaleString('zh-TW')}</td>
                    <td className="px-4 py-3"><RateBar rate={s.accept_rate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* By position — is the AI's ranking informative? */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#8c52ff]" /> 依排序位置的接受率
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            若第 1 個和第 10 個建議接受率差不多，代表 AI 的排序沒有資訊量——該讓模型回傳真實信心分數再重排。
          </p>
        </div>
        {c.by_position.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無資料</div>
        ) : (
          <div className="px-6 py-4 space-y-1.5">
            {c.by_position.map((p) => (
              <div key={p.position} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs text-slate-500">第 {(p.position ?? 0) + 1} 個</span>
                <div className="flex-1">
                  <RateBar rate={p.accept_rate} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs text-slate-400">{p.shown.toLocaleString('zh-TW')} 次顯示</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
