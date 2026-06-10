import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Alert,
  Switch,
  Modal,
  FlatList,
  Platform,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Check, X } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { changeLanguageSafe } from '../i18n';
import {
  requestForegroundPermissionsAsync,
  getCurrentPositionAsync,
  Accuracy,
} from 'expo-location';
import { COLORS, type ColorPalette } from '../constants/theme';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { setAnalyticsOptIn } from '../lib/analytics';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import type { PiktagProfile } from '../types';

type SettingsScreenProps = {
  navigation: any;
};

type SettingsItem = {
  label: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  textColor?: string;
};

type SettingsGroup = {
  title: string;
  items: SettingsItem[];
};

// Mirrors SUPPORTED_LANGS in src/i18n/index.ts. If you add a new
// locale there you also need to add the picker label here so users
// can actually choose it from Settings → Language.
//
// Ordered by total speakers (L1+L2, Ethnologue 2023) descending so
// the most users find their language at or near the top — same
// ordering as landing/src/i18n/index.ts. Locale auto-detection still
// pre-selects on first launch; this ordering only matters when the
// user opens the picker manually.
const LANGUAGE_OPTIONS: { key: string; label: string }[] = [
  { key: 'en', label: 'English' },                   // ~1.5B
  { key: 'zh-CN', label: '简体中文' },                // ~1.1B
  { key: 'hi', label: 'हिन्दी' },                     // ~602M
  { key: 'es', label: 'Español' },                   // ~548M
  { key: 'fr', label: 'Français' },                  // ~274M
  { key: 'ar', label: 'العربية' },                   // ~274M
  { key: 'bn', label: 'বাংলা' },                     // ~272M
  { key: 'ru', label: 'Русский' },                   // ~258M
  { key: 'pt', label: 'Português' },                 // ~257M
  { key: 'ur', label: 'اردو' },                       // ~232M
  { key: 'id', label: 'Bahasa Indonesia' },          // ~199M
  { key: 'de', label: 'Deutsch' },                   // ~135M
  { key: 'ja', label: '日本語' },                     // ~125M
  { key: 'tr', label: 'Türkçe' },                    // ~88M
  { key: 'vi', label: 'Tiếng Việt' },                // ~86M
  { key: 'ko', label: '한국어' },                     // ~81M
  { key: 'th', label: 'ไทย' },                       // ~70M
  { key: 'it', label: 'Italiano' },                  // ~68M
  { key: 'zh-TW', label: '繁體中文' },                // ~30M
];

const APP_VERSION = '1.0.0';

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();

  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [shareLocation, setShareLocation] = useState(true);
  // Re-entrancy guard for the share-location toggle. The ON path awaits
  // a multi-second GPS fetch; without this a second tap (e.g. user taps
  // OFF because nothing seems to happen) races the in-flight ON write —
  // OFF writes share_location:false, then the slow ON write resolves
  // and overwrites with true+coords → UI shows OFF but the server keeps
  // broadcasting (a privacy leak). The ref blocks re-entry; the state
  // disables the Switch while busy. (2026-06-05 bug-review fix.)
  const locationToggleBusyRef = useRef(false);
  const [locationToggleBusy, setLocationToggleBusy] = useState(false);
  // Notification category toggles — 2026-05-30 categorization.
  // Replaces the old placebo "piktag_notifications_enabled" master
  // (AsyncStorage-only, gated nothing server-side) and the per-type
  // vibe_shift toggle (now subsumed under notif_social). Each maps
  // 1:1 to a column on piktag_profiles; a BEFORE INSERT trigger on
  // piktag_notifications enforces them DB-side (see migration
  // 20260530000000). Defaults ON — match the column DEFAULTs so a
  // pre-fetch UI render reads the same as the server eventually will.
  const [notifSocial, setNotifSocial] = useState(true);
  const [notifMatches, setNotifMatches] = useState(true);
  const [notifMemories, setNotifMemories] = useState(true);
  // `isDark` is the live theme state; `setThemeMode` persists the
  // choice (ThemeContext writes it to AsyncStorage and re-applies on
  // launch). The dark-mode Switch is driven directly off `isDark` —
  // no separate local state, no separate storage key, so it can
  // never drift out of sync with the actual theme.
  const { isDark, colors, setMode: setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Mirror the LIVE i18n language — NOT what the DB says. The DB column
  // historically had DEFAULT 'en' set in Studio, which meant every new
  // signup got 'en' written even if their device was Chinese; the old
  // version of this screen would then read that and force-flip the
  // entire app to English the moment the user opened Settings. The DB
  // value is now a backup we sync TO (in handleLanguageChange), not a
  // source we sync FROM. Boot logic in src/i18n/index.ts owns truth.
  const [currentLanguage, setCurrentLanguage] = useState(i18n.language);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [analyticsOptIn, setAnalyticsOptInState] = useState(true);

  // Load profile and stored preferences on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (user) {
          const { data, error } = await supabase
            .from('piktag_profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (!error && data) {
            setProfile(data);
            setShareLocation(data.share_location !== false);
            // Notification categories. Each column defaults true at
            // the DB, but a row pre-dating the migration won't have
            // the column populated yet; treat null/undefined as ON
            // (only explicit false counts as opt-out).
            setNotifSocial((data as any).notif_social !== false);
            setNotifMatches((data as any).notif_matches !== false);
            setNotifMemories((data as any).notif_memories !== false);
            // NOTE: deliberately NOT calling changeLanguageSafe from the
            // DB value here — see the comment at currentLanguage init.
            // The chip mirrors live i18n. If the user previously made an
            // explicit pick, AsyncStorage already restored it at boot.
            setCurrentLanguage(i18n.language);
          }
        }

        const storedAnalytics = await AsyncStorage.getItem('analytics_opt_in');
        // Dark mode is NOT read here — ThemeContext owns its own
        // persistence (piktag_theme_mode) and re-applies on launch.
        // The Switch reads `isDark` straight from ThemeContext.
        // Default = opted in. Only an explicit 'false' counts as opt-out.
        setAnalyticsOptInState(storedAnalytics !== 'false');
      } catch (err) {
        console.warn('Failed to load settings:', err);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadSettings();
  }, [user]);

  // Shared notification-category toggle. Optimistic flip → DB write
  // → revert on real failure. Missing-column errors are tolerated
  // either direction:
  //   • Column not yet added (stale binary, migration not landed):
  //       Postgres returns 42703 + "column does not exist".
  //   • Column dropped after binary shipped (the inverse — old
  //     TestFlight build trying to write to a column we removed):
  //       PostgREST returns PGRST204 + "Could not find the
  //       'X' column of 'piktag_profiles' in the schema cache".
  // Both should leave the optimistic flip in place so the toggle
  // doesn't visibly snap back to the user — the on-screen state is
  // the user's intent even if the column to persist it is gone.
  const updateNotifCategory = useCallback(
    async (
      column: 'notif_social' | 'notif_matches' | 'notif_memories',
      newValue: boolean,
      setter: (v: boolean) => void,
      prev: boolean,
    ) => {
      if (!user) return;
      setter(newValue);
      const { error } = await supabase
        .from('piktag_profiles')
        .update({ [column]: newValue })
        .eq('id', user.id);
      if (error) {
        const code = (error as any).code;
        const msg = error.message || '';
        // Match the column name anywhere in the message — covers
        // both Postgres "column X does not exist" and PostgREST's
        // "Could not find the 'X' column …" wording. Codes 42703
        // and PGRST204 are the same condition from different layers.
        const isMissingColumn =
          code === '42703' ||
          code === 'PGRST204' ||
          new RegExp(column, 'i').test(msg);
        if (!isMissingColumn) {
          console.warn(`[Settings] ${column} toggle failed:`, error);
          setter(prev);
        }
      }
    },
    [user],
  );

  const handleNotifSocialToggle = () =>
    updateNotifCategory('notif_social', !notifSocial, setNotifSocial, notifSocial);
  const handleNotifMatchesToggle = () =>
    updateNotifCategory('notif_matches', !notifMatches, setNotifMatches, notifMatches);
  const handleNotifMemoriesToggle = () =>
    updateNotifCategory('notif_memories', !notifMemories, setNotifMemories, notifMemories);

  const handleShareLocationToggle = async () => {
    // Re-entrancy guard — see locationToggleBusyRef declaration. A
    // second toggle is ignored until the first write fully settles, so
    // a rapid OFF can't race a slow ON write (the privacy-leak path).
    if (!user || locationToggleBusyRef.current) return;
    locationToggleBusyRef.current = true;
    setLocationToggleBusy(true);
    const newValue = !shareLocation;
    setShareLocation(newValue);
    try {
      if (newValue) {
        // Turning ON. Capture the device's current position and write
        // it alongside the flag (the bare-flag ON path left lat/lng
        // null → the friends map dropped everyone, "only me" bug,
        // 2026-06-05). Locations still go stale after 24h — refreshed
        // on app open by lib/sharedLocation.ts.
        const { status } = await requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setShareLocation(false); // can't share without permission
          Alert.alert(
            t('settings.locationPermissionTitle', { defaultValue: '需要定位權限' }),
            t('settings.locationPermissionMessage', {
              defaultValue: '要在地圖上分享位置給朋友，請允許 PikTag 取用定位。',
            }),
          );
          return;
        }
        const pos = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
        const { error } = await supabase
          .from('piktag_profiles')
          .update({
            share_location: true,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            location_updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
        if (error) {
          setShareLocation(false);
          Alert.alert(
            t('common.error', { defaultValue: '錯誤' }),
            t('settings.alertPrivacyError', { defaultValue: '更新失敗，請稍後再試。' }),
          );
        }
      } else {
        // Turning OFF — clear coords. A silent failure here is a real
        // privacy leak (user sees "off" but server keeps broadcasting),
        // so verify the write and roll back on error.
        const { error } = await supabase
          .from('piktag_profiles')
          .update({ share_location: false, latitude: null, longitude: null, location_updated_at: null })
          .eq('id', user.id);
        if (error) {
          setShareLocation(true); // revert optimistic flip
          Alert.alert(
            t('common.error', { defaultValue: '錯誤' }),
            t('settings.alertPrivacyError', { defaultValue: '更新失敗，請稍後再試。' }),
          );
        }
      }
    } catch {
      // GPS / permission threw (ON path). Revert to the pre-toggle state.
      setShareLocation(!newValue);
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        newValue
          ? t('settings.locationFetchFailed', { defaultValue: '抓不到目前位置，請稍後再試。' })
          : t('settings.alertPrivacyError', { defaultValue: '更新失敗，請稍後再試。' }),
      );
    } finally {
      locationToggleBusyRef.current = false;
      setLocationToggleBusy(false);
    }
  };

  const handleLanguagePicker = () => {
    setLanguageModalVisible(true);
  };

  const handleLanguageChange = async (langKey: string) => {
    if (!user) return;

    setLanguageModalVisible(false);
    const prevLang = currentLanguage;
    setCurrentLanguage(langKey);
    // Lazy-loads the locale JSON first if not already resident.
    await changeLanguageSafe(langKey);

    const { error } = await supabase
      .from('piktag_profiles')
      .update({ language: langKey })
      .eq('id', user.id);

    if (error) {
      console.warn('Failed to update language:', error.message);
      setCurrentLanguage(prevLang);
      await changeLanguageSafe(prevLang);
      Alert.alert(t('common.error'), t('settings.alertLanguageError'));
    }
  };

  const handleDarkModeToggle = () => {
    // Flip relative to the live theme state. setThemeMode persists +
    // re-renders every theme-aware screen; the Switch's `value` is
    // bound to `isDark` so it follows automatically.
    setThemeMode(isDark ? 'light' : 'dark');
  };

  const handleAbout = () => {
    Alert.alert(t('settings.alertAboutTitle'), t('settings.alertAboutMessage', { version: APP_VERSION }));
  };

  const doLogout = async () => {
    // Reliable logout even on a flaky network. auth-js `_signOut` POSTs
    // /logout BEFORE clearing local storage (for EVERY scope), and RN
    // fetch never times out — so a stalled call hangs (or a non-4xx
    // network error early-returns) BEFORE `_removeSession()`, leaving the
    // session in place and never emitting SIGNED_OUT. The button then
    // looks dead — exactly what the founder hit on a real device
    // (2026-06-05). Bound the call; on timeout/error, hard-clear the
    // persisted SecureStore session so the app can't auto-restore it.
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LOGOUT_TIMEOUT')), 3000),
        ),
      ]);
    } catch {
      // Force-remove the persisted session (SecureStore key =
      // sb-<project-ref>-auth-token, the supabase-js default). Best
      // effort — a relaunch then lands on the auth stack regardless.
      try {
        const ref = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
        await SecureStore.deleteItemAsync(`sb-${ref}-auth-token`);
      } catch {}
      // Fire-and-forget a second local sign-out to emit SIGNED_OUT and
      // flip AppNavigator to the auth stack live (if it can't, the
      // SecureStore clear above guarantees logout on next launch).
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(t('settings.alertLogoutMessage', { defaultValue: '確定要登出嗎？' }));
      if (ok) await doLogout();
    } else {
      Alert.alert(t('settings.alertLogoutTitle'), t('settings.alertLogoutMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.alertLogoutButton'),
          style: 'destructive',
          onPress: doLogout,
        },
      ]);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.alertDeleteAccountTitle'),
      t('settings.alertDeleteAccountNote'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.alertDeleteAccountConfirm'),
          style: 'destructive',
          onPress: async () => {
            // No `if (!user) return` guard here: identity comes from the
            // session token below, and a silent return on a transiently-null
            // hook value is exactly the 防呆 "silent drop" defect — the user
            // taps confirm and NOTHING happens. The !token branch alerts.
            try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              if (!token) {
                Alert.alert(t('common.error'), t('settings.alertDeleteError'));
                return;
              }

              // The Edge Function uses the service-role key to actually
              // delete auth.users + cascade all piktag_* rows. If we let
              // this fail silently, Apple sign-in would resurrect the
              // account with all the old data attached.
              // Identity is derived server-side from the JWT (auth.getUser).
              // We deliberately do NOT send user_id — the function ignores
              // it on the self-delete branch, and shipping it would only
              // invite a client tampering with someone else's id.
              //
              // `apikey` header is REQUIRED: this is the app's only raw
              // fetch to functions/v1 (everything else goes through
              // supabase.functions.invoke, which adds apikey+Authorization
              // automatically). With the new-style publishable anon key the
              // gateway rejects requests without `apikey` BEFORE they reach
              // the function — which is why delete silently failed for
              // Android/Google testers (zero hits in function logs) while
              // every invoke()-based feature worked. The account then
              // survived, Google sign-in returned the SAME account
              // (onboarding_completed=true), and the wizard "never showed".
              // One missing header, both symptoms (2026-06-10).
              const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'apikey': supabaseAnonKey,
                },
                body: JSON.stringify({}),
              });
              if (!res.ok) {
                const detail = await res.text().catch(() => '');
                Alert.alert(t('common.error'), (t('settings.alertDeleteError', { defaultValue: '刪除失敗' })) + ` (${res.status})`);
                console.warn('[DeleteAccount] edge function failed:', res.status, detail);
                return;
              }

              // Show confirmation, then sign out on OK. Ordering matters:
              // if we signOut first, AppNavigator's onAuthStateChange
              // listener swaps the stack to AuthNavigator mid-way through
              // the alert lifecycle, which looks janky. By gating signOut
              // behind the OK callback, the user sees a clean
              // acknowledgement → then a single transition to Login.
              Alert.alert(
                t('settings.alertAccountDeletedTitle'),
                t('settings.alertAccountDeletedMessage'),
                [{
                  text: t('common.confirm', { defaultValue: 'OK' }),
                  onPress: async () => {
                    await supabase.auth.signOut();
                    // onAuthStateChange → AppNavigator → AuthNavigator
                    // (no manual navigation.reset needed)
                  },
                }],
                { cancelable: false },
              );
            } catch (err: any) {
              Alert.alert(t('common.error'), err.message || t('settings.alertDeleteError'));
            }
          },
        },
      ]
    );
  };

  const languageLabel =
    LANGUAGE_OPTIONS.find((l) => l.key === currentLanguage)?.label || '繁體中文';

  const settingsGroups: SettingsGroup[] = [
    {
      // Founder 2026-06-07 (Depth B): the VALUE features lead in their
      // OWN section — 通訊錄同步 is how a user first FEELS the app's worth
      // (+ the North-Star friend-add funnel); 洞察報告 is the payoff that
      // depends on that synced data. Opening Settings here (not on
      // 修改密碼) signals "this connects you", not "this is a password
      // app". 帳號 below is now credential / account-privacy only.
      title: t('settings.groupNetwork', { defaultValue: '人脈' }),
      items: [
        { label: t('settings.contactSync'), onPress: () => navigation.navigate('ContactSync') },
        { label: t('settings.socialStats'), onPress: () => navigation.navigate('SocialStats') },
      ],
    },
    {
      // Credential + account-level privacy only (修改密碼 + 分享所在地點).
      // Destructive 登出 / 停用 / 刪除 stay separate at the page bottom.
      title: t('settings.groupAccount'),
      items: [
        { label: t('settings.changePassword', { defaultValue: '修改密碼' }), onPress: () => {
          // Detect whether this user has an email-flavoured identity at
          // all. Apple / Google Sign-In accounts that have NEVER set a
          // Supabase password show up here without an 'email' identity
          // (only 'apple' / 'google'). For them, this flow won't
          // "change" anything — it'll ADD a first-time password and
          // turn the account into a dual-mode login. The copy adjusts
          // to set that expectation up front.
          const identities = (user as any)?.identities;
          const hasEmailIdentity = Array.isArray(identities)
            ? identities.some((i: any) => i?.provider === 'email')
            : true; // unknown shape → fall back to the original copy

          const title = hasEmailIdentity
            ? (t('settings.changePasswordTitle', { defaultValue: '修改密碼' }))
            : (t('settings.addPasswordTitle', { defaultValue: '新增密碼' }));
          const message = hasEmailIdentity
            ? (t('settings.changePasswordMessage', { defaultValue: '我們會發送密碼重設信到你的 Email' }))
            : (t('settings.addPasswordMessage', { defaultValue: '你目前用 Apple/Google 登入，沒有 PikTag 密碼。送出後會寄一封信到你的 Email，幫你新增一組密碼，之後也能用 Email + 密碼登入（Apple/Google 登入仍然有效）' }));
          const cta = hasEmailIdentity
            ? (t('settings.sendResetEmail', { defaultValue: '發送' }))
            : (t('settings.sendAddPasswordEmail', { defaultValue: '發送設定信' }));

          Alert.alert(
            title,
            message,
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: cta, onPress: async () => {
                const { error } = await supabase.auth.resetPasswordForEmail(user?.email || '', {
                  redirectTo: 'https://pikt.ag/reset-password',
                });
                if (!error) {
                  Alert.alert(t('settings.resetEmailSent', { defaultValue: '已發送' }), t('settings.resetEmailSentMessage', { defaultValue: '請查看你的信箱' }));
                } else {
                  // Was silent on error — user waited forever for an
                  // email that never sent (esp. OAuth-only users).
                  Alert.alert(
                    t('common.error', { defaultValue: '錯誤' }),
                    t('auth.login.errGeneric', { defaultValue: '寄送失敗，請稍後再試。' }),
                  );
                }
              }},
            ]
          );
        }},
        {
          label: t('settings.shareLocation', { defaultValue: '分享所在地點' }),
          onPress: locationToggleBusy ? undefined : handleShareLocationToggle,
          rightElement: (
            <Switch
              value={shareLocation}
              onValueChange={handleShareLocationToggle}
              disabled={locationToggleBusy}
              trackColor={{ false: colors.gray200, true: colors.piktag300 }}
              thumbColor={shareLocation ? colors.piktag500 : colors.gray400}
            />
          ),
        },
      ],
    },
    // Notification category toggles — 2026-05-30 categorization.
    // Each row maps to a column on piktag_profiles; the server-side
    // BEFORE INSERT trigger (migration 20260530000000) enforces the
    // flag for in-app rows. Defaults ON to match column DEFAULTs.
    {
      title: t('settings.groupNotifications', { defaultValue: '通知' }),
      items: [
        {
          label: t('settings.notifSocial', { defaultValue: '社交動態' }),
          onPress: handleNotifSocialToggle,
          rightElement: (
            <Switch
              value={notifSocial}
              onValueChange={handleNotifSocialToggle}
              trackColor={{ false: colors.gray200, true: colors.piktag300 }}
              thumbColor={notifSocial ? colors.piktag500 : colors.gray400}
            />
          ),
        },
        {
          label: t('settings.notifMatches', { defaultValue: 'AI 配對推薦' }),
          onPress: handleNotifMatchesToggle,
          rightElement: (
            <Switch
              value={notifMatches}
              onValueChange={handleNotifMatchesToggle}
              trackColor={{ false: colors.gray200, true: colors.piktag300 }}
              thumbColor={notifMatches ? colors.piktag500 : colors.gray400}
            />
          ),
        },
        {
          label: t('settings.notifMemories', { defaultValue: '節日與回憶' }),
          onPress: handleNotifMemoriesToggle,
          rightElement: (
            <Switch
              value={notifMemories}
              onValueChange={handleNotifMemoriesToggle}
              trackColor={{ false: colors.gray200, true: colors.piktag300 }}
              thumbColor={notifMemories ? colors.piktag500 : colors.gray400}
            />
          ),
        },
      ],
    },
    {
      title: t('settings.groupGeneral'),
      items: [
        {
          label: t('settings.language'),
          onPress: handleLanguagePicker,
          rightElement: (
            <View style={styles.languageRight}>
              <Text style={styles.languageValue}>{languageLabel}</Text>
              <ChevronRight size={20} color={colors.gray400} />
            </View>
          ),
        },
        // Dark mode toggle. The Switch is driven directly off `isDark`
        // from ThemeContext (no local mirror state) so it can't drift.
        {
          label: t('settings.darkMode', { defaultValue: '深色模式' }),
          onPress: handleDarkModeToggle,
          rightElement: (
            <Switch
              value={isDark}
              onValueChange={handleDarkModeToggle}
              trackColor={{ false: colors.gray200, true: colors.piktag300 }}
              thumbColor={isDark ? colors.piktag500 : colors.gray400}
            />
          ),
        },
        { label: t('settings.aboutPiktag'), onPress: handleAbout },
        { label: t('settings.privacyPolicy', { defaultValue: '隱私權政策' }), onPress: () => navigation.navigate('PrivacyPolicy') },
        { label: t('settings.termsOfService', { defaultValue: '服務條款' }), onPress: () => navigation.navigate('TermsOfService') },
      ],
    },
  ];

  if (loadingProfile) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <ArrowLeft size={24} color={colors.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings.headerTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <PageLoader />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.headerTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {settingsGroups.map((group) => (
          <View key={group.title} style={styles.groupContainer}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.groupItems}>
              {group.items.map((item, index) => (
                <TouchableOpacity
                  key={item.label}
                  style={[
                    styles.settingsItem,
                    index < group.items.length - 1 && styles.settingsItemBorder,
                  ]}
                  onPress={item.onPress}
                  activeOpacity={0.6}
                >
                  <Text
                    style={[
                      styles.settingsItemText,
                      item.textColor ? { color: item.textColor } : undefined,
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.rightElement || (
                    <ChevronRight size={20} color={colors.gray400} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* UGC report SLA commitment now lives inside Terms of Service
            (termsOfService.section11). Apple Guideline 1.2 only requires
            the commitment to be present in-app, not on a specific screen,
            so consolidating it into Terms keeps the Settings page clean. */}

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutText}>{t('settings.logoutButton')}</Text>
        </TouchableOpacity>

        {/* Deactivate Account Button */}
        <TouchableOpacity
          style={styles.deactivateButton}
          onPress={() => {
            Alert.alert(
              t('settings.deactivateTitle', { defaultValue: '停用帳號' }),
              t('settings.deactivateMessage', { defaultValue: '停用後你的個人頁將隱藏，其他人找不到你。你可以隨時重新登入恢復。' }),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.deactivateConfirm', { defaultValue: '停用' }),
                  style: 'destructive',
                  onPress: async () => {
                    if (!user?.id) return;
                    // Verify the hide actually persisted BEFORE signing
                    // out — otherwise the user is logged out believing
                    // they're deactivated while the profile stays public.
                    const { error } = await supabase
                      .from('piktag_profiles')
                      .update({ is_public: false })
                      .eq('id', user.id);
                    if (error) {
                      Alert.alert(
                        t('common.error', { defaultValue: '錯誤' }),
                        t('settings.alertPrivacyError', { defaultValue: '更新失敗，請稍後再試。' }),
                      );
                      return;
                    }
                    await supabase.auth.signOut();
                  },
                },
              ]
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.deactivateText}>{t('settings.deactivateButton', { defaultValue: '停用帳號' })}</Text>
        </TouchableOpacity>

        {/* Delete Account Button */}
        <TouchableOpacity
          style={styles.deleteAccountButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteAccountText}>{t('settings.deleteAccountButton')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Language Selection Modal */}
      <Modal
        visible={languageModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <View style={styles.langModalOverlay}>
          <View style={[styles.langModalContainer, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.langModalHeader}>
              <Text style={styles.langModalTitle}>{t('settings.alertLanguagePickerTitle')}</Text>
              <TouchableOpacity
                onPress={() => setLanguageModalVisible(false)}
                activeOpacity={0.6}
                style={styles.langModalCloseBtn}
              >
                <X size={24} color={colors.gray900} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={LANGUAGE_OPTIONS}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.langOptionItem}
                  onPress={() => handleLanguageChange(item.key)}
                  activeOpacity={0.6}
                >
                  <Text style={[
                    styles.langOptionText,
                    currentLanguage === item.key && styles.langOptionTextActive,
                  ]}>
                    {item.label}
                  </Text>
                  {currentLanguage === item.key && (
                    <Check size={20} color={colors.piktag500} />
                  )}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.langOptionSeparator} />}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerBackBtn: {
    padding: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: c.gray900,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  groupContainer: {
    paddingTop: 28,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray500,
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupItems: {
    backgroundColor: c.white,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  settingsItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  settingsItemText: {
    fontSize: 16,
    color: c.gray900,
    fontWeight: '500',
  },
  logoutButton: {
    marginTop: 48,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.red500,
  },
  deactivateButton: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: c.gray200,
  },
  deactivateText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray500,
  },
  deleteAccountButton: {
    marginTop: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteAccountText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.red500,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  languageValue: {
    fontSize: 14,
    color: c.gray500,
  },
  helperText: {
    fontSize: 12,
    color: c.gray500,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 16,
  },

  // Language Modal
  langModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  langModalContainer: {
    backgroundColor: c.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '70%',
  },
  langModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  langModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: c.gray900,
  },
  langModalCloseBtn: {
    padding: 4,
  },
  langOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 4,
  },
  langOptionText: {
    fontSize: 16,
    color: c.gray700,
    fontWeight: '500',
  },
  langOptionTextActive: {
    color: c.piktag600,
    fontWeight: '700',
  },
  langOptionSeparator: {
    height: 1,
    backgroundColor: c.gray100,
  },
  });
}
