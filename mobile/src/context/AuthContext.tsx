import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../lib/supabase';
import {
  setCache,
  getCache,
  invalidateCache,
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
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      sessionRef.current = nextSession;
      setLoading(false);
      // Tag every Sentry event with the current user id so error reports
      // can be triaged per-account. We only send the id — never email or
      // phone — to keep PII out of crash logs.
      if (nextSession?.user) {
        lastUserIdRef.current = nextSession.user.id;
        try { Sentry.setUser({ id: nextSession.user.id }); } catch {}
        // Disk first (instant, works offline), network second.
        void hydrateProfileFromDisk(nextSession.user.id);
        void fetchProfileFor(nextSession.user.id);
      } else {
        try { Sentry.setUser(null); } catch {}
        setProfile(null);
        invalidateCache(CACHE_KEYS.PROFILE);
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
  }, [fetchProfileFor, hydrateProfileFromDisk]);

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

  const signOut = useCallback(async () => {
    // Clear onboarding flag first so a different user logging in on
    // this device still goes through onboarding. Non-fatal on failure —
    // worst case the next user skips onboarding once.
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } catch {}
    const outgoingUserId = lastUserIdRef.current;
    // Clear local storage FIRST, then sign out. Offline, auth-js's
    // `_signOut` stalls inside `_useSession` trying to refresh an expired
    // token and returns before it ever reaches `_removeSession()` — so the
    // session survives and SIGNED_OUT is never emitted. With storage
    // already empty, `_useSession` resolves instantly with no session and
    // `_removeSession()` runs, emitting SIGNED_OUT even with no network.
    // (Same reasoning as SettingsScreen.doLogout, 2026-06-05.)
    await clearPersistedSession();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // The storage clear above is what actually logs the user out; the
      // event emission is a bonus.
    }
    invalidateCache(CACHE_KEYS.PROFILE);
    invalidateCache(CACHE_KEYS.CONNECTIONS);
    invalidateCache(CACHE_KEYS.NOTIFICATIONS);
    await clearPersistentCaches(outgoingUserId);
  }, []);

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
