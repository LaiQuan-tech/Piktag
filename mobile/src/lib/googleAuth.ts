import { maybeCompleteAuthSession, openAuthSessionAsync } from 'expo-web-browser';
import { createURL } from 'expo-linking';
import { supabase } from './supabase';

// Ensures auth session completes when the browser redirects back to the app
maybeCompleteAuthSession();

/**
 * Sign in with Google using the Supabase-recommended OAuth PKCE flow.
 * - Uses supabase.auth.signInWithOAuth to obtain the authorization URL
 * - Opens the URL inside a WebBrowser auth session (ASWebAuthenticationSession on iOS)
 * - Parses the returned `code` query param and exchanges it for a Supabase session
 *
 * Requires the Supabase client to be configured with `flowType: 'pkce'`.
 */
export async function signInWithGoogle() {
  // Deep link the browser will redirect back to when auth completes.
  // Must match one of the "Redirect URLs" configured in Supabase Auth settings.
  const redirectTo = createURL('auth/callback');

  // Ask Supabase to build the provider-specific authorize URL (but don't redirect yet).
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error('Google Sign-In failed: no authorization URL');

  // Open the authorize URL in a secure in-app browser session.
  // This returns when the provider redirects to `redirectTo`.
  const result = await openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null; // user cancelled
  }

  if (result.type !== 'success') {
    throw new Error(`Google Sign-In failed: ${result.type}`);
  }

  // Pull the ?code=... param out of the redirect URL and exchange it for a session.
  const url = new URL(result.url);
  const code = url.searchParams.get('code');

  if (!code) {
    throw new Error('Google Sign-In failed: no authorization code returned');
  }

  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) throw exchangeError;
  return sessionData;
}
