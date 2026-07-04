'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UserX, UserCheck } from 'lucide-react';

// Inline deactivate/reactivate for the signup review panel — hits the
// existing POST /api/admin/users/[id]/deactivate (toggles is_active) so
// the founder can kill an obvious bot without leaving the cohort view.
export default function SignupRowAction({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const toggle = async () => {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}/deactivate`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={
        'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors disabled:opacity-50 ' +
        (isActive
          ? 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
          : 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700')
      }
      title={err ? '操作失敗，再試一次' : undefined}
    >
      {isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
      {busy ? '…' : isActive ? '停用' : '啟用'}
    </button>
  );
}
