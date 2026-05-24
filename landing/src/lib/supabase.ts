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
    // Implicit flow (the supabase-js v2 default). MUST NOT be 'pkce'
    // here: PKCE requires a `code_verifier` that supabase-js stores in
    // browser localStorage at the moment the auth flow is initiated —
    // and password resets are initiated on the mobile app, not on this
    // web page. Setting flowType: 'pkce' caused supabase-js to ignore
    // the implicit-flow `#access_token=…` hash that the recovery email
    // actually delivers, and instead look for a `?code=` it could
    // exchange. The exchange always failed because the verifier lived
    // on the user's phone, not their browser. Default (implicit) is
    // correct here — the recovery email's hash carries everything
    // needed to set a session and call updateUser({ password }).
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const isSupabaseConfigured = Boolean(SUPABASE_ANON_KEY);
