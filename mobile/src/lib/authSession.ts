import * as SecureStore from 'expo-secure-store';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseUrl } from './supabase';

// ─────────────────────────────────────────────────────────────────────
// Offline-safe auth session helpers.
//
// THE RULE (founder red line, 2026-08-06 — "在沒有網路時，會直接登出帳號"):
// a NETWORK failure must NEVER be read as "signed out". Only
//   (a) the server confirming the credential is invalid (401 / invalid
//       token → auth-js clears storage and emits SIGNED_OUT), or
//   (b) the user tapping log out
// may clear auth state. Everything else keeps the user inside the app
// and lets autoRefreshToken retry when connectivity returns.
//
// WHY THIS FILE EXISTS — the actual mechanism of the bug:
// `supabase.auth.getSession()` does NOT just read storage. When the
// persisted access token is expired (or within EXPIRY_MARGIN_MS = 90s
// of expiring) it calls `_callRefreshToken()`, which hits the network.
// Offline that fails, and `__loadSession` returns
//   { data: { session: null }, error: AuthRetryableFetchError }
// (auth-js 2.97, GoTrueClient.js:1241-1244). Callers that destructure
// only `data.session` and ignore `error` therefore see `null` and
// conclude "logged out" — even though the session is still sitting in
// SecureStore, perfectly restorable. `onAuthStateChange` has the same
// trap: after initialize, auth-js emits INITIAL_SESSION with `null`
// whenever `_useSession` errored (GoTrueClient.js:1634-1649).
//
// Note that auth-js itself is careful: it only calls `_removeSession()`
// when the refresh error is NOT retryable (GoTrueClient.js:1999-2001,
// 1929-1932). So on a network failure the stored session survives — the
// logout is entirely a CLIENT-SIDE misreading, which is what these
// helpers undo.
// ─────────────────────────────────────────────────────────────────────

// The SecureStore key supabase-js persists the session under. supabase-js
// derives its default as `sb-${hostname.split('.')[0]}-auth-token` (see
// SupabaseClient's `defaultStorageKey`), and mobile/src/lib/supabase.ts
// deliberately does NOT override `storageKey`, so this must mirror that
// derivation exactly. Same expression SettingsScreen.doLogout has used in
// production since 2026-06-05.
const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
export const AUTH_STORAGE_KEY = `sb-${projectRef}-auth-token`;

// How long the startup gate is willing to wait for `getSession()` before
// falling back to the persisted session. Offline, auth-js retries the
// refresh with exponential backoff for up to AUTO_REFRESH_TICK_DURATION_MS
// (30s) — far past any acceptable launch time, and a direct violation of
// the project rule 「啟動閘門不可 block 在網路上」. We stop waiting early
// and read storage instead; the refresh keeps running in the background
// and lands via onAuthStateChange('TOKEN_REFRESHED') when it succeeds.
const STARTUP_SESSION_TIMEOUT_MS = 2500;

const TIMED_OUT = Symbol('getSession-timeout');

function looksLikeSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  // Same shape test auth-js uses in `_isValidSession`, plus a user id —
  // without a user id the rest of the app has nothing to key on.
  return (
    typeof s.access_token === 'string' &&
    typeof s.refresh_token === 'string' &&
    'expires_at' in s &&
    !!(s.user as { id?: string } | undefined)?.id
  );
}

/**
 * Read the session straight out of SecureStore. Pure local I/O — never
 * touches the network, so it is safe on the startup gate and safe while
 * offline. Returns null when nothing valid is persisted (fresh install,
 * or a real sign-out that cleared storage).
 */
export async function readPersistedSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return looksLikeSession(parsed) ? parsed : null;
  } catch {
    // Unreadable / corrupt storage is NOT proof of a sign-out, but there
    // is nothing to restore either. Callers treat null as "no local
    // evidence of a session".
    return null;
  }
}

/**
 * Hard-clear the persisted session. Only ever called from the explicit
 * user-initiated log-out path.
 */
export async function clearPersistedSession(): Promise<void> {
  const keys = [
    AUTH_STORAGE_KEY,
    `${AUTH_STORAGE_KEY}-code-verifier`,
    `${AUTH_STORAGE_KEY}-user`,
  ];
  for (const key of keys) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // best-effort; a relaunch still lands on the auth stack as long as
      // the main key went away.
    }
  }
}

/**
 * Resolve the session for the launch gate WITHOUT letting a network
 * failure look like a sign-out.
 *
 * Order of trust:
 *   1. `getSession()` returned a session      → use it (freshest).
 *   2. `getSession()` returned null AND no    → genuinely signed out.
 *      error (storage was empty)
 *   3. anything else (error, timeout, throw)  → we could not VERIFY.
 *      Fall back to whatever is persisted; keep the user in the app.
 */
export async function resolveStartupSession(
  timeoutMs: number = STARTUP_SESSION_TIMEOUT_MS,
): Promise<Session | null> {
  // `.catch` on the live call rather than a try/catch around the race:
  // when the timeout wins, a later rejection would otherwise surface as an
  // unhandled promise rejection. A throw here is a transport failure, never
  // an authorization verdict, so it degrades to the persisted-session path.
  const live = supabase.auth.getSession().catch(() => null);
  const raced: unknown = await Promise.race([
    live,
    new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), timeoutMs)),
  ]);

  if (raced && raced !== TIMED_OUT) {
    const result = raced as { data?: { session?: Session | null }; error?: unknown };
    const session = result.data?.session ?? null;
    if (session) return session;
    // Case 2: the ONLY way we conclude "not signed in" from a live call.
    if (!result.error) return null;
  }

  // Case 3: unverifiable. Trust local storage.
  return await readPersistedSession();
}

/**
 * Decide what a null session from `onAuthStateChange` actually means.
 *
 * auth-js emits a null session for two very different reasons:
 *   - SIGNED_OUT: storage was cleared (explicit sign-out, or the server
 *     rejected the refresh token with a non-retryable error). Real.
 *   - INITIAL_SESSION with null after `_useSession` errored: we were
 *     offline when it tried to refresh. NOT a sign-out.
 *
 * Returns the session to fall back to, or null if the user really is
 * signed out.
 */
export async function recoverSessionForNullEvent(
  event: string,
): Promise<Session | null> {
  if (event === 'SIGNED_OUT') return null;
  return await readPersistedSession();
}
