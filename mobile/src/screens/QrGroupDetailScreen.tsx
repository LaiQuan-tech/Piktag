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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Share2, Plus, X, Hash, Edit3, ScanLine, Link2, Pencil } from 'lucide-react-native';
import AtomIcon from '../components/AtomIcon';
import TagChip from '../components/TagChip';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
// react-native-qrcode-svg is the same lib AddTagScreen uses. Import
// inline so the bundle only pulls it on this screen too.
import QRCode from 'react-native-qrcode-svg';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import RingedAvatar from '../components/RingedAvatar';
import QrNameCard from '../components/QrNameCard';

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

// P0 "Vibe-to-Vibe reactivation" — current shared tags among
// this Vibe's members, returned by the vibe_member_current_tags
// RPC. `member_ids` lets the UI filter the member list to just
// the people behind a chosen tag (tap a tag → see who).
type CurrentVibeTag = {
  tag_name: string;
  member_count: number;
  member_ids: string[];
};

type Props = { navigation: any; route: any };

export default function QrGroupDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const groupId = route.params?.groupId as string | undefined;

  // Two views, one screen — mirrors AddTagScreen's setMode pattern.
  // 'present' = the full-bleed gradient "show off / share my QR"
  // card (what you land on from the Tag list — the look only ever
  // flashed once at creation before). 'edit' = the original
  // detail/editor (rename, tag editor, members). 編輯 QR toggles
  // present→edit; the editor's back arrow returns to present.
  const [mode, setMode] = useState<'present' | 'edit'>('present');
  const [qrUsername, setQrUsername] = useState('');

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  // P0 reactivation surface — current shared tags among the
  // Vibe's members. Empty array if the RPC isn't deployed yet
  // (migration tolerance) or if the threshold filtered everything
  // out (1-member Vibes will have nothing).
  const [currentTags, setCurrentTags] = useState<CurrentVibeTag[]>([]);
  // When non-null, the member list filters down to only those
  // members whose current tags include this one. Tapping the
  // already-selected tag clears the filter.
  const [selectedFilterTag, setSelectedFilterTag] = useState<string | null>(null);

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

      // Host's @username for the present-mode card (same derivation
      // as AddTagScreen: profile username, fallback to the id).
      try {
        const { data: prof } = await supabase
          .from('piktag_profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();
        setQrUsername((prof as any)?.username || user.id);
      } catch {
        setQrUsername(user.id);
      }

      const { data: m, error: mErr } = await supabase.rpc('qr_group_members', {
        p_group_id: groupId,
      });
      if (!mErr && Array.isArray(m)) {
        setMembers(m as Member[]);
      }

      // P0: fetch the "Vibe-to-Vibe" reactivation tags. Wrapped
      // in its own try so a missing RPC (migration not yet run
      // on this DB) just hides the section instead of breaking
      // the page. PGRST202 = "the requested function … was not
      // found"; treat it like 42703 — silent fall-through.
      try {
        const { data: tags, error: tagsErr } = await supabase.rpc(
          'vibe_member_current_tags',
          { p_group_id: groupId },
        );
        if (!tagsErr && Array.isArray(tags)) {
          setCurrentTags(tags as CurrentVibeTag[]);
        } else if (tagsErr) {
          const isMissing =
            (tagsErr as any).code === 'PGRST202' ||
            /could not find the function|does not exist/i.test(tagsErr.message);
          if (!isMissing) {
            console.warn('[QrGroupDetail] currentTags fetch failed:', tagsErr);
          }
          setCurrentTags([]);
        }
      } catch (err) {
        console.warn('[QrGroupDetail] currentTags threw:', err);
        setCurrentTags([]);
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
      // Wrap the raw qr_code_data URL in the same LINE-style
      // shareMessage as AddTagScreen so the recipient sees a
      // friendly invite line + tappable URL rather than a bare
      // URL with no context.
      await Share.share({
        message: t('addTag.shareMessage', { url: group.qr_code_data }),
      });
    } catch {
      /* user cancelled */
    }
  }, [group, t]);

  const handleCopyLink = useCallback(async () => {
    if (!group?.qr_code_data) return;
    try {
      await setClipboardStringAsync(group.qr_code_data);
      Alert.alert(
        t('addTag.alertLinkCopiedTitle', { defaultValue: '已複製' }),
        t('addTag.alertLinkCopiedMessage', { defaultValue: '連結已複製到剪貼簿' }),
      );
    } catch {
      /* no-op */
    }
  }, [group, t]);

  // P1 "Gather the Tribe" button was removed per user feedback:
  // "真實人生其實這群人可能互不認識，只是都跟發 QRcode 的使用者
  // 有一面之緣，所以群發不太可能". A Vibe is a snapshot of
  // people the host happened to meet — they share a relationship
  // with the HOST, not with each other. Group-pinging strangers
  // who only have the host in common feels socially wrong.
  // Individual DMs via the member list below preserve the
  // 一期一會 ("one moment, one meeting") spirit of a Vibe —
  // each connection stands on its own, no implied collective.

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
    [navigation, styles, colors],
  );

  // ─── Present mode ────────────────────────────────────────
  // Full-bleed gradient "show off / share my QR" card. Visually
  // mirrors AddTagScreen.renderQrMode so the look the user loved
  // (and that previously only flashed once at creation) is now
  // the persistent landing when you tap a Tag from the list.
  const renderPresent = () => {
    if (!group) return null;
    const presentName =
      group.name?.trim() ||
      t('qrGroup.untitled', { defaultValue: '未命名 Tag' });
    return (
      <LinearGradient
        colors={['#ff5757', '#c44dff', '#8c52ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.presentGradient}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
        <View style={[styles.presentTopBar, { paddingTop: insets.top + 12 }]}>
          {/* Back to the Tag list. */}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
            style={styles.presentTopBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', { defaultValue: '返回' })}
          >
            <X size={26} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('CameraScan')}
            activeOpacity={0.6}
            style={styles.presentTopBtn}
            accessibilityRole="button"
            accessibilityLabel={t('qrGroup.scan', { defaultValue: '掃描 QR 加好友' })}
          >
            <ScanLine size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.presentCardWrap}>
          {/* Shared white name-card (also used by the profile share
              modal) — keeps both surfaces pixel-identical. */}
          <QrNameCard
            qrValue={group.qr_code_data}
            handle={qrUsername}
            name={presentName}
            tags={group.event_tags}
          />
        </View>

        <View style={[styles.presentBottomRow, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity style={styles.presentBottomBtn} onPress={handleShare} activeOpacity={0.7}>
            <Share2 size={22} color={'#111827'} />
            <Text style={styles.presentBottomBtnText}>
              {t('addTag.shareFile', { defaultValue: '分享檔案' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presentBottomBtn} onPress={handleCopyLink} activeOpacity={0.7}>
            <Link2 size={22} color={'#111827'} />
            <Text style={styles.presentBottomBtnText}>
              {t('addTag.copyLink', { defaultValue: '複製連結' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presentBottomBtn} onPress={() => setMode('edit')} activeOpacity={0.7}>
            <Pencil size={22} color={'#111827'} />
            <Text style={styles.presentBottomBtnText}>
              {t('addTag.editQr', { defaultValue: '編輯 QR' })}
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  };

  if (loading || !group) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn}>
            <ArrowLeft size={22} color={colors.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('qrGroup.detailHeader', { defaultValue: 'Tag' })}</Text>
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

  // Default landing = the pretty present card. 編輯 QR flips to edit.
  if (mode === 'present') {
    return renderPresent();
  }

  const displayName =
    group.name?.trim() ||
    t('qrGroup.untitled', { defaultValue: '未命名 Tag' });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        {/* Back arrow returns to PRESENT (not the list) — the
            flow is list → present → edit, so ← should peel one
            layer back to the pretty card, then ← again to the
            list. */}
        <TouchableOpacity onPress={() => setMode('present')} style={styles.headerBackBtn}>
          <ArrowLeft size={22} color={colors.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('qrGroup.detailHeader', { defaultValue: 'Tag' })}
        </Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerBackBtn}>
          <Share2 size={20} color={colors.piktag600} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ─── Gradient hero ────────────────────────────────────
            Same red→purple→deep-purple gradient as the post-create
            QR screen (AddTagScreen renderQrMode). The user pointed
            out that this look only showed once — at QR creation —
            and asked to reuse it here so the Vibe detail page has
            real visual identity instead of being yet another white
            scrolling form.

            Layout mirrors the share screen:
              • Vibe name in white, big (still tap-to-edit)
              • White QR card with shadow
              • Tag preview line in semi-transparent white
            Editor controls (add/remove tags), Vibe-shift section,
            Gather button, and member list all live BELOW the
            gradient on plain white — gradient surfaces are great
            for showing off, terrible for typing. */}
        {/* Plain (non-gradient) hero. This is the SETTINGS view —
            the flashy red→purple gradient is now reserved for the
            present card (the one you show new friends to scan), so
            keeping the editor calm/utilitarian makes the present
            surface visually distinct. Dark text on a plain white
            background; the QR sits in a bordered card so it still
            reads as a discrete object without the gradient behind
            it. */}
        <View style={styles.heroPlain}>
          <View style={styles.heroNameSection}>
            {editingName ? (
              <TextInput
                style={styles.heroNameInput}
                value={nameInput}
                onChangeText={setNameInput}
                autoFocus
                onBlur={handleSaveName}
                onSubmitEditing={handleSaveName}
                returnKeyType="done"
                placeholder={t('qrGroup.namePlaceholder', { defaultValue: '幫這個 Tag 取個名字' })}
                placeholderTextColor={colors.gray400}
                maxLength={40}
              />
            ) : (
              <TouchableOpacity
                style={styles.heroNameRow}
                activeOpacity={0.6}
                onPress={() => setEditingName(true)}
              >
                <Text style={styles.heroNameText}>{displayName}</Text>
                <Edit3 size={14} color={colors.gray400} />
              </TouchableOpacity>
            )}
          </View>

          {/* QR in a bordered card — defined against plain white
              without the gradient. */}
          <View style={styles.heroQrWrap}>
            {group.qr_code_data ? (
              <QRCode value={group.qr_code_data} size={220} color={'#000000'} backgroundColor="#FFFFFF" />
            ) : null}
          </View>

          {/* Read-only tag preview. The full add/remove editor is
              the next section; this is just the glimpse. */}
          {group.event_tags.length > 0 ? (
            <Text style={styles.heroTagsLine} numberOfLines={2}>
              {group.event_tags.map((tag) => '#' + tag.replace(/^#/, '')).join('  ')}
            </Text>
          ) : null}
        </View>

        {/* Tag editor. */}
        <View style={styles.tagSection}>
          <Text style={styles.sectionTitle}>
            {t('qrGroup.tagsTitle', { defaultValue: 'Tag 標籤' })}
          </Text>
          <View style={styles.tagChipsRow}>
            {/* Shared TagChip (no × glyph, whole pill = tap to remove,
                fill-only purple). Founder contract: no per-screen chip
                copies; no × anywhere. */}
            {group.event_tags.map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                onRemove={() => removeTag(tag)}
              />
            ))}
            {group.event_tags.length === 0 ? (
              <Text style={styles.tagEmpty}>
                {t('qrGroup.tagsEmpty', { defaultValue: '尚無標籤' })}
              </Text>
            ) : null}
          </View>
          <View style={styles.tagInputRow}>
            <View style={styles.tagInputPill}>
              <Hash size={16} color={colors.gray400} />
              <TextInput
                style={styles.tagInput}
                placeholder={t('qrGroup.tagInputPlaceholder', { defaultValue: '輸入新標籤' })}
                placeholderTextColor={colors.gray400}
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

        {/* ─── P0: Vibe-to-Vibe reactivation ─────────────────
            Shows tags that ≥2 members of this Vibe have on their
            CURRENT profile (excludes the Vibe's own identity
            tags). Tapping a tag filters the member list below to
            just those members. The whole section hides if there
            are no shared current tags (e.g. a 1-member Vibe, or
            a brand-new Vibe before members have set tags).

            This is the headline difference between PikTag and a
            generic contacts app: a static "who scanned my QR"
            list becomes a live "what they're into now" view. */}
        {currentTags.length > 0 && (
          <View style={styles.vibeShiftSection}>
            <View style={styles.vibeShiftHeader}>
              <AtomIcon size={16} color={colors.piktag500} strokeWidth={2.2} />
              <Text style={styles.vibeShiftTitle}>
                {t('qrGroup.currentVibesTitle', { defaultValue: '他們最近在標什麼' })}
              </Text>
            </View>
            <Text style={styles.vibeShiftHint}>
              {t('qrGroup.currentVibesHint', {
                defaultValue: '這群人現在共同的標籤 — 點一下看是誰',
              })}
            </Text>
            <View style={styles.vibeShiftChipsRow}>
              {currentTags.map((ct) => {
                const isActive = selectedFilterTag === ct.tag_name;
                return (
                  <TouchableOpacity
                    key={ct.tag_name}
                    style={[
                      styles.vibeShiftChip,
                      isActive && styles.vibeShiftChipActive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      // Toggle: tap an already-selected chip to clear
                      setSelectedFilterTag(isActive ? null : ct.tag_name);
                    }}
                  >
                    <Text
                      style={[
                        styles.vibeShiftChipTag,
                        isActive && styles.vibeShiftChipTagActive,
                      ]}
                    >
                      #{ct.tag_name}
                    </Text>
                    <Text
                      style={[
                        styles.vibeShiftChipCount,
                        isActive && styles.vibeShiftChipCountActive,
                      ]}
                    >
                      {t('qrGroup.currentVibesCount', {
                        count: ct.member_count,
                        defaultValue: `${ct.member_count} 人`,
                      })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Member list + P1 Gather button. */}
        <View style={styles.memberSection}>
          {(() => {
            // When a tag filter is active, members are scoped to
            // those whose user_id is in the selected tag's
            // member_ids set. Otherwise the full list shows.
            const filterEntry =
              selectedFilterTag != null
                ? currentTags.find((ct) => ct.tag_name === selectedFilterTag)
                : null;
            const filteredMembers =
              filterEntry != null
                ? members.filter((m) =>
                    filterEntry.member_ids.includes(m.connected_user_id),
                  )
                : members;
            return (
              <>
                <View style={styles.memberHeaderRow}>
                  <Text style={styles.sectionTitle}>
                    {t('qrGroup.membersTitle', {
                      count: filteredMembers.length,
                      defaultValue: `成員（${filteredMembers.length}）`,
                    })}
                  </Text>
                  {filterEntry != null ? (
                    <TouchableOpacity
                      onPress={() => setSelectedFilterTag(null)}
                      style={styles.memberFilterClearBtn}
                      hitSlop={6}
                    >
                      <Text style={styles.memberFilterClearText}>
                        #{filterEntry.tag_name}
                      </Text>
                      <X size={12} color={colors.piktag600} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {filteredMembers.length === 0 ? (
                  <View style={styles.memberEmpty}>
                    <Text style={styles.memberEmptyText}>
                      {filterEntry != null
                        ? t('qrGroup.membersFilterEmpty', {
                            defaultValue: '這個 Tag 中沒有貼這個標籤的人',
                          })
                        : t('qrGroup.membersEmpty', {
                            defaultValue: '還沒有人掃這個 QR — 分享給朋友吧',
                          })}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredMembers}
                    keyExtractor={(m) => m.connection_id}
                    renderItem={renderMember}
                    scrollEnabled={false}
                  />
                )}
              </>
            );
          })()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },

  // ── Present mode (mirrors AddTagScreen.renderQrMode) ──
  presentGradient: { flex: 1 },
  presentTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  presentTopBtn: { padding: 8 },
  presentCardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // (presentWhiteCard / presentUsername / presentName /
  // presentTagsWrap / presentTagsLine moved into the shared
  // QrNameCard component — single source of truth for the card.)
  presentBottomRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  presentBottomBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  presentBottomBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
    gap: 12,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: c.gray900, textAlign: 'center' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 14, color: c.gray500 },
  scrollContent: { paddingBottom: 60 },

  // ─── Gradient hero ─────────────────────────────────────────
  // Mirrors AddTagScreen renderQrMode's gradient — red → magenta
  // → deep purple. Used at the top of the Vibe detail page so
  // the QR + name + tag preview share the same visual identity
  // as the share/create surface.
  // Plain settings hero (gradient removed — reserved for the
  // present card). Thin bottom rule separates it from the tag
  // editor below so the page reads as stacked settings sections.
  heroPlain: {
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  heroNameSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 22,
  },
  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroNameText: {
    fontSize: 24,
    fontWeight: '800',
    color: c.gray900,
    textAlign: 'center',
    flexShrink: 1,
  },
  heroNameInput: {
    fontSize: 24,
    fontWeight: '800',
    color: c.gray900,
    textAlign: 'center',
    minWidth: 200,
    borderBottomWidth: 1.5,
    borderBottomColor: c.gray200,
    paddingVertical: 4,
  },
  // QR card: a light border (not a heavy float shadow) so it
  // reads as a defined object on the plain page.
  heroQrWrap: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.gray100,
  },
  heroTagsLine: {
    marginTop: 18,
    fontSize: 13,
    fontWeight: '600',
    color: c.gray500,
    textAlign: 'center',
    letterSpacing: 0.2,
  },


  tagSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.gray600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  tagChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  // (tagChip / tagChipText removed — chip rendering now via the
  // shared <TagChip>; no per-screen chip styles allowed.)
  tagEmpty: { fontSize: 13, color: c.gray400 },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tagInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: 12,
    backgroundColor: c.white,
    minHeight: 40,
  },
  tagInput: { flex: 1, fontSize: 15, color: c.gray900 },
  tagAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },

  memberSection: { paddingHorizontal: 20, paddingTop: 18 },

  // Header row pairs the "Members (N)" title with the active
  // filter chip when a tag is selected. Filter chip is the same
  // visual style as the active Vibe-shift chip but at a smaller
  // size + with an X to clear.
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  memberFilterClearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: c.piktag50,
  },
  memberFilterClearText: {
    fontSize: 12,
    color: c.piktag600,
    fontWeight: '700',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  memberBody: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: c.gray900 },
  memberHandle: { fontSize: 12, color: c.gray500, marginTop: 1 },
  memberEmpty: { paddingVertical: 24, alignItems: 'center' },
  memberEmptyText: { fontSize: 13, color: c.gray500, textAlign: 'center' },

  // ─── P0 Vibe-to-Vibe reactivation ──────────────────────────
  // Section sits between the Vibe's own tag editor and the member
  // list, visually distinct (Atom icon + light purple chip
  // backgrounds) so users register "this is a different kind of
  // info — what they're into NOW, not what tagged the event."
  vibeShiftSection: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  vibeShiftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  vibeShiftTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray900,
  },
  vibeShiftHint: {
    fontSize: 12,
    color: c.gray500,
    marginBottom: 10,
  },
  vibeShiftChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vibeShiftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: c.piktag50,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Selected state: solid purple background + inverted text. Makes
  // it crystal clear which filter is active. Tap again to deselect.
  vibeShiftChipActive: {
    backgroundColor: c.piktag500,
    borderColor: c.piktag500,
  },
  vibeShiftChipTag: {
    fontSize: 13,
    fontWeight: '700',
    color: c.piktag600,
  },
  vibeShiftChipTagActive: {
    color: '#FFFFFF',
  },
  vibeShiftChipCount: {
    fontSize: 12,
    color: c.gray500,
    fontWeight: '600',
  },
  vibeShiftChipCountActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  });
}
