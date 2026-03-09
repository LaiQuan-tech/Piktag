import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

type RegisterScreenProps = {
  navigation: any;
};

export default function RegisterScreen({ navigation }: RegisterScreenProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName.trim() || !username.trim() || !email.trim() || !password.trim()) {
      Alert.alert(t('common.error'), t('auth.register.alertEmptyFields'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.register.alertPasswordTooShort'));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: username.trim(),
          },
        },
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          Alert.alert(t('auth.register.alertRegisterFailedTitle'), t('auth.register.alertEmailTaken'));
        } else {
          Alert.alert(t('auth.register.alertRegisterFailedTitle'), error.message);
        }
        return;
      }

      // Signup success - email is auto-confirmed on staging.
      // The auth state change listener in AppNavigator will detect the session
      // and automatically switch to MainTabs.
      if (data.session) {
        Alert.alert(t('auth.register.alertSuccessTitle'), t('auth.register.alertSuccessMessage'));
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo Area */}
        <View style={styles.logoContainer}>
          <View style={styles.logoRow}>
            <Hash size={40} color={COLORS.piktag500} strokeWidth={2.5} />
            <Text style={styles.logoText}>{t('common.brandName')}</Text>
          </View>
          <Text style={styles.subtitle}>{t('common.brandSlogan')}</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.register.namePlaceholder')}
            placeholderTextColor={COLORS.gray400}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          <TextInput
            style={styles.input}
            placeholder={t('auth.register.usernamePlaceholder')}
            placeholderTextColor={COLORS.gray400}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder={t('auth.register.emailPlaceholder')}
            placeholderTextColor={COLORS.gray400}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder={t('auth.register.passwordPlaceholder')}
            placeholderTextColor={COLORS.gray400}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.registerButtonText}>{t('auth.register.registerButton')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login Link */}
        <TouchableOpacity
          style={styles.footer}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>{t('auth.register.hasAccountPrompt')}</Text>
            <Text style={[styles.footerText, styles.footerLink]}>{t('auth.register.loginLink')}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SPACING.sm,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.piktag500,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.gray500,
    marginTop: SPACING.sm,
  },
  formContainer: {
    gap: SPACING.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
    backgroundColor: COLORS.white,
  },
  registerButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: BORDER_RADIUS.xl,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  registerButtonDisabled: {
    opacity: 0.7,
  },
  registerButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: 'bold',
  },
  footer: {
    alignItems: 'center',
    marginTop: SPACING.xxxl,
    padding: SPACING.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  footerLink: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },
});
