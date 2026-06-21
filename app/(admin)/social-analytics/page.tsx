'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  MousePointerClick,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  SocialContentPillar,
  SocialPlatform,
  SocialPostsResponse,
} from '@/lib/admin-types';

const PLATFORM_LABELS: Record<SocialPlatform | 'all', string> = {
  all: '全部',
  threads: 'Threads',
  instagram: 'Instagram',
};

const PILLAR_LABELS: Record<SocialContentPillar, string> = {
  ai_building: 'AI 開發日記',
  product_thinking: '產品思考',
  founder_story: '創辦人故事',
  tutorial: 'AI 教學',
  launch_update: '產品更新',
  community_question: '互動提問',
  other: '其他',
};

const EMPTY_METRICS = {
  impressions: '0',
  reach: '0',
  views: '0',
  likes: '0',
  comments: '0',
  replies: '0',
  shares: '0',
  reposts: '0',
  saves: '0',
  profile_visits: '0',
  follows: '0',
  link_clicks: '0',
};

type MetricFormState = typeof EMPTY_METRICS;

type NewPostForm = {
  platform: SocialPlatform;
  post_url: string;
  content: string;
  content_pillar: SocialContentPillar;
  campaign: string;
  hook: string;
  cta: string;
};

function formatNumber(value: number | undefined | null) {
  return (value ?? 0).toLocaleString('zh-TW');
}

function formatDate(value: string | null) {
  if (!value) return '未發布';
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function parseMetrics(form: MetricFormState) {
  return Object.fromEntries(
    Object.entries(form).map(([key, value]) => [
      key,
      Math.max(0, Math.floor(Number(value) || 0)),
    ]),
  );
}

function MetricPill({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{formatNumber(value)}</div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#faf5ff] text-[#8c52ff]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-sm font-medium text-slate-600">{label}</div>
      </div>
      <div className="text-3xl font-bold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

export default function SocialAnalyticsPage() {
  const [data, setData] = useState<SocialPostsResponse | null>(null);
  const [platform, setPlatform] = useState<SocialPlatform | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [metricForm, setMetricForm] = useState<MetricFormState>(EMPTY_METRICS);
  const [newPost, setNewPost] = useState<NewPostForm>({
    platform: 'threads',
    post_url: '',
    content: '',
    content_pillar: 'ai_building',
    campaign: 'launch_series',
    hook: '',
    cta: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = platform === 'all' ? '' : `?platform=${platform}`;
      const res = await fetch(`/api/admin/social-posts${qs}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SocialPostsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPost = useMemo(
    () => data?.items.find((post) => post.id === selectedPostId) ?? data?.items[0] ?? null,
    [data?.items, selectedPostId],
  );

  const savePost = async () => {
    if (!newPost.content.trim()) {
      setError('請先輸入貼文內容');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/social-posts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...newPost,
          content_type: newPost.platform === 'threads' ? 'thread' : 'image',
          status: 'published',
          published_at: new Date().toISOString(),
          created_by: 'admin',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewPost({
        platform: 'threads',
        post_url: '',
        content: '',
        content_pillar: 'ai_building',
        campaign: 'launch_series',
        hook: '',
        cta: '',
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveMetrics = async () => {
    if (!selectedPost) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/social-posts/${selectedPost.id}/metrics`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parseMetrics(metricForm)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMetricForm(EMPTY_METRICS);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新 metrics 失敗');
    } finally {
      setSaving(false);
    }
  };

  const syncOfficialApi = async () => {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/admin/social-posts/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{
          platform: SocialPlatform;
          status: string;
          imported_posts: number;
          updated_posts: number;
          metric_snapshots: number;
          missing_credentials?: string[];
          errors?: string[];
        }>;
        error?: string;
      };
      if (!res.ok && !json.results) throw new Error(json.error ?? `HTTP ${res.status}`);
      const results = json.results ?? [];
      const missing = results.flatMap((item) => item.missing_credentials ?? []);
      const imported = results.reduce((sum, item) => sum + item.imported_posts, 0);
      const updated = results.reduce((sum, item) => sum + item.updated_posts, 0);
      const snapshots = results.reduce((sum, item) => sum + item.metric_snapshots, 0);
      if (missing.length) {
        setSyncMessage(`缺少官方 API env：${[...new Set(missing)].join(', ')}。已保留手動補數據模式。`);
      } else {
        setSyncMessage(`同步完成：新增 ${imported} 則、更新 ${updated} 則、寫入 ${snapshots} 筆 metrics snapshot。`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '官方 API 同步失敗');
    } finally {
      setSyncing(false);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#8c52ff]">PikTag Growth Lab</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-950">社群貼文成效</h1>
          <p className="mt-2 text-sm text-slate-500">
            追蹤 IG / Threads 每則貼文曝光、互動與轉換；API 未接上前可手動補數據。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void syncOfficialApi()}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? '同步中...' : '同步官方 API'}
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {syncMessage ? (
        <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700">
          {syncMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Send}
          label="總貼文數"
          value={formatNumber(summary?.total_posts)}
          hint="已進入後台追蹤的貼文"
        />
        <KpiCard
          icon={Eye}
          label="總曝光"
          value={formatNumber(summary?.total_impressions || summary?.total_views)}
          hint="優先 impressions，無資料時看 views"
        />
        <KpiCard
          icon={Heart}
          label="總互動"
          value={formatNumber(summary?.total_engagements)}
          hint="讚、留言、回覆、分享、收藏"
        />
        <KpiCard
          icon={TrendingUp}
          label="平均互動率"
          value={`${summary?.average_engagement_rate ?? 0}%`}
          hint="總互動 / 總曝光"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.8fr_1fr]">
        <section className="rounded-xl border border-slate-100 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">貼文列表</h2>
              <p className="text-sm text-slate-500">點一則貼文後，可在右側補最新 metrics snapshot。</p>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['all', 'threads', 'instagram'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setPlatform(item)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    platform === item ? 'bg-white text-[#8c52ff] shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {PLATFORM_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">貼文</th>
                  <th className="px-5 py-3">平台</th>
                  <th className="px-5 py-3">曝光</th>
                  <th className="px-5 py-3">互動率</th>
                  <th className="px-5 py-3">點擊</th>
                  <th className="px-5 py-3">分數</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-5 py-10 text-center text-slate-400" colSpan={6}>
                      載入中...
                    </td>
                  </tr>
                ) : data?.items.length ? (
                  data.items.map((post) => (
                    <tr
                      key={post.id}
                      onClick={() => setSelectedPostId(post.id)}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        selectedPost?.id === post.id ? 'bg-[#faf5ff]' : ''
                      }`}
                    >
                      <td className="max-w-xl px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <MessageCircle className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-medium text-slate-950 line-clamp-2">
                              {post.content_preview}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{formatDate(post.published_at)}</span>
                              <span>·</span>
                              <span>{PILLAR_LABELS[post.content_pillar]}</span>
                              {post.post_url ? (
                                <a
                                  href={post.post_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-[#8c52ff]"
                                >
                                  開啟 <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-700">
                        {PLATFORM_LABELS[post.platform]}
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {formatNumber(
                          post.latest_metrics?.impressions || post.latest_metrics?.views,
                        )}
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {post.latest_metrics?.engagement_rate ?? 0}%
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {formatNumber(post.latest_metrics?.link_clicks)}
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-[#8c52ff] px-2.5 py-1 text-xs font-semibold text-white">
                          {post.latest_metrics?.content_score ?? 0}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-5 py-10 text-center text-slate-400" colSpan={6}>
                      還沒有貼文資料。先在右側新增第一則。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#8c52ff]" />
              <h2 className="text-lg font-semibold text-slate-950">新增貼文紀錄</h2>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={newPost.platform}
                  onChange={(event) =>
                    setNewPost((prev) => ({ ...prev, platform: event.target.value as SocialPlatform }))
                  }
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="threads">Threads</option>
                  <option value="instagram">Instagram</option>
                </select>
                <select
                  value={newPost.content_pillar}
                  onChange={(event) =>
                    setNewPost((prev) => ({
                      ...prev,
                      content_pillar: event.target.value as SocialContentPillar,
                    }))
                  }
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {Object.entries(PILLAR_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={newPost.post_url}
                onChange={(event) => setNewPost((prev) => ({ ...prev, post_url: event.target.value }))}
                placeholder="貼文 URL"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <textarea
                value={newPost.content}
                onChange={(event) => setNewPost((prev) => ({ ...prev, content: event.target.value }))}
                placeholder="貼文內容"
                rows={5}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={newPost.hook}
                onChange={(event) => setNewPost((prev) => ({ ...prev, hook: event.target.value }))}
                placeholder="Hook / 開頭策略"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void savePost()}
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#8c52ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7b43ef] disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                新增紀錄
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MousePointerClick className="h-5 w-5 text-[#8c52ff]" />
              <h2 className="text-lg font-semibold text-slate-950">補最新數據</h2>
            </div>
            {selectedPost ? (
              <>
                <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <div className="font-medium text-slate-950 line-clamp-2">
                    {selectedPost.content_preview}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {PLATFORM_LABELS[selectedPost.platform]} · {formatDate(selectedPost.published_at)}
                  </div>
                </div>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  <MetricPill label="曝光" value={selectedPost.latest_metrics?.impressions} />
                  <MetricPill label="按讚" value={selectedPost.latest_metrics?.likes} />
                  <MetricPill label="點擊" value={selectedPost.latest_metrics?.link_clicks} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {Object.keys(EMPTY_METRICS).map((key) => (
                    <label key={key} className="text-xs font-medium text-slate-500">
                      {key}
                      <input
                        type="number"
                        min="0"
                        value={metricForm[key as keyof MetricFormState]}
                        onChange={(event) =>
                          setMetricForm((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => void saveMetrics()}
                  disabled={saving}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <BarChart3 className="h-4 w-4" />
                  儲存 snapshot
                </button>
              </>
            ) : (
              <div className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400">
                請先選擇或新增一則貼文
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
