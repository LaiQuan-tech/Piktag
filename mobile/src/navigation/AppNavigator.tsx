import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet, Platform, InteractionManager } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Home,
  Search,
  QrCode,
  Hash,
  Bell,
  User,
} from 'lucide-react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { registerForPushNotifications } from '../lib/pushNotifications';
import { posthog } from '../lib/analytics';

// Auth Screens — eager (needed before session resolves)
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OnboardingScreen from '../screens/auth/OnboardingScreen';

// Tab-level screens — eager (loaded on first render of MainTabs)
import ConnectionsScreen from '../screens/ConnectionsScreen';
import SearchScreen from '../screens/SearchScreen';
import AddTagScreen from '../screens/AddTagScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';

// Primary drill-downs — eager (hit on almost every session, navigation
// animation would mask any lazy-require latency but the module cost is
// significant enough that keeping them warm is the better tradeoff)
import FriendDetailScreen from '../screens/FriendDetailScreen';
import UserDetailScreen from '../screens/UserDetailScreen';
import TagDetailScreen from '../screens/TagDetailScreen';
import ScanResultScreen from '../screens/ScanResultScreen';

// Secondary screens — lazy-loaded via getComponent prop below (13 screens
// for ~500-800KB of deferred module evaluation). The inline require()
// pattern is Metro-friendly and doesn't need Suspense boilerplate. The
// module is pulled in on first navigation to that screen.

// Stack Navigators
const AuthStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();
const SearchStack = createNativeStackNavigator();
const AddTagStack = createNativeStackNavigator();
const NotificationStack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
}

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Connections" component={ConnectionsScreen} />
    </HomeStack.Navigator>
  );
}

function SearchStackNavigator() {
  return (
    <SearchStack.Navigator screenOptions={{ headerShown: false }}>
      <SearchStack.Screen name="SearchMain" component={SearchScreen} />
    </SearchStack.Navigator>
  );
}

function AddTagStackNavigator() {
  return (
    <AddTagStack.Navigator screenOptions={{ headerShown: false }}>
      <AddTagStack.Screen name="AddTagMain" component={AddTagScreen} />
    </AddTagStack.Navigator>
  );
}

function NotificationStackNavigator() {
  return (
    <NotificationStack.Navigator screenOptions={{ headerShown: false }}>
      <NotificationStack.Screen name="NotificationMain" component={NotificationsScreen} />
    </NotificationStack.Navigator>
  );
}

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
    </ProfileStack.Navigator>
  );
}

function MainTabs() {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      detachInactiveScreens={true}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#000000' : '#FFFFFF',
          borderTopWidth: isDark ? 0.5 : 1,
          borderTopColor: isDark ? '#363636' : COLORS.gray100,
          paddingBottom: 28,
          paddingTop: 10,
          height: 80,
        },
        tabBarActiveTintColor: isDark ? '#ffffff' : COLORS.piktag500,
        tabBarInactiveTintColor: isDark ? '#8e8e8e' : COLORS.gray400,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.home'),
          tabBarIcon: ({ color, focused }) => (
            <Home
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.search'),
          tabBarIcon: ({ color, focused }) => (
            <Search
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="AddTagTab"
        component={AddTagStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.addTag'),
          tabBarIcon: ({ color, focused }) => (
            <Hash
              size={28}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.notifications'),
          tabBarIcon: ({ color, focused }) => (
            <Bell
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.profile'),
          tabBarIcon: ({ color, focused }) => (
            <User
              size={24}
              color={color}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Root stack that wraps MainTabs + modal screens + onboarding
const RootStack = createNativeStackNavigator();

function MainNavigator({ needsOnboarding }: { needsOnboarding: boolean }) {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {needsOnboarding ? (
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : null}
      <RootStack.Screen name="Main" component={MainTabs} />

      {/* Task/detail screens — no tab bar */}
      {/* Eager: primary drill-downs hit on every session */}
      <RootStack.Screen name="FriendDetail" component={FriendDetailScreen} />
      <RootStack.Screen name="UserDetail" component={UserDetailScreen} />
      <RootStack.Screen name="TagDetail" component={TagDetailScreen} />

      {/* Lazy: secondary screens loaded on first navigation */}
      <RootStack.Screen
        name="EditProfile"
        getComponent={() => require('../screens/EditProfileScreen').default}
      />
      <RootStack.Screen
        name="ManageTags"
        getComponent={() => require('../screens/ManageTagsScreen').default}
      />
      <RootStack.Screen
        name="Settings"
        getComponent={() => require('../screens/SettingsScreen').default}
      />
      <RootStack.Screen
        name="ContactSync"
        getComponent={() => require('../screens/ContactSyncScreen').default}
      />
      <RootStack.Screen
        name="Invite"
        getComponent={() => require('../screens/InviteScreen').default}
      />
      <RootStack.Screen
        name="LocationContacts"
        getComponent={() => require('../screens/LocationContactsScreen').default}
      />
      <RootStack.Screen
        name="SocialStats"
        getComponent={() => require('../screens/SocialStatsScreen').default}
      />
      <RootStack.Screen
        name="CameraScan"
        getComponent={() => require('../screens/CameraScanScreen').default}
      />
      <RootStack.Screen
        name="PrivacyPolicy"
        getComponent={() => require('../screens/legal/PrivacyPolicyScreen').default}
      />
      <RootStack.Screen
        name="TermsOfService"
        getComponent={() => require('../screens/legal/TermsOfServiceScreen').default}
      />
      <RootStack.Screen
        name="PointsHistory"
        getComponent={() => require('../screens/PointsHistoryScreen').default}
      />
      <RootStack.Screen
        name="RedeemInvite"
        getComponent={() => require('../screens/RedeemInviteScreen').default}
      />

      {/* Modal screens */}
      {/* Eager: QR scan result is part of the primary scan flow */}
      <RootStack.Screen
        name="ScanResult"
        component={ScanResultScreen}
        options={{ presentation: 'modal' }}
      />
      {/* Lazy: one-time review flow */}
      <RootStack.Screen
        name="ActivityReview"
        getComponent={() => require('../screens/ActivityReviewScreen').default}
        options={{ presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

// Parse sid from a piktag deep link URL
function parseSidFromUrl(url: string | null): { username?: string; sid?: string } | null {
  if (!url) return null;
  try {
    // Handle piktag://username?sid=xxx or https://pikt.ag/username?sid=xxx
    const parsed = new URL(url.replace('piktag://', 'https://piktag.app/'));
    const sid = parsed.searchParams.get('sid');
    const pathParts = parsed.pathname.replace(/^\//, '').split('/');
    const username = pathParts[0] || undefined;
    if (sid && username) return { username, sid };
  } catch {}
  return null;
}

const PENDING_DEEP_LINK_KEY = 'piktag_pending_deep_link';

export default function AppNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const navigationRef = useRef<any>(null);

  // Capture deep links — only on native (web handles routing differently)
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let sub: any;
    (async () => {
      try {
        const Linking = await import('expo-linking');
        const captureDeepLink = (url: string | null) => {
          const parsed = parseSidFromUrl(url);
          if (parsed?.sid) {
            AsyncStorage.setItem(PENDING_DEEP_LINK_KEY, JSON.stringify(parsed));
          }
        };

        const initialUrl = await Linking.getInitialURL();
        captureDeepLink(initialUrl);

        sub = Linking.addEventListener('url', (event: any) => captureDeepLink(event.url));
      } catch {}
    })();
    return () => { if (sub) sub.remove(); };
  }, []);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        // Identify user in PostHog so all events are linked to this account.
        posthog.identify(currentSession.user.id, {
          email: currentSession.user.email,
        });
        checkOnboardingStatus(currentSession.user.id, currentSession.user.created_at);
        // Defer push notification registration until after the first frame
        // has been painted and the main screen's mount work has settled.
        // This frees up the JS thread during the critical boot-to-interactive
        // window (~1-2s). Permissions dialog + token fetch + DB write were
        // previously competing with the ConnectionsScreen first-mount queries.
        const userId = currentSession.user.id;
        InteractionManager.runAfterInteractions(() => {
          registerForPushNotifications(userId).catch(() => {});
        });
      } else {
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          checkOnboardingStatus(newSession.user.id, newSession.user.created_at);
          // Resolve pending connections for newly registered users
          resolvePendingDeepLink(newSession.user.id, newSession.user.created_at);
        } else {
          setNeedsOnboarding(false);
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const checkOnboardingStatus = async (userId: string, userCreatedAt: string) => {
    try {
      // Check if user account was created within the last 5 minutes
      const createdAt = new Date(userCreatedAt);
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const isNewUser = diffMs < 5 * 60 * 1000; // 5 minutes

      if (!isNewUser) {
        setNeedsOnboarding(false);
        setLoading(false);
        return;
      }

      // Check if bio is filled in (onboarding complete indicator)
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('bio')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error checking onboarding status:', error.message);
        setNeedsOnboarding(false);
      } else {
        const bioEmpty = !data?.bio || data.bio.trim() === '';
        setNeedsOnboarding(bioEmpty);
      }
    } catch (err) {
      console.warn('Onboarding check error:', err);
      setNeedsOnboarding(false);
    } finally {
      setLoading(false);
    }
  };

  // Resolve pending deep link connections after registration
  const resolvePendingDeepLink = async (userId: string, userCreatedAt: string) => {
    try {
      // Only for new users (registered within 5 minutes)
      const diffMs = Date.now() - new Date(userCreatedAt).getTime();
      if (diffMs > 5 * 60 * 1000) return;

      const stored = await AsyncStorage.getItem(PENDING_DEEP_LINK_KEY);
      if (!stored) return;

      const { sid } = JSON.parse(stored) as { username?: string; sid?: string };
      if (!sid) return;

      // Clear stored deep link immediately to prevent double processing
      await AsyncStorage.removeItem(PENDING_DEEP_LINK_KEY);

      // Call the DB function to resolve pending connection
      const { data, error } = await supabase.rpc('resolve_pending_connections', {
        p_new_user_id: userId,
        p_scan_session_id: sid,
      });

      if (error) {
        console.warn('[PendingConn] resolve error:', error.message);
      }
    } catch (err) {
      console.warn('[PendingConn] resolvePendingDeepLink error:', err);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.piktag500} />
      </View>
    );
  }

  return session ? (
    <MainNavigator needsOnboarding={needsOnboarding} />
  ) : (
    <AuthNavigator />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
});
