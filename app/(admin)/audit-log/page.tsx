'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AdminAuditLogEntry, PaginatedResponse } from '@/lib/admin-types';

const PAGE_SIZE = 50;

/** Static enum of actions emitted by logAdminAction (see lib/audit.ts). */
const ACTION_OPTIONS = [
  'view_user',
  'deactivate_user',
  'reactivate_user',
  'delete_user',
  'resolve_report',
  'dismiss_report',
  'block_reported_user',
  'login',
  'logout',
] as const;

const ACTION_LABEL: Record<string, string> = {
  view_user: '查看用戶',
  deactivate_user: '停用帳號',
  reactivate_user: '啟用帳號',
  delete_user: '刪除帳號',
  resolve_report: '標記舉報已處理',
  dismiss_report: '駁回舉報',
  block_reported_user: '封鎖被檢舉用戶',
  login: '登入',
  logout: '登出',
};

type BadgeTone = 'red' | 'green' | 'gray' | 'yellow';

const ACTION_TONE: Record<string, BadgeTone> = {
  delete_user: 'red',
  block_reported_user: 'red',
  deactivate_user: 'red',
  resolve_report: 'green',
  reactivate_user: 'green',
  view_user: 'gray',
  login: 'gray',
  logout: 'gray',
  dismiss_report: 'yellow',
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  red: 'bg-red-100 text-red-800',
  green: 'bg-green-100 text-green-800',
  gray: 'bg-slate-100 text-slate-700',
  yellow: 'bg-yellow-100 text-yellow-800',
};

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ActionBadge({ action }: { action: string }) {
  const tone = ACTION_TONE[action] ?? 'gray';
  const label = ACTION_LABEL[action] ?? action;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

function TargetCell({ entry }: { entry: AdminAuditLogEntry }) {
  if (!entry.target_type) return <span className="text-slate-400">—</span>;
  const idLabel = entry.target_id ? entry.target_id.slice(0, 8) : '';
  if (entry.target_type === 'user' && entry.target_id) {
    return (
      <span className="text-xs">
        <span className="text-slate-500">user</span>{' '}
        <Link
          href={`/users/${entry.target_id}`}
          className="text-[#8c52ff] hover:underline font-mono"
          title={entry.target_id}
        >
          {idLabel}
        </Link>
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-600">
      <span className="text-slate-500">{entry.target_type}</span>
      {idLabel ? (
        <span className="ml-1 font-mono text-slate-700" title={entry.target_id ?? undefined}>
          {idLabel}
        </span>
      ) : null}
    </span>
  );
}

function MetadataCell({
  entry,
  expanded,
  onToggle,
}: {
  entry: AdminAuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!entry.metadata || Object.keys(entry.metadata).length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  const json = JSON.stringify(entry.metadata);
  const truncated = json.length > 100;
  const display = !expanded && truncated ? `${json.slice(0, 100)}…` : json;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-left font-mono text-xs text-slate-700 hover:text-[#8c52ff] break-all"
      title={expanded ? '點擊收合' : '點擊展開'}
    >
      {display}
    </button>
  );
}

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [adminEmailFilter, setAdminEmailFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('page_size', String(PAGE_SIZE));
      if (adminEmailFilter) params.set('admin_email', adminEmailFilter);
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`載入失敗（${res.status}）`);
      }
      const data = (await res.json()) as PaginatedResponse<AdminAuditLogEntry>;
      setEntries(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入操作紀錄時發生錯誤');
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, adminEmailFilter, actionFilter]);

  // One-time: fetch a large unfiltered slice to derive distinct admin emails
  // for the dropdown. Capped at 100 rows (API max) which in practice covers
  // the entire admin roster many times over.
  const loadAdminEmails = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/audit-log?page=1&page_size=100`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as PaginatedResponse<AdminAuditLogEntry>;
      const uniq = Array.from(
        new Set((data.items ?? []).map((e) => e.admin_email).filter(Boolean)),
      ).sort();
      setAdminEmails(uniq);
    } catch {
      // Non-fatal — dropdown will just be empty.
    }
  }, []);

  useEffect(() => {
    loadAdminEmails();
  }, [loadAdminEmails]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Reset page whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [adminEmailFilter, actionFilter]);

  const headerRow = useMemo(
    () => (
      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
        <th className="px-4 py-3">時間</th>
        <th className="px-4 py-3">管理員</th>
        <th className="px-4 py-3">動作</th>
        <th className="px-4 py-3">目標</th>
        <th className="px-4 py-3">Metadata</th>
      </tr>
    ),
    [],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-slate-900">操作紀錄</h1>
        <p className="mt-1 text-sm text-slate-500">查看管理員過往操作的審計紀錄</p>
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

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-admin-filter" className="text-xs font-medium text-slate-600">
            管理員
          </label>
          <select
            id="audit-admin-filter"
            value={adminEmailFilter}
            onChange={(e) => setAdminEmailFilter(e.target.value)}
            className="min-w-[220px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8c52ff]/40"
          >
            <option value="">全部</option>
            {adminEmails.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="audit-action-filter" className="text-xs font-medium text-slate-600">
            動作
          </label>
          <select
            id="audit-action-filter"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8c52ff]/40"
          >
            <option value="">全部</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </div>

        {(adminEmailFilter || actionFilter) && (
          <button
            type="button"
            onClick={() => {
              setAdminEmailFilter('');
              setActionFilter('');
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <X className="w-3.5 h-3.5" />
            清除篩選
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">載入中…</div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">
            目前沒有操作紀錄
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">{headerRow}</thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600">
                      {formatTimestamp(entry.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {entry.admin_email}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <ActionBadge action={entry.action} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <TargetCell entry={entry} />
                    </td>
                    <td className="px-4 py-3 max-w-md align-top">
                      <MetadataCell
                        entry={entry}
                        expanded={expandedId === entry.id}
                        onToggle={() =>
                          setExpandedId((curr) => (curr === entry.id ? null : entry.id))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <div>
            共 <span className="font-semibold text-slate-900">{total}</span> 筆紀錄 · 第{' '}
            <span className="font-semibold text-slate-900">{page}</span> / {totalPages} 頁
          </div>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              上一頁
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一頁
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
