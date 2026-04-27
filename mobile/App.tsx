import React, { useEffect, useState } from 'react';
import { View, Platform, StyleSheet, InteractionManager } from 'react-native';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // Initialize i18n
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { AppReadyProvider, useAppReady } from './src/context/AppReadyContext';
import SplashOverlay from './src/components/SplashOverlay';
import ErrorBoundary from './src/components/ErrorBoundary';

// Ensure foreground notifications display the system banner, play sound,
// and update the badge. Without this, notifications arriving while the
// app is open are silently dropped on iOS.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    // Kept for backward compat with older expo-notifications versions.
    shouldShowAlert: true,
  } as any),
});

// Sentry DSN is a write-only ingest URL — safe to hardcode and critical
// to have available even when env vars are misconfigured (if env breaks,
// we want Sentry to tell us about it).
// Initialization itself is deferred to `InteractionManager.runAfterInteractions`
// in `AppInner` below — running it synchronously at module-eval time
// added ~200ms to cold start (native crash handlers + transport queue
// + session tracking setup).
const SENTRY_DSN =
  'https://a6f25db2278dc71a2ea41314adc226c0@o4511225670402048.ingest.us.sentry.io/4511227846066176';

// expo-linking can crash on web — use safe prefix
let prefix = '';
try {
  if (Platform.OS !== 'web') {
    const Linking = require('expo-linking');
    prefix = Linking.createURL('/');
  }
} catch {}

const linking = {
  prefixes: [prefix, 'piktag://', 'https://pikt.ag', 'https://www.pikt.ag'].filter(Boolean),
  config: {
    screens: {
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Connections: 'connections',
              FriendDetail: 'friend/:id',
              UserDetail: {
                path: ':username',
              },
            },
          },
          AddTagTab: {
            screens: {
              AddTagMain: 'add',
              CameraScan: 'scan',
            },
          },
          ProfileTab: {
            screens: {
              ProfileMain: 'profile',
            },
          },
        },
      },
      RedeemInvite: {
        path: 'invite/:code',
      },
      ScanResult: 'scan-result',
    },
  },
};

// Readiness gates that must all clear before the splash overlay fades:
//   - "auth": AppNavigator has resolved the session + onboarding check.
// If we later add other blocking bootstraps (feature flags, i18n fetch,
// etc), add their names here and call `markReady("<gate>")` from the
// owning module.
const READY_GATES = ['auth'] as const;

function AppInner() {
  const isWeb = Platform.OS === 'web';
  // IG-style 'from PikTag' launch moment, shown on native after the
  // native Expo splash hides and until the app signals readiness (or
  // the overlay's safety-net timer fires). Skipped on web — web has
  // its own landing experience.
  const [splashVisible, setSplashVisible] = useState(!isWeb);
  const navigationRef = useNavigationContainerRef();
  const { isReady } = useAppReady();

  // Defer Sentry initialization until after the first frame paints.
  // The module-level init previously ran synchronously and blocked JS
  // during the critical boot-to-interactive window.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        Sentry.init({
          dsn: SENTRY_DSN,
          // Only send errors in production. Dev builds still log to console.
          enabled: !__DEV__,
          // Sample 20% of transactions for performance monitoring.
          tracesSampleRate: 0.2,
        });
      } catch (err) {
        // Never let Sentry initialization itself crash the app.
        if (__DEV__) console.warn('[Sentry] deferred init failed:', err);
      }
    });
    return () => {
      if (handle && typeof (handle as any).cancel === 'function') {
        (handle as any).cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (isWeb) return;
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { type?: string; conversationId?: string };
      if (data?.type === 'chat' && data?.conversationId) {
        // Navigate into the specific thread. Go via SearchTab > ChatThread.
        navigationRef.current?.navigate('Main' as never, {
          screen: 'SearchTab',
          params: { screen: 'ChatThread', params: { conversationId: data.conversationId } },
        } as never);
      }
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Foreground listener — keeps the default OS banner. We don't act on
    // the payload here (response listener handles taps); the listener's
    // mere presence works with `setNotificationHandler` above to surface
    // the banner while the app is open.
    const foregroundSub = Notifications.addNotificationReceivedListener((_notification) => {
      // intentional no-op: handler config drives the banner display.
    });

    // Cold start: check if the app was opened FROM a notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    });

    return () => {
      sub.remove();
      foregroundSub.remove();
    };
  }, [navigationRef, isWeb]);

  const content = (
    <ThemeProvider>
      <AuthProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <ErrorBoundary>
              <NavigationContainer ref={navigationRef} linking={linking}>
                <ExpoStatusBar style="dark" />
                <AppNavigator />
                {splashVisible && (
                  <SplashOverlay
                    ready={isReady}
                    onHidden={() => setSplashVisible(false)}
                  />
                )}
              </NavigationContainer>
            </ErrorBoundary>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </AuthProvider>
    </ThemeProvider>
  );

  if (isWeb) {
    return (
      <View style={webStyles.outerContainer}>
        <View style={webStyles.innerContainer}>
          {content}
        </View>
      </View>
    );
  }

  return content;
}

function App() {
  return (
    <AppReadyProvider gates={READY_GATES}>
      <AppInner />
    </AppReadyProvider>
  );
}

const webStyles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  innerContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    // Subtle shadow on desktop
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 20px rgba(0,0,0,0.08)',
    } : {}),
  },
});

export default Sentry.wrap(App);
