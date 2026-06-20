import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';

// The OAuth clients live in Google Cloud project "Piktag App" (57945731882) —
// the SAME project whose Web client is configured as Supabase's Google auth
// provider. The native sign-in below requests an ID token whose audience is
// that Web client, so Supabase already trusts it and no extra Supabase config
// is needed. The Android OAuth clients (package ag.pikt.app + both signing
// SHA-1s: Play App Signing + upload key) and the iOS client in that project are
// what let Google Play services / the iOS SDK issue the token for this app.
const WEB_CLIENT_ID =
  '57945731882-pvldep5366d9h2hfjs10mkg2if886l1s.apps.googleusercontent.com';
const IOS_CLIENT_ID =
  '57945731882-qjbeia7tu8sh3d79a5s8o7t1g37lsrdt.apps.googleusercontent.com';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    // webClientId becomes the ID-token audience (serverClientId) on BOTH
    // platforms, so supabase.auth.signInWithIdToken validates it against the
    // same Google client the Supabase provider already trusts.
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
  });
  configured = true;
}

/**
 * Sign in with Google using the NATIVE flow (Credential Manager on Android,
 * the Google SDK on iOS), then exchange the returned ID token for a Supabase
 * session via signInWithIdToken.
 *
 * Replaces the previous expo-web-browser OAuth (PKCE) flow, which on Android
 * bounced through a Chrome Custom Tab and tripped Google's "this browser may
 * not be secure" / 2-step number-matching checks — so accounts with 2SV could
 * not complete sign-in on-device. The native flow uses the system account
 * picker and avoids the browser entirely.
 *
 * Returns the Supabase session data on success, or null if the user cancelled.
 */
export async function signInWithGoogle() {
  ensureConfigured();

  // No-op on iOS; on Android verifies Google Play services is present/updated.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  let response: any;
  try {
    response = await GoogleSignin.signIn();
  } catch (err: any) {
    // Some SDK paths surface cancellation as a thrown status code rather than
    // a { type: 'cancelled' } result — treat it as a silent no-op.
    if (err?.code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw err;
  }

  // v13+ returns { type, data }; cancellation comes back as type 'cancelled'.
  if (response?.type === 'cancelled') return null;

  const idToken: string | undefined =
    response?.data?.idToken ?? response?.idToken;
  if (!idToken) {
    throw new Error('Google Sign-In failed: no ID token returned');
  }

  const { data: sessionData, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) throw error;
  return sessionData;
}
