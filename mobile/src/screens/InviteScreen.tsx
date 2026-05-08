import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  Alert,
  Share,
  Platform,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { setStringAsync } from 'expo-clipboard';
import {
  ArrowLeft,
  Gift,
  Copy,
  Share2,
  Check,
  Clock,
  UserPlus,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type InviteScreenProps = {
  navigation: any;
};

type Invite = {
  id: string;
  invite_code: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
};

const APP_URL = 'https://pikt.ag';

export default function InviteScreen({ navigation }: InviteScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [quota, setQuota] = useState(0);
  const [maxQuota, setMaxQuota] = useState(5);
  const [pPoints, setPPoints] = useState(0);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      // Auto-recover quota if 24h have passed
      // Uses _rpc suffix to avoid collision with existing trigger function
      try {
        await supabase.rpc('recover_invite_quota_rpc');
      } catch (recErr) {
        console.warn('[Invite] quota recovery error:', recErr);
      }

      // Fetch quota + p_points from profile
      const { data: profileData } = await supabase
        .from('piktag_profiles')
        .select('invite_quota, invite_quota_max, p_points')
        .eq('id', user.id)
        .single();

      if (profileData) {
        setQuota(profileData.invite_quota ?? 0);
        setMaxQuota(profileData.invite_quota_max ?? 5);
        setPPoints(profileData.p_points ?? 0);
      }

      // Fetch invites
      const { data: invitesData } = await supabase
        .from('piktag_invites')
        .select('*')
        .eq('inviter_id', user.id)
        .order('created_at', { ascending: false });

      if (invitesData) {
        setInvites(invitesData);
      }
    } catch (err) {
      console.error('Error fetching invite data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch on every focus — covers initial mount AND background→return.
  // Without this, the "已使用" badge + "✅ N 人已加入" summary would
  // show stale state for inviters returning to the screen after a
  // friend redeems. useFocusEffect runs on first focus too, so a
  // separate mount useEffect would just double-fetch on entry.
  useFocusEffect(
    useCallback(() => {
      if (user) fetchData();
    }, [user, fetchData]),
  );

  const handleGenerateInvite = async () => {
    if (!user) return;
    if (quota <= 0) {
      Alert.alert(t('invite.alertQuotaUsedTitle'), t('invite.alertQuotaUsedMessage'));
      return;
    }

    setGenerating(true);
    try {
      // Server-side: generates unguessable code + atomically decrements quota.
      const { data: rows, error: rpcErr } = await supabase.rpc('generate_invite_code');

      if (rpcErr) {
        console.error('Error generating invite:', rpcErr);
        Alert.alert(
          t('common.error'),
          rpcErr.message || t('invite.alertGenerateError')
        );
        return;
      }

      const invite = Array.isArray(rows) ? rows[0] : rows;
      if (!invite) {
        Alert.alert(t('common.error'), t('invite.alertGenerateError'));
        return;
      }

      setQuota((q) => Math.max(0, q - 1));
      setInvites((prev) => [
        {
          id: invite.id,
          invite_code: invite.invite_code,
          used_by: null,
          used_at: null,
          created_at: invite.created_at,
        },
        ...prev,
      ]);

      // Auto-open native share sheet so user doesn't have to hunt for the
      // share icon in the history list. Dismissal is silently swallowed
      // inside handleShareInvite — code is preserved in history regardless.
      handleShareInvite(invite.invite_code);
    } catch (err: any) {
      console.error('Generate invite error:', err);
      Alert.alert(
        t('common.error'),
        err?.message || t('invite.alertGenerateError')
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await setStringAsync(code);
      Alert.alert(t('invite.alertCopiedTitle'), t('invite.alertCopiedMessage', { code }));
    } catch (err) {
      console.warn('[Invite] copy failed:', err);
      Alert.alert(t('common.error'), 'Failed to copy');
    }
  };

  const handleShareInvite = async (code: string) => {
    try {
      const universalLink = `https://pikt.ag/i/${code}`;
      const deepLink = `piktag://invite/${code}`;
      require('../lib/analytics').trackInviteShared();
      await Share.share({
        message: t('invite.shareMessage', {
          code,
          url: universalLink,
          deepLink,
        }),
      });
    } catch (err) {
      console.warn('[Invite] share failed:', err);
      // Share sheet cancellation also throws here on some platforms —
      // only surface to user if it's clearly not a dismissal.
      if (err instanceof Error && !/(dismiss|cancel)/i.test(err.message)) {
        Alert.alert(t('common.error'), t('common.unknownError'));
      }
    }
  };

  const renderInvite = ({ item }: { item: Invite }) => {
    const isUsed = !!item.used_by;
    return (
      <View style={[styles.inviteCard, isUsed && styles.inviteCardUsed]}>
        <View style={styles.inviteCodeRow}>
          <Text style={[styles.inviteCode, isUsed && styles.inviteCodeUsed]}>
            {item.invite_code}
          </Text>
          {isUsed ? (
            <View style={styles.usedBadge}>
              <Check size={12} color={COLORS.piktag600} />
              <Text style={styles.usedBadgeText}>{t('invite.usedBadge')}</Text>
            </View>
          ) : (
            <View style={styles.inviteActions}>
              <TouchableOpacity
                style={styles.inviteActionBtn}
                onPress={() => handleCopyCode(item.invite_code)}
                activeOpacity={0.7}
              >
                <Copy size={16} color={COLORS.gray600} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inviteActionBtn}
                onPress={() => handleShareInvite(item.invite_code)}
                activeOpacity={0.7}
              >
                <Share2 size={16} color={COLORS.gray600} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <Text style={styles.inviteDate}>
          {new Date(item.created_at).toLocaleDateString('zh-TW')}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('invite.headerTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <PageLoader />
      ) : (
        <>
          {/* Quota Card */}
          <View style={styles.quotaCard}>
            <View style={styles.quotaIconCircle}>
              <Gift size={28} color={COLORS.piktag600} />
            </View>
            <Text style={styles.quotaTitle}>{t('invite.quotaTitle')}</Text>
            <Text style={styles.quotaNumber}>
              {quota} <Text style={styles.quotaMax}>/ {maxQuota}</Text>
            </Text>
            <View style={styles.quotaBarBg}>
              <View
                style={[
                  styles.quotaBarFill,
                  { width: `${(quota / maxQuota) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.quotaHint}>
              <Clock size={14} color={COLORS.gray400} />
              <Text style={styles.quotaHintText}>{t('invite.quotaHint')}</Text>
            </View>

            <TouchableOpacity
              style={[
                styles.generateBtn,
                (quota <= 0 || generating) && styles.generateBtnDisabled,
              ]}
              onPress={handleGenerateInvite}
              disabled={quota <= 0 || generating}
              activeOpacity={0.8}
            >
              {generating ? (
                <BrandSpinner size={20} />
              ) : (
                <>
                  <UserPlus size={18} color={COLORS.gray900} />
                  <Text style={styles.generateBtnText}>{t('invite.generateButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* P Points Card */}
          <TouchableOpacity
            onPress={() => navigation.navigate('PointsHistory')}
            style={styles.pointsCard}
            activeOpacity={0.8}
          >
            <Text style={styles.pointsLabel}>{t('points.balance')}</Text>
            <Text style={styles.pointsValue}>{pPoints} {t('points.pointsUnit')}</Text>
            <Text style={styles.pointsHint}>{t('points.redeemHint')}</Text>
          </TouchableOpacity>

          {/* Invites List */}
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>
              {t('invite.inviteRecordHeader')} ({invites.length})
            </Text>
            {/* At-a-glance success counter so the inviter doesn't have
                to scan every row to learn how many of their invites were
                actually redeemed. Updates optimistically because the
                local `invites` state is the source of truth here. */}
            {invites.some((i) => !!i.used_by) && (
              <Text style={styles.listHeaderAccepted}>
                {t('invite.acceptedSummary', {
                  defaultValue: '✅ {{count}} 人已加入',
                  count: invites.filter((i) => !!i.used_by).length,
                })}
              </Text>
            )}
          </View>

          <FlatList
            data={invites}
            renderItem={renderInvite}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('invite.noInvites')}</Text>
            }
          />
        </>
      )}
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
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quotaCard: {
    margin: 20,
    backgroundColor: COLORS.piktag50,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.piktag100,
  },
  quotaIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  quotaTitle: {
    fontSize: 14,
    color: COLORS.gray600,
    fontWeight: '500',
    marginBottom: 8,
  },
  quotaNumber: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  quotaMax: {
    fontSize: 18,
    fontWeight: '500',
    color: COLORS.gray400,
  },
  quotaBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.gray200,
    borderRadius: 4,
    marginTop: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  quotaBarFill: {
    height: '100%',
    backgroundColor: COLORS.piktag500,
    borderRadius: 4,
  },
  quotaHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  quotaHintText: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 8,
    width: '100%',
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listHeader: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  listHeaderAccepted: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  listContent: {
    paddingBottom: 100,
  },
  inviteCard: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  inviteCardUsed: {
    opacity: 0.6,
  },
  inviteCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inviteCode: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  inviteCodeUsed: {
    textDecorationLine: 'line-through',
    color: COLORS.gray500,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 12,
  },
  inviteActionBtn: {
    padding: 6,
  },
  usedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.piktag50,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  usedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  inviteDate: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 6,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 40,
  },
  pointsCard: {
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag100,
    borderRadius: 16,
    padding: 16,
    margin: 16,
    alignItems: 'center',
  },
  pointsLabel: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  pointsValue: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.piktag600,
    marginTop: 4,
  },
  pointsHint: {
    fontSize: 11,
    color: COLORS.gray400,
    marginTop: 2,
  },
});
