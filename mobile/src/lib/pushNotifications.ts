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
