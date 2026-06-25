import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Alert, View, StyleSheet, Platform, InteractionManager } from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home,
  Search,
  QrCode,
  MessageCircle,
  Bell,
  User,
} from 'lucide-react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAppReady } from '../context/AppReadyContext';
import { useTranslation } from 'react-i18next';
import { registerForPushNotifications, refreshBadgeFromServer } from '../lib/pushNotifications';
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
// Task 2 (QR groups): AddTagTab now lands on QrGroupListScreen
// instead of AddTagScreen directly. AddTagScreen becomes the
// "create new group" form, pushed onto the stack from the list.
import QrGroupListScreen from '../screens/QrGroupListScreen';
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
const ChatStack = createNativeStackNavigator();
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

function ChatStackNavigator() {
  return (
    <ChatStack.Navigator screenOptions={{ headerShown: false }}>
      {/* Chat inbox is the tab root (founder 2026-06-24 — chat promoted
          to a first-class tab, replacing the event-QR tab). Threads +
          compose live in RootStack (full-screen, no tab bar) so opening
          a chat from a profile returns to that profile; opening one from
          here returns to the inbox. */}
      <ChatStack.Screen
        name="ChatList"
        getComponent={() => require('../screens/ChatListScreen').default}
      />
    </ChatStack.Navigator>
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();
  const { total: chatUnread } = useChatUnread();
  const insets = useSafeAreaInsets();
  // edgeToEdgeEnabled (app.json) + targetSdk 35 make the app draw UNDER the
  // Android system nav bar, so this bottom-pinned tab bar MUST reserve the
  // device's REAL bottom inset or the icon row sits under the 3-button /
  // gesture nav and the OS captures the taps (the founder's "點不到按鈕"
  // report). insets.bottom is ~0 on full-gesture devices and ~24-48dp on
  // 3-button / tall OEM nav bars; a 12px floor keeps breathing room when the
  // inset is 0, and Math.max guards the brief first-frame 0 before native
  // insets resolve (canonical pattern: LocalContactDetailScreen footer). The
  // icon/touch row stays a fixed 52px (paddingTop 10 + ~42 icon area) so
  // proportions are identical across devices — only the reserved bottom space
  // varies. Replaces the old hardcoded paddingBottom:28 / height:80, which was
  // too short on 3-button nav bars.
  const bottomInset = Math.max(insets.bottom, 12);
  // Single source of truth for the tab bar style — referenced both
  // as the default screenOptions baseline AND inside per-tab options
  // (AddTagTab below) where we conditionally hide it on inner screens
  // that need full-bleed real estate (the QR display + group detail).
  const baseTabBarStyle = {
    backgroundColor: isDark ? '#000000' : '#FFFFFF',
    borderTopWidth: isDark ? 0.5 : 1,
    borderTopColor: isDark ? '#363636' : colors.gray100,
    paddingBottom: bottomInset,
    paddingTop: 10,
    height: 52 + bottomInset,
  } as const;
  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      detachInactiveScreens={true}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: baseTabBarStyle,
        tabBarActiveTintColor: isDark ? '#ffffff' : colors.piktag500,
        tabBarInactiveTintColor: isDark ? '#8e8e8e' : colors.gray400,
        // Unread chat count badge — accentPop on purpose (high-saturation
        // pop reserved for moments that should jump the eye, per the
        // theme's accent vs primary system).
        tabBarBadgeStyle: {
          backgroundColor: colors.accentPop,
          color: '#FFFFFF',
        },
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
              fill={focused ? color : 'none'}
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
          // No tabBarBadge here — moved to NotificationsTab below.
          // The chat inbox is reached through the bell-tab header's
          // ChatList button, so an unread count on the magnifying
          // glass misdirected users to a tab unrelated to messages.
          tabBarIcon: ({ color, focused }) => (
            <Search
              size={24}
              color={color}
              fill={focused ? color : 'none'}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="ChatTab"
        component={ChatStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.chat'),
          // Chat is the reactivation-loop endpoint (search→message,
          // icebreaker→reconnect). Promoted from the bell-tab header to a
          // first-class tab 2026-06-24, taking the slot the unpopular
          // event-QR tab held. The unread badge lives here now.
          tabBarBadge: chatUnread > 0 ? chatUnread : undefined,
          tabBarIcon: ({ color, focused }) => (
            <MessageCircle
              size={24}
              color={color}
              fill={focused ? color : 'none'}
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
              fill={focused ? color : 'none'}
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
              fill={focused ? color : 'none'}
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
    </Tab.Navigator>
    {/* TabTooltipOverlay removed 2026-06-10 (founder — testers still saw
        it; a823b87 shipped QuickStartTour + this overlay together, fbc6299
        removed only the tour and this sibling survived). Five labels that
        vanish on one tap teach nothing; the wizard payoff step now owns
        first-use education. */}
    </View>
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

        {/* Event-group QR (demoted from the # tab 2026-06-24): full-screen
            pushes reached from the Home header QR button + on_this_day
            deep links. Kept, not deleted — the conference/meetup case the
            store copy sells. */}
        <RootStack.Screen name="QrGroupList" component={QrGroupListScreen} />
        <RootStack.Screen name="AddTagCreate" component={AddTagScreen} />
        <RootStack.Screen
          name="QrGroupDetail"
          getComponent={() => require('../screens/QrGroupDetailScreen').default}
        />

        {/* Chat thread + compose live in RootStack so back-navigation
            returns to the origin (TagDetail → UserDetail → ChatThread →
            back → UserDetail). The inbox (ChatList) is the ChatTab root. */}
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
          name="LocationContacts"
          getComponent={() => require('../screens/LocationContactsScreen').default}
        />
        <RootStack.Screen
          name="LocalContactDetail"
          getComponent={() => require('../screens/LocalContactDetailScreen').default}
        />
        <RootStack.Screen
          name="EditLocalContact"
          getComponent={() => require('../screens/EditLocalContactScreen').default}
        />
        <RootStack.Screen
          name="SocialStats"
          getComponent={() => require('../screens/SocialStatsScreen').default}
        />
        <RootStack.Screen
          name="CameraScan"
          getComponent={() => require('../screens/CameraScanScreen').default}
        />
        {/* Custom business-card capture (framing guide → better OCR).
            Two modes: (1) entry mode { forNewContact:true } — the "+人"
            icon opens this FIRST and it REPLACES itself with
            EditLocalContact on capture / 手動輸入; (2) callback mode
            { onCaptured,... } — retry-from-form + onboarding hand the
            photo back to the caller's scan pipeline. */}
        <RootStack.Screen
          name="CardCamera"
          getComponent={() => require('../screens/CardCameraScreen').default}
        />
        <RootStack.Screen
          name="PrivacyPolicy"
          getComponent={() => require('../screens/legal/PrivacyPolicyScreen').default}
        />
        <RootStack.Screen
          name="TermsOfService"
          getComponent={() => require('../screens/legal/TermsOfServiceScreen').default}
        />
        {/* PointsHistory route removed — the p_points system was
            retired in the Tribe-size pivot. DB columns (p_points,
            p_points_lifetime) + piktag_points_ledger table are kept
            as legacy artifacts (no new writes, no readers) and can
            be dropped in a separate DB-side cleanup if needed. */}
        {/* Network graph — how the viewer's OWN friends interconnect, plus
            anonymous "you may know" bridges (2026-06-25, replaces the retired
            invite-lineage Tribe). Reached from the Friends-page friend count. */}
        <RootStack.Screen
          name="NetworkGraph"
          getComponent={() => require('../screens/NetworkGraphScreen').default}
        />
        {/* Followers list. Reached from the "追蹤者" stat on
            ProfileScreen / FriendDetail / UserDetail. Params:
            { userId, displayName? }. */}
        <RootStack.Screen
          name="Followers"
          getComponent={() => require('../screens/FollowersScreen').default}
        />

        {/* Modal screens */}
        {/* Eager: QR scan result is part of the primary scan flow */}
        {/* `as any` on the component prop: ScanResultScreen uses a local
            Props type rather than React Navigation's typed param-list.
            Strictly typing it would require lifting RootStackParamList
            into the screen file itself — a larger refactor than this
            error-cleanup scope warrants. */}
        <RootStack.Screen
          name="ScanResult"
          component={ScanResultScreen as any}
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
// Per-account cache key. The bare ONBOARDING_COMPLETED_KEY was a
// DEVICE-GLOBAL flag, so onboarding-completion leaked across accounts
// on the same device: once ANY account finished (or an old account
// backfilled the flag), EVERY later account on that phone skipped the
// wizard — the "精靈全部沒發生" bug the founder hit on a real device.
// Namespacing by user id scopes completion to the account it belongs to.
const onboardingFlagKey = (userId: string) => `${ONBOARDING_COMPLETED_KEY}_${userId}`;

// Decision for whether to include the Onboarding screen in the root
// stack. `pending` = auth/onboarding check hasn't resolved yet (hold
// the spinner). `required` = include Onboarding as the initial route.
// `skip` = go straight to Main.
type OnboardingDecision = 'pending' | 'required' | 'skip';

export default function AppNavigator() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingDecision, setOnboardingDecision] = useState<OnboardingDecision>('pending');
  // Mirror the latest session into a ref so the deep-link capture
  // closure (registered once on mount) can read fresh auth state
  // without re-subscribing every time `session` changes.
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // The user id we last ran the onboarding decision for. Guards the
  // auth-state listener so we ONLY re-decide on a genuine sign-in /
  // account switch (user id changes) — never on a token refresh, which
  // also fires onAuthStateChange and would otherwise re-flash the
  // loader + re-query every hour.
  const decidedForUserRef = useRef<string | null>(null);
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
          // (Invite-code deep-link handoff removed — the invite/redeem
          // gate was retired; open signup, no codes. Only the QR/sid
          // connect deep link is handled now.)
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

    // Anti-brick watchdog. The launch gate (loading || onboardingDecision
    // === 'pending') MUST always resolve. Both getSession() and the
    // onboarding profile check touch the network, and RN fetch never
    // times out — a stalled token refresh / query would otherwise pin the
    // splash loader FOREVER (the founder's real-device brick, 2026-06-05).
    // Backstop: if we're still unresolved after 7s, force the gate open
    // (fail-open to Main). decideOnboarding's own 4s query timeout
    // normally resolves first; this only catches a hang BEFORE that
    // (e.g. getSession itself stalling).
    const watchdog = setTimeout(() => {
      if (!isMounted) return;
      setLoading(false);
      setOnboardingDecision((d) => (d === 'pending' ? 'skip' : d));
    }, 7000);

    const finalize = () => {
      if (!isMounted) return;
      clearTimeout(watchdog);
      setLoading(false);
      // Signal splash that auth/onboarding decision has landed.
      markReady('auth');
    };

    // Hydrate persisted onboarding flag BEFORE anything else so we can
    // decide the initial route synchronously once auth lands. This
    // prevents the flash of Main-then-Onboarding that happens when the
    // onboarding check races the navigator mount.
    const hydrate = async () => {
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
      // Coalesce email to '' so the property is always a string —
      // PostHog's `identify` properties accept strings/numbers/bools but
      // not `undefined`, and Supabase's session.user.email is optional.
      posthog.identify(currentSession.user.id, {
        email: currentSession.user.email ?? '',
      });

      decidedForUserRef.current = currentSession.user.id;
      await decideOnboarding(currentSession.user.id, currentSession.user.created_at);

      // Defer push notification registration until after the first
      // frame paints — frees the JS thread during the critical
      // boot-to-interactive window.
      const userId = currentSession.user.id;
      InteractionManager.runAfterInteractions(() => {
        registerForPushNotifications(userId).catch(() => {});
        // Reflect the user's unread count on the app icon. No
        // separate badge toggle by design — the badge is the visible
        // form of "you have unread notifications you opted into".
        refreshBadgeFromServer(userId).catch(() => {});
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
          const uid = newSession.user.id;
          // Only act on a genuine sign-in / account switch (user id
          // changed) — skip token refreshes (same user) so we don't
          // re-flash the loader or re-query every hour.
          if (decidedForUserRef.current !== uid) {
            decidedForUserRef.current = uid;
            // Show the loader (not Main) WHILE we decide, so a fresh
            // registration goes splash → wizard with NO flash of the
            // empty home in between ("新帳號一註冊就走精靈", founder).
            setOnboardingDecision('pending');
            await decideOnboarding(uid, newSession.user.created_at);
            // Resolve pending connections for newly registered users.
            resolvePendingDeepLink(uid, newSession.user.created_at);
          }
        } else {
          decidedForUserRef.current = null;
          setOnboardingDecision('skip');
        }
        // Auth-state changes after initial load should never re-open
        // the splash; just keep `loading` false.
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
    // markReady identity is stable from AppReadyContext; we intentionally
    // run this effect exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-ACCOUNT onboarding gate, keyed on the SERVER flag
  // piktag_profiles.onboarding_completed — not a device-global flag and
  // not auth.users.created_at. That column is set TRUE only at the
  // wizard's true completion point (handleComplete), so it's immune to
  // the "username+full_name written at end of step 1" false-positive.
  //
  // Why this shape (founder real-device test, 2026-06-05 — "精靈全部
  // 沒發生" on fresh accounts):
  //   • The old source-of-truth was a DEVICE-GLOBAL AsyncStorage flag,
  //     so once any account on the phone finished — or an OLD account
  //     hit the >5min backfill — EVERY later account skipped the wizard.
  //   • The fallback gate "created_at < 5 min" also stranded a new user
  //     who got interrupted >5 min mid-flow with an incomplete profile.
  // Completeness-on-the-profile fixes both: per-account, survives
  // interruption, and is testable (any incomplete account shows it).
  // The namespaced AsyncStorage key is now only a fast-path cache so a
  // returning, already-complete account skips the profile round-trip.
  const decideOnboarding = async (userId: string, createdAt?: string) => {
    // Fail-open vs fail-closed is AGE-DEPENDENT. For an ESTABLISHED account
    // a transient query failure must never trap them in the wizard → 'skip'.
    // But for a BRAND-NEW account (created minutes ago — e.g. a fresh Google
    // sign-up on a slow Android network, where the post-OAuth token refresh
    // can hold the auth lock past the 4s timeout) failing open SKIPS the
    // sacred linear wizard entirely — the founder's "新帳號沒看到精靈"
    // report. A fresh account belongs IN the wizard, so for them we fail
    // closed → 'required'.
    const isFreshAccount = !!createdAt &&
      Date.now() - new Date(createdAt).getTime() < 10 * 60 * 1000;
    const failDecision = isFreshAccount ? 'required' as const : 'skip' as const;
    try {
      const cacheKey = onboardingFlagKey(userId);
      const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
      if (cached === 'true') {
        setOnboardingDecision('skip');
        return;
      }

      // Bound the query with a timeout. It sits on the launch / sign-in
      // gate, and RN fetch never times out — a stalled query (e.g. a
      // token refresh holding the auth lock) would otherwise pin the
      // splash loader FOREVER (the founder's real-device brick, 2026-06-05).
      // On timeout, fail-OPEN to 'skip' so the gate always resolves: the
      // app launches and the profile is still finishable in EditProfile.
      const TIMED_OUT = Symbol('timeout');
      const raced: any = await Promise.race([
        supabase
          .from('piktag_profiles')
          .select('onboarding_completed')
          .eq('id', userId)
          .maybeSingle(),
        new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), 4000)),
      ]);
      if (raced === TIMED_OUT) {
        setOnboardingDecision(failDecision);
        return;
      }

      const { data: prof, error } = raced;
      if (error) {
        // Established account: fail-OPEN — never trap a real user in the
        // wizard over a transient query error (finishable in EditProfile).
        // Fresh account: fail-CLOSED into the wizard (see above).
        setOnboardingDecision(failDecision);
        return;
      }

      // Explicit server flag, set ONLY at full wizard completion
      // (handleComplete). Null row (fresh signup) or false (interrupted,
      // incl. bailed-after-step-1) → not complete → show the wizard.
      const complete = !!prof && prof.onboarding_completed === true;
      if (complete) {
        // Cache the per-account result so later launches skip the query.
        // (Tab-tooltip backfill removed with the overlay, 2026-06-10.)
        AsyncStorage.setItem(cacheKey, 'true').catch(() => {});
        setOnboardingDecision('skip');
      } else {
        // Null profile (fresh signup) or missing username/full_name
        // (interrupted) → the wizard hasn't been completed. Show it.
        setOnboardingDecision('required');
      }
    } catch (err) {
      console.warn('Onboarding check error:', err);
      setOnboardingDecision(failDecision);
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

      // Security (M10): require explicit user confirmation before
      // accepting a deep-link-supplied scan session. A malicious link
      // could otherwise auto-attach the new user to an unintended
      // connection at registration time.
      const confirmed: boolean = await new Promise((resolve) => {
        Alert.alert(
          t('appNav.confirmInviteTitle', { defaultValue: 'Confirm connection' }),
          pending?.username
            ? t('appNav.confirmInviteBody', {
                name: pending.username,
                defaultValue: `Connect with @${pending.username} from your invite link?`,
              })
            : t('appNav.confirmInviteBodyAnon', {
                defaultValue: 'Accept the connection from your invite link?',
              }),
          [
            {
              text: t('appNav.confirmInviteCancel', { defaultValue: 'Cancel' }),
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: t('appNav.confirmInviteAccept', { defaultValue: 'Connect' }),
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;

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
        <PageLoader />
      </View>
    );
  }

  return session ? (
    <MainNavigator needsOnboarding={onboardingDecision === 'required'} />
  ) : (
    <AuthNavigator />
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.white,
  },
  });
}
