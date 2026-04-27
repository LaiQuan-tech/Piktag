import { signInAsync, AppleAuthenticationScope } from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

export async function signInWithApple() {
  // Generate a per-attempt nonce to prevent ID-token replay attacks.
  // Apple receives the SHA256 hash; Supabase verifies against the raw value.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  const credential = await signInAsync({
    requestedScopes: [
      AppleAuthenticationScope.FULL_NAME,
      AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error('Apple Sign-In failed: no identity token');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  // Save full name to profile if provided (Apple only gives it on first sign-in)
  if (data.user && credential.fullName) {
    const fullName = [credential.fullName.givenName, credential.fullName.familyName]
      .filter(Boolean)
      .join(' ');
    if (fullName) {
      await supabase
        .from('piktag_profiles')
        .update({ full_name: fullName })
        .eq('id', data.user.id)
        .is('full_name', null); // only if not already set
    }
  }

  if (error) throw error;
  return data;
}
