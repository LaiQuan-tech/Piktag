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
  Hash,
  User,
} from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { checkOffline } from '../lib/netStatus';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuthContext } from '../context/AuthContext';
import { useAppReady } from '../context/AppReadyContext';
import { useTranslation } from 'react-i18next';
import { registerForPushNotifications, refreshBadgeFromServer } from '../lib/pushNotifications';
import { captureAcquisitionSource } from '../lib/acquisition';
import { identifyUser } from '../lib/analytics';
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

// Memoized: AppNavigator now reads auth from AuthContext, so it
// re-renders whenever anything in that context changes (profile hydrate,
// profileLoading flips, hourly TOKEN_REFRESHED). None of that can change
// what these two stacks render, and re-rendering a Navigator's children
// rebuilds the whole screen descriptor tree for nothing.
const AuthNavigator = React.memo(function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
    </AuthStack.Navigator>
  );
});

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

// Event tags (the QR-group list) took the bell's tab slot, 2026-09-01.
// Creating an event QR is a North-Star add-friend moment and it was
// reachable only through a Hash icon in the Profile header — one icon,
// two levels down. Notifications moved to the Chat header instead of
// out of reach: chat is the surface people come back to daily, so the
// bell stays on that path (and it is where IG-shaped muscle memory
// looks). Notifications are still reached by push, which deep-links
// straight to the row's target.
//
// 2026-09-03 it moved again, into the CENTRE slot, swapping with chat
// (founder: 標籤是我們主要的功能，聊天是匹配的功能). Order follows the loop
// rather than the feature list: 標 comes before 連, so the tag surface
// sits ahead of the surface you use once a match already exists. The
// centre of a five-tab bar is also the easiest slot to reach and the one
// convention reserves for CREATING something — which is what this tab
// does. Chat keeps its tab and its unread badge; a badge is found by its
// colour, not its position.
function EventTagStackNavigator() {
  return (
    <NotificationStack.Navigator screenOptions={{ headerShown: false }}>
      <NotificationStack.Screen name="EventTagMain" component={QrGroupListScreen} />
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
  // The tab bar style. It used to be referenced twice — here as the
  // screenOptions baseline and again inside AddTagTab's options, which
  // hid the bar on the inner screens that wanted full-bleed room (the QR
  // display, the group detail). Those screens are RootStack pushes now,
  // so they sit above the tab navigator and get the whole viewport for
  // free; there is no AddTagTab and no per-tab override left. One
  // reference, no conditional.
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
          // No tabBarBadge here: an unread count on the magnifying glass
          // misdirects people to a tab that has nothing to do with
          // messages. Unread messages are counted on ChatTab, which owns
          // them. (This note used to say the count "moved to
          // NotificationsTab" and that the inbox was reached from the
          // bell tab's header — both stale long before the bell gave up
          // its tab on 2026-09-01. Chat has been its own tab since
          // 2026-06-24, and now carries the bell in ITS header.)
          tabBarIcon: ({ color, focused }) => (
            // Search is the exception (founder 2026-06-26): a filled magnifier
            // reads as a lollipop, so keep it outline even when active — the
            // active state shows via colour + the bolder stroke only.
            <Search
              size={24}
              color={color}
              fill="none"
              strokeWidth={focused ? 2.5 : 2}
            />
          ),
        }}
      />
      <Tab.Screen
        name="EventTagTab"
        component={EventTagStackNavigator}
        options={{
          tabBarAccessibilityLabel: t('tabs.eventTags'),
          tabBarIcon: ({ color, focused }) => (
            <Hash size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
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
              // Optical balance (founder 2026-06-26): a filled speech-bubble
              // reads heavier than the other glyphs, so 22 looks equal to the
              // others' 24 — same apparent size, not the same number.
              size={22}
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

// Memoized for the same reason as AuthNavigator above: `needsOnboarding`
// is the only input, and it changes exactly once per sign-in.
const MainNavigator = React.memo(function MainNavigator({ needsOnboarding }: { needsOnboarding: boolean }) {
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
        {/* Pushed from the Chat header bell (the bell lost its tab to
            event tags, 2026-09-01). A RootStack route so it opens over
            whichever tab you are on, and so push deep-links keep a
            target. */}
        <RootStack.Screen name="Notifications" component={NotificationsScreen} />
        {/* QrGroupList as a RootStack push is GONE (2026-09-02). It existed
            for the Profile header's # icon, from the window when event QR
            had no tab. Pushing it mounted a SECOND copy of the tab root on
            top of the tab — two event-tag lists, two composers, and a back
            arrow on a screen that is otherwise a tab root. The tab is the
            only way in now; EventTagMain (in EventTagStackNavigator) is
            the one registration. */}
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
        {/* Burst batch-tag prompt (event-tag rework 方向一, 2026-07-03):
            ScanResult routes here when the last hour's adds hit the burst
            threshold; save/skip land on the just-added friend. Also the
            seed screen for the future full batch-tag feature. */}
        <RootStack.Screen
          name="BatchTag"
          getComponent={() => require('../screens/BatchTagScreen').default}
        />
        {/* Event room list (event-tag rework 方向三, 2026-07-03): opted-in
            attendees of a scan session see each other + one-tap connect.
            Reached from UserDetail's post-connect offer. */}
        <RootStack.Screen
          name="EventAttendees"
          getComponent={() => require('../screens/EventAttendeesScreen').default}
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
});

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

// The one key here that genuinely CANNOT be user-namespaced: it is
// written at cold start, before anyone has signed in, precisely because
// it carries the invite that leads to registration. There is no user id
// to scope it to at capture time, and inventing one would recreate a
// global key under a different name.
//
// Two bounds instead, so a stale invite cannot attach itself to an
// unrelated later registration on a shared phone:
//   • the stored envelope carries its capture time, and a link older
//     than PENDING_DEEP_LINK_TTL_MS is discarded on read;
//   • AuthContext.signOut() removes it, so it never survives a handover
//     from one user to the next.
const PENDING_DEEP_LINK_KEY = 'piktag_pending_deep_link';
// One hour. Long enough for capture → app-store install → sign-up on a
// slow connection, far short of "still here tomorrow for whoever picks
// up the phone". The consumer already refuses accounts older than five
// minutes; this bounds the OTHER side of the same window.
const PENDING_DEEP_LINK_TTL_MS = 60 * 60 * 1000;
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

// The onboarding decision, carried together with the account it was made
// for. Keeping the two in ONE state object is what makes the launch gate
// self-consistent: a decision can never be applied to a different user
// than the one it was computed for, and a slow decision that lands after
// an account switch is ignored by construction instead of by a guard
// someone has to remember to write.
type OnboardingGate = { forUser: string | null; decision: OnboardingDecision };

export default function AppNavigator() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ── THE session. Read, never owned. ───────────────────────────────
  // This component used to keep its OWN `session` state, fed by its OWN
  // onAuthStateChange subscription — a second, independent copy of what
  // AuthProvider (mounted above us in App.tsx) already owns. That copy is
  // what kept the previous user's screens up after an OFFLINE log out:
  // AuthContext.signOut() clears SecureStore, that account's disk caches
  // and its own state immediately, but the only thing that cleared the
  // copy here was auth-js's SIGNED_OUT event — and offline, with an
  // expired access token, auth-js is inside its retryable-refresh backoff
  // (AUTO_REFRESH_TICK_DURATION_MS = 30s) and does not reach
  // _removeSession() (and therefore does not emit SIGNED_OUT) for up to
  // ~25s. Credentials were gone, caches were gone, and the app still sat
  // on the Main tabs showing the previous user's friends and
  // notifications.
  //
  // Reading the context instead means sign-out flips the stack in the
  // same React commit that clears the credentials — no event, no network,
  // no timer. It also means there is exactly ONE place in the app that
  // decides what "signed in" means, so the rule that a network failure
  // must never clear auth state (see lib/authSession.ts) is enforced in
  // one file instead of two.
  const { session, loading: authLoading } = useAuthContext();
  // Route on the user ID, not the session object: auth-js hands back a
  // NEW session object on every TOKEN_REFRESHED (hourly, plus every
  // foreground), and everything below keys off this string — so a refresh
  // costs nothing: no re-decide, no loader flash, no re-query.
  const userId = session?.user?.id ?? null;

  const [onboardingGate, setOnboardingGate] = useState<OnboardingGate>({
    forUser: null,
    decision: 'pending',
  });
  // Anti-brick escape hatch for the launch gate (see the watchdog effect
  // near the render below).
  const [gateForcedOpen, setGateForcedOpen] = useState(false);
  // False until the first auth resolution after mount. Distinguishes the
  // LAUNCH path (cold start, which already handled its own cold-start
  // deep link) from a later sign-in / account switch.
  const authResolvedOnceRef = useRef(false);
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

    // First-touch signup-source attribution (NO-SDK). Fire-and-forget so
    // it can NEVER delay launch — it reads the same cold-start
    // Linking.getInitialURL() this effect handles, stored once in
    // AsyncStorage before the URL context is lost. Persisted onto the
    // profile later, only on the new-signup path (OnboardingScreen).
    captureAcquisitionSource().catch(() => {});

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
            AsyncStorage.setItem(
              PENDING_DEEP_LINK_KEY,
              JSON.stringify({ ...parsed, capturedAt: Date.now() }),
            ).catch(() => {});
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

  // ── Auth → routing ────────────────────────────────────────────────
  // Reacts to the ONE session. Runs when AuthContext finishes its startup
  // resolve (resolveStartupSession + its 2.5s cap — unchanged, it just
  // lives in AuthContext now, which was already calling it), and after
  // that on sign-in, account switch and sign-out. It does NOT run on
  // TOKEN_REFRESHED: `userId` is a string and a refresh doesn't change
  // it, which is the same protection the old `decidedForUserRef` guard
  // gave — except now it is structural rather than remembered.
  useEffect(() => {
    // AuthContext hasn't resolved the startup session yet. Hold the
    // loader: deciding now would route on a session we don't have.
    if (authLoading) return;

    let cancelled = false;
    const isLaunchResolution = !authResolvedOnceRef.current;
    authResolvedOnceRef.current = true;

    const authUser = session?.user ?? null;
    if (!authUser) {
      // Signed out, or never signed in → auth stack. No onboarding check
      // to run. Reset the gate to 'pending' so the NEXT sign-in holds the
      // loader while it decides instead of flashing the empty home before
      // the wizard ("新帳號一註冊就走精靈", founder).
      setOnboardingGate({ forUser: null, decision: 'pending' });
      markReady('auth');
      return;
    }

    // Identify user in PostHog so all events are linked to this account.
    // Coalesce email to '' so the property is always a string —
    // PostHog's `identify` properties accept strings/numbers/bools but
    // not `undefined`, and Supabase's session.user.email is optional.
    //
    // Goes through identifyUser(), NOT the raw `posthog` client: this was
    // the one emit site in the app that bypassed lib/analytics entirely,
    // so an opted-out user still had their id and EMAIL sent on every
    // auth resolution. identifyUser checks the opt-out gate first.
    identifyUser(authUser.id, { email: authUser.email ?? '' });

    void (async () => {
      const decision = await decideOnboarding(authUser.id, authUser.created_at);
      if (cancelled) return;
      // ONE atomic write: which account, and what we decided for it. The
      // render gate below only trusts a decision whose `forUser` matches
      // the session currently on screen.
      setOnboardingGate({ forUser: authUser.id, decision });
      // Signal splash that the auth/onboarding decision has landed.
      markReady('auth');
      if (!isLaunchResolution) {
        // Resolve pending connections for newly registered users — the
        // sign-in path only, exactly as before (a cold start goes through
        // the capture effect above).
        resolvePendingDeepLink(authUser.id, authUser.created_at);
      }
    })();

    // Defer push notification registration until after the first
    // frame paints — frees the JS thread during the critical
    // boot-to-interactive window.
    const pushHandle = InteractionManager.runAfterInteractions(() => {
      // requestPermission:false — startup only refreshes the token when
      // permission is ALREADY granted. The OS prompt itself is deferred
      // to maybeAskPushPermission() at the first meaningful moment
      // (first friend-add / first Notifications-tab open); a cold ask
      // at launch is the highest-refusal timing on iOS. Founder 2026-06-29.
      registerForPushNotifications(authUser.id, { requestPermission: false }).catch(() => {});
      // Reflect the user's unread count on the app icon. No
      // separate badge toggle by design — the badge is the visible
      // form of "you have unread notifications you opted into".
      refreshBadgeFromServer(authUser.id).catch(() => {});
    });

    return () => {
      cancelled = true;
      if (pushHandle && typeof (pushHandle as any).cancel === 'function') {
        (pushHandle as any).cancel();
      }
    };
    // `session` is read for id / email / created_at only, all constant
    // for a given `userId`; adding it to the deps would re-run this on
    // every refreshed session object — i.e. re-query hourly. markReady is
    // stable (AppReadyContext); decideOnboarding and resolvePendingDeepLink
    // are re-created each render by design and are only called here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authLoading]);

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
  //
  // RETURNS the decision rather than setting state: the caller writes it
  // together with the user id it belongs to, so a slow decision can never
  // be applied to an account that has since changed (or signed out).
  const decideOnboarding = async (
    userId: string,
    createdAt?: string,
  ): Promise<Exclude<OnboardingDecision, 'pending'>> => {
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
        return 'skip';
      }

      // ── No signal: do not spend the 4s race finding that out ────────
      // This is the ONLY network call on the startup path without a
      // connectivity guard, and it sits directly under the splash
      // loader. Offline the query below cannot succeed, so the race
      // always ran its full 4 seconds and then returned `failDecision`
      // anyway — four seconds of white screen for an answer we already
      // know. Return the SAME decision immediately. (checkOffline fails
      // open, so an unknown NetInfo state still takes the real path.)
      if (await checkOffline()) {
        return failDecision;
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
        return failDecision;
      }

      const { data: prof, error } = raced;
      if (error) {
        // Established account: fail-OPEN — never trap a real user in the
        // wizard over a transient query error (finishable in EditProfile).
        // Fresh account: fail-CLOSED into the wizard (see above).
        return failDecision;
      }

      // Explicit server flag, set ONLY at full wizard completion
      // (handleComplete). Null row (fresh signup) or false (interrupted,
      // incl. bailed-after-step-1) → not complete → show the wizard.
      const complete = !!prof && prof.onboarding_completed === true;
      if (complete) {
        // Cache the per-account result so later launches skip the query.
        // (Tab-tooltip backfill removed with the overlay, 2026-06-10.)
        AsyncStorage.setItem(cacheKey, 'true').catch(() => {});
        return 'skip';
      }
      // Null profile (fresh signup) or missing username/full_name
      // (interrupted) → the wizard hasn't been completed. Show it.
      return 'required';
    } catch (err) {
      console.warn('Onboarding check error:', err);
      return failDecision;
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
        if (stored) {
          const parsed = JSON.parse(stored) as {
            username?: string;
            sid?: string;
            capturedAt?: number;
          };
          // Expired, or written before this build stamped a time. Either
          // way we cannot tell whose invite it is, so drop it rather
          // than attach a stranger's inviter to this registration.
          const capturedAt = parsed?.capturedAt ?? 0;
          if (Date.now() - capturedAt > PENDING_DEEP_LINK_TTL_MS) {
            await AsyncStorage.removeItem(PENDING_DEEP_LINK_KEY).catch(() => {});
          } else {
            pending = parsed;
          }
        }
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

  // ── The launch gate ───────────────────────────────────────────────
  // Blocked while AuthContext is still resolving the startup session, or
  // while a signed-in user's onboarding decision hasn't landed for THIS
  // account yet. Signing OUT never blocks it: with no user there is
  // nothing to decide, so the auth stack renders in the same commit that
  // clears the credentials.
  const decisionReady =
    !userId ||
    (onboardingGate.forUser === userId && onboardingGate.decision !== 'pending');
  const gateBlocked = authLoading || !decisionReady;

  // Anti-brick watchdog. The launch gate MUST always resolve. Both the
  // startup session resolve and the onboarding profile check touch the
  // network, and RN fetch never times out — a stalled refresh / query
  // would otherwise pin the splash loader FOREVER (the founder's
  // real-device brick, 2026-06-05). Backstop: 7s after the gate closes,
  // force it open (fail-open to Main, same verdict the old watchdog's
  // 'pending' → 'skip' produced). decideOnboarding's own 4s query timeout
  // normally resolves first; this only catches a hang before that.
  // Re-armed every time the gate closes again (sign-in, account switch),
  // and reset when it opens — a watchdog that fires once per app launch
  // would leave a later sign-in unprotected.
  useEffect(() => {
    if (!gateBlocked) {
      setGateForcedOpen(false); // no-op when already false; no re-render
      return;
    }
    const watchdog = setTimeout(() => setGateForcedOpen(true), 7000);
    return () => clearTimeout(watchdog);
  }, [gateBlocked]);

  if (gateBlocked && !gateForcedOpen) {
    return (
      <View style={styles.loadingContainer}>
        <PageLoader />
      </View>
    );
  }

  return userId ? (
    <MainNavigator
      needsOnboarding={
        onboardingGate.forUser === userId && onboardingGate.decision === 'required'
      }
    />
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
