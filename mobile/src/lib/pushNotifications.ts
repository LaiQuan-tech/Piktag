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
export async function registerForPushNotifications(
  userId: string,
  opts: { requestPermission?: boolean } = {},
): Promise<string | null> {
  const { requestPermission = true } = opts;
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
      // Contextual-ask policy (founder 2026-06-29): the OS permission
      // prompt must NOT fire cold at app start — the startup path passes
      // requestPermission:false (token refresh only) and the prompt is
      // deferred to maybeAskPushPermission() at the first meaningful
      // moment (first friend-add success / first Notifications-tab open).
      if (!requestPermission) return null;
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
// unread count.
//
// 2026-05-30 architectural decision: there is NO user toggle for the
// badge. Founder rationale — "if you've opted IN to a category, you
// want to see those notifications; the badge IS that signal; a
// separate toggle is asking the user to opt against themselves."
// The badge simply reflects the unread row count after the category
// gates have done their filtering at INSERT time.
//
// Same lazy-import discipline as registerForPushNotifications — the
// native module is only touched after the JS runtime is stable.

/**
 * Compute unread count and set the app-icon badge to match.
 * Call after auth resolves, on each new realtime INSERT, and after
 * marking a row as read. Cheap (single COUNT query, head=true).
 *
 * Three filters layered so the badge can never get "stuck":
 *   - is_read = false   →  user hasn't tapped it
 *   - is_dismissed = false  →  user hasn't long-pressed → Hide
 *     (Hide and "Don't suggest" both set is_dismissed; without
 *     this filter a dismissed-but-unread row keeps the badge
 *     at 1 forever — @lpfrg's 2026-05-30 report)
 *   - type IN KNOWN_NOTIFICATION_TYPES  →  the row would
 *     actually appear in some tab if NotificationsScreen rendered
 *     it. Legacy / orphan types (e.g. 'contract_expiry' never
 *     wired into any tab) don't get counted — otherwise they're
 *     invisible AND keep the badge non-zero, which from the user's
 *     side reads as a hard bug.
 */
export async function refreshBadgeFromServer(userId: string): Promise<void> {
  try {
    // Imported lazily-at-call-time to keep this module dependency-
    // light; the constant module itself is sync.
    const { KNOWN_NOTIFICATION_TYPES } = await import('./notificationTypes');

    // Preferred path: server RPC that respects the per-user badge baseline
    // (the 3-day auto-clear — notifications created at/before the last clear
    // no longer badge, but stay in the feed). On older backends the RPC is
    // missing → fall through to the direct count below.
    const rpc = await supabase.rpc('get_badge_count', {
      p_types: KNOWN_NOTIFICATION_TYPES as unknown as string[],
    });
    if (!rpc.error && typeof rpc.data === 'number') {
      const Notifications = await import('expo-notifications');
      await Notifications.setBadgeCountAsync(Math.max(0, rpc.data));
      return;
    }

    let { count, error } = await supabase
      .from('piktag_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .eq('is_dismissed', false)
      .in('type', KNOWN_NOTIFICATION_TYPES as unknown as string[]);
    if (error) {
      // 42703 = `is_dismissed` not yet migrated; fall back to the
      // narrower query so stale environments still get SOMETHING
      // closer to the truth than no badge update at all.
      const isMissing =
        (error as any).code === '42703' || /is_dismissed/i.test(error.message);
      if (isMissing) {
        const fb = await supabase
          .from('piktag_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false)
          .in('type', KNOWN_NOTIFICATION_TYPES as unknown as string[]);
        if (fb.error) {
          console.warn('[badge] fallback unread query failed:', fb.error.message);
          return;
        }
        count = fb.count;
      } else {
        console.warn('[badge] unread query failed:', error.message);
        return;
      }
    }
    const Notifications = await import('expo-notifications');
    await Notifications.setBadgeCountAsync(Math.max(0, count ?? 0));
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

// One-shot contextual permission ask (founder 2026-06-29): fire the OS
// push-permission prompt at the first moment the user has experienced
// something notification-worthy (first friend-add success, first open of
// the Notifications tab) instead of cold at app start — the cold ask is
// the highest-refusal timing on iOS, and a refusal there is near-permanent
// (Settings-only to undo). We only ever trigger the OS dialog once
// (AsyncStorage flag); if permission is already granted this just makes
// sure the token is registered.
const PUSH_PROMPTED_KEY = 'piktag_push_prompted_v1';

export async function maybeAskPushPermission(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const Notifications = await import('expo-notifications');
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') {
      // Already granted (existing installs) — refresh the token, no prompt.
      await registerForPushNotifications(user.id, { requestPermission: false });
      return;
    }
    if (!canAskAgain) return; // hard-denied at the OS level — don't nag

    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    if (await AsyncStorage.getItem(PUSH_PROMPTED_KEY)) return;
    await AsyncStorage.setItem(PUSH_PROMPTED_KEY, '1');

    await registerForPushNotifications(user.id, { requestPermission: true });
  } catch {
    /* best-effort — a failed ask must never break the calling flow */
  }
}

// Records that the user is active so the server-side 3-day-inactivity badge
// cron knows NOT to clear them. Throttled to ≤1 write / 30 min — last_active_at
// only needs day-level freshness, and foreground fires often. Uses auth.uid()
// server-side, so no userId arg; a no-op when signed out (0 rows updated).
let _lastTouchAt = 0;
export async function touchLastActive(): Promise<void> {
  const now = Date.now();
  if (now - _lastTouchAt < 30 * 60 * 1000) return;
  _lastTouchAt = now;
  try {
    await supabase.rpc('touch_last_active');
  } catch {
    /* best-effort — badge auto-clear tolerates a missed touch */
  }
}
