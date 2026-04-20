'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function ForbiddenPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // Sign the user out immediately — they have an auth session but no admin rights.
    void supabase.auth.signOut();
  }, []);

  function handleBackToLogin(): void {
    router.push('/login');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#aa00ff] via-[#8c52ff] to-[#6a11cb] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#aa00ff]/10">
          <ShieldAlert className="h-8 w-8 text-[#aa00ff]" aria-hidden="true" />
        </div>

        <h1 className="text-3xl font-bold text-gray-900">403 Forbidden</h1>
        <p className="mt-3 text-gray-600">此帳號無管理員權限</p>
        <p className="mt-1 text-sm text-gray-500">
          已自動登出,請使用授權的管理員帳號重新登入。
        </p>

        <button
          type="button"
          onClick={handleBackToLogin}
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-[#aa00ff] px-4 py-2.5 font-medium text-white transition hover:bg-[#8c52ff]"
        >
          回登入頁
        </button>
      </div>
    </main>
  );
}
