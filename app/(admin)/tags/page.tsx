import { Tags, Sparkles, Hash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase-admin';

// Always show fresh counts in the admin area.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface TagRow {
  id: string;
  name: string;
  usage_count: number | null;
  semantic_type: string | null;
  created_at: string;
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 個月前`;
  const years = Math.floor(months / 12);
  return `${years} 年前`;
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
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
      </div>
    </div>
  );
}

export default async function AdminTagsPage() {
  const supabase = createAdminClient();

  // 1. 總標籤數
  const totalTagsRes = await supabase
    .from('piktag_tags')
    .select('id', { count: 'exact', head: true });

  // 2. 語意概念數
  const totalConceptsRes = await supabase
    .from('tag_concepts')
    .select('id', { count: 'exact', head: true });

  // 3. 別名數
  const totalAliasesRes = await supabase
    .from('tag_aliases')
    .select('alias', { count: 'exact', head: true });

  // 4. Top 50 tags by usage_count
  const topTagsRes = await supabase
    .from('piktag_tags')
    .select('id, name, usage_count, semantic_type, created_at')
    .order('usage_count', { ascending: false })
    .limit(50);

  const totalTags = totalTagsRes.count ?? 0;
  const totalConcepts = totalConceptsRes.count ?? 0;
  const totalAliases = totalAliasesRes.count ?? 0;
  const topTags: TagRow[] = (topTagsRes.data ?? []) as TagRow[];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">標籤管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          MVP 只顯示統計，合併/編輯功能在 Phase 2
        </p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Tags} label="總標籤數" value={totalTags} />
        <StatCard icon={Sparkles} label="語意概念數" value={totalConcepts} />
        <StatCard icon={Hash} label="別名數" value={totalAliases} />
      </section>

      {/* Top 50 tags table */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">熱門標籤 Top 50</h2>
          <p className="text-xs text-slate-500 mt-0.5">依使用次數排序</p>
        </div>
        {topTags.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">尚無標籤</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-16">排名</th>
                  <th className="px-4 py-3">標籤名稱</th>
                  <th className="px-4 py-3">使用次數</th>
                  <th className="px-4 py-3">語意類型</th>
                  <th className="px-4 py-3">建立時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topTags.map((tag, idx) => (
                  <tr key={tag.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-slate-900">{tag.name}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full bg-[#faf5ff] px-2.5 py-0.5 text-xs font-semibold text-[#8c52ff]">
                        {(tag.usage_count ?? 0).toLocaleString('zh-TW')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {tag.semantic_type ? (
                        <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {tag.semantic_type}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {formatRelative(tag.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Phase 2 note */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        💡 未來功能：合併重複語意概念、標籤審核、垃圾標籤封鎖 — 見 Phase 2 計畫
      </div>
    </div>
  );
}
