import React, { useState, useRef } from 'react';
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
import { Hash, Eye, EyeOff, Phone } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { signInWithApple } from '../../lib/appleAuth';
import { signInWithGoogle } from '../../lib/googleAuth';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

type LoginScreenProps = {
  navigation: any;
};

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const { t } = useTranslation();
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
            placeholder={t('auth.login.emailPlaceholder')}
            placeholderTextColor={COLORS.gray400}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <View style={styles.passwordContainer}>
            <TextInput
              ref={passwordRef}
              style={styles.passwordInput}
              placeholder={t('auth.login.passwordPlaceholder')}
              placeholderTextColor={COLORS.gray400}
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
                <EyeOff size={20} color={COLORS.gray500} />
              ) : (
                <Eye size={20} color={COLORS.gray500} />
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
              <ActivityIndicator size="small" color={COLORS.piktag500} />
            ) : (
              <Text style={styles.forgotPasswordText}>
                {t('auth.login.forgotPassword')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.loginButtonText}>{t('auth.login.loginButton')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('auth.login.orDivider') || '或'}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Social Login */}
        <View style={styles.socialContainer}>
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.socialBtn}
              onPress={handleApple}
              disabled={!!socialLoading}
              activeOpacity={0.8}
            >
              {socialLoading === 'apple' ? (
                <ActivityIndicator color={COLORS.gray900} />
              ) : (
                <>
                  <Text style={styles.appleIcon}>{'\uF8FF'}</Text>
                  <Text style={styles.socialBtnText}>{t('auth.login.continueWithApple') || 'Apple 登入'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.socialBtn}
            onPress={handleGoogle}
            disabled={!!socialLoading}
            activeOpacity={0.8}
          >
            {socialLoading === 'google' ? (
              <ActivityIndicator color={COLORS.gray900} />
            ) : (
              <>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.socialBtnText}>{t('auth.login.continueWithGoogle') || 'Google 登入'}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.socialBtn}
            onPress={() => navigation.navigate('PhoneAuth')}
            disabled={!!socialLoading}
            activeOpacity={0.8}
          >
            <Phone size={20} color={COLORS.gray700} />
            <Text style={styles.socialBtnText}>{t('auth.login.continueWithPhone') || '手機號碼登入'}</Text>
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
            <Text style={styles.footerText}>{t('auth.login.noAccountPrompt')}</Text>
            <Text style={[styles.footerText, styles.footerLink]}>{t('auth.login.registerLink')}</Text>
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
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.xl,
    backgroundColor: COLORS.white,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
  },
  eyeButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
  },
  forgotPasswordBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    minHeight: 28,
    justifyContent: 'center',
  },
  forgotPasswordText: {
    fontSize: 14,
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  loginButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: BORDER_RADIUS.xl,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.sm,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: 'bold',
  },
  // Divider
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.gray200 },
  dividerText: { paddingHorizontal: 14, fontSize: 13, color: COLORS.gray400 },

  // Social buttons
  socialContainer: { gap: 10 },
  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: BORDER_RADIUS.xl,
    paddingVertical: 14, backgroundColor: COLORS.white,
  },
  socialBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.gray800 },
  appleIcon: { fontSize: 20, color: COLORS.gray900 },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4' },

  footer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
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
