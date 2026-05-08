import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, StatusBar, TouchableOpacity, TextInput,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Gift, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { setPendingInviteCode, clearPendingInviteCode } from '../lib/pendingInvite';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function RedeemInviteScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const initialCode = (route.params as any)?.code as string | undefined;

  const [code, setCode] = useState(initialCode?.toUpperCase() ?? '');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // If a deep link delivered a code but the user isn't signed in yet,
  // persist the code and bounce them through the auth flow. After they
  // finish onboarding and land on the home tab, ConnectionsScreen will
  // resume the redeem flow with the saved code.
  useEffect(() => {
    if (!initialCode || user?.id) return;
    setPendingInviteCode(initialCode);
    Alert.alert(
      t('redeemInvite.signInRequiredTitle', { defaultValue: '請先登入' }),
      t('redeemInvite.signInRequiredMessage', {
        defaultValue: '登入或註冊後會自動完成邀請兌換。',
      }),
      [
        {
          text: t('common.ok', { defaultValue: 'OK' }),
          onPress: () => {
            // We don't directly own the auth stack from here; the auth
            // navigator mounts whenever there's no session, so just pop
            // this screen — AppNavigator will swap to AuthNavigator.
            if (navigation.canGoBack()) navigation.goBack();
          },
        },
      ],
      { cancelable: false },
    );
    // We only act on cold-start arrival; subsequent edits to `code` shouldn't
    // re-trigger the alert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRedeem = useCallback(async (rawCode?: string) => {
    const input = (rawCode ?? code).trim().toUpperCase();
    if (!input) {
      Alert.alert(
        t('common.error'),
        t('redeemInvite.errorEmpty', { defaultValue: 'Please enter an invite code' }),
      );
      return;
    }
    if (!user?.id) {
      Alert.alert(
        t('common.error'),
        t('redeemInvite.errorNotAuthenticated', { defaultValue: 'Please sign in first' }),
      );
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('redeem_invite_code', { p_code: input });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.success) {
        setSuccess(true);
        require('../lib/analytics').trackInviteRedeemed(code.trim());
        // Clear the persisted handoff so we don't re-prompt next launch.
        clearPendingInviteCode();
        Alert.alert(
          t('redeemInvite.successTitle', { defaultValue: 'Invite redeemed' }),
          t('redeemInvite.successMessage', { defaultValue: 'You can now connect with the person who invited you!' }),
          [{ text: t('common.ok', { defaultValue: 'OK' }), onPress: () => {
            // Deep-linked entry (invite/:code) has no back stack, so
            // fall through to the home tab instead of crashing on
            // native-stack's "nothing to go back to" invariant.
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Main', { screen: 'HomeTab' });
          } }],
        );
      } else {
        const reason: string = row?.message || 'unknown';
        const msgKey = `redeemInvite.error_${reason}`;
        // Index signature so unknown `reason` values don't trip TS'
        // implicit-any-on-keyed-access rule. Returns undefined for
        // codes we haven't translated yet — the `||` falls through
        // to the generic English message below.
        const fallbacks: Record<string, string> = {
          invite_not_found: 'Invite code not found',
          already_redeemed: 'This invite has already been redeemed',
          expired: 'This invite has expired',
          cannot_redeem_own: 'You cannot redeem your own invite',
          not_authenticated: 'Please sign in first',
        };
        const fallback = fallbacks[reason] || 'Failed to redeem invite';
        Alert.alert(t('common.error'), t(msgKey) || fallback);
      }
    } catch (err: any) {
      console.warn('[RedeemInvite] error:', err);
      Alert.alert(t('common.error'), err?.message || t('redeemInvite.errorGeneric', { defaultValue: 'Failed to redeem invite' }));
    } finally {
      setLoading(false);
    }
  }, [code, user, t, navigation]);

  // Security (M10): Do NOT auto-redeem from deep links. A malicious link
  // could otherwise trick a user into redeeming/connecting without
  // intent. The code is pre-populated above (initialCode -> useState),
  // and the user must explicitly tap the Redeem button to proceed.

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" />
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Main', { screen: 'HomeTab' });
          }}
          style={styles.backBtn}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('redeemInvite.headerTitle', { defaultValue: 'Redeem Invite' })}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: colors.piktag50 }]}>
          <Gift size={48} color={colors.piktag500} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {t('redeemInvite.title', { defaultValue: 'Got an invite code?' })}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('redeemInvite.subtitle', { defaultValue: 'Enter the code below to connect with the person who invited you.' })}
        </Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
          placeholder={t('redeemInvite.placeholder', { defaultValue: 'PIK-XXXXXX' })}
          placeholderTextColor={colors.textTertiary}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          editable={!loading && !success}
        />

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.piktag500 },
            (loading || success || !code.trim()) && { opacity: 0.5 },
          ]}
          onPress={() => handleRedeem()}
          disabled={loading || success || !code.trim()}
          activeOpacity={0.8}
        >
          {loading ? (
            <BrandSpinner size={20} />
          ) : success ? (
            <Check size={20} color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {t('redeemInvite.button', { defaultValue: 'Redeem' })}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingBottom: 14, borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center', marginHorizontal: 12 },
  content: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  input: {
    width: '100%', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16,
    paddingVertical: 16, fontSize: 18, fontWeight: '600',
    letterSpacing: 2, textAlign: 'center', marginBottom: 16,
  },
  button: {
    width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
