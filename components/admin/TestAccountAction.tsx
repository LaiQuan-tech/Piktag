'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';

// Mark / un-mark a profile as a closed-test tester account — hits
// POST /api/admin/users/[id]/test-account (toggles is_test_account). The
// reversible, transparent half of the tester-exclusion feature: a tester
// is stripped from all "real data" metrics, and a false positive can be
// un-marked here with one click.
export default function TestAccountAction({
  userId,
  isTestAccount,
}: {
  userId: string;
  isTestAccount: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const toggle = async () => {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}/test-account`, {
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
        (isTestAccount
          ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')
      }
      title={
        err
          ? '操作失敗，再試一次'
          : isTestAccount
            ? '取消測試標記（重新計入真實數據）'
            : '標記為測試帳號（排除出真實數據）'
      }
    >
      {isTestAccount ? (
        <RotateCcw className="w-3.5 h-3.5" />
      ) : (
        <FlaskConical className="w-3.5 h-3.5" />
      )}
      {busy ? '…' : isTestAccount ? '取消測試' : '標記測試'}
    </button>
  );
}
