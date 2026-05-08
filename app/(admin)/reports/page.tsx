'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, X } from 'lucide-react';
import type { AdminReport, PaginatedResponse, ReportStatus } from '@/lib/admin-types';

type TabKey = ReportStatus;

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'pending', label: '待處理' },
  { key: 'reviewed', label: '已處理' },
  { key: 'dismissed', label: '已駁回' },
];

const REASON_LABELS: Record<string, string> = {
  spam: '垃圾訊息',
  harassment: '騷擾',
  inappropriate: '不當內容',
  fake: '假冒帳號',
  other: '其他',
};

function formatRelative(value: string): string {
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

function truncate(text: string, max = 100): { display: string; truncated: boolean } {
  if (text.length <= max) return { display: text, truncated: false };
  return { display: `${text.slice(0, max)}…`, truncated: true };
}

function StatusBadge({ status }: { status: ReportStatus }) {
  const styles: Record<ReportStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    reviewed: 'bg-green-100 text-green-800',
    dismissed: 'bg-slate-100 text-slate-600',
  };
  const label: Record<ReportStatus, string> = {
    pending: '待處理',
    reviewed: '已處理',
    dismissed: '已駁回',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [counts, setCounts] = useState<Record<TabKey, number | null>>({
    pending: null,
    reviewed: null,
    dismissed: null,
  });
  const [loading, setLoading] = useState(false);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(
    async (status: TabKey) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/reports?status=${encodeURIComponent(status)}&page=1&page_size=50`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          throw new Error(`載入失敗（${res.status}）`);
        }
        const data = (await res.json()) as PaginatedResponse<AdminReport>;
        setReports(data.items ?? []);
        setCounts((prev) => ({ ...prev, [status]: data.total ?? data.items?.length ?? 0 }));
      } catch (err) {
        setError(err instanceof Error ? err.message : '載入舉報列表時發生錯誤');
        setReports([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadCounts = useCallback(async () => {
    try {
      const results = await Promise.all(
        TABS.map(async (tab) => {
          const res = await fetch(
            `/api/admin/reports?status=${encodeURIComponent(tab.key)}&page=1&page_size=1`,
            { cache: 'no-store' },
          );
          if (!res.ok) return [tab.key, 0] as const;
          const data = (await res.json()) as PaginatedResponse<AdminReport>;
          return [tab.key, data.total ?? 0] as const;
        }),
      );
      setCounts((prev) => {
        const next = { ...prev };
        for (const [key, value] of results) next[key] = value;
        return next;
      });
    } catch {
      // Non-fatal — tab counts just won't render.
    }
  }, []);

  // Initial load: counts + default tab list.
  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    loadList(activeTab);
  }, [activeTab, loadList]);

  const refresh = useCallback(async () => {
    await Promise.all([loadList(activeTab), loadCounts()]);
  }, [activeTab, loadCounts, loadList]);

  const updateStatus = useCallback(
    async (id: string, status: 'reviewed' | 'dismissed') => {
      setActionPendingId(id);
      setError(null);
      try {
        const res = await fetch(`/api/admin/reports/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          throw new Error(`操作失敗（${res.status}）`);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失敗');
      } finally {
        setActionPendingId(null);
      }
    },
    [refresh],
  );

  const blockReported = useCallback(
    async (id: string) => {
      if (!window.confirm('確定封鎖被檢舉用戶？此動作會停用該帳號。')) return;
      setActionPendingId(id);
      setError(null);
      try {
        const res = await fetch(`/api/admin/reports/${id}/block`, { method: 'POST' });
        if (!res.ok) {
          throw new Error(`封鎖失敗（${res.status}）`);
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '封鎖失敗');
      } finally {
        setActionPendingId(null);
      }
    },
    [refresh],
  );

  const headerRow = useMemo(
    () => (
      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <th className="px-4 py-3">檢舉人</th>
        <th className="px-4 py-3">被檢舉人</th>
        <th className="px-4 py-3">原因</th>
        <th className="px-4 py-3">說明</th>
        <th className="px-4 py-3">狀態</th>
        <th className="px-4 py-3">時間</th>
        <th className="px-4 py-3 text-right">操作</th>
      </tr>
    ),
    [],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">舉報管理</h1>
        <p className="mt-1 text-sm text-slate-500">審查用戶舉報並採取必要行動</p>
      </header>

      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-500 hover:text-red-700"
            aria-label="關閉錯誤訊息"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          const count = counts[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`relative -mb-px px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                active
                  ? 'border-[#8c52ff] text-[#8c52ff]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
              {count !== null ? (
                <span
                  className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    active ? 'bg-[#faf5ff] text-[#8c52ff]' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">載入中…</div>
        ) : reports.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">
            此分類下沒有舉報
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">{headerRow}</thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((r) => {
                  const reporterLabel = r.reporter_username?.trim() || '未命名用戶';
                  const reportedLabel = r.reported_username?.trim() || '未命名用戶';
                  const reasonLabel = REASON_LABELS[r.reason] ?? r.reason;
                  const desc = r.description ?? '';
                  const { display: shortDesc, truncated } = truncate(desc, 100);
                  const isBusy = actionPendingId === r.id;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/users/${r.reporter_id}`}
                          className="text-[#8c52ff] hover:underline font-medium"
                        >
                          {reporterLabel}
                        </Link>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/users/${r.reported_id}`}
                          className="text-[#8c52ff] hover:underline font-medium"
                        >
                          {reportedLabel}
                        </Link>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {reasonLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-sm">
                        {desc ? (
                          <span
                            className="text-slate-700 break-words"
                            title={truncated ? desc : undefined}
                          >
                            {shortDesc}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                        {formatRelative(r.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {r.status === 'pending' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateStatus(r.id, 'reviewed')}
                              className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Check className="w-3.5 h-3.5" />
                              標記處理
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => updateStatus(r.id, 'dismissed')}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <X className="w-3.5 h-3.5" />
                              駁回
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => blockReported(r.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              封鎖被檢舉人
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
