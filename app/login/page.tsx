'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Lock } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message || '登入失敗,請確認帳號密碼');
      setIsSubmitting(false);
      return;
    }

    const destination = nextParam && nextParam.startsWith('/') ? nextParam : '/';
    router.push(destination);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#8c52ff] via-[#8c52ff] to-[#6a11cb] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center">
          <img
            src="/logo.png"
            width={48}
            height={48}
            alt="PikTag"
            className="mb-3 h-12 w-12"
          />
          <h1 className="text-2xl font-bold text-gray-900">PikTag 管理後台</h1>
          <p className="mt-1 text-sm text-gray-500">僅限授權管理員登入</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              電子郵件
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-[#8c52ff] focus:ring-2 focus:ring-[#8c52ff]/30"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              <span className="inline-flex items-center gap-1">
                <Lock className="h-4 w-4" aria-hidden="true" />
                密碼
              </span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 outline-none focus:border-[#8c52ff] focus:ring-2 focus:ring-[#8c52ff]/30"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#8c52ff] px-4 py-2.5 font-medium text-white transition hover:bg-[#8c52ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {isSubmitting ? '登入中…' : '登入'}
          </button>

          <div
            role="alert"
            aria-live="polite"
            className="min-h-[1.25rem] text-center text-sm text-red-600"
          >
            {error}
          </div>
        </form>
      </div>
    </main>
  );
}
