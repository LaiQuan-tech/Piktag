// Pending invite-code handoff: when an invitee taps a /i/{code} link, we
// route them to RedeemInviteScreen. If they're not signed in, we stash the
// code here, send them through Auth + Onboarding, then auto-resume the
// redeem flow once they hit the home tab.
//
// Survives app kills via AsyncStorage. The in-memory fast path avoids a
// disk hop for the common in-session case.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'piktag_pending_invite_code_v1';

let inMemory: string | null = null;

/** Save an invite code captured from a deep link. */
export async function setPendingInviteCode(code: string): Promise<void> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  inMemory = normalized;
  try {
    await AsyncStorage.setItem(KEY, normalized);
  } catch {
    // Disk failure is non-fatal — in-memory copy keeps the session-local flow alive.
  }
}

/**
 * Read the pending code without clearing it. Used by Login/Register screens
 * to render an "you were invited" banner without consuming the handoff.
 */
export async function peekPendingInviteCode(): Promise<string | null> {
  if (inMemory) return inMemory;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) inMemory = stored;
    return stored;
  } catch {
    return null;
  }
}

/**
 * Read AND clear in one shot. Used by ConnectionsScreen on mount to
 * resume the redeem flow exactly once. Idempotent — calling twice
 * returns null the second time.
 */
export async function consumePendingInviteCode(): Promise<string | null> {
  const code = inMemory ?? (await (async () => {
    try {
      return await AsyncStorage.getItem(KEY);
    } catch {
      return null;
    }
  })());
  inMemory = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
  return code;
}

/** Force-clear (e.g. on successful redeem, or when user explicitly cancels). */
export async function clearPendingInviteCode(): Promise<void> {
  inMemory = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
