import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, StatusBar, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../context/ThemeContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PointsLedgerEntry } from '../types';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function PointsHistoryScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<number>(0);
  const [entries, setEntries] = useState<PointsLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [balanceRes, entriesRes] = await Promise.all([
        supabase.from('piktag_profiles').select('p_points').eq('id', user.id).single(),
        supabase.from('piktag_points_ledger').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      ]);
      setBalance(balanceRes.data?.p_points ?? 0);
      setEntries((entriesRes.data as PointsLedgerEntry[]) ?? []);
    } catch (err) {
      console.warn('[PointsHistory] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const reasonLabel = (reason: string) => {
    if (reason === 'invite_accepted') return t('points.reasonInviteAccepted');
    if (reason === 'admin_grant') return t('points.reasonAdminGrant');
    if (reason === 'redeemed') return t('points.reasonRedeemed');
    return reason;
  };

  const renderItem = ({ item }: { item: PointsLedgerEntry }) => (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.reason, { color: colors.text }]}>{reasonLabel(item.reason)}</Text>
        <Text style={[styles.date, { color: colors.textTertiary }]}>{new Date(item.created_at).toLocaleString()}</Text>
      </View>
      <Text style={[styles.delta, { color: item.delta >= 0 ? '#22c55e' : '#ef4444' }]}>
        {item.delta >= 0 ? '+' : ''}{item.delta} {t('points.pointsUnit')}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('points.historyTitle')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={[styles.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.balanceLabel, { color: colors.textSecondary }]}>{t('points.balance')}</Text>
        <Text style={[styles.balanceValue, { color: colors.piktag500 }]}>{balance} {t('points.pointsUnit')}</Text>
        <Text style={[styles.balanceHint, { color: colors.textTertiary }]}>{t('points.redeemHint')}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator /></View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('points.emptyHistory')}</Text>
        </View>
      ) : (
        <FlatList data={entries} keyExtractor={(item) => item.id} renderItem={renderItem} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center', marginHorizontal: 12 },
  balanceCard: { margin: 16, padding: 20, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  balanceLabel: { fontSize: 14, marginBottom: 6 },
  balanceValue: { fontSize: 36, fontWeight: '800' },
  balanceHint: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  reason: { fontSize: 15, fontWeight: '600' },
  date: { fontSize: 12, marginTop: 2 },
  delta: { fontSize: 17, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyText: { fontSize: 15 },
});
