import * as SecureStore from 'expo-secure-store';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseUrl } from './supabase';
import { checkOffline } from './netStatus';

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

// ─────────────────────────────────────────────────────────────────────
// OFFLINE SESSION TRUST WINDOW — 30 days.
//
// THIS NUMBER IS A FOUNDER PRODUCT DECISION (2026-08-06), NOT A
// TECHNICAL LIMIT. Nothing in auth-js, Supabase or the token format
// requires it: a refresh token stays usable far longer, and the code
// below would work identically with any value. The decision is that a
// device which has not managed to reach the auth server for a whole
// month should ask the human to sign in again — a phone lost after an
// event shouldn't stay logged in forever just by staying in airplane
// mode. Do NOT "simplify" this away, do not derive it from token
// lifetimes, and do not shorten it to match some refresh interval:
// changing it is a product call, not a refactor.
export const OFFLINE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Supabase's default access-token lifetime, used ONLY when a persisted
// blob somehow lacks `expires_in`. Matches the project's Auth settings
// (JWT expiry 3600s).
const DEFAULT_ACCESS_TOKEN_LIFETIME_S = 3600;

/**
 * When was this session last KNOWN-GOOD — i.e. the last moment the auth
 * server itself vouched for the credential?
 *
 * We derive it from the blob instead of writing our own timestamp:
 *
 *   last_verified_at = expires_at - expires_in
 *
 * Every auth-js path that persists a session writes the pair together
 * at the moment a server call SUCCEEDED — `_saveSession({expires_at:
 * now + data.expires_in, ...data})` after a refresh (GoTrueClient.js
 * :2425), and `{expires_in: expires_at - now}` after a live `_getUser`
 * validation (:1402). Either way the difference collapses to the clock
 * reading at the last successful round-trip with the auth server, which
 * is exactly the age this cap is about, and it advances on its own
 * every time connectivity returns.
 *
 * `expires_at` alone is useless as an age: an access token lives ~1
 * hour, so every session that survived one night offline would look
 * ancient and everyone would be logged out by morning — the original
 * bug, re-introduced through the front door.
 *
 * Why not persist our own `last_verified_at` on each successful online
 * resolve? It would measure the same thing but with two extra failure
 * modes: it is written with the DEVICE clock (so equally forgeable),
 * and a missed/failed write would silently age a good session out. The
 * server-issued timestamp travels inside the session we are already
 * reading, cannot drift from it, and needs no new write path.
 *
 * TRADEOFF, stated plainly: the comparison still uses `Date.now()`, so
 * a user who moves the device clock BACKWARDS can keep an old session
 * inside the window. We accept that — it buys nothing (every request
 * still needs a token the server will accept, and the server is the one
 * enforcing real expiry) and defending against it would mean trusting a
 * monotonic clock we don't have offline. The direction that matters is
 * the other one: a clock moved FORWARD makes a session look older and
 * we fail closed, back to the sign-in screen.
 */
function lastKnownGoodAtMs(session: Session): number | null {
  const expiresAt = (session as { expires_at?: number | null }).expires_at;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  const expiresIn = (session as { expires_in?: number | null }).expires_in;
  const lifetimeS =
    typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : DEFAULT_ACCESS_TOKEN_LIFETIME_S;
  return (expiresAt - lifetimeS) * 1000;
}

/**
 * Is a persisted session young enough to keep trusting while we cannot
 * verify it? Exported for tests / future callers; the app-facing use is
 * `readTrustedPersistedSession()` below.
 *
 * A session with no usable timestamp returns TRUE. That is deliberate:
 * this file's whole doctrine is that we only conclude "signed out" from
 * positive evidence, and "the blob has no readable issue time" is not
 * evidence that it is stale.
 */
export function isWithinOfflineTrustWindow(
  session: Session,
  nowMs: number = Date.now(),
): boolean {
  const knownGoodAt = lastKnownGoodAtMs(session);
  if (knownGoodAt === null) return true;
  return nowMs - knownGoodAt <= OFFLINE_SESSION_MAX_AGE_MS;
}

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
 * The persisted session, but only if it is still inside the 30-day
 * offline trust window. This — NOT `readPersistedSession` — is what the
 * unverifiable/offline fallback paths use.
 *
 * Two properties this function must keep:
 *
 *  1. It is ONLY reachable from a fallback. A live `getSession()` that
 *     actually answered is authoritative no matter how old the session
 *     is: if the server is willing to refresh a 90-day-old token, the
 *     user stays in. The cap is about how long we will vouch for a
 *     credential the server has NOT confirmed.
 *  2. Hitting the cap does NOT delete anything. We return null so the
 *     app routes to the auth stack, and leave SecureStore untouched —
 *     the very next launch with signal may find the refresh token still
 *     valid, and the user is back in with no re-typing. Deleting here
 *     would turn a connectivity condition into permanent data loss,
 *     which is the exact class of bug 437639d fixed.
 */
async function readTrustedPersistedSession(): Promise<Session | null> {
  const persisted = await readPersistedSession();
  if (!persisted) return null;
  if (!isWithinOfflineTrustWindow(persisted)) {
    // Deliberately no clearPersistedSession() here. See (2) above.
    return null;
  }
  return persisted;
}

/**
 * Hard-clear the persisted session. Only ever called from the explicit
 * user-initiated log-out path.
 */
const LEGACY_SESSION_KEY = 'supabase.auth.token';

export async function clearPersistedSession(): Promise<void> {
  const keys = [
    AUTH_STORAGE_KEY,
    `${AUTH_STORAGE_KEY}-code-verifier`,
    `${AUTH_STORAGE_KEY}-user`,
    // The pre-2026 storage key. lib/supabase.ts migrates any value found
    // under it from AsyncStorage INTO SecureStore on every cold start,
    // and nothing ever deleted the SecureStore copy — so a device that
    // upgraded across that migration kept a full refresh token for the
    // account, readable after log-out and after account deletion. It is
    // not the key auth-js reads any more, which is exactly why nobody
    // noticed it was still there.
    LEGACY_SESSION_KEY,
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
 *      Fall back to the persisted session, provided it is still inside
 *      the 30-day offline trust window; keep the user in the app.
 *
 * Note the asymmetry in (1) vs (3): a session the auth client actually
 * handed back is accepted at ANY age. The cap only governs how long we
 * are willing to vouch for a credential nobody has confirmed.
 */
export async function resolveStartupSession(
  timeoutMs: number = STARTUP_SESSION_TIMEOUT_MS,
): Promise<Session | null> {
  // Shortcut for case 3 when we can already PROVE it applies. With no
  // connectivity `getSession()` cannot verify anything — it just spends
  // ~25s retrying a refresh that has no network to use — so the race
  // below is a guaranteed 2.5s wait for a known answer. Every screen
  // hydrates from user-namespaced caches and therefore cannot paint
  // ANYTHING until `user` lands, so that 2.5s is 2.5s of skeletons on
  // exactly the launch the founder filmed. Reading SecureStore directly
  // takes ~50ms.
  //
  // This cannot make a sign-out more likely: it lands on the same
  // trusted-persisted-session path the timeout would have reached, and
  // `checkOffline()` only answers true on positive evidence of no
  // connection (see lib/netStatus.ts).
  if (await checkOffline()) {
    return await readTrustedPersistedSession();
  }

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

  // Case 3: unverifiable. Trust local storage — up to 30 days.
  return await readTrustedPersistedSession();
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
 * signed out — or if the persisted session has aged past the 30-day
 * offline trust window, which the caller treats the same way (route to
 * auth; nothing is deleted).
 */
export async function recoverSessionForNullEvent(
  event: string,
): Promise<Session | null> {
  if (event === 'SIGNED_OUT') return null;
  return await readTrustedPersistedSession();
}
