'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Flag,
  Link as LinkIcon,
  QrCode,
  Sparkles,
  Search,
  Tag,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import SignupsChart from '@/components/admin/SignupsChart';
import type { AdminAnalytics } from '@/lib/admin-types';

interface StatDef {
  key: keyof Pick<
    AdminAnalytics,
    | 'total_users'
    | 'active_users_last_7d'
    | 'total_connections'
    | 'total_tags_created'
    | 'qr_scans_last_7d'
    | 'pending_reports'
  >;
  label: string;
  icon: LucideIcon;
  alert?: boolean;
}

const STAT_DEFS: StatDef[] = [
  { key: 'total_users', label: '總用戶數', icon: Users },
  { key: 'active_users_last_7d', label: '活躍用戶 7 天', icon: Activity },
  { key: 'total_connections', label: '總連接數', icon: LinkIcon },
  { key: 'total_tags_created', label: '總標籤數', icon: Tag },
  { key: 'qr_scans_last_7d', label: '7 天 QR 掃描', icon: QrCode },
  { key: 'pending_reports', label: '待處理舉報', icon: Flag, alert: true },
];

// Growth-pulse stat definitions (added 2026-05-27). Visually
// separated below the existing stats — these are the "cold-start
// vitals" that map 1:1 to the real-time admin push notifications
// (新註冊 / 魔法時刻) plus weekly digest indicators.
interface GrowthStatDef {
  key: keyof Pick<
    AdminAnalytics,
    | 'new_signups_last_7d'
    | 'magic_moments_last_7d'
    | 'activation_rate_pct_last_7d'
    | 'search_total_last_7d'
    | 'search_recovery_pct_last_7d'
    | 'search_empty_pct_last_7d'
  >;
  label: string;
  icon: LucideIcon;
  suffix?: string;
  // good = lower (alert when high). Used for search_recovery_pct /
  // search_empty_pct where lower % = healthier engine.
  inverted?: boolean;
}

const GROWTH_STAT_DEFS: GrowthStatDef[] = [
  { key: 'new_signups_last_7d', label: '本週新註冊', icon: UserPlus },
  { key: 'magic_moments_last_7d', label: '本週魔法時刻', icon: Sparkles },
  { key: 'activation_rate_pct_last_7d', label: '激活率', icon: TrendingUp, suffix: '%' },
  { key: 'search_total_last_7d', label: '本週搜尋', icon: Search },
  { key: 'search_recovery_pct_last_7d', label: 'LLM 救援率', icon: Search, suffix: '%', inverted: true },
  { key: 'search_empty_pct_last_7d', label: '空手率', icon: Search, suffix: '%', inverted: true },
];

function StatCard({
  icon: Icon,
  label,
  value,
  alert = false,
  suffix,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  alert?: boolean;
  suffix?: string;
}) {
  const valueColor = alert && value > 0 ? 'text-red-600' : 'text-[#8c52ff]';
  const iconWrap =
    alert && value > 0
      ? 'bg-red-50 text-red-600'
      : 'bg-[#faf5ff] text-[#8c52ff]';
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconWrap}`}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-slate-600 font-medium">{label}</span>
      </div>
      <div className={`text-4xl font-bold ${valueColor}`}>
        {value.toLocaleString('zh-TW')}
        {suffix ? <span className="text-2xl ml-0.5">{suffix}</span> : null}
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-slate-100" />
        <div className="h-4 w-20 bg-slate-100 rounded" />
      </div>
      <div className="h-10 w-28 bg-slate-100 rounded" />
    </div>
  );
}

function TopTagsList({ tags }: { tags: AdminAnalytics['top_tags'] }) {
  const items = tags.slice(0, 20);
  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-slate-400">
        資料累積中，請稍後再看
      </div>
    );
  }
  const max = Math.max(...items.map((t) => t.usage_count), 1);
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((tag) => {
        const pct = Math.max(4, Math.round((tag.usage_count / max) * 100));
        return (
          <li key={tag.name} className="px-6 py-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-sm font-medium text-slate-900 truncate">
                {tag.name}
              </span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {tag.usage_count.toLocaleString('zh-TW')}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#8c52ff]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FailedKeywordsList({
  keywords,
}: {
  keywords: AdminAnalytics['failed_search_keywords_last_7d'];
}) {
  const items = keywords.slice(0, 15);
  if (items.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-slate-400">
        過去 7 天沒有失敗搜尋
      </div>
    );
  }
  const max = Math.max(...items.map((k) => k.frequency), 1);
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((kw) => {
        const pct = Math.max(4, Math.round((kw.frequency / max) * 100));
        return (
          <li key={kw.keyword} className="px-6 py-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-sm font-medium text-slate-900 truncate">
                {kw.keyword}
              </span>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {kw.frequency.toLocaleString('zh-TW')} 次
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-400"
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/analytics', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as AdminAnalytics;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signupsData = data?.signups_last_30d ?? [];
  const hasSignups = signupsData.some((d) => d.count > 0);

  return (
    <div className="space-y-8">
      {/* Error bar */}
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>載入資料時發生錯誤：{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            重試
          </button>
        </div>
      ) : null}

      {/* Header */}
      <header>
        <h1 className="text-3xl font-bold text-slate-900">使用數據</h1>
        <p className="mt-1 text-sm text-slate-500">
          PikTag 內部指標（Play Console / App Store 數據將在 iOS 上線後整合）
        </p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {loading && !data
          ? STAT_DEFS.map((def) => <StatCardSkeleton key={def.key} />)
          : STAT_DEFS.map((def) => (
              <StatCard
                key={def.key}
                icon={def.icon}
                label={def.label}
                value={data ? data[def.key] : 0}
                alert={def.alert}
              />
            ))}
      </section>

      {/* Growth pulse — the cold-start vitals. Same metrics as the
          real-time admin push (新註冊 / 魔法時刻) + weekly digest
          health stats. 「成長指標」label separates this section
          visually from the all-time aggregates above. */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">
          成長指標 <span className="text-sm font-normal text-slate-500">過去 7 天</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {loading && !data
            ? GROWTH_STAT_DEFS.map((def) => <StatCardSkeleton key={def.key} />)
            : GROWTH_STAT_DEFS.map((def) => {
                const value = data ? data[def.key] : 0;
                // Inverted metrics (recovery%, empty%) read as ALERT
                // when above ~30 — that's a noticeable degradation.
                // Plain metrics (signups, magic moments) stay neutral.
                const alertOnHigh = !!def.inverted && value >= 30;
                return (
                  <StatCard
                    key={def.key}
                    icon={def.icon}
                    label={def.label + (def.suffix ? '' : '')}
                    value={value}
                    alert={alertOnHigh}
                    suffix={def.suffix}
                  />
                );
              })}
        </div>
      </section>

      {/* Signups chart */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">過去 30 天每日新用戶</h2>
          <p className="text-xs text-slate-500 mt-0.5">每日註冊人數趨勢</p>
        </div>
        <div className="p-6">
          {loading && !data ? (
            <div className="h-[300px] w-full animate-pulse rounded-lg bg-slate-50" />
          ) : !hasSignups ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-slate-400">
              資料累積中，請稍後再看
            </div>
          ) : (
            <SignupsChart data={signupsData} />
          )}
        </div>
      </section>

      {/* Two-column below */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top tags */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">熱門標籤</h2>
            <p className="text-xs text-slate-500 mt-0.5">使用次數前 20 名</p>
          </div>
          {loading && !data ? (
            <div className="px-6 py-6 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-3 w-24 bg-slate-100 rounded mb-2" />
                  <div className="h-2 w-full bg-slate-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <TopTagsList tags={data?.top_tags ?? []} />
          )}
        </div>

        {/* Phase 3 placeholder */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">
              (Phase 3) Play Console 下載數據
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">App 商店安裝與下載分析</p>
          </div>
          <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-xl bg-[#faf5ff] text-[#8c52ff] flex items-center justify-center mb-4">
              <QrCode className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-600 max-w-sm">
              將在 iOS 上線後整合 Google Play + App Store 下載數據
            </p>
          </div>
        </div>
      </section>

      {/* Search-failure keywords — the actionable "missing tag" signal that
          used to live in the weekly admin push (now retired). Each row is a
          query where the LLM recovery fired but nothing matched → a candidate
          for a new tag / alias. */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">
            搜尋失敗關鍵字{' '}
            <span className="text-sm font-normal text-slate-500">過去 7 天</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            LLM 解析後仍無結果的查詢 — 每個都是該補的 tag 候選
            {data ? (
              <span className="ml-1 text-slate-400">
                · 救援率 vs 上週 {data.search_recovery_pct_prior_7d}% →{' '}
                {data.search_recovery_pct_last_7d}% · 空手率{' '}
                {data.search_empty_pct_prior_7d}% → {data.search_empty_pct_last_7d}%
              </span>
            ) : null}
          </p>
        </div>
        {loading && !data ? (
          <div className="px-6 py-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 w-24 bg-slate-100 rounded mb-2" />
                <div className="h-2 w-full bg-slate-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : (
          <FailedKeywordsList keywords={data?.failed_search_keywords_last_7d ?? []} />
        )}
      </section>
    </div>
  );
}
