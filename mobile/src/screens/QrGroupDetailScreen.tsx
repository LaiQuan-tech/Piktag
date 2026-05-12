// QrGroupDetailScreen.tsx
//
// Task 2 (QR groups). One persistent QR group's detail view:
//   * Editable name (taps the title to edit)
//   * QR code (re-shareable any time — the group never expires)
//   * Editable tag chips (will become AI-driven in task 3; manual
//     for now so the existing data flow still works end-to-end)
//   * Member list — everyone who scanned this QR and registered
//   * Share button — system Share sheet for the QR's URL
//
// Route param: groupId (uuid). The screen fetches the row by id
// on mount and on every focus so a fresh scan that just added a
// member shows up when the host comes back.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Share,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Share2, Plus, X, Hash, Edit3 } from 'lucide-react-native';
// react-native-qrcode-svg is the same lib AddTagScreen uses. Import
// inline so the bundle only pulls it on this screen too.
import QRCode from 'react-native-qrcode-svg';
import { Image } from 'expo-image';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import RingedAvatar from '../components/RingedAvatar';

type Member = {
  connection_id: string;
  connected_user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  met_at: string;
};

type Group = {
  id: string;
  name: string | null;
  event_tags: string[];
  qr_code_data: string;
  created_at: string;
};

type Props = { navigation: any; route: any };

export default function QrGroupDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const groupId = route.params?.groupId as string | undefined;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [tagInput, setTagInput] = useState('');

  const fetchGroup = useCallback(async () => {
    if (!user || !groupId) return;
    setLoading(true);
    try {
      // Same migration-tolerance pattern as QrGroupListScreen: try
      // with `name`, fall back to without if the column doesn't
      // exist on this database yet.
      let { data: g, error: gErr } = await supabase
        .from('piktag_scan_sessions')
        .select('id, name, event_tags, qr_code_data, created_at')
        .eq('id', groupId)
        .eq('host_user_id', user.id)
        .maybeSingle();
      if (gErr && ((gErr as any).code === '42703' || /column .*name/i.test(gErr.message))) {
        const fallback = await supabase
          .from('piktag_scan_sessions')
          .select('id, event_tags, qr_code_data, created_at')
          .eq('id', groupId)
          .eq('host_user_id', user.id)
          .maybeSingle();
        g = fallback.data ? ({ ...fallback.data, name: null } as any) : null;
        gErr = fallback.error;
      }
      if (gErr || !g) {
        console.warn('[QrGroupDetail] group fetch failed:', gErr);
        setGroup(null);
        return;
      }
      setGroup(g as Group);
      setNameInput((g as any).name ?? '');

      const { data: m, error: mErr } = await supabase.rpc('qr_group_members', {
        p_group_id: groupId,
      });
      if (!mErr && Array.isArray(m)) {
        setMembers(m as Member[]);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, user]);

  useFocusEffect(
    useCallback(() => {
      fetchGroup();
    }, [fetchGroup]),
  );

  // Save name. Optimistic update so the title doesn't blink.
  const handleSaveName = useCallback(async () => {
    if (!group) return;
    const trimmed = nameInput.trim();
    setEditingName(false);
    if (trimmed === (group.name ?? '')) return;
    setGroup({ ...group, name: trimmed || null });
    const { error } = await supabase
      .from('piktag_scan_sessions')
      .update({ name: trimmed || null })
      .eq('id', group.id);
    if (error) {
      // 42703 = column doesn't exist (migration not applied yet).
      // Don't bother the user with a warning popup — just keep the
      // optimistic state as a session-local rename. Migration will
      // catch this up next time.
      const isMissingColumn =
        (error as any).code === '42703' || /column .*name/i.test(error.message);
      if (!isMissingColumn) {
        console.warn('[QrGroupDetail] save name failed:', error);
        // Revert optimistic state on real errors
        fetchGroup();
      }
    }
  }, [group, nameInput, fetchGroup]);

  // Add / remove tags. event_tags is a text[] on the row — we just
  // overwrite the whole array each edit.
  const writeTags = useCallback(
    async (next: string[]) => {
      if (!group) return;
      setGroup({ ...group, event_tags: next });
      const { error } = await supabase
        .from('piktag_scan_sessions')
        .update({ event_tags: next })
        .eq('id', group.id);
      if (error) {
        console.warn('[QrGroupDetail] update tags failed:', error);
        fetchGroup();
      }
    },
    [group, fetchGroup],
  );

  const addTag = useCallback(() => {
    if (!group) return;
    const trimmed = tagInput.trim().replace(/^#/, '');
    if (!trimmed) return;
    if (group.event_tags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    writeTags([...group.event_tags, trimmed]);
    setTagInput('');
  }, [group, tagInput, writeTags]);

  const removeTag = useCallback(
    (tag: string) => {
      if (!group) return;
      writeTags(group.event_tags.filter((t) => t !== tag));
    },
    [group, writeTags],
  );

  const handleShare = useCallback(async () => {
    if (!group?.qr_code_data) return;
    try {
      await Share.share({
        message: group.qr_code_data,
      });
    } catch {
      /* user cancelled */
    }
  }, [group]);

  const renderMember = useCallback(
    ({ item }: { item: Member }) => {
      const displayName = item.full_name || item.username || '?';
      return (
        <TouchableOpacity
          style={styles.memberRow}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('FriendDetail', {
              connectionId: item.connection_id,
              friendId: item.connected_user_id,
            })
          }
        >
          <RingedAvatar
            size={42}
            ringStyle="subtle"
            name={displayName}
            avatarUrl={item.avatar_url}
          />
          <View style={styles.memberBody}>
            <Text style={styles.memberName} numberOfLines={1}>{displayName}</Text>
            {item.username ? (
              <Text style={styles.memberHandle} numberOfLines={1}>
                @{item.username}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      );
    },
    [navigation],
  );

  if (loading || !group) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
            <ArrowLeft size={22} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('qrGroup.detailHeader', { defaultValue: 'Vibe' })}</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>
            {t('common.processing', { defaultValue: '處理中…' })}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName =
    group.name?.trim() ||
    t('qrGroup.untitled', { defaultValue: '未命名 Vibe' });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
          <ArrowLeft size={22} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('qrGroup.detailHeader', { defaultValue: 'Vibe' })}
        </Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerBackBtn}>
          <Share2 size={20} color={COLORS.piktag600} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Editable name. Tap to edit, blur or submit to save. */}
        <View style={styles.nameSection}>
          {editingName ? (
            <TextInput
              style={styles.nameInput}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              onBlur={handleSaveName}
              onSubmitEditing={handleSaveName}
              returnKeyType="done"
              placeholder={t('qrGroup.namePlaceholder', { defaultValue: '幫這個 Vibe 取個名字' })}
              placeholderTextColor={COLORS.gray400}
              maxLength={40}
            />
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              activeOpacity={0.6}
              onPress={() => setEditingName(true)}
            >
              <Text style={styles.nameText}>{displayName}</Text>
              <Edit3 size={14} color={COLORS.gray400} />
            </TouchableOpacity>
          )}
        </View>

        {/* QR. Big, central, scannable from any angle. */}
        <View style={styles.qrCard}>
          <View style={styles.qrInner}>
            {group.qr_code_data ? (
              <QRCode value={group.qr_code_data} size={220} color={COLORS.gray900} />
            ) : null}
          </View>
        </View>

        {/* Tag editor. */}
        <View style={styles.tagSection}>
          <Text style={styles.sectionTitle}>
            {t('qrGroup.tagsTitle', { defaultValue: 'Vibe 標籤' })}
          </Text>
          <View style={styles.tagChipsRow}>
            {group.event_tags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>#{tag}</Text>
                <TouchableOpacity onPress={() => removeTag(tag)} hitSlop={6}>
                  <X size={12} color={COLORS.piktag600} />
                </TouchableOpacity>
              </View>
            ))}
            {group.event_tags.length === 0 ? (
              <Text style={styles.tagEmpty}>
                {t('qrGroup.tagsEmpty', { defaultValue: '尚無標籤' })}
              </Text>
            ) : null}
          </View>
          <View style={styles.tagInputRow}>
            <View style={styles.tagInputPill}>
              <Hash size={16} color={COLORS.gray400} />
              <TextInput
                style={styles.tagInput}
                placeholder={t('qrGroup.tagInputPlaceholder', { defaultValue: '輸入新標籤' })}
                placeholderTextColor={COLORS.gray400}
                value={tagInput}
                onChangeText={setTagInput}
                returnKeyType="done"
                onSubmitEditing={addTag}
                maxLength={20}
              />
            </View>
            <TouchableOpacity
              style={styles.tagAddBtn}
              onPress={addTag}
              disabled={!tagInput.trim()}
              activeOpacity={0.7}
            >
              <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Member list. */}
        <View style={styles.memberSection}>
          <Text style={styles.sectionTitle}>
            {t('qrGroup.membersTitle', {
              count: members.length,
              defaultValue: `成員（${members.length}）`,
            })}
          </Text>
          {members.length === 0 ? (
            <View style={styles.memberEmpty}>
              <Text style={styles.memberEmptyText}>
                {t('qrGroup.membersEmpty', {
                  defaultValue: '還沒有人掃這個 QR — 分享給朋友吧',
                })}
              </Text>
            </View>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(m) => m.connection_id}
              renderItem={renderMember}
              scrollEnabled={false}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    gap: 12,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: COLORS.gray900, textAlign: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 14, color: COLORS.gray500 },
  scrollContent: { paddingBottom: 60 },

  nameSection: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { fontSize: 22, fontWeight: '800', color: COLORS.gray900, flexShrink: 1 },
  nameInput: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.gray900,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.piktag500,
    paddingVertical: 4,
  },

  qrCard: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  qrInner: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },

  tagSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  tagChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 16,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
  },
  tagChipText: { fontSize: 13, fontWeight: '700', color: COLORS.piktag600 },
  tagEmpty: { fontSize: 13, color: COLORS.gray400 },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tagInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    minHeight: 40,
  },
  tagInput: { flex: 1, fontSize: 15, color: COLORS.gray900 },
  tagAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },

  memberSection: { paddingHorizontal: 20, paddingTop: 18 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  memberBody: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: COLORS.gray900 },
  memberHandle: { fontSize: 12, color: COLORS.gray500, marginTop: 1 },
  memberEmpty: { paddingVertical: 24, alignItems: 'center' },
  memberEmptyText: { fontSize: 13, color: COLORS.gray500, textAlign: 'center' },
});
