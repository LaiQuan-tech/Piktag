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
import { ArrowLeft, Phone, Shield } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

type PhoneAuthScreenProps = { navigation: any };

export default function PhoneAuthScreen({ navigation }: PhoneAuthScreenProps) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const otpRef = useRef<TextInput>(null);

  const handleSendOtp = async () => {
    const cleaned = phone.trim().replace(/[\s\-]/g, '');
    if (!cleaned || cleaned.length < 8) {
      Alert.alert(t('common.error'), t('auth.phoneAuth.invalidPhone') || '請輸入有效的手機號碼');
      return;
    }

    // Ensure phone has country code
    const fullPhone = cleaned.startsWith('+') ? cleaned : `+886${cleaned.startsWith('0') ? cleaned.slice(1) : cleaned}`;

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
      if (error) {
        Alert.alert(t('common.error'), error.message);
      } else {
        setPhone(fullPhone);
        setStep('otp');
        setTimeout(() => otpRef.current?.focus(), 300);
      }
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      Alert.alert(t('common.error'), t('auth.phoneAuth.invalidOtp') || '請輸入 6 位驗證碼');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: 'sms',
      });
      if (error) {
        Alert.alert(t('common.error'), error.message);
      }
      // Success: useAuth hook will detect session change and navigate automatically
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
        {/* Header */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => step === 'otp' ? setStep('phone') : navigation.goBack()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>

        {step === 'phone' ? (
          /* ── Step 1: Phone number ── */
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Phone size={40} color={COLORS.piktag500} />
            </View>
            <Text style={styles.title}>{t('auth.phoneAuth.title') || '手機號碼登入'}</Text>
            <Text style={styles.description}>
              {t('auth.phoneAuth.description') || '我們會發送驗證碼到你的手機'}
            </Text>

            <View style={styles.phoneInputRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+886</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder={t('auth.phoneAuth.phonePlaceholder') || '912345678'}
                placeholderTextColor={COLORS.gray400}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoFocus
                maxLength={15}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
              onPress={handleSendOtp}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {t('auth.phoneAuth.sendOtp') || '發送驗證碼'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Step 2: OTP verification ── */
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Shield size={40} color={COLORS.piktag500} />
            </View>
            <Text style={styles.title}>{t('auth.phoneAuth.otpTitle') || '輸入驗證碼'}</Text>
            <Text style={styles.description}>
              {t('auth.phoneAuth.otpDescription', { phone }) || `驗證碼已發送至 ${phone}`}
            </Text>

            <TextInput
              ref={otpRef}
              style={styles.otpInput}
              placeholder="000000"
              placeholderTextColor={COLORS.gray300}
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
            />

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
              onPress={handleVerifyOtp}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {t('auth.phoneAuth.verify') || '驗證'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resendBtn}
              onPress={handleSendOtp}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.resendText}>
                {t('auth.phoneAuth.resend') || '重新發送驗證碼'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  scrollContent: { flexGrow: 1, paddingHorizontal: SPACING.xxl },
  backBtn: { paddingTop: 60, paddingBottom: SPACING.lg },
  content: { flex: 1, justifyContent: 'center', paddingBottom: 80 },
  iconContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.piktag50, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: SPACING.xl,
  },
  title: { fontSize: 26, fontWeight: '700', color: COLORS.gray900, textAlign: 'center', marginBottom: SPACING.sm },
  description: { fontSize: 15, color: COLORS.gray500, textAlign: 'center', marginBottom: SPACING.xxl, lineHeight: 22 },
  phoneInputRow: { flexDirection: 'row', gap: 10, marginBottom: SPACING.xl },
  countryCode: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.gray50,
    justifyContent: 'center',
  },
  countryCodeText: { fontSize: 16, fontWeight: '600', color: COLORS.gray700 },
  phoneInput: {
    flex: 1, borderWidth: 1, borderColor: COLORS.gray200, borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.xl, paddingVertical: 14, fontSize: 18,
    color: COLORS.gray900, backgroundColor: "transparent", letterSpacing: 1,
  },
  otpInput: {
    borderWidth: 1, borderColor: COLORS.gray200, borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.xl, paddingVertical: 16, fontSize: 28,
    color: COLORS.gray900, backgroundColor: COLORS.white, letterSpacing: 8,
    fontWeight: '700', marginBottom: SPACING.xl,
  },
  primaryBtn: {
    backgroundColor: COLORS.piktag500, borderRadius: BORDER_RADIUS.xl,
    paddingVertical: 16, alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.white, fontSize: 17, fontWeight: '700' },
  resendBtn: { alignItems: 'center', marginTop: SPACING.lg, padding: SPACING.sm },
  resendText: { fontSize: 14, color: COLORS.piktag600, fontWeight: '500' },
});
