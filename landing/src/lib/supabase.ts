// landing/src/lib/supabase.ts
//
// Browser-side Supabase client used by the password-reset page.
//
// Why a separate client (vs. the mobile app's): different runtime,
// different auth storage. The mobile app stores auth in SecureStore
// + AsyncStorage; here we just lean on supabase-js's default
// localStorage-backed session, since the only supported flow on the
// landing site is the recovery-link → updatePassword exchange (no
// long-lived web sessions yet).
//
// Env vars are inlined at build time by Vite (VITE_*-prefixed vars
// reach the client bundle). Vercel project Settings → Environment
// Variables must have:
//   VITE_SUPABASE_URL       = https://<project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <anon key>
// The anon key is meant to be public — it's the value the mobile app
// already ships with. RLS gates everything sensitive on the server.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  'https://kbwfdskulxnhjckdvghj.supabase.co';

const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Recovery links land at /reset-password with `?…` query OR a
    // `#access_token=…&type=recovery` hash, depending on Supabase's
    // flow. Letting supabase-js parse the URL automatically converts
    // either into a real session that updateUser() can act on.
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
  },
});

export const isSupabaseConfigured = Boolean(SUPABASE_ANON_KEY);
