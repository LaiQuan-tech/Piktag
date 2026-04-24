import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

// Must match the key in AppNavigator/OnboardingScreen. On sign-out we
// wipe it so a different user logging in on the same device still goes
// through onboarding as they should.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

type UseAuthReturn = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Clear onboarding flag first so the next sign-in on this device
    // re-evaluates onboarding against the new user's account state.
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    } catch {
      // Non-fatal — worst case the next user skips onboarding once.
    }
    await supabase.auth.signOut();
  };

  return { user, session, loading, signOut };
}
