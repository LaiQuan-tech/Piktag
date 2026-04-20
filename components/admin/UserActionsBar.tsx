'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UserCheck, UserX, Trash2 } from 'lucide-react';

interface Props {
  userId: string;
  username: string;
  isActive: boolean;
}

export default function UserActionsBar({ userId, username, isActive }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleToggle = async () => {
    setBusy('toggle');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/deactivate`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    // NOTE: ConfirmModal component (built by another agent) should replace this
    // window.confirm once available. For now we use native confirm as placeholder.
    const ok = window.confirm(`確定刪除 @${username}？此動作無法復原。`);
    if (!ok) return;
    setBusy('delete');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push('/users');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '刪除失敗');
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy !== null}
          className={
            'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
            (isActive
              ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              : 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700')
          }
        >
          {isActive ? (
            <>
              <UserX className="w-4 h-4" />
              {busy === 'toggle' ? '處理中...' : '停用帳號'}
            </>
          ) : (
            <>
              <UserCheck className="w-4 h-4" />
              {busy === 'toggle' ? '處理中...' : '啟用帳號'}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-rose-600 text-white border border-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          {busy === 'delete' ? '刪除中...' : '刪除帳號'}
        </button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
