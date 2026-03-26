import React from 'react';
import { StatusBar, View, Platform, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import './src/i18n'; // Initialize i18n
import AppNavigator from './src/navigation/AppNavigator';

const prefix = Linking.createURL('/');

const linking = {
  prefixes: [prefix, 'piktag://', 'https://go.pikt.ag'],
  config: {
    screens: {
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Connections: 'connections',
              FriendDetail: 'friend/:id',
              UserDetail: {
                path: 'u/:username',
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
      ScanResult: 'scan-result',
    },
  },
};

export default function App() {
  const isWeb = Platform.OS === 'web';

  const content = (
    <SafeAreaProvider>
      <NavigationContainer linking={linking}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );

  // Web: center content in a phone-sized container (like Instagram web)
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
