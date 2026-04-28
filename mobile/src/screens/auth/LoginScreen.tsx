import React, { useState, useRef } from 'react';
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
import { Hash, Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { signInWithApple } from '../../lib/appleAuth';
import { signInWithGoogle } from '../../lib/googleAuth';
import { SPACING, BORDER_RADIUS, TYPOGRAPHY } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type LoginScreenProps = {
  navigation: any;
};

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert(t('common.error'), t('auth.login.alertEmptyFields'));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        Alert.alert(t('auth.login.alertLoginFailedTitle'), error.message);
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert(t('common.error'), t('auth.login.alertEnterEmailFirst'));
      return;
    }

    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        Alert.alert(t('common.error'), error.message);
      } else {
        Alert.alert(
          t('auth.login.alertResetSentTitle'),
          t('auth.login.alertResetSentMessage')
        );
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setResetLoading(false);
    }
  };

  const handleApple = async () => {
    setSocialLoading('apple');
    try { await signInWithApple(); }
    catch (err: any) { if (err.code !== 'ERR_CANCELED') Alert.alert(t('common.error'), err.message); }
    finally { setSocialLoading(null); }
  };

  const handleGoogle = async () => {
    setSocialLoading('google');
    try { await signInWithGoogle(); }
    catch (err: any) { Alert.alert(t('common.error'), err.message); }
    finally { setSocialLoading(null); }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo Area */}
        <View style={styles.logoContainer}>
          <Text style={[styles.logoText, { color: colors.piktag500 }]}>{t('common.brandName')}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('common.brandSlogan')}</Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: '#111827', backgroundColor: '#f9fafb' }]}
            placeholder={t('auth.login.emailPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <View style={[styles.passwordContainer, { borderColor: colors.border, backgroundColor: '#f9fafb' }]}>
            <TextInput
              ref={passwordRef}
              style={[styles.passwordInput, { color: '#000000' }]}
              placeholder={t('auth.login.passwordPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              activeOpacity={0.6}
            >
              {showPassword ? (
                <EyeOff size={20} color={colors.textSecondary} />
              ) : (
                <Eye size={20} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          </View>

          {/* Forgot Password */}
          <TouchableOpacity
            style={styles.forgotPasswordBtn}
            onPress={handleForgotPassword}
            disabled={resetLoading}
            activeOpacity={0.7}
          >
            {resetLoading ? (
              <BrandSpinner size={16} />
            ) : (
              <Text style={[styles.forgotPasswordText, { color: colors.piktag600 }]}>
                {t('auth.login.forgotPassword')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginButton, { backgroundColor: colors.piktag500 }, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {loading ? (
              <BrandSpinner size={20} />
            ) : (
              <Text style={styles.loginButtonText}>{t('auth.login.loginButton')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textTertiary }]}>{t('auth.login.orDivider') || '或'}</Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Social Login */}
        <View style={styles.socialContainer}>
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleApple}
              disabled={!!socialLoading}
              activeOpacity={0.8}
            >
              {socialLoading === 'apple' ? (
                <BrandSpinner size={20} />
              ) : (
                <>
                  <Text style={[styles.appleIcon, { color: colors.text }]}>{'\uF8FF'}</Text>
                  <Text style={[styles.socialBtnText, { color: colors.text }]}>{t('auth.login.continueWithApple') || 'Apple 登入'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.socialBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={handleGoogle}
            disabled={!!socialLoading}
            activeOpacity={0.8}
          >
            {socialLoading === 'google' ? (
              <BrandSpinner size={20} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={[styles.socialBtnText, { color: colors.text }]}>{t('auth.login.continueWithGoogle') || 'Google 登入'}</Text>
              </>
            )}
          </TouchableOpacity>

        </View>

        {/* Register Link */}
        <TouchableOpacity
          style={styles.footer}
          onPress={() => navigation.navigate('Register')}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID="register-link"
        >
          <View style={styles.footerRow}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>{t('auth.login.noAccountPrompt')}</Text>
            <Text style={[styles.footerText, styles.footerLink, { color: colors.piktag600 }]}>{t('auth.login.registerLink')}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACING.xxl },
  logoContainer: { alignItems: 'center', marginBottom: 48 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  logoText: { ...TYPOGRAPHY.display, fontSize: 44 },
  subtitle: { ...TYPOGRAPHY.body, marginTop: SPACING.sm },
  formContainer: { gap: SPACING.lg },
  input: {
    borderWidth: 1, borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.xl, paddingVertical: 14,
    ...TYPOGRAPHY.body,
  },
  passwordContainer: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: BORDER_RADIUS.lg,
  },
  passwordInput: {
    flex: 1, paddingHorizontal: SPACING.xl, paddingVertical: 14,
    ...TYPOGRAPHY.body,
  },
  eyeButton: { paddingHorizontal: SPACING.lg, paddingVertical: 14 },
  forgotPasswordBtn: { alignSelf: 'flex-end', paddingVertical: 4, minHeight: 28, justifyContent: 'center' },
  forgotPasswordText: { ...TYPOGRAPHY.label },
  loginButton: {
    borderRadius: BORDER_RADIUS.lg, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: SPACING.sm,
  },
  loginButtonDisabled: { opacity: 0.7 },
  loginButtonText: { ...TYPOGRAPHY.button, color: '#FFFFFF' },
  // Divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { paddingHorizontal: 14, ...TYPOGRAPHY.caption },
  // Social buttons
  socialContainer: { gap: 10 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14,
  },
  socialBtnText: { ...TYPOGRAPHY.bodyBold },
  appleIcon: { fontSize: 20 },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4' },
  // Footer
  footer: { alignItems: 'center', marginTop: SPACING.xl, padding: SPACING.md },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerText: { ...TYPOGRAPHY.label },
  footerLink: { fontWeight: '600' },
});
