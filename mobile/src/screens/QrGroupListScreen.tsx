// QrGroupListScreen.tsx
//
// Task 2 (QR → groups). Replaces AddTagScreen as the AddTagTab
// landing surface. Shows the host's persistent QR groups (renamed
// scan_sessions) with a member count per row. Tap a row → opens
// the same QR view used to show the group's code + edit its tags.
// "+" button at the top right creates a fresh group through the
// reused AddTagScreen creation flow.
//
// Why this exists: the old AddTagScreen treated QR codes as
// single-use 24-hour ephemeral artefacts. The user wants each QR
// to be a long-lived classifier ("公司聚會", "週末活動") so a person
// scanning becomes a member of that group permanently, and the
// host can re-share the same QR later. This screen is the index.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  QrCode,
  ChevronRight,
  Users,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type QrGroup = {
  id: string;
  name: string | null;
  event_tags: string[];
  event_date: string | null;
  event_location: string | null;
  qr_code_data: string;
  created_at: string;
  is_active: boolean;
  member_count: number;
};

type Props = { navigation: any };

export default function QrGroupListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const [groups, setGroups] = useState<QrGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Load my groups. Refetched on every focus so a new group created
  // via the AddTag flow appears here as soon as the user comes back.
  //
  // Migration tolerance: the `name` column was added in
  // 20260508130000_qr_groups.sql. If the user hasn't applied that
  // migration yet (testing without running the SQL), SELECTing
  // `name` would 42703-error and the screen would silently show
  // empty, masking real data. Try with `name` first; on column-
  // missing error, retry without it. Both branches surface the
  // user's actual sessions; the only difference is whether the
  // display name comes from session.name (with migration) or
  // falls back to event_location / date (without).
  const loadGroups = useCallback(async () => {
    if (!user) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const cols = 'id, name, event_tags, event_date, event_location, qr_code_data, created_at, is_active';
      let { data, error } = await supabase
        .from('piktag_scan_sessions')
        .select(cols)
        .eq('host_user_id', user.id)
        .order('created_at', { ascending: false });
      // 42703 = undefined_column. Postgres error code for "column X
      // does not exist". Means migration hasn't been applied — fall
      // back to the same query without the optional `name` column.
      if (error && ((error as any).code === '42703' || /column .*name/i.test(error.message))) {
        const fallback = await supabase
          .from('piktag_scan_sessions')
          .select('id, event_tags, event_date, event_location, qr_code_data, created_at, is_active')
          .eq('host_user_id', user.id)
          .order('created_at', { ascending: false });
        // fallback rows lack `name` — coerce to the wider shape so
        // downstream code can read .name as null without TS error.
        data = (fallback.data ?? null) as any;
        error = fallback.error;
      }
      if (error) {
        console.warn('[QrGroupList] load failed:', error);
        setGroups([]);
        return;
      }
      // Normalize: rows from the fallback path don't have a `name`
      // field — coerce to null so the rest of the screen can treat
      // both shapes identically.
      const rows = ((data ?? []) as Array<Partial<Omit<QrGroup, 'member_count'>>>).map(
        (r) => ({ ...r, name: (r as any).name ?? null }) as Omit<QrGroup, 'member_count'>,
      );
      // Member counts in parallel via the SECURITY DEFINER RPC.
      // One round-trip per group sounds heavy, but the typical user
      // has <20 groups and the RPC is a fast indexed count.
      const counts = await Promise.all(
        rows.map(async (r) => {
          const { data: c } = await supabase.rpc('qr_group_member_count', {
            p_group_id: r.id,
          });
          return typeof c === 'number' ? c : 0;
        }),
      );
      setGroups(rows.map((r, i) => ({ ...r, member_count: counts[i] })));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadGroups();
    }, [loadGroups]),
  );

  const handleCreateNew = useCallback(() => {
    // Reuse the existing AddTagScreen as the creation form. Pass
    // mode=create so it knows to start fresh (no group id pre-loaded).
    navigation.navigate('AddTagCreate');
  }, [navigation]);

  const handleOpenGroup = useCallback(
    (g: QrGroup) => {
      navigation.navigate('QrGroupDetail', { groupId: g.id });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: QrGroup }) => {
      const displayName =
        item.name?.trim() ||
        (item.event_location ? `${item.event_location}` : null) ||
        t('qrGroup.untitledFallback', {
          date: new Date(item.created_at).toLocaleDateString(),
          defaultValue: `Group · ${new Date(item.created_at).toLocaleDateString()}`,
        });
      const tagPreview = item.event_tags.slice(0, 3);
      return (
        <TouchableOpacity
          style={styles.groupRow}
          activeOpacity={0.7}
          onPress={() => handleOpenGroup(item)}
        >
          <View style={styles.groupIcon}>
            <QrCode size={22} color={COLORS.piktag600} />
          </View>
          <View style={styles.groupBody}>
            <Text style={styles.groupName} numberOfLines={1}>
              {displayName}
            </Text>
            <View style={styles.groupMetaRow}>
              {tagPreview.length > 0 ? (
                <Text style={styles.groupTags} numberOfLines={1}>
                  {tagPreview.map((t) => `#${t}`).join('  ')}
                  {item.event_tags.length > 3 ? `  +${item.event_tags.length - 3}` : ''}
                </Text>
              ) : (
                <Text style={styles.groupTagsEmpty}>
                  {t('qrGroup.noTagsYet', { defaultValue: '尚無標籤' })}
                </Text>
              )}
            </View>
            <View style={styles.groupCountRow}>
              <Users size={12} color={COLORS.gray500} />
              <Text style={styles.groupCount}>
                {t('qrGroup.memberCount', {
                  count: item.member_count,
                  defaultValue: `${item.member_count} 位好友`,
                })}
              </Text>
            </View>
          </View>
          <ChevronRight size={18} color={COLORS.gray400} />
        </TouchableOpacity>
      );
    },
    [handleOpenGroup, t],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <QrCode size={36} color={COLORS.piktag500} />
        </View>
        <Text style={styles.emptyTitle}>
          {t('qrGroup.emptyTitle', { defaultValue: '還沒有活動群組標籤' })}
        </Text>
        <Text style={styles.emptyDesc}>
          {t('qrGroup.emptyDesc', {
            defaultValue: '每個 QR 是一個群組，朋友掃一下就加進來 — 之後隨時可以回來看名單、加標籤、重新分享。',
          })}
        </Text>
        <TouchableOpacity
          style={styles.emptyCta}
          activeOpacity={0.85}
          onPress={handleCreateNew}
        >
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.emptyCtaText}>
            {t('qrGroup.createFirst', { defaultValue: '建立第一個活動群組標籤' })}
          </Text>
        </TouchableOpacity>
      </View>
    ),
    [t, handleCreateNew],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {t('qrGroup.headerTitle', { defaultValue: '活動群組標籤' })}
        </Text>
        <TouchableOpacity
          style={styles.headerAddBtn}
          activeOpacity={0.7}
          onPress={handleCreateNew}
          accessibilityRole="button"
          accessibilityLabel={t('qrGroup.create', { defaultValue: '建立新活動群組' })}
        >
          <Plus size={22} color={COLORS.piktag600} />
        </TouchableOpacity>
      </View>

      {loading && groups.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={COLORS.piktag500} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderItem}
          contentContainerStyle={groups.length === 0 ? styles.emptyContentContainer : styles.listContent}
          ListEmptyComponent={listEmpty}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  headerAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingBottom: 100 },
  emptyContentContainer: { flexGrow: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupBody: { flex: 1, gap: 3 },
  groupName: { fontSize: 16, fontWeight: '700', color: COLORS.gray900 },
  groupMetaRow: { flexDirection: 'row' },
  groupTags: { fontSize: 13, color: COLORS.piktag600, fontWeight: '500' },
  groupTagsEmpty: { fontSize: 13, color: COLORS.gray400, fontStyle: 'italic' },
  groupCountRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  groupCount: { fontSize: 12, color: COLORS.gray500 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.gray900 },
  emptyDesc: { fontSize: 13, color: COLORS.gray500, textAlign: 'center', lineHeight: 19 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: COLORS.piktag500,
    marginTop: 12,
  },
  emptyCtaText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
