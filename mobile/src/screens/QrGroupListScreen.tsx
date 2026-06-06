// QrGroupListScreen.tsx
//
// Task 2 landing surface for AddTagTab. Lists the host's persistent
// event groups (piktag_scan_sessions rows) with member count,
// drag-to-reorder, and swipe/long-press delete.
//
// Sort precedence:
//   1. sort_position ASC NULLS LAST  (user's manual order)
//   2. created_at DESC               (newest first for untouched rows)
//
// Drag-reorder writes back sort_position values 0..N-1 to the rows
// in their new visual order on drop. Once any reorder happens, the
// list permanently follows sort_position; newly-created groups land
// at the top with sort_position = NULL until the user reorders.
//
// Delete uses a confirm Alert + SQL DELETE — cascades into
// piktag_pending_connections via the existing FK. Connections rows
// that referenced this scan_session via text scan_session_id are
// not FK-linked, so they survive (good — the friend is still your
// friend, the group entry just disappears).

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  QrCode,
  ChevronRight,
  Users,
  Trash2,
  GripVertical,
  ScanLine,
} from 'lucide-react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { COLORS, type ColorPalette } from '../constants/theme';
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
  sort_position: number | null;
  member_count: number;
};


type Props = { navigation: any };

export default function QrGroupListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [groups, setGroups] = useState<QrGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Load my groups. Refetched on every focus so a new group created
  // via the AddTag flow appears here as soon as the user comes back.
  //
  // Migration tolerance (two columns may not exist yet):
  //   * `name`           added in 20260508130000_qr_groups.sql
  //   * `sort_position`  added in 20260512010000_qr_groups_sort_position.sql
  // We probe with the full column set; if it 42703s on either column,
  // fall back to the minimal stable set and treat both as null.
  const loadGroups = useCallback(async () => {
    if (!user) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fullCols =
        'id, name, sort_position, event_tags, event_date, event_location, qr_code_data, created_at, is_active';
      let { data, error } = await supabase
        .from('piktag_scan_sessions')
        .select(fullCols)
        .eq('host_user_id', user.id)
        .order('sort_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error && ((error as any).code === '42703' || /column .*(name|sort_position)/i.test(error.message))) {
        const fallback = await supabase
          .from('piktag_scan_sessions')
          .select('id, event_tags, event_date, event_location, qr_code_data, created_at, is_active')
          .eq('host_user_id', user.id)
          .order('created_at', { ascending: false });
        data = (fallback.data ?? null) as any;
        error = fallback.error;
      }
      if (error) {
        console.warn('[QrGroupList] load failed:', error);
        setGroups([]);
        return;
      }
      const rows = ((data ?? []) as Array<Partial<Omit<QrGroup, 'member_count'>>>).map(
        (r) => ({
          ...r,
          name: (r as any).name ?? null,
          sort_position: (r as any).sort_position ?? null,
        }) as Omit<QrGroup, 'member_count'>,
      );
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
    navigation.navigate('AddTagCreate');
  }, [navigation]);

  // Scan-someone-else's-QR entry point. Previously buried inside the
  // create-QR form's header — moved here because creating-my-own-QR
  // and scanning-someone-else's-QR are sibling actions, not parent/
  // child. Both belong on the tab's landing page so users discover
  // them at a glance instead of having to drill into the create flow.
  //
  // `CameraScan` lives in the root stack (registered in AppNavigator),
  // not the AddTag stack. React Navigation walks up parent navigators
  // when a route name isn't found locally, so this single navigate
  // call works.
  const handleOpenScanner = useCallback(() => {
    navigation.navigate('CameraScan');
  }, [navigation]);

  const handleOpenGroup = useCallback(
    (g: QrGroup) => {
      navigation.navigate('QrGroupDetail', { groupId: g.id });
    },
    [navigation],
  );

  // ─── Delete ─────────────────────────────────────────────
  const handleDelete = useCallback(
    (g: QrGroup) => {
      const displayName =
        g.name?.trim() ||
        g.event_location ||
        t('qrGroup.untitled', { defaultValue: '未命名 Tag' });
      Alert.alert(
        t('qrGroup.deleteTitle', { defaultValue: '刪除這個 Tag？' }),
        t('qrGroup.deleteMessage', {
          name: displayName,
          defaultValue: `「${displayName}」會從你的 Tags 中移除。已經透過這個 QR 碼加你為好友的人不會受影響。`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '刪除' }),
            style: 'destructive',
            onPress: async () => {
              // Optimistic remove so the row disappears immediately.
              setGroups((prev) => prev.filter((x) => x.id !== g.id));
              // `.select()` so we can see WHICH rows were actually
              // deleted. Without it, an RLS-denied delete returns
              // { error: null } and deletes 0 rows — the optimistic
              // UI then lies (row vanishes, reappears on next load).
              // Empty `data` => nothing deleted => surface it and
              // revert instead of pretending it worked.
              const { data: deleted, error } = await supabase
                .from('piktag_scan_sessions')
                .delete()
                .eq('id', g.id)
                .select('id');
              const nothingDeleted =
                !error && (!deleted || deleted.length === 0);
              if (error || nothingDeleted) {
                console.warn(
                  '[QrGroupList] delete failed:',
                  error ?? 'RLS denied or row already gone (0 rows affected)',
                );
                // Revert the optimistic removal — the row is still
                // in the DB.
                await loadGroups();
                Alert.alert(
                  t('qrGroup.deleteFailedTitle', { defaultValue: '刪除失敗' }),
                  t('qrGroup.deleteFailedMessage', {
                    defaultValue:
                      '這個 Vibe 沒有被刪除，請稍後再試。若持續發生請聯絡我們。',
                  }),
                );
              }
            },
          },
        ],
      );
    },
    [t, loadGroups],
  );

  // ─── Drag-reorder ───────────────────────────────────────
  // Called by DraggableFlatList when the user drops a dragged row.
  // Writes back sort_position = visual_index for every row, so the
  // ordering survives reload. Done as parallel UPDATEs because
  // there's no single-statement batch UPDATE in PostgREST; a bulk
  // upsert with explicit (id, sort_position) pairs would also work
  // but adds complexity for no real perf gain at <20 groups.
  const handleDragEnd = useCallback(
    async ({ data }: { data: QrGroup[] }) => {
      setGroups(data);
      try {
        await Promise.all(
          data.map((g, idx) =>
            supabase
              .from('piktag_scan_sessions')
              .update({ sort_position: idx })
              .eq('id', g.id),
          ),
        );
      } catch (err) {
        // 42703 (missing column) means migration not applied — silent
        // fail is fine, the reorder still works in the current session
        // even if it doesn't persist across reloads.
        console.warn('[QrGroupList] reorder persist failed:', err);
      }
    },
    [],
  );

  // ─── Row render ─────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<QrGroup>) => {
      const displayName =
        item.name?.trim() ||
        (item.event_location ? `${item.event_location}` : null) ||
        t('qrGroup.untitledFallback', {
          date: new Date(item.created_at).toLocaleDateString(),
          defaultValue: `Tag · ${new Date(item.created_at).toLocaleDateString()}`,
        });
      const tagPreview = item.event_tags.slice(0, 3);
      return (
        <ScaleDecorator>
          <TouchableOpacity
            style={[styles.groupRow, isActive && styles.groupRowActive]}
            activeOpacity={0.7}
            onPress={() => handleOpenGroup(item)}
            onLongPress={drag}
            delayLongPress={250}
          >
            {/* Drag handle — explicit visual affordance so users
                discover the long-press → drag interaction. The whole
                row is also long-press-draggable for ergonomics, but
                the grip icon teaches the gesture. */}
            <TouchableOpacity
              onLongPress={drag}
              delayLongPress={150}
              hitSlop={8}
              style={styles.groupGrip}
            >
              <GripVertical size={18} color={colors.gray400} />
            </TouchableOpacity>

            {/* QR-icon avatar removed — every row in this list is
                a QR-coded Vibe, so the icon was the same on every
                row and carried no information. Dropping it lets
                the name + tag preview own the row's visual weight. */}

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
                <Users size={12} color={colors.gray500} />
                <Text style={styles.groupCount}>
                  {t('qrGroup.memberCount', {
                    count: item.member_count,
                    defaultValue: `${item.member_count} 位好友`,
                  })}
                </Text>
              </View>
            </View>

            {/* Inline delete button. Positioned to the right of the
                content so a single tap (no swipe) covers the delete
                action — simpler than a Swipeable for non-power users
                and avoids iOS's brittle gesture conflict with the
                draggable parent. */}
            <TouchableOpacity
              onPress={() => handleDelete(item)}
              hitSlop={8}
              style={styles.groupDeleteBtn}
              accessibilityLabel={t('common.delete', { defaultValue: '刪除' })}
              accessibilityRole="button"
            >
              <Trash2 size={18} color={colors.gray400} />
            </TouchableOpacity>

            <ChevronRight size={16} color={colors.gray300} />
          </TouchableOpacity>
        </ScaleDecorator>
      );
    },
    // `styles` + `colors` MUST be deps — renderItem builds JSX with
    // them, and they change on theme switch. Omitting them froze the
    // rows on whatever theme rendered first (dark rows on a light
    // page after the launch theme settled).
    [handleOpenGroup, handleDelete, t, styles, colors],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <QrCode size={36} color={colors.piktag500} />
        </View>
        <Text style={styles.emptyTitle}>
          {t('qrGroup.emptyTitle', { defaultValue: '讓標籤，替你記住新朋友' })}
        </Text>
        <Text style={styles.emptyDesc}>
          {t('qrGroup.emptyDesc', {
            defaultValue:
              '掃描互加後，系統會自動備註這次相遇，再也不怕忘記在哪見過面。',
          })}
        </Text>
        <TouchableOpacity
          style={styles.emptyCta}
          activeOpacity={0.85}
          onPress={handleCreateNew}
        >
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.emptyCtaText}>
            {t('qrGroup.createFirst', { defaultValue: '建立當下的 Tag' })}
          </Text>
        </TouchableOpacity>
        {/* Secondary "scan someone else's QR" link removed from the
            empty state for a cleaner screen — the scan action still
            lives in the header (ScanLine icon, top-right), so no
            navigation path is lost, just visual noise. */}
      </View>
    ),
    [t, handleCreateNew],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>
              {t('qrGroup.headerTitle', { defaultValue: '認識新朋友' })}
            </Text>
            {/* Title is the PURPOSE ("認識新朋友"), not jargon.
                The ARTIFACT noun was renamed "Vibe" → "Tag" (English
                brand term in EVERY locale — ties to the app name
                PikTag and the core "tagging" mechanic; localising it
                to 標籤/タグ collides with the #tag chips each row
                shows). Applied across every surface (list rows,
                delete dialog, QrGroupDetail).

                The subtitle is the unified brand line "PikTag to
                connect." — hard-coded English in EVERY locale,
                deliberately NOT wrapped in t() (the old
                qrGroup.headerSubtitle i18n key was removed). Same
                doctrine as SplashOverlay: the brand name is used as
                a VERB so it occupies mindshare ("Google it" /
                "DM me"); localising it would dilute the global
                identity. Same line as the splash screen and the
                website hero subtitle — one signature across every
                surface. Translators: please don't re-add an i18n
                key here. */}
            <Text style={styles.headerSubtitle}>
              PikTag to connect.
            </Text>
          </View>
          <View style={styles.headerActions}>
            {/* Scan someone else's QR. Sibling action to "+ create my QR" —
                both are equally important entry points, so they live
                side-by-side at the tab's landing page. */}
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={handleOpenScanner}
              accessibilityRole="button"
              accessibilityLabel={t('qrGroup.scan', { defaultValue: '掃描 QR 碼加好友' })}

            >
              <ScanLine size={24} color={colors.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={handleCreateNew}
              accessibilityRole="button"
              accessibilityLabel={t('qrGroup.create', { defaultValue: '建立新 Tag' })}
            >
              <Plus size={24} color={colors.gray600} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Cross-Vibe search bar (P2) was removed after user
            feedback — too busy for the tab's first impression.
            The find_connections_by_tag RPC stays deployed; it'll
            get a home elsewhere (likely the existing Search tab)
            once we have a clearer pattern for "intent-driven
            people search". For now this tab is purely about
            listing + opening Vibes. */}
        {loading && groups.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.piktag500} />
          </View>
        ) : groups.length === 0 ? (
          listEmpty
        ) : (
          <DraggableFlatList
            data={groups}
            keyExtractor={(g) => g.id}
            renderItem={renderItem}
            onDragEnd={handleDragEnd}
            contentContainerStyle={styles.listContent}
            activationDistance={Platform.OS === 'ios' ? 10 : 5}
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  // Left-side title block — "Vibes" big, Chinese explainer
  // underneath in a smaller gray weight. The two-line stack lets
  // English-unaware users learn the term WITHOUT making "Vibes"
  // itself any less prominent.
  headerTitleWrap: {
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: c.gray900,
  },
  headerSubtitle: {
    fontSize: 12,
    color: c.gray500,
    marginTop: 2,
  },
  // Right-side cluster — scan + create live side-by-side as peer
  // entry points. Naked icons (no circular pill background) to
  // match the convention used by Connections / Search / other
  // tab headers — the pill was visually loud and inconsistent
  // with the rest of the app.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIconBtn: {
    padding: 4,
  },
  listContent: { paddingBottom: 100 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
    backgroundColor: c.white,
  },
  // Visual feedback while the user is mid-drag — slight shadow +
  // background so the dragged row sits above its neighbours.
  groupRowActive: {
    backgroundColor: c.piktag50,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  groupGrip: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  groupBody: { flex: 1, gap: 3 },
  groupName: { fontSize: 16, fontWeight: '700', color: c.gray900 },
  groupMetaRow: { flexDirection: 'row' },
  groupTags: { fontSize: 13, color: c.piktag600, fontWeight: '500' },
  groupTagsEmpty: { fontSize: 13, color: c.gray400, fontStyle: 'italic' },
  groupCountRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  groupCount: { fontSize: 12, color: c.gray500 },
  groupDeleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: c.gray900 },
  emptyDesc: { fontSize: 13, color: c.gray500, textAlign: 'center', lineHeight: 19 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: c.piktag500,
    marginTop: 12,
  },
  emptyCtaText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  // (emptyScanBtn / emptyScanText removed with the secondary
  //  scan link — scan now lives only in the header.)
  });
}
