import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase project credentials loaded from env (mobile/.env locally,
// EAS secrets in production). The anon key is technically public — it's
// the key the RN app ships with, protected by Supabase RLS — but we
// still load via env so it can be rotated without a code change, and
// so the value doesn't live in git history.
export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy mobile/.env.example to mobile/.env and fill in real values.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
