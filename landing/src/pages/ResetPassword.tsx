// ResetPassword
//
// Lands here from the PikTag password-reset email. The link is now:
//   https://pikt.ag/reset-password?token_hash=<hash>&type=recovery
//
// WHY token_hash (not the old #access_token hash or a PKCE ?code):
//   The mobile app uses flowType:'pkce'. A PKCE recovery link needs the
//   code_verifier that supabase-js stored ON THE DEVICE that requested the
//   reset (the app's SecureStore). Opening the link in ANY browser — even
//   the same phone's browser — has no verifier, so the session could never
//   be established and the page showed "invalid or has expired" 100% of the
//   time for app-initiated resets. token_hash + verifyOtp is a server-side
//   one-time-token verification that needs NO verifier, so it works on any
//   device.
//
// WHY we verify at SUBMIT, not on load:
//   Email security scanners (Gmail etc.) pre-fetch links. If we consumed the
//   one-time token on page load, a scanner would burn it before the user
//   clicked. So the page just shows the form; the token is spent only when
//   the user actually submits a new password.
//
// Backward-compat: older emails (implicit #access_token) still work — if no
// token_hash is present we fall back to detecting a session supabase-js may
// have ingested from the URL hash.

import { useEffect, useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

type Status = 'verifying' | 'ready' | 'updating' | 'done' | 'invalid' | 'config-missing';

export default function ResetPassword() {
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );
  const tokenHash = params.get('token_hash');
  const otpType = (params.get('type') || 'recovery') as 'recovery';

  const [status, setStatus] = useState<Status>(
    !isSupabaseConfigured ? 'config-missing' : tokenHash ? 'ready' : 'verifying',
  );
  // Whether a recovery session is already established (implicit-hash path, or
  // after a successful verifyOtp). When true, submit goes straight to update.
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // token_hash path is verified at submit — nothing to detect on load.
    if (!isSupabaseConfigured || tokenHash) return;

    // Backward-compat: older implicit links carry #access_token, which
    // supabase-js consumes on mount, emitting PASSWORD_RECOVERY + a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setVerified(true);
        setStatus('ready');
      }
    });
    const fallback = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setVerified(true);
        setStatus((c) => (c === 'verifying' ? 'ready' : c));
      } else {
        setStatus((c) => (c === 'verifying' ? 'invalid' : c));
      }
    }, 1500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(fallback);
    };
  }, [tokenHash]);

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

    // Spend the one-time recovery token NOW (token_hash flow). No PKCE
    // verifier needed → works on any device; consumed only on submit →
    // link-scanners can't pre-burn it.
    if (tokenHash && !verified) {
      const { error: vErr } = await supabase.auth.verifyOtp({
        type: otpType,
        token_hash: tokenHash,
      });
      if (vErr) {
        setError(
          'This reset link is invalid or has expired. Please request a new one from the PikTag app.',
        );
        setStatus('ready');
        return;
      }
      setVerified(true);
    }

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

            {error && <div className="text-rose-300 text-sm">{error}</div>}

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
              Back to PikTag
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
