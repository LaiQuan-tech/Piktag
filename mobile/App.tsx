import React, { useEffect, useState } from 'react';
import { View, Platform, StyleSheet, InteractionManager } from 'react-native';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // Initialize i18n
import appJson from './app.json';
import AppNavigator from './src/navigation/AppNavigator';
import { trackScreen } from './src/lib/analytics';
import { ThemeProvider } from './src/context/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import { AppReadyProvider, useAppReady } from './src/context/AppReadyContext';
import SplashOverlay from './src/components/SplashOverlay';
import ErrorBoundary from './src/components/ErrorBoundary';
import OfflineBanner from './src/components/OfflineBanner';
import { supabase } from './src/lib/supabase';
import { routeFromNotification } from './src/lib/notificationRouter';

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

// Sentry DSN comes from EXPO_PUBLIC_SENTRY_DSN, substituted into the JS
// bundle by Metro at bundle time. Keeps the DSN out of source control —
// although the DSN is a write-only ingest URL, we'd still rather not
// publish it. CI workflows pass it via job-level env from a GitHub
// secret of the same name.
// Initialization itself is deferred to `InteractionManager.runAfterInteractions`
// in `AppInner` below — running it synchronously at module-eval time
// added ~200ms to cold start (native crash handlers + transport queue
// + session tracking setup).
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const APP_VERSION = (appJson as any)?.expo?.version ?? '0.0.0';
const IOS_BUILD = (appJson as any)?.expo?.ios?.buildNumber ?? '';
const ANDROID_BUILD = (appJson as any)?.expo?.android?.versionCode ?? '';
const BUILD_ID = Platform.OS === 'ios' ? String(IOS_BUILD) : String(ANDROID_BUILD);
const SENTRY_RELEASE = BUILD_ID
  ? `ag.pikt.app@${APP_VERSION}+${BUILD_ID}`
  : `ag.pikt.app@${APP_VERSION}`;

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
          // Also gate on DSN presence so missing-secret CI builds don't
          // try to ship events to nowhere.
          enabled: !__DEV__ && !!SENTRY_DSN,
          environment: __DEV__ ? 'development' : 'production',
          release: SENTRY_RELEASE,
          // Sample 20% of transactions for performance monitoring.
          tracesSampleRate: 0.2,
          // Strip auth secrets from XHR breadcrumbs before they leave
          // the device. Supabase attaches `Authorization` (user JWT) and
          // `apikey` (anon key) on every request — neither belongs in
          // an error report.
          beforeBreadcrumb(breadcrumb) {
            if (breadcrumb.category === 'xhr' && breadcrumb.data?.headers) {
              const h = { ...breadcrumb.data.headers };
              if (h.authorization) h.authorization = '[Filtered]';
              if (h.Authorization) h.Authorization = '[Filtered]';
              if (h.apikey) h.apikey = '[Filtered]';
              breadcrumb.data.headers = h;
            }
            return breadcrumb;
          },
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
    const handleResponse = async (response: Notifications.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, any>;
      const type: string | undefined = data?.type;
      const nav = navigationRef.current as any;
      if (!nav) return;

      // chat type stays special-cased: it nests via SearchTab → ChatThread
      // so the back button returns to the previous chat-list state instead
      // of bouncing between RootStack siblings.
      if (type === 'chat' && data?.conversationId) {
        nav.navigate('Main', {
          screen: 'SearchTab',
          params: { screen: 'ChatThread', params: { conversationId: data.conversationId } },
        });
        return;
      }

      // All other types (follow / tag_added / tag_trending / biolink_click /
      // ask_posted / birthday / anniversary / friend / recommendation / …)
      // share the same routing logic with the in-app NotificationsScreen
      // tap handler. Without this branch a `follow` push opened the app
      // and silently went nowhere — the bug surfaced as "stranger followed
      // me, notification appeared, tapping does nothing".
      if (!type) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await routeFromNotification(nav, { type, data }, session?.user?.id ?? null);
      } catch {
        /* navigation is best-effort here; failure means we stay on the
           current screen, same as before the routing was wired in */
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
              <NavigationContainer
                ref={navigationRef}
                linking={linking}
                onReady={() => {
                  // Capture the very first route once the navigator
                  // mounts — `onStateChange` only fires on transitions,
                  // so without this we'd miss the landing screen of
                  // every session.
                  const route = navigationRef.getCurrentRoute();
                  if (route?.name) {
                    trackScreen(route.name, route.params as Record<string, unknown> | undefined);
                  }
                }}
                onStateChange={() => {
                  // Fires on every navigation state mutation (push, pop,
                  // tab switch, modal present). `getCurrentRoute()`
                  // resolves the deepest active leaf, which is what we
                  // want for screen-level analytics.
                  const route = navigationRef.getCurrentRoute();
                  if (route?.name) {
                    trackScreen(route.name, route.params as Record<string, unknown> | undefined);
                  }
                }}
              >
                <ExpoStatusBar style="dark" />
                <OfflineBanner />
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
