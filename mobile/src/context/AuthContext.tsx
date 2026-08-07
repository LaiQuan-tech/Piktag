import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../lib/supabase';
import {
  setCache,
  getCache,
  setCacheOwner,
  CACHE_KEYS,
  setPersistentCache,
  getPersistentCache,
  clearPersistentCaches,
} from '../lib/dataCache';
import {
  resolveStartupSession,
  recoverSessionForNullEvent,
  clearPersistedSession,
} from '../lib/authSession';
import { checkOffline } from '../lib/netStatus';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import type { User, Session } from '@supabase/supabase-js';
import type { PiktagProfile } from '../types';

// Must match the keys in AppNavigator/OnboardingScreen.
//
// ACCOUNT ISOLATION FOR ONBOARDING IS NOT DONE HERE. It is done by the
// per-user NAMING in AppNavigator (`onboardingFlagKey`), which appends
// the user id — that is what stops one account's completion from
// skipping another's wizard, and it works whether or not anyone ever
// signs out. This comment used to claim the opposite while the line
// below removed the BARE key, which the app has not written since the
// flag went per-user: a no-op dressed up as the isolation guarantee.
//
// What sign-out removes below is RESIDUE: the outgoing account's own
// per-user flag (so a deleted account leaves nothing behind), the bare
// legacy key (one-time cleanup for devices that still carry it), and the
// pre-auth deep-link envelope, which cannot be user-namespaced because
// it is captured before anyone is signed in — see the comment on
// PENDING_DEEP_LINK_KEY in AppNavigator.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';
const onboardingFlagKeyFor = (userId: string) =>
  `${ONBOARDING_COMPLETED_KEY}_${userId}`;
const PENDING_DEEP_LINK_KEY = 'piktag_pending_deep_link';

// AuthContext hydrates the current auth user + the `piktag_profiles`
// row exactly once, and exposes them to the whole tree. This replaces
// the prior pattern where every screen mounted and fired its own
// `supabase.auth.getUser()` / `from('piktag_profiles').select('*')`
// call on focus — the audit flagged this as a major source of
// redundant cold-start latency.
//
// Consumers:
//   - `useAuth()`      → { user, session, loading, signOut }   (back-compat shape)
//   - `useAuthProfile()` → { profile, refreshProfile, setProfileLocal }
//
// The existing `useAuth` hook at src/hooks/useAuth.ts now re-exports
// the context version so we don't have to touch every import site.

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: PiktagProfile | null;
  loading: boolean;
  profileLoading: boolean;
  /**
   * Re-fetch the profile row. Resolves TRUE only when the server
   * actually answered. Callers use that to decide whether their own
   * derived snapshot is safe to persist — a failed refresh must never
   * be mistaken for "the account really has nothing".
   */
  refreshProfile: () => Promise<boolean>;
  setProfileLocal: (patch: Partial<PiktagProfile> | PiktagProfile | null) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const inflightProfileFor = useRef<string | null>(null);
  // Mirrors `session` for the auth listener, which needs to know whether
  // we already hold a session without re-subscribing on every change.
  const sessionRef = useRef<Session | null>(null);
  // Last signed-in user id, kept so sign-out can clear that account's
  // persisted caches (the session itself is already gone by then).
  const lastUserIdRef = useRef<string | null>(null);

  // Paint the last-known profile from disk. Offline (or on a slow
  // network) this is the difference between a usable profile + a
  // scannable personal QR and a blank page with an empty-username QR —
  // and showing your QR is THE thing you do at an event. Never
  // overwrites a fresher row that already landed.
  const hydrateProfileFromDisk = useCallback(async (uid: string) => {
    if (!uid) return;
    const cached = await getPersistentCache<PiktagProfile>(CACHE_KEYS.AUTH_PROFILE, uid);
    if (!cached) return;
    setProfile((prev) => (prev ? prev : cached));
  }, []);

  // Drop every trace of the outgoing account from THIS PROCESS: React
  // state, Sentry's user tag, and the whole in-memory cache (see
  // setCacheOwner — owner change wipes the Map, so no cache key can be
  // forgotten here and leak into the next account). Deliberately
  // synchronous and deliberately shared: both the auth listener and
  // signOut() below go through it, so there is exactly one definition of
  // "signed out" in the app.
  //
  // Does NOT touch SecureStore or the disk caches — those are I/O and
  // belong to the explicit sign-out path, not to an auth event.
  const clearLocalAccountState = useCallback(() => {
    try { Sentry.setUser(null); } catch {}
    sessionRef.current = null;
    setSession(null);
    setUser(null);
    setProfile(null);
    setCacheOwner(null);
    setLoading(false);
  }, []);

  const fetchProfileFor = useCallback(async (uid: string): Promise<boolean> => {
    if (!uid) return false;
    // Coalesce concurrent calls for the same user.
    if (inflightProfileFor.current === uid) return false;
    // With no signal this query does not fail — it SITS THERE for ~25s
    // while auth-js retries the token refresh (see lib/netStatus.ts).
    // Nothing here can succeed offline and the disk hydration above has
    // already painted, so skip it and let the reconnect path retry.
    if (await checkOffline()) return false;
    inflightProfileFor.current = uid;
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle();
      if (!error && data) {
        setProfile(data as PiktagProfile);
        // Mirror into the existing in-memory cache.
        //
        // NOTE THE SHAPE: `{ profile }` and nothing else. ProfileScreen
        // stores a WIDER 5-field snapshot under CACHE_KEYS.PROFILE, so
        // this narrow object is a partial of that key. ProfileScreen's
        // reader validates the shape before accepting a hit — do not
        // widen or narrow either side without checking the other, and
        // never let a partial reach ProfileScreen's disk writer, which
        // is how a good offline snapshot got emptied out.
        setCache(CACHE_KEYS.PROFILE, { profile: data });
        // ...and to disk, so the next cold start has something to show
        // before (or without) a successful network round-trip.
        void setPersistentCache(CACHE_KEYS.AUTH_PROFILE, uid, data);
        return true;
      }
      // A failed fetch leaves `profile` exactly as it was. It is a
      // network problem, never a reason to blank the user's own data.
      return false;
    } finally {
      inflightProfileFor.current = null;
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applySession = (nextSession: Session | null) => {
      if (cancelled) return;
      if (nextSession?.user) {
        // Re-point the in-memory cache at this account BEFORE anything
        // can read or write it. Same id => free no-op (the common case:
        // TOKEN_REFRESHED fires all day). A DIFFERENT id => the Map is
        // emptied, so user B can never be served a hit that user A left
        // behind within the 5-minute TTL.
        setCacheOwner(nextSession.user.id);
        setSession(nextSession);
        setUser(nextSession.user);
        sessionRef.current = nextSession;
        setLoading(false);
        lastUserIdRef.current = nextSession.user.id;
        // Tag every Sentry event with the current user id so error reports
        // can be triaged per-account. We only send the id — never email or
        // phone — to keep PII out of crash logs.
        try { Sentry.setUser({ id: nextSession.user.id }); } catch {}
        // Disk first (instant, works offline), network second.
        void hydrateProfileFromDisk(nextSession.user.id);
        void fetchProfileFor(nextSession.user.id);
      } else {
        clearLocalAccountState();
        void clearPersistentCaches(lastUserIdRef.current);
        lastUserIdRef.current = null;
      }
    };

    // Startup: resolveStartupSession falls back to the persisted session
    // whenever `getSession()` can't VERIFY (offline / timeout), instead of
    // reporting null and dumping the user on the login screen.
    void resolveStartupSession().then(applySession);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return;
      if (newSession) {
        applySession(newSession);
        return;
      }
      // A null session is only a sign-out when auth-js says SIGNED_OUT
      // (storage cleared: explicit log out, or the server rejected the
      // token). An INITIAL_SESSION carrying null after an offline refresh
      // failure is a NETWORK symptom — keep the user where they are.
      void recoverSessionForNullEvent(event).then((recovered) => {
        if (cancelled) return;
        if (recovered) {
          if (!sessionRef.current) applySession(recovered);
          else setLoading(false);
          return;
        }
        applySession(null);
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfileFor, hydrateProfileFromDisk, clearLocalAccountState]);

  // Connectivity came back: go get the profile row we deliberately did
  // not fetch while offline. Without this the only thing that would
  // re-run it is auth-js's 30s auto-refresh tick emitting
  // TOKEN_REFRESHED — real, but not something the UI should depend on.
  useNetInfoReconnect(
    useCallback(() => {
      const uid = sessionRef.current?.user?.id;
      if (!uid) return;
      inflightProfileFor.current = null;
      void fetchProfileFor(uid);
    }, [fetchProfileFor]),
  );

  const refreshProfile = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    inflightProfileFor.current = null; // force a re-fetch
    return await fetchProfileFor(user.id);
  }, [user?.id, fetchProfileFor]);

  const setProfileLocal = useCallback((patch: Partial<PiktagProfile> | PiktagProfile | null) => {
    if (patch === null) {
      setProfile(null);
      return;
    }
    setProfile(prev => {
      const next = prev ? { ...prev, ...patch } as PiktagProfile : (patch as PiktagProfile);
      // keep the in-memory cache aligned
      setCache(CACHE_KEYS.PROFILE, { profile: next });
      return next;
    });
  }, []);

  // THE log-out path. Every UI entry point calls this one function —
  // SettingsScreen used to carry a second, subtly different copy, and
  // the copy was the one that silently did nothing offline.
  //
  // Ordering here is the whole correctness argument, so: auth-js's
  // `_signOut` runs inside `_useSession`, and `_useSession` ->
  // `__loadSession` REFRESHES over the network when the stored access
  // token is within EXPIRY_MARGIN_MS of expiring. Offline that comes
  // back as an AuthRetryableFetchError, and `_signOut` bails on it with
  // `return this._returnResult({ error: sessionError })` BEFORE it ever
  // reaches `_removeSession()` (GoTrueClient.js:1587-1611). Note it
  // RESOLVES with that error — `throwOnError` defaults to false and
  // lib/supabase.ts does not enable it — so no amount of try/catch or
  // Promise.race-then-reject sees it. The old Settings copy put the
  // credential clearing in a `catch` that therefore never ran: offline,
  // "log out" wiped the user's offline caches and left them signed in.
  //
  // With SecureStore emptied FIRST, `__loadSession` returns
  // `{data:{session:null}, error:null}` with no network at all
  // (GoTrueClient.js:1204), `_signOut` skips the /logout POST for want of
  // an access token, reaches `_removeSession()` and emits SIGNED_OUT.
  const signOut = useCallback(async () => {
    const outgoingUserId = lastUserIdRef.current;

    // Residue that is NOT in CACHE_KEYS and so is not covered by
    // clearPersistentCaches below. All best-effort: a failure here costs
    // one redundant round-trip or one re-shown wizard, never a stuck
    // session.
    try {
      await AsyncStorage.multiRemove([
        // The outgoing account's own onboarding fast-path flag. Removing
        // it means a deleted account leaves nothing on the device; the
        // server column stays the source of truth, so the worst case is
        // one extra query on the next sign-in.
        ...(outgoingUserId ? [onboardingFlagKeyFor(outgoingUserId)] : []),
        // One-time cleanup of the bare pre-namespacing key, which this
        // line used to remove ON ITS OWN while a comment claimed it was
        // what kept onboarding account-isolated. It is not — the
        // per-user naming is. See the key declarations at the top.
        ONBOARDING_COMPLETED_KEY,
        // Pre-auth invite envelope. Device-global by necessity, so
        // sign-out is the only place it can be scoped: without this it
        // survives a handover and offers user A's inviter to user B.
        PENDING_DEEP_LINK_KEY,
      ]);
    } catch {}

    // 1. Credentials. This — not the auth-js call — is what actually
    //    logs the user out, and it is pure local I/O, so it cannot fail
    //    for being offline.
    await clearPersistedSession();

    // 2. That account's data, in this order so there is no window where
    //    the app is signed out but the previous user's snapshots are
    //    still readable, nor one where the caches are gone but the user
    //    is still signed in.
    await clearPersistentCaches(outgoingUserId);

    // 3. Flip the app to signed-out ourselves. We do NOT wait for
    //    SIGNED_OUT to come back and do it for us: it arrives from step
    //    4, which we are not allowed to block on. (The event still
    //    arrives and re-runs applySession(null) — idempotent.)
    lastUserIdRef.current = null;
    clearLocalAccountState();

    // 4. Tell auth-js, so it drops its own in-memory session, stops the
    //    auto-refresh timer and emits SIGNED_OUT to any other listener.
    //    Not awaited: a refresh already in flight can hold auth-js's
    //    internal call queue for up to ~30s offline, and the user is
    //    already fully signed out by steps 1-3. If a refresh does land
    //    in between and re-persists a session, this call is queued
    //    behind it and removes it again.
    void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }, [clearLocalAccountState]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    profile,
    loading,
    profileLoading,
    refreshProfile,
    setProfileLocal,
    signOut,
  }), [user, session, profile, loading, profileLoading, refreshProfile, setProfileLocal, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Primary hook — returns the full context. Screens that only need
// `user`/`session` still get the same shape as the legacy hook.
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback path for unit tests / environments without the provider.
    // Returns a shape matching the old hook so callers don't explode.
    return {
      user: null,
      session: null,
      profile: null,
      loading: true,
      profileLoading: false,
      refreshProfile: async () => false,
      setProfileLocal: () => {},
      signOut: async () => {},
    };
  }
  return ctx;
}

// Convenience accessor for the cached profile.
export function useAuthProfile() {
  const { profile, profileLoading, refreshProfile, setProfileLocal } = useAuthContext();
  return { profile, profileLoading, refreshProfile, setProfileLocal };
}
