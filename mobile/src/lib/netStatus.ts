import NetInfo from '@react-native-community/netinfo';

// ─────────────────────────────────────────────────────────────────────
// Module-level connectivity mirror.
//
// WHY THIS EXISTS (founder 2026-08-08: 「離線時開啟app，沒有內容」).
// The disk caches added in 437639d/3b580fe/ccd9ca4 were correct, but
// every screen still decided WHAT TO PAINT inside a network callback,
// and offline that callback does not come back for ~25-50 seconds:
//
//   supabase-js calls `auth.getSession()` before EVERY PostgREST/RPC
//   request (supabase-js/dist/index.cjs:325 `_getAccessToken`). When the
//   stored access token is inside EXPIRY_MARGIN_MS (90s) of expiring —
//   i.e. on essentially every cold start — `getSession()` runs
//   `_callRefreshToken`, and `_refreshAccessToken` retries with
//   exponential backoff until `elapsed + nextBackoff` crosses
//   AUTO_REFRESH_TICK_DURATION_MS = 30_000
//   (auth-js/dist/main/GoTrueClient.js:1820-1843, lib/constants.js:6).
//   In airplane mode each attempt fails instantly, so the ~25s is pure
//   sleep, and the calls serialise behind `_acquireLock`
//   (GoTrueClient.js:1112). A screen that clears `loading` in the
//   `finally` of that chain shows a skeleton for the whole window.
//
// `useNetInfo()` cannot help there — it is a hook, and the decision has
// to be made inside an async data loader. So this module keeps ONE
// process-wide NetInfo subscription and exposes it as a plain function.
// Same library (@react-native-community/netinfo), same event source as
// <OfflineBanner> and useNetInfoReconnect — no new dependency.
//
// FAIL-OPEN, NOT FAIL-CLOSED. `checkOffline()` only reports `true` on
// POSITIVE evidence from NetInfo that there is no connection. "We don't
// know yet" answers `false`, so an unknown state never blocks a request
// that might have worked. The symmetric mistake — assuming offline and
// refusing to fetch — would break the app for anyone whose NetInfo
// reporting is flaky, which is a much worse failure than one slow load.
// ─────────────────────────────────────────────────────────────────────

/** Upper bound on the one-shot NetInfo probe in `checkOffline()`. */
const NET_PROBE_TIMEOUT_MS = 800;

/** null = NetInfo has not reported yet. Never assume from null. */
let connected: boolean | null = null;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  try {
    // Deliberately never unsubscribed: there is exactly one subscription
    // for the life of the process and it costs nothing to keep.
    NetInfo.addEventListener((state) => {
      // `isConnected` is nullable on some platforms while the OS is still
      // deciding. Null means "no new information", so hold the last known
      // value rather than downgrading to unknown.
      if (state?.isConnected === null || state?.isConnected === undefined) return;
      connected = !!state.isConnected;
    });
  } catch {
    // Native module missing (tests / bare JS runtime). Stay in the
    // unknown state, which fails open.
    subscribed = false;
  }
}

/**
 * "Should I even try the network?" — the guard every offline-capable
 * loader calls before firing a query.
 *
 * Answers from the live subscription when it has spoken (the normal
 * case: NetInfo emits its first event within milliseconds of the app
 * starting). Otherwise it does ONE bounded active probe, and if even
 * that does not answer in time it returns `false` — see the fail-open
 * note above.
 */
export async function checkOffline(): Promise<boolean> {
  ensureSubscribed();
  if (connected !== null) return connected === false;
  try {
    const probe = await Promise.race([
      NetInfo.fetch(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), NET_PROBE_TIMEOUT_MS)),
    ]);
    if (probe && probe.isConnected !== null && probe.isConnected !== undefined) {
      connected = !!probe.isConnected;
      return connected === false;
    }
  } catch {
    // fall through to fail-open
  }
  return false;
}

/**
 * How long a screen may sit on a skeleton while a request that we
 * BELIEVE can succeed is in flight. This is the safety net for the case
 * `checkOffline()` cannot see: NetInfo reports a connection but the
 * request is doomed anyway (captive portal, venue wifi that associates
 * but routes nowhere, an expired token that cannot be refreshed). The
 * request is never cancelled — it still paints if it lands — we just
 * stop pretending the screen is about to fill in.
 *
 * 8s: comfortably longer than any healthy cold-start fetch in this app
 * (the slowest, ConnectionsScreen's two waves, lands in ~1.5s on 4G),
 * and far short of the ~25s auth-refresh backoff that produced the
 * "沒有內容" report.
 */
export const NETWORK_PAINT_DEADLINE_MS = 8000;
