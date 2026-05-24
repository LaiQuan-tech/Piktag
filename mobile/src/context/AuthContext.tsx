import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../lib/supabase';
import { setCache, getCache, invalidateCache, CACHE_KEYS } from '../lib/dataCache';
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
      }
    } finally {
      inflightProfileFor.current = null;
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (cancelled) return;
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);
      // Tag every Sentry event with the current user id so error reports
      // can be triaged per-account. We only send the id — never email or
      // phone — to keep PII out of crash logs.
      if (currentSession?.user) {
        try { Sentry.setUser({ id: currentSession.user.id }); } catch {}
        void fetchProfileFor(currentSession.user.id);
      } else {
        try { Sentry.setUser(null); } catch {}
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
      if (newSession?.user) {
        try { Sentry.setUser({ id: newSession.user.id }); } catch {}
        void fetchProfileFor(newSession.user.id);
      } else {
        try { Sentry.setUser(null); } catch {}
        setProfile(null);
        invalidateCache(CACHE_KEYS.PROFILE);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [fetchProfileFor]);

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
    await supabase.auth.signOut();
    invalidateCache(CACHE_KEYS.PROFILE);
    invalidateCache(CACHE_KEYS.CONNECTIONS);
    invalidateCache(CACHE_KEYS.NOTIFICATIONS);
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
