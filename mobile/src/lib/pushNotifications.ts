import { Platform } from 'react-native';
import { supabase } from './supabase';

// NOTE: expo-notifications and expo-device are intentionally lazy-loaded
// inside the function below. Importing them at module top level loaded
// their native modules during app launch, which (on iOS 17.x with New
// Architecture) triggered a TurboModule background-thread NSException →
// Hermes cross-thread memory corruption → SIGSEGV crash on launch.
//
// By deferring the dynamic import until the user is already logged in,
// the native modules only register well after the JS runtime is stable.

let handlerConfigured = false;

/**
 * Register for push notifications and save token to DB.
 * Safe to call on every session restore — wrapped in try/catch so any
 * native failure can never crash the app.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  try {
    const Notifications = await import('expo-notifications');
    const Device = await import('expo-device');

    // Configure notification behavior on first call only
    if (!handlerConfigured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      handlerConfigured = true;
    }

    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    // Check/request permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied');
      return null;
    }

    // Android notification channel
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'PikTag',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    // Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '713740e1-6546-4448-97d4-04868daf8fbd',
    });
    const pushToken = tokenData.data;

    // Save to DB
    await supabase
      .from('piktag_profiles')
      .update({ push_token: pushToken })
      .eq('id', userId);

    return pushToken;
  } catch (err) {
    console.warn('Push notification setup failed:', err);
    return null;
  }
}

// ─── App-icon badge management ────────────────────────────────────
// Pre-2026-05-30 the badge was never set anywhere — both the server
// (Expo push payload `badge: undefined`) and the client (no
// setBadgeCountAsync call) deferred to the other and so nothing
// happened. We now compute it client-side from piktag_notifications
// unread count, gated on the user's `notif_badge` preference.
//
// Same lazy-import discipline as registerForPushNotifications — the
// native module is only touched after the JS runtime is stable.

/**
 * Reflect the user's badge preference on the app icon RIGHT NOW.
 * - enabled=true  → query unread count and apply it
 * - enabled=false → force zero
 *
 * Call after toggling the Settings switch, or after the user opens
 * NotificationsScreen and marks rows read.
 */
export async function applyBadgePreference(
  enabled: boolean,
  userId: string,
): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    if (!enabled) {
      await Notifications.setBadgeCountAsync(0);
      return;
    }
    const { count, error } = await supabase
      .from('piktag_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) {
      console.warn('[badge] unread query failed:', error.message);
      return;
    }
    await Notifications.setBadgeCountAsync(Math.max(0, count ?? 0));
  } catch (err) {
    console.warn('[badge] applyBadgePreference threw:', err);
  }
}

/**
 * Read the user's badge preference from DB, then apply. Use at app
 * launch / auth resolve — caller doesn't need to know the current
 * preference value, this fn does both reads.
 */
export async function refreshBadgeFromServer(userId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('piktag_profiles')
      .select('notif_badge')
      .eq('id', userId)
      .single();
    if (error) {
      // Column-missing (42703) → migration not yet applied. Default
      // ON (matches the DEFAULT we'll set when it lands).
      const isMissing =
        (error as any).code === '42703' ||
        /column .*notif_badge/i.test(error.message);
      await applyBadgePreference(isMissing, userId);
      return;
    }
    const enabled = (data as any)?.notif_badge !== false;
    await applyBadgePreference(enabled, userId);
  } catch (err) {
    console.warn('[badge] refreshBadgeFromServer threw:', err);
  }
}

/** Force-clear the badge. Cheap to call. */
export async function clearBadge(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.setBadgeCountAsync(0);
  } catch {
    /* silent — badge clear is best-effort */
  }
}
