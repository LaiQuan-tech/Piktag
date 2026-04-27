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
import { useAppReady } from '../context/AppReadyContext';
import { useTranslation } from 'react-i18next';
import { registerForPushNotifications } from '../lib/pushNotifications';
import { posthog } from '../lib/analytics';
import { ChatUnreadProvider, useChatUnread } from '../hooks/useChatUnread';

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
      <SearchStack.Screen
        name="ChatList"
        getComponent={() => require('../screens/ChatListScreen').default}
      />
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
  const { total: chatUnread } = useChatUnread();
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
          tabBarBadge: chatUnread > 0 ? chatUnread : undefined,
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
    <ChatUnreadProvider>
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

        {/* Chat thread + compose live in RootStack so back-navigation
            returns to the screen the user came from (e.g. TagDetail →
            UserDetail → ChatThread → back goes to UserDetail) instead
            of popping inside the SearchTab to its root. */}
        <RootStack.Screen
          name="ChatThread"
          getComponent={() => require('../screens/ChatThreadScreen').default}
        />
        <RootStack.Screen
          name="ChatCompose"
          getComponent={() => require('../screens/ChatComposeScreen').default}
          options={{ presentation: 'modal' }}
        />

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
    </ChatUnreadProvider>
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
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

// Decision for whether to include the Onboarding screen in the root
// stack. `pending` = auth/onboarding check hasn't resolved yet (hold
// the spinner). `required` = include Onboarding as the initial route.
// `skip` = go straight to Main.
type OnboardingDecision = 'pending' | 'required' | 'skip';

export default function AppNavigator() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingDecision, setOnboardingDecision] = useState<OnboardingDecision>('pending');
  // Pending deep link holds the parsed payload from cold start until a
  // consumer (post-register flow) clears it. Stored in a ref so capture
  // and consume don't race through render cycles.
  const pendingDeepLinkRef = useRef<{ username?: string; sid?: string } | null>(null);
  // Cold-start URL is only fetched once per app launch — guard against
  // StrictMode double-invocation and any accidental remount.
  const coldStartHandledRef = useRef(false);
  const { markReady } = useAppReady();

  // Deep link capture. Runs once on mount: grabs the cold-start URL,
  // subscribes to runtime URL events, and cleans up via the
  // EventSubscription.remove() API (RN 0.72+). The listener is
  // registered exactly once.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let sub: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        const Linking = await import('expo-linking');

        const captureDeepLink = (url: string | null, persist: boolean) => {
          const parsed = parseSidFromUrl(url);
          if (!parsed?.sid) return;
          // In-memory first so the auth-resolution path can consume
          // without touching AsyncStorage (fast path).
          pendingDeepLinkRef.current = parsed;
          if (persist) {
            // Persist as a safety net: if the app is killed between
            // cold-start capture and register completion, we still get
            // a chance to resolve the pending connection next launch.
            AsyncStorage.setItem(PENDING_DEEP_LINK_KEY, JSON.stringify(parsed)).catch(() => {});
          }
        };

        if (!coldStartHandledRef.current) {
          coldStartHandledRef.current = true;
          const initialUrl = await Linking.getInitialURL();
          if (!cancelled) captureDeepLink(initialUrl, true);
        }

        if (cancelled) return;
        sub = Linking.addEventListener('url', (event: { url: string }) =>
          captureDeepLink(event.url, true),
        );
      } catch (err) {
        if (__DEV__) console.warn('[DeepLink] capture error:', err);
      }
    })();

    return () => {
      cancelled = true;
      // EventSubscription.remove() — the modern RN 0.72+ API. The
      // deprecated Linking.removeEventListener was removed in RN 0.72.
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const finalize = () => {
      if (!isMounted) return;
      setLoading(false);
      // Signal splash that auth/onboarding decision has landed.
      markReady('auth');
    };

    // Hydrate persisted onboarding flag BEFORE anything else so we can
    // decide the initial route synchronously once auth lands. This
    // prevents the flash of Main-then-Onboarding that happens when the
    // onboarding check races the navigator mount.
    const hydrate = async () => {
      let persistedCompleted = false;
      try {
        const raw = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
        persistedCompleted = raw === 'true';
      } catch {}

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(currentSession);

      if (!currentSession?.user) {
        // No session = auth stack. No onboarding check needed.
        setOnboardingDecision('skip');
        finalize();
        return;
      }

      // Identify user in PostHog so all events are linked to this account.
      posthog.identify(currentSession.user.id, {
        email: currentSession.user.email,
      });

      if (persistedCompleted) {
        // Persisted flag is the source of truth — bio check only runs
        // when nothing is stored (first launch post-upgrade / reinstall).
        setOnboardingDecision('skip');
      } else {
        await decideOnboarding(currentSession.user.id, currentSession.user.created_at);
      }

      // Defer push notification registration until after the first
      // frame paints — frees the JS thread during the critical
      // boot-to-interactive window.
      const userId = currentSession.user.id;
      InteractionManager.runAfterInteractions(() => {
        registerForPushNotifications(userId).catch(() => {});
      });

      finalize();
    };

    hydrate();

    // Listen for auth state changes (sign-in, sign-out, token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!isMounted) return;
        setSession(newSession);
        if (newSession?.user) {
          let persistedCompleted = false;
          try {
            persistedCompleted = (await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY)) === 'true';
          } catch {}
          if (persistedCompleted) {
            setOnboardingDecision('skip');
          } else {
            await decideOnboarding(newSession.user.id, newSession.user.created_at);
          }
          // Resolve pending connections for newly registered users.
          resolvePendingDeepLink(newSession.user.id, newSession.user.created_at);
        } else {
          setOnboardingDecision('skip');
        }
        // Auth-state changes after initial load should never re-open
        // the splash; just keep `loading` false.
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
    // markReady identity is stable from AppReadyContext; we intentionally
    // run this effect exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decideOnboarding = async (userId: string, userCreatedAt: string) => {
    try {
      // Only truly new accounts (< 5min old) are onboarding candidates.
      // Older accounts without a persisted flag are considered already
      // onboarded — forcing them through the flow again would be worse
      // UX than letting them through.
      const createdAt = new Date(userCreatedAt);
      const diffMs = Date.now() - createdAt.getTime();
      const isNewUser = diffMs < 5 * 60 * 1000;

      if (!isNewUser) {
        setOnboardingDecision('skip');
        // Backfill the flag so we don't re-check on every launch.
        AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true').catch(() => {});
        return;
      }

      // For new users, check if bio is filled in (legacy indicator of
      // onboarding completion). Keeps backwards compatibility with
      // existing users who onboarded before the persisted flag shipped.
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('bio')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Error checking onboarding status:', error.message);
        // Fail open — don't trap the user behind onboarding if the DB
        // call fails.
        setOnboardingDecision('skip');
        return;
      }

      const bioEmpty = !data?.bio || data.bio.trim() === '';
      if (bioEmpty) {
        setOnboardingDecision('required');
      } else {
        setOnboardingDecision('skip');
        AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true').catch(() => {});
      }
    } catch (err) {
      console.warn('Onboarding check error:', err);
      setOnboardingDecision('skip');
    }
  };

  // Resolve pending deep link connections after registration. Prefers
  // the in-memory ref (fast path) but falls back to AsyncStorage so a
  // cold-start capture survives an app kill before registration
  // completes.
  const resolvePendingDeepLink = async (userId: string, userCreatedAt: string) => {
    try {
      // Only for new users (registered within 5 minutes).
      const diffMs = Date.now() - new Date(userCreatedAt).getTime();
      if (diffMs > 5 * 60 * 1000) return;

      let pending = pendingDeepLinkRef.current;
      if (!pending) {
        const stored = await AsyncStorage.getItem(PENDING_DEEP_LINK_KEY);
        if (stored) pending = JSON.parse(stored) as { username?: string; sid?: string };
      }

      if (!pending?.sid) return;

      // Clear BOTH ref and persisted key immediately to prevent double
      // processing (second auth-state change, hot reload, etc).
      pendingDeepLinkRef.current = null;
      await AsyncStorage.removeItem(PENDING_DEEP_LINK_KEY).catch(() => {});

      const { error } = await supabase.rpc('resolve_pending_connections', {
        p_new_user_id: userId,
        p_scan_session_id: pending.sid,
      });

      if (error) {
        console.warn('[PendingConn] resolve error:', error.message);
      }
    } catch (err) {
      console.warn('[PendingConn] resolvePendingDeepLink error:', err);
    }
  };

  if (loading || onboardingDecision === 'pending') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.piktag500} />
      </View>
    );
  }

  return session ? (
    <MainNavigator needsOnboarding={onboardingDecision === 'required'} />
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
