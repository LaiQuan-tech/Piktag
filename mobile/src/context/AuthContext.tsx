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
import type { User, Session } from '@supabase/supabase-js';
import type { PiktagProfile } from '../types';

// Must match the key in AppNavigator/OnboardingScreen. On sign-out we
// wipe it so a different user logging in on the same device still goes
// through onboarding as they should.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

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
  refreshProfile: () => Promise<void>;
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

  const fetchProfileFor = useCallback(async (uid: string) => {
    if (!uid) return;
    // Coalesce concurrent calls for the same user.
    if (inflightProfileFor.current === uid) return;
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
        // Mirror into the existing in-memory cache so legacy readers
        // that still look at CACHE_KEYS.PROFILE stay warm.
        setCache(CACHE_KEYS.PROFILE, { profile: data });
        // ...and to disk, so the next cold start has something to show
        // before (or without) a successful network round-trip.
        void setPersistentCache(CACHE_KEYS.AUTH_PROFILE, uid, data);
      }
      // A failed fetch leaves `profile` exactly as it was. It is a
      // network problem, never a reason to blank the user's own data.
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

  const refreshProfile = useCallback(async () => {
    if (user?.id) {
      inflightProfileFor.current = null; // force a re-fetch
      await fetchProfileFor(user.id);
    }
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
    // Clear onboarding flag first so a different user logging in on
    // this device still goes through onboarding. Non-fatal on failure —
    // worst case the next user skips onboarding once.
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } catch {}
    const outgoingUserId = lastUserIdRef.current;

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
      refreshProfile: async () => {},
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
