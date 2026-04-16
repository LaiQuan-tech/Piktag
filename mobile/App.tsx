import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: '', // TODO: Add Sentry DSN from sentry.io project settings
  tracesSampleRate: 0.2,
  enabled: !__DEV__,
});

import React from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/i18n'; // Initialize i18n
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider } from './src/context/ThemeContext';

// Initialize Sentry for production crash & error monitoring.
// The DSN is intentionally hardcoded — it's a write-only ingest URL
// (no read access to your data), and it MUST be available even when env
// vars are misconfigured (chicken-and-egg: if env breaks, you want
// Sentry to tell you about it).
Sentry.init({
  dsn: 'https://a6f25db2278dc71a2ea41314adc226c0@o4511225670402048.ingest.us.sentry.io/4511227846066176',
  // Only send errors in production. Dev builds still log to console.
  enabled: !__DEV__,
  // Sample 20% of transactions for performance monitoring (keep cost low).
  tracesSampleRate: 0.2,
});

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

function App() {
  const isWeb = Platform.OS === 'web';

  const content = (
    <ThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationContainer linking={linking}>
            <ExpoStatusBar style="dark" />
            <AppNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
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
