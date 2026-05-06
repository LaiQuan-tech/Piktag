// ResetPassword
//
// Lands here from the Supabase password-reset email. The link looks like
//   https://pikt.ag/reset-password#access_token=…&refresh_token=…&type=recovery
// and supabase-js's `detectSessionInUrl` consumes the hash on mount,
// turning the recovery token into a usable session. From that session we
// can call `auth.updateUser({ password })` to actually change the password.
//
// Three render states:
//   1. Verifying — waiting for supabase-js to ingest the URL hash and
//      tell us via `onAuthStateChange('PASSWORD_RECOVERY')` that the
//      link was valid.
//   2. Form — recovery confirmed; show new-password + confirm fields.
//   3. Done — password updated; tell the user to open the app.
//
// We don't auto-redirect anywhere afterwards because most users open
// the link on the device they're reading email on (often desktop) and
// the actual app login happens on their phone. Showing a clear "open
// the PikTag app and sign in with your new password" beats a redirect
// that leads to a screen they can't do anything useful on.

import { useEffect, useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type Status = 'verifying' | 'ready' | 'updating' | 'done' | 'invalid' | 'config-missing';

export default function ResetPassword() {
  const [status, setStatus] = useState<Status>(
    isSupabaseConfigured ? 'verifying' : 'config-missing',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    // Subscribe BEFORE asking for the session — the PASSWORD_RECOVERY
    // event fires synchronously after supabase-js parses the URL hash
    // on first mount, and we want to catch it instead of racing the
    // initial getSession call below.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready');
      }
    });

    // Fallback path: some Supabase flows (PKCE/code in query string)
    // don't emit PASSWORD_RECOVERY but still create a session. After a
    // short tick, accept any present session as "we can update password".
    const fallback = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      setStatus((cur) => {
        if (cur !== 'verifying') return cur;
        return data.session ? 'ready' : 'invalid';
      });
    }, 1500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setStatus('updating');
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(updateErr.message);
      setStatus('ready');
      return;
    }
    setStatus('done');
    // Sign the recovery session out so this URL can't be re-used.
    supabase.auth.signOut().catch(() => {});
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0612] via-[#15082a] to-[#1a0a2e] text-white flex items-center justify-center p-6 selection:bg-fuchsia-500/40">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-8 shadow-xl">
        <h1 className="text-2xl font-bold mb-1">Reset password</h1>
        <p className="text-white/60 text-sm mb-6">
          Set a new password for your PikTag account.
        </p>

        {status === 'config-missing' && (
          <div className="text-amber-300 text-sm">
            This page is misconfigured. Please contact support.
          </div>
        )}

        {status === 'verifying' && (
          <div className="text-white/70 text-sm">Verifying recovery link…</div>
        )}

        {status === 'invalid' && (
          <div className="text-rose-300 text-sm leading-relaxed">
            This recovery link is invalid or has expired. Please request a new
            password-reset email from the PikTag app.
          </div>
        )}

        {(status === 'ready' || status === 'updating') && (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-sm text-white/70">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === 'updating'}
                className="mt-1 w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60"
                placeholder="At least 6 characters"
                minLength={6}
                required
              />
            </label>

            <label className="block">
              <span className="text-sm text-white/70">Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={status === 'updating'}
                className="mt-1 w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60"
                minLength={6}
                required
              />
            </label>

            {error && (
              <div className="text-rose-300 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={status === 'updating'}
              className="w-full rounded-lg bg-gradient-to-r from-rose-500 via-fuchsia-500 to-violet-500 py-2.5 font-semibold text-white shadow-lg shadow-fuchsia-500/30 hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'updating' ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {status === 'done' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-200 text-sm">
              Password updated. Open the PikTag app and sign in with your new
              password.
            </div>
            <a
              href="https://pikt.ag"
              className="block text-center text-white/70 hover:text-white text-sm"
            >
              ← Back to PikTag
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
