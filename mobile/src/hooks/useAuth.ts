import { useAuthContext } from '../context/AuthContext';
import type { User, Session } from '@supabase/supabase-js';

// Back-compat: `useAuth()` now reads from AuthContext so that each
// screen mount doesn't re-fetch the session (and subscribe its own
// onAuthStateChange listener). The returned shape matches the prior
// hook — existing call sites don't need to change.

type UseAuthReturn = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

export function useAuth(): UseAuthReturn {
  const { user, session, loading, signOut } = useAuthContext();
  return { user, session, loading, signOut };
}
