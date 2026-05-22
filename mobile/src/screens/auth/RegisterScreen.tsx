import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import BrandSpinner from '../../components/loaders/BrandSpinner';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { toBirthdayDate } from '../../lib/birthday';
import { signInWithApple } from '../../lib/appleAuth';
import { signInWithGoogle } from '../../lib/googleAuth';
import { trackSignupComplete } from '../../lib/analytics';
import { COLORS, SPACING, BORDER_RADIUS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type RegisterScreenProps = {
  navigation: any;
};

export default function RegisterScreen({ navigation }: RegisterScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Birthday is the core of PikTag's CRM — the daily pg_cron fn
  // surfaces "X 今天生日" reminders to friends. Optional here (also
  // collected in Onboarding / EditProfile) but capturing at sign-up
  // gives the highest yield. Stored normalized to YYYY-MM-DD.
  const [birthday, setBirthday] = useState('');
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const birthdayRef = useRef<TextInput>(null);

  const handleRegister = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert(t('common.error'), t('auth.register.alertEmptyFields'));
      return;
    }

    if (password.length < 6) {
      Alert.alert(t('common.error'), t('auth.register.alertPasswordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(t('common.error'), t('auth.register.alertPasswordMismatch'));
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          Alert.alert(t('auth.register.alertRegisterFailedTitle'), t('auth.register.alertEmailTaken'));
        } else {
          Alert.alert(t('auth.register.alertRegisterFailedTitle'), error.message);
        }
        return;
      }

      // Persist birthday on the profile if the viewer entered one.
      // Normalize to YYYY-MM-DD — the live pg_cron fn
      // (enqueue_birthday_notifications) only counts a profile
      // birthday matching ^\d{4}-\d{2}-\d{2}$ (then ::date). Was
      // storing the raw string (latent broken-CRM bug); now shared
      // with Onboarding via lib/birthday.ts (Onboarding also
      // collects it so OAuth signups aren't left without one).
      const normBirthday = toBirthdayDate(birthday);
      const userId = data.user?.id;
      // Only writable when we actually have a session (email-confirm
      // OFF). upsert — not update().eq — so a profile row the signup
      // trigger hasn't committed yet still gets the birthday instead
      // of a silent 0-row no-op (data loss with no feedback).
      if (normBirthday && userId && data.session) {
        await supabase
          .from('piktag_profiles')
          .upsert({ id: userId, birthday: normBirthday }, { onConflict: 'id' })
          .then(({ error: bdayErr }) => {
            if (bdayErr) console.warn('Save birthday failed:', bdayErr.message);
          });
      }

      if (data.session) {
        Alert.alert(t('auth.register.alertSuccessTitle'), t('auth.register.alertSuccessMessage'));
      } else {
        // Email confirmation is ON: signUp returns NO session and NO
        // error. Without this branch the user taps Register and sees
        // absolutely nothing — a silent dead end on the form. Tell
        // them to verify, then route to Login.
        Alert.alert(
          t('auth.register.alertVerifyEmailTitle', { defaultValue: '請先驗證 Email' }),
          t('auth.register.alertVerifyEmailMessage', {
            defaultValue: '我們寄了一封確認信到你的信箱，點開信中連結後，再回來登入。',
          }),
        );
        navigation.navigate('Login');
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const passwordsMatch = confirmPassword.length === 0 || password === confirmPassword;

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
          <Text style={styles.logoText}>{t('common.brandName')}</Text>
          <Text style={styles.subtitle}>{t('common.brandSlogan')}</Text>
        </View>


        {/* Form */}
        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.register.emailPlaceholder')}
            placeholderTextColor={colors.gray400}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <View>
            <View style={[
              styles.passwordContainer,
              password.length > 0 && password.length < 6 && styles.inputError,
            ]}>
              <TextInput
                ref={passwordRef}
                style={[styles.passwordInput, { color: colors.text }]}
                placeholder={t('auth.register.passwordPlaceholder')}
                placeholderTextColor={colors.gray400}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="next"
                onSubmitEditing={() => confirmPasswordRef.current?.focus()}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                activeOpacity={0.6}
              >
                {showPassword ? (
                  <EyeOff size={20} color={colors.gray500} />
                ) : (
                  <Eye size={20} color={colors.gray500} />
                )}
              </TouchableOpacity>
            </View>
            {password.length > 0 && password.length < 6 && (
              <Text style={styles.errorHint}>
                {t('auth.register.passwordHint', { defaultValue: '密碼至少需要 6 個字元' })}
              </Text>
            )}
          </View>

          <View>
            <View style={[
              styles.passwordContainer,
              !passwordsMatch && styles.inputError,
            ]}>
              <TextInput
                ref={confirmPasswordRef}
                style={[styles.passwordInput, { color: colors.text }]}
                placeholder={t('auth.register.confirmPasswordPlaceholder')}
                placeholderTextColor={colors.gray400}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirmPassword}
                returnKeyType="next"
                onSubmitEditing={() => birthdayRef.current?.focus()}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                activeOpacity={0.6}
              >
                {showConfirmPassword ? (
                  <EyeOff size={20} color={colors.gray500} />
                ) : (
                  <Eye size={20} color={colors.gray500} />
                )}
              </TouchableOpacity>
            </View>
            {!passwordsMatch && (
              <Text style={styles.errorHint}>
                {t('auth.register.alertPasswordMismatch')}
              </Text>
            )}
          </View>

          {/* Birthday — optional but encouraged. Format MM/DD matches the
              Onboarding screen's input + the daily-birthday-check edge
              function's exact-string match query. */}
          <View style={styles.birthdayRow}>
            <Text style={styles.birthdayLabel}>
              {t('auth.register.birthdayLabel', { defaultValue: '生日（選填）' })}
            </Text>
            <TextInput
              ref={birthdayRef}
              style={styles.birthdayInput}
              placeholder="MM/DD"
              placeholderTextColor={colors.gray400}
              value={birthday}
              onChangeText={setBirthday}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />
          </View>

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {loading ? (
              <BrandSpinner size={20} />
            ) : (
              <Text style={styles.registerButtonText}>{t('auth.register.registerButton')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('auth.login.orDivider', { defaultValue: '或' })}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social Login */}
        <View style={styles.socialContainer}>
          {Platform.OS === 'ios' && (
            <TouchableOpacity style={styles.socialBtn} onPress={async () => {
              setSocialLoading('apple');
              try { await signInWithApple(); } catch (err: any) { if (err.code !== 'ERR_CANCELED') Alert.alert(t('common.error'), err.message); }
              setSocialLoading(null);
            }} disabled={!!socialLoading} activeOpacity={0.8}>
              {socialLoading === 'apple' ? <BrandSpinner size={20} /> : <>
                <Text style={styles.appleIcon}>{'\uF8FF'}</Text>
                <Text style={styles.socialBtnText}>{t('auth.login.continueWithApple', { defaultValue: 'Apple 登入' })}</Text>
              </>}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.socialBtn} onPress={async () => {
            setSocialLoading('google');
            try { await signInWithGoogle(); } catch (err: any) { Alert.alert(t('common.error'), err.message); }
            setSocialLoading(null);
          }} disabled={!!socialLoading} activeOpacity={0.8}>
            {socialLoading === 'google' ? <BrandSpinner size={20} /> : <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.socialBtnText}>{t('auth.login.continueWithGoogle', { defaultValue: 'Google 登入' })}</Text>
            </>}
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
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
    color: c.piktag500,
  },
  subtitle: {
    fontSize: 16,
    color: c.gray500,
    marginTop: SPACING.sm,
  },
  formContainer: {
    gap: SPACING.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    fontSize: 16,
    color: c.gray900,
    backgroundColor: c.white,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.xl,
    backgroundColor: c.white,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    fontSize: 16,
    color: c.gray900,
  },
  eyeButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorHint: {
    fontSize: 13,
    color: '#EF4444',
    marginTop: 6,
    marginLeft: SPACING.xl,
  },
  // Birthday row — labeled inline with the input so users see the field
  // is optional. Visual matches the password row height for consistency.
  birthdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray50,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    gap: 12,
  },
  birthdayLabel: {
    fontSize: 15,
    color: c.gray700,
    fontWeight: '500',
  },
  birthdayInput: {
    flex: 1,
    fontSize: 15,
    color: c.text,
    padding: 0,
  },
  registerButton: {
    backgroundColor: c.piktag500,
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
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: 'bold',
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.gray200 },
  dividerText: { paddingHorizontal: 14, fontSize: 13, color: c.gray400 },
  socialContainer: { gap: 10 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderColor: c.gray200, borderRadius: BORDER_RADIUS.xl,
    paddingVertical: 14, backgroundColor: c.white,
  },
  socialBtnText: { fontSize: 16, fontWeight: '600', color: c.gray800 },
  appleIcon: { fontSize: 20, color: c.gray900 },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4' },
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
    color: c.gray500,
  },
  footerLink: {
    color: c.piktag600,
    fontWeight: '600',
  },
  });
}
