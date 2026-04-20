'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

type HeaderProps = {
  adminEmail: string;
};

export default function Header({ adminEmail }: HeaderProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore — still redirect so the admin isn't stranded.
    }
    router.replace('/login');
    router.refresh();
  };

  return (
    <header className="h-14 bg-white border-b border-slate-200 px-8 flex items-center justify-between">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-600">{adminEmail}</span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>登出</span>
        </button>
      </div>
    </header>
  );
}
