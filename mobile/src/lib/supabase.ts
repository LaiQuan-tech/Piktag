import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

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

// SecureStore-backed adapter for Supabase auth session storage.
// expo-secure-store is backed by iOS Keychain / Android Keystore, so the
// session token is encrypted at rest instead of living in AsyncStorage
// plaintext (M8). expo-secure-store has a ~2KB per-value limit; the
// Supabase session JSON normally fits comfortably within that. If it
// ever overflows we'll see a runtime error and split at that point.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// One-time migration: copy any existing Supabase session out of
// AsyncStorage (where older builds stored it in plaintext) into
// SecureStore, then clear AsyncStorage. This keeps already-logged-in
// users signed in across the upgrade. Safe to run on every cold start —
// it short-circuits once SecureStore has the key.
const LEGACY_SESSION_KEY = 'supabase.auth.token';

(async () => {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    if (!legacy) return;
    const existing = await SecureStore.getItemAsync(LEGACY_SESSION_KEY);
    if (!existing) {
      await SecureStore.setItemAsync(LEGACY_SESSION_KEY, legacy);
    }
    await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
  } catch (err) {
    // Migration is best-effort; failing here just means the user has to
    // sign in again on this device. Don't crash the app.
    console.warn('[supabase] legacy session migration failed', err);
  }
})();
