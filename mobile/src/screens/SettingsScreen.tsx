import React, { useState, useEffect } from 'react';
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
import { COLORS } from '../constants/theme';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
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

const LANGUAGE_OPTIONS: { key: string; label: string }[] = [
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
  { key: 'zh-CN', label: '简体中文' },
  { key: 'ja', label: '日本語' },
  { key: 'es', label: 'Español' },
  { key: 'fr', label: 'Français' },
  { key: 'ar', label: 'العربية' },
  { key: 'hi', label: 'हिन्दी' },
  { key: 'bn', label: 'বাংলা' },
  { key: 'pt', label: 'Português' },
  { key: 'ru', label: 'Русский' },
];

const APP_VERSION = '1.0.0';

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();

  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [shareLocation, setShareLocation] = useState(true);
  const { isDark } = useTheme();
  const [darkModeEnabled, setDarkModeEnabled] = useState(isDark);
  const [currentLanguage, setCurrentLanguage] = useState('zh-TW');
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
            const profileLang = data.language || 'zh-TW';
            setCurrentLanguage(profileLang);
            if (i18n.language !== profileLang) {
              // Lazy-loads the locale bundle if not already in memory.
              await changeLanguageSafe(profileLang);
            }
          }
        }

        const [storedNotifications, storedDarkMode, storedAnalytics] = await Promise.all([
          AsyncStorage.getItem('piktag_notifications_enabled'),
          AsyncStorage.getItem('piktag_dark_mode'),
          AsyncStorage.getItem('analytics_opt_in'),
        ]);

        if (storedNotifications !== null) {
          setNotificationsEnabled(storedNotifications === 'true');
        }
        if (storedDarkMode !== null) {
          setDarkModeEnabled(storedDarkMode === 'true');
        }
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

  const handleNotificationsToggle = async () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    await AsyncStorage.setItem('piktag_notifications_enabled', String(newValue));
  };

  const handleShareLocationToggle = async () => {
    if (!user) return;
    const newValue = !shareLocation;
    setShareLocation(newValue);
    // Update DB: if turning off, also clear lat/lng
    if (newValue) {
      await supabase.from('piktag_profiles').update({ share_location: true }).eq('id', user.id);
    } else {
      await supabase.from('piktag_profiles').update({ share_location: false, latitude: null, longitude: null, location_updated_at: null }).eq('id', user.id);
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

  const { setMode: setThemeMode } = useTheme();

  const handleDarkModeToggle = () => {
    const newValue = !darkModeEnabled;
    setDarkModeEnabled(newValue);
    setThemeMode(newValue ? 'dark' : 'light');
  };

  const handleAbout = () => {
    Alert.alert(t('settings.alertAboutTitle'), t('settings.alertAboutMessage', { version: APP_VERSION }));
  };

  const doLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // If signOut API fails, force clear local session
      await supabase.auth.signOut({ scope: 'local' });
    }
  };

  const handleLogout = async () => {
    if (Platform.OS === 'web') {
      const ok = window.confirm(t('settings.alertLogoutMessage') || '確定要登出嗎？');
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
            if (!user) return;
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
              const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({}),
              });
              if (!res.ok) {
                const detail = await res.text().catch(() => '');
                Alert.alert(t('common.error'), (t('settings.alertDeleteError') || '刪除失敗') + ` (${res.status})`);
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
                  text: t('common.confirm') || 'OK',
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
      title: t('settings.groupAccount'),
      items: [
        { label: t('settings.changePassword') || '修改密碼', onPress: () => {
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
            ? (t('settings.changePasswordTitle') || '修改密碼')
            : (t('settings.addPasswordTitle') || '新增密碼');
          const message = hasEmailIdentity
            ? (t('settings.changePasswordMessage') || '我們會發送密碼重設信到你的 Email')
            : (t('settings.addPasswordMessage') ||
                '你目前用 Apple/Google 登入，沒有 PikTag 密碼。送出後會寄一封信到你的 Email，幫你新增一組密碼，之後也能用 Email + 密碼登入（Apple/Google 登入仍然有效）');
          const cta = hasEmailIdentity
            ? (t('settings.sendResetEmail') || '發送')
            : (t('settings.sendAddPasswordEmail') || '發送設定信');

          Alert.alert(
            title,
            message,
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: cta, onPress: async () => {
                const { error } = await supabase.auth.resetPasswordForEmail(user?.email || '', {
                  redirectTo: 'https://pikt.ag/reset-password',
                });
                if (!error) Alert.alert(t('settings.resetEmailSent') || '已發送', t('settings.resetEmailSentMessage') || '請查看你的信箱');
              }},
            ]
          );
        }},
        { label: t('settings.contactSync'), onPress: () => navigation.navigate('ContactSync') },
        { label: t('settings.inviteFriends'), onPress: () => navigation.navigate('Invite'), textColor: COLORS.piktag600 },
        { label: t('settings.redeemInvite') || '兌換邀請碼', onPress: () => navigation.navigate('RedeemInvite') },
        { label: t('settings.socialStats'), onPress: () => navigation.navigate('SocialStats') },
        {
          label: t('settings.notificationSettings'),
          onPress: handleNotificationsToggle,
          rightElement: (
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: COLORS.gray200, true: COLORS.piktag300 }}
              thumbColor={notificationsEnabled ? COLORS.piktag500 : COLORS.gray400}
            />
          ),
        },
        {
          label: t('settings.shareLocation') || '分享所在地點',
          onPress: handleShareLocationToggle,
          rightElement: (
            <Switch
              value={shareLocation}
              onValueChange={handleShareLocationToggle}
              trackColor={{ false: COLORS.gray200, true: COLORS.piktag300 }}
              thumbColor={shareLocation ? COLORS.piktag500 : COLORS.gray400}
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
              <ChevronRight size={20} color={COLORS.gray400} />
            </View>
          ),
        },
        { label: t('settings.aboutPiktag'), onPress: handleAbout },
        { label: t('settings.privacyPolicy') || '隱私權政策', onPress: () => navigation.navigate('PrivacyPolicy') },
        { label: t('settings.termsOfService') || '服務條款', onPress: () => navigation.navigate('TermsOfService') },
      ],
    },
  ];

  if (loadingProfile) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
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
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
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
                    <ChevronRight size={20} color={COLORS.gray400} />
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
              t('settings.deactivateTitle') || '停用帳號',
              t('settings.deactivateMessage') || '停用後你的個人頁將隱藏，其他人找不到你。你可以隨時重新登入恢復。',
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.deactivateConfirm') || '停用',
                  style: 'destructive',
                  onPress: async () => {
                    if (!user?.id) return;
                    await supabase.from('piktag_profiles').update({ is_public: false }).eq('id', user.id);
                    await supabase.auth.signOut();
                  },
                },
              ]
            );
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.deactivateText}>{t('settings.deactivateButton') || '停用帳號'}</Text>
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
                <X size={24} color={COLORS.gray900} />
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
                    <Check size={20} color={COLORS.piktag500} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerBackBtn: {
    padding: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
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
    color: COLORS.gray500,
    paddingHorizontal: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupItems: {
    backgroundColor: COLORS.white,
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
    borderBottomColor: COLORS.gray100,
  },
  settingsItemText: {
    fontSize: 16,
    color: COLORS.gray900,
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
    color: COLORS.red500,
  },
  deactivateButton: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
  },
  deactivateText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  deleteAccountButton: {
    marginTop: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteAccountText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.red500,
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
    color: COLORS.gray500,
  },
  helperText: {
    fontSize: 12,
    color: COLORS.gray500,
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
    backgroundColor: COLORS.white,
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
    color: COLORS.gray900,
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
    color: COLORS.gray700,
    fontWeight: '500',
  },
  langOptionTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  langOptionSeparator: {
    height: 1,
    backgroundColor: COLORS.gray100,
  },
});
