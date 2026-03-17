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
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
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
  const [isPublic, setIsPublic] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('zh-TW');
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Load profile and stored preferences on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Fetch profile from Supabase
        if (user) {
          const { data, error } = await supabase
            .from('piktag_profiles')
            .select('*')
            .eq('id', user.id)
            .single();

          if (!error && data) {
            setProfile(data);
            setIsPublic(data.is_public);
            const profileLang = data.language || 'zh-TW';
            setCurrentLanguage(profileLang);
            // Sync i18n with profile language
            if (i18n.language !== profileLang) {
              i18n.changeLanguage(profileLang);
            }
          }
        }

        // Load AsyncStorage preferences
        const [storedNotifications, storedDarkMode] = await Promise.all([
          AsyncStorage.getItem('piktag_notifications_enabled'),
          AsyncStorage.getItem('piktag_dark_mode'),
        ]);

        if (storedNotifications !== null) {
          setNotificationsEnabled(storedNotifications === 'true');
        }
        if (storedDarkMode !== null) {
          setDarkModeEnabled(storedDarkMode === 'true');
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadSettings();
  }, [user]);

  const handleAccountInfo = () => {
    navigation.navigate('EditProfile');
  };

  const handlePrivacyToggle = async () => {
    if (!user) return;

    const newValue = !isPublic;
    setIsPublic(newValue);

    const { error } = await supabase
      .from('piktag_profiles')
      .update({ is_public: newValue })
      .eq('id', user.id);

    if (error) {
      console.warn('Failed to update privacy:', error.message);
      setIsPublic(!newValue); // Revert
      Alert.alert(t('common.error'), t('settings.alertPrivacyError'));
    }
  };

  const handleNotificationsToggle = async () => {
    const newValue = !notificationsEnabled;
    setNotificationsEnabled(newValue);
    await AsyncStorage.setItem('piktag_notifications_enabled', String(newValue));
  };

  const handleLanguagePicker = () => {
    const buttons = LANGUAGE_OPTIONS.map((lang) => ({
      text: lang.label + (currentLanguage === lang.key ? ' ✓' : ''),
      onPress: () => handleLanguageChange(lang.key),
    }));
    buttons.push({ text: t('common.cancel'), onPress: () => {} });

    Alert.alert(t('settings.alertLanguagePickerTitle'), undefined, buttons);
  };

  const handleLanguageChange = async (langKey: string) => {
    if (!user) return;

    const prevLang = currentLanguage;
    setCurrentLanguage(langKey);

    // Change app language immediately
    i18n.changeLanguage(langKey);

    const { error } = await supabase
      .from('piktag_profiles')
      .update({ language: langKey })
      .eq('id', user.id);

    if (error) {
      console.warn('Failed to update language:', error.message);
      setCurrentLanguage(prevLang); // Revert
      i18n.changeLanguage(prevLang); // Revert i18n
      Alert.alert(t('common.error'), t('settings.alertLanguageError'));
    }
  };

  const handleDarkModeToggle = async () => {
    const newValue = !darkModeEnabled;
    setDarkModeEnabled(newValue);
    await AsyncStorage.setItem('piktag_dark_mode', String(newValue));
  };

  const handleAbout = () => {
    Alert.alert(t('settings.alertAboutTitle'), t('settings.alertAboutMessage', { version: APP_VERSION }));
  };

  const handleLogout = async () => {
    Alert.alert(t('settings.alertLogoutTitle'), t('settings.alertLogoutMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.alertLogoutButton'),
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.alertDeleteAccountTitle'),
      t('settings.alertDeleteAccountMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.alertDeleteAccountConfirm'),
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            try {
              const { error: profileError } = await supabase
                .from('piktag_profiles')
                .delete()
                .eq('id', user.id);

              if (profileError) {
                console.warn('Profile deletion error:', profileError.message);
              }

              await supabase.auth.signOut();
              Alert.alert(t('settings.alertAccountDeletedTitle'), t('settings.alertAccountDeletedMessage'));
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
        { label: t('settings.contactSync'), onPress: () => navigation.navigate('ContactSync') },
        { label: t('settings.inviteFriends'), onPress: () => navigation.navigate('Invite') },
        { label: t('settings.socialStats'), onPress: () => navigation.navigate('SocialStats') },
        {
          label: t('settings.privacySettings'),
          onPress: handlePrivacyToggle,
          rightElement: (
            <Switch
              value={isPublic}
              onValueChange={handlePrivacyToggle}
              trackColor={{ false: COLORS.gray200, true: COLORS.piktag300 }}
              thumbColor={isPublic ? COLORS.piktag500 : COLORS.gray400}
            />
          ),
        },
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
        {
          label: t('settings.darkMode'),
          onPress: handleDarkModeToggle,
          rightElement: (
            <Switch
              value={darkModeEnabled}
              onValueChange={handleDarkModeToggle}
              trackColor={{ false: COLORS.gray200, true: COLORS.piktag300 }}
              thumbColor={darkModeEnabled ? COLORS.piktag500 : COLORS.gray400}
            />
          ),
        },
        { label: t('settings.aboutPikTag'), onPress: handleAbout },
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
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings.headerTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
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
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
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

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutText}>{t('settings.logoutButton')}</Text>
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
    padding: 4,
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
});
