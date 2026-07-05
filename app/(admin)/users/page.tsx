'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminUser, PaginatedResponse } from '@/lib/admin-types';

type FilterKey = 'all' | 'verified' | 'inactive';

// Show everyone on one page (founder call 2026-07-05). The route caps at
// 2000; filtering is done client-side over the full list.
const PAGE_SIZE = 2000;

// Signup-method badge (from the auth provider).
const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  email: 'Email',
};
function providerLabel(p: string | null | undefined): string {
  if (!p) return '—';
  return PROVIDER_LABEL[p] ?? p;
}
function providerClasses(p: string | null | undefined): string {
  switch (p) {
    case 'google':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'apple':
      return 'bg-slate-100 text-slate-800 border-slate-300';
    case 'email':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-slate-50 text-slate-500 border-slate-200';
  }
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return '';
}

function getInitials(user: AdminUser): string {
  const source = user.full_name || user.username || user.email || '?';
  const trimmed = source.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [data, setData] = useState<PaginatedResponse<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  // Search stays server-side (it also resolves email → id via RPC); the
  // filter chips are applied client-side over the full one-page list.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('q', debouncedSearch);
    params.set('page', '1');
    params.set('page_size', String(PAGE_SIZE));
    return params.toString();
  }, [debouncedSearch]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?${queryString}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as PaginatedResponse<AdminUser>;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const allItems = data?.items ?? [];
  // Client-side filter chips (all data is on one page).
  const items = useMemo(() => {
    if (filter === 'verified') return allItems.filter((u) => u.email_verified);
    if (filter === 'inactive') return allItems.filter((u) => !u.is_active);
    return allItems;
  }, [allItems, filter]);
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">用戶管理</h1>
        <p className="text-sm text-slate-500 mt-1">共 {total} 位用戶</p>
      </div>

      {/* Search */}
      <div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋 username 或 email"
          className="w-full px-4 py-2.5 border border-slate-300 rounded-md bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#8c52ff] focus:border-transparent"
        />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(
          [
            ['all', '全部'],
            ['verified', '已驗證'],
            ['inactive', '未啟用'],
          ] as Array<[FilterKey, string]>
        ).map(([key, label]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                'px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ' +
                (active
                  ? 'bg-[#8c52ff] border-[#8c52ff] text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50')
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-3 w-16">頭像</th>
              <th className="text-left font-medium px-4 py-3">使用者</th>
              <th className="text-left font-medium px-4 py-3">Email</th>
              <th className="text-center font-medium px-4 py-3">註冊方式</th>
              <th className="text-center font-medium px-4 py-3">Email 驗證</th>
              <th className="text-center font-medium px-4 py-3">是否啟用</th>
              <th className="text-right font-medium px-4 py-3">P-points</th>
              <th className="text-left font-medium px-4 py-3">註冊時間</th>
              <th className="text-right font-medium px-4 py-3 w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  載入中...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-red-600">
                  載入失敗：{error}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                  找不到符合條件的用戶
                </td>
              </tr>
            ) : (
              items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatar_url}
                        alt={u.username ?? ''}
                        className="w-9 h-9 rounded-full object-cover bg-slate-100"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-600">
                        {getInitials(u)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      @{u.username ?? '—'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {u.full_name ?? ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{u.email ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ' +
                        providerClasses(u.provider)
                      }
                    >
                      {providerLabel(u.provider)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.email_verified ? (
                      <span className="text-emerald-600 font-medium">✓</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.is_active ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        ACTIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                        DEACTIVATED
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {u.p_points ?? 0}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {relativeTime(u.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/users/${u.id}`}
                      className="text-[#8c52ff] hover:underline font-medium"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* One-page list (no pagination): show the loaded count vs total. */}
      <p className="text-sm text-slate-500">
        顯示 {items.length} / 共 {total} 位
        {filter !== 'all' ? '（已篩選）' : ''}
      </p>
    </div>
  );
}
