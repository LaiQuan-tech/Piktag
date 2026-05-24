// Phone-prompt helper: decides whether to nudge the user to add their
// phone number so contact-sync can match them.
//
// Why this exists: users registering via Apple/Google Sign-In never get
// asked for a phone number. The match_contacts_against_profiles RPC
// only matches against piktag_profiles.phone or piktag_biolinks
// (platform='phone'). So those users are completely invisible to
// friends doing contact sync — the friend sees them as "尚未加入" even
// though they're active members.
//
// `shouldShowPhonePrompt` returns true only when ALL of:
//   1. User has dismissed the prompt before (one-shot — never re-nag).
//   2. auth.users.phone is NULL.
//   3. piktag_profiles.phone is NULL.
//   4. No piktag_biolinks row with platform = 'phone'.
//
// Source-of-truth check is server-side; we do NOT cache the result —
// the moment the user adds a phone elsewhere (EditProfile, biolinks,
// onboarding), the next call returns false without any cache invalidation.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const DISMISS_KEY = 'piktag_phone_prompt_dismissed_v1';

export async function shouldShowPhonePrompt(userId: string): Promise<boolean> {
  if (!userId) return false;

  // Cheap dismiss check first — short-circuit before hitting the DB.
  try {
    const dismissed = await AsyncStorage.getItem(DISMISS_KEY);
    if (dismissed === 'true') return false;
  } catch {
    // If AsyncStorage is unavailable, fall through and check the DB anyway.
  }

  try {
    // auth.users.phone is not directly queryable via PostgREST; rely on
    // the auth.user object the client already has via supabase.auth.getUser()
    // for that one. piktag_profiles.phone + biolinks are public-readable.
    const { data: user } = await supabase.auth.getUser();
    if (user?.user?.phone) return false;

    const { data: profile } = await supabase
      .from('piktag_profiles')
      .select('phone')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.phone) return false;

    const { data: biolinks } = await supabase
      .from('piktag_biolinks')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'phone')
      .limit(1);
    if (biolinks && biolinks.length > 0) return false;

    return true;
  } catch {
    // Network blip / RLS hiccup — don't badger the user with a prompt
    // we can't even confirm they need.
    return false;
  }
}

export async function dismissPhonePrompt(): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    // Non-fatal — worst case the prompt re-appears next launch.
  }
}
