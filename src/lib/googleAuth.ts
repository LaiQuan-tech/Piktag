import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { supabase, supabaseUrl } from './supabase';

export async function signInWithGoogle() {
  // Generate PKCE code verifier/challenge
  const codeVerifier = AuthSession.generateCodeVerifier();
  const codeChallenge = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'piktag', path: 'auth/callback' });

  // Build Supabase OAuth URL with PKCE
  const authUrl =
    `${supabaseUrl}/auth/v1/authorize?` +
    `provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  // Open browser for Google login
  const result = await AuthSession.startAsync({ authUrl });

  if (result.type === 'success' && result.params?.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(result.params.code);
    if (error) throw error;
    return data;
  }

  return null; // user cancelled
}
