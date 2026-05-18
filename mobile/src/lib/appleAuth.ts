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

  // Surface a failed sign-in BEFORE touching the profile — no point
  // (and no auth) writing a profile on a failed auth, and the late
  // throw made the error ordering confusing.
  if (error) throw error;

  // Save full name to profile if provided (Apple only gives it on
  // first sign-in). Best-effort: if the post-signup profile-trigger
  // race makes this a 0-row no-op, Onboarding's upsert reliably
  // captures the name afterwards, so this is not a data-loss path.
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

  return data;
}
