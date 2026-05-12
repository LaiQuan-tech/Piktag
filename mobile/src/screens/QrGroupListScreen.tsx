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

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  FlatList,
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
  Search,
  X as XIcon,
} from 'lucide-react-native';
import RingedAvatar from '../components/RingedAvatar';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
  sort_position: number | null;
  member_count: number;
};

// P2 — one row per matched friend across all your Vibes.
// Returned by the find_connections_by_tag RPC. vibe_id / vibe_name
// can be null if the connection's scan_session_id no longer
// resolves (legacy connections, deleted Vibes, etc.).
type TagMatch = {
  connection_id: string;
  connected_user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  met_at: string;
  vibe_id: string | null;
  vibe_name: string | null;
  matched_tag: string;
  match_score: number;
};

type Props = { navigation: any };

export default function QrGroupListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const [groups, setGroups] = useState<QrGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // ─── P2: Cross-Vibe matching state ───────────────────────
  // When `searchInput` is non-empty, the screen flips from
  // showing Vibes (rows) to showing tag-matched friends across
  // all Vibes. Empty input → back to Vibes view, no extra clicks.
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<TagMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ─── P2: Debounced cross-Vibe search ─────────────────────
  // 300ms debounce. Empties results when input is cleared so the
  // UI flips back to Vibes view cleanly. Errors silently fall to
  // an empty result list — better than crashing the tab over a
  // missing RPC (migration not yet applied).
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    const query = searchInput.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc(
          'find_connections_by_tag',
          { p_tag_query: query },
        );
        if (error) {
          // PGRST202 = function not found (migration pending);
          // silent fall-through so the user sees "no matches" not
          // an angry red banner.
          const isMissing =
            (error as any).code === 'PGRST202' ||
            /could not find the function|does not exist/i.test(error.message);
          if (!isMissing) {
            console.warn('[VibeFind] search failed:', error);
          }
          setSearchResults([]);
        } else if (Array.isArray(data)) {
          setSearchResults(data as TagMatch[]);
        }
      } catch (err) {
        console.warn('[VibeFind] search threw:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  const handleOpenMatch = useCallback(
    (m: TagMatch) => {
      navigation.navigate('FriendDetail', {
        connectionId: m.connection_id,
        friendId: m.connected_user_id,
      });
    },
    [navigation],
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
        t('qrGroup.untitled', { defaultValue: '未命名 Vibe' });
      Alert.alert(
        t('qrGroup.deleteTitle', { defaultValue: '刪除這個 Vibe？' }),
        t('qrGroup.deleteMessage', {
          name: displayName,
          defaultValue: `「${displayName}」會從你的 Vibes 中移除。已經透過這個 QR 加你為好友的人不會受影響。`,
        }),
        [
          { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
          {
            text: t('common.delete', { defaultValue: '刪除' }),
            style: 'destructive',
            onPress: async () => {
              // Optimistic remove so the row disappears immediately.
              setGroups((prev) => prev.filter((x) => x.id !== g.id));
              const { error } = await supabase
                .from('piktag_scan_sessions')
                .delete()
                .eq('id', g.id);
              if (error) {
                console.warn('[QrGroupList] delete failed:', error);
                // Revert on failure
                await loadGroups();
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
          defaultValue: `Vibe · ${new Date(item.created_at).toLocaleDateString()}`,
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
              <GripVertical size={18} color={COLORS.gray400} />
            </TouchableOpacity>

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
              <Trash2 size={18} color={COLORS.gray400} />
            </TouchableOpacity>

            <ChevronRight size={16} color={COLORS.gray300} />
          </TouchableOpacity>
        </ScaleDecorator>
      );
    },
    [handleOpenGroup, handleDelete, t],
  );

  // ─── P2: Search-result row ───────────────────────────────
  const renderMatch = useCallback(
    ({ item }: { item: TagMatch }) => {
      const displayName = item.full_name || item.username || '?';
      // Subtitle = the Vibe context. Fall back to "認識的好友" if
      // the Vibe row has been deleted or the legacy connection
      // never had one.
      const vibeContext = item.vibe_name
        ? t('qrGroup.matchMetAt', {
            vibe: item.vibe_name,
            defaultValue: `在「${item.vibe_name}」認識`,
          })
        : t('qrGroup.matchMetGeneric', { defaultValue: '你的好友' });
      return (
        <TouchableOpacity
          style={styles.matchRow}
          activeOpacity={0.7}
          onPress={() => handleOpenMatch(item)}
        >
          <RingedAvatar
            size={44}
            ringStyle="subtle"
            name={displayName}
            avatarUrl={item.avatar_url}
          />
          <View style={styles.matchBody}>
            <Text style={styles.matchName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.matchSubtitle} numberOfLines={1}>
              #{item.matched_tag} · {vibeContext}
            </Text>
          </View>
          <ChevronRight size={16} color={COLORS.gray300} />
        </TouchableOpacity>
      );
    },
    [t, handleOpenMatch],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <QrCode size={36} color={COLORS.piktag500} />
        </View>
        <Text style={styles.emptyTitle}>
          {t('qrGroup.emptyTitle', { defaultValue: '還沒有 Vibe' })}
        </Text>
        <Text style={styles.emptyDesc}>
          {t('qrGroup.emptyDesc', {
            defaultValue: '每個 Vibe 就是一個活動瞬間 — 朋友掃 QR 一起加進來，之後隨時回頭看是誰、加標籤、再揪一次。',
          })}
        </Text>
        <TouchableOpacity
          style={styles.emptyCta}
          activeOpacity={0.85}
          onPress={handleCreateNew}
        >
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.emptyCtaText}>
            {t('qrGroup.createFirst', { defaultValue: '建立第一個 Vibe' })}
          </Text>
        </TouchableOpacity>

        {/* Secondary path: scan someone else's QR. First-time users
            arriving at this empty state might equally want to add a
            friend via someone else's QR — surface that path here so
            it's a peer choice, not a hidden afterthought. */}
        <TouchableOpacity
          style={styles.emptyScanBtn}
          activeOpacity={0.7}
          onPress={handleOpenScanner}
        >
          <ScanLine size={16} color={COLORS.piktag600} />
          <Text style={styles.emptyScanText}>
            {t('qrGroup.emptyScanCta', { defaultValue: '或掃描朋友的 QR 加好友' })}
          </Text>
        </TouchableOpacity>
      </View>
    ),
    [t, handleCreateNew, handleOpenScanner],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>
              {t('qrGroup.headerTitle', { defaultValue: 'Vibes' })}
            </Text>
            {/* Chinese subtitle explains what "Vibe" means without
                requiring the user to know the English word. Plain
                three-clause sentence: who / where / what — each
                dimension a Vibe captures. */}
            <Text style={styles.headerSubtitle}>
              {t('qrGroup.headerSubtitle', { defaultValue: '你跟誰在哪裡，做了什麼' })}
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
              accessibilityLabel={t('qrGroup.scan', { defaultValue: '掃描 QR 加好友' })}

            >
              <ScanLine size={22} color={COLORS.piktag600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.7}
              onPress={handleCreateNew}
              accessibilityRole="button"
              accessibilityLabel={t('qrGroup.create', { defaultValue: '建立新 Vibe' })}
            >
              <Plus size={22} color={COLORS.piktag600} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── P2: Cross-Vibe search bar ──────────────────────
            Always visible above the content. When empty, body
            renders the Vibes list as usual. When the user starts
            typing, the body flips to "friends in your network
            tagged #X". Clear button (X) appears once there's
            any input. Backed by find_connections_by_tag RPC
            with 300ms debounce — keeps RPC calls reasonable
            even on rapid typing. */}
        <View style={styles.searchBarWrap}>
          <View style={styles.searchBar}>
            <Search size={16} color={COLORS.gray400} />
            <TextInput
              style={styles.searchInput}
              value={searchInput}
              onChangeText={setSearchInput}
              placeholder={t('qrGroup.searchPlaceholder', {
                defaultValue: '找有 #X 標籤的朋友…',
              })}
              placeholderTextColor={COLORS.gray400}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchInput.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchInput('')}
                hitSlop={8}
                accessibilityLabel={t('common.clear', { defaultValue: '清除' })}
              >
                <XIcon size={16} color={COLORS.gray400} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {searchInput.trim().length > 0 ? (
          // ─── P2: Search-result mode ───────────────────────
          searchLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={COLORS.piktag500} />
            </View>
          ) : searchResults.length === 0 ? (
            <View style={styles.searchEmptyWrap}>
              <Text style={styles.searchEmptyTitle}>
                {t('qrGroup.searchNoResultsTitle', {
                  defaultValue: '沒有匹配的朋友',
                })}
              </Text>
              <Text style={styles.searchEmptyDesc}>
                {t('qrGroup.searchNoResultsDesc', {
                  defaultValue: '你的 Vibes 裡還沒有人貼這個標籤。試試不同關鍵字？',
                })}
              </Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(m) => m.connection_id}
              renderItem={renderMatch}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            />
          )
        ) : loading && groups.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={COLORS.piktag500} />
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
    color: COLORS.gray900,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 2,
  },
  // Right-side cluster — scan + create live side-by-side as peer
  // entry points.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingBottom: 100 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // ─── P2: search bar + result rows ─────────────────────────
  // Bar lives in its own thin wrapper so the surrounding spacing
  // matches the header above and the list rows below. Pill shape
  // (rounded gray-50) reads as a search affordance without
  // borrowing too much visual weight from the brand purple.
  searchBarWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.white,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: COLORS.gray50,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900,
    padding: 0,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  matchBody: { flex: 1 },
  matchName: { fontSize: 15, fontWeight: '700', color: COLORS.gray900 },
  matchSubtitle: { fontSize: 12, color: COLORS.gray500, marginTop: 2 },
  searchEmptyWrap: {
    paddingTop: 80,
    paddingHorizontal: 40,
    alignItems: 'center',
    gap: 8,
  },
  searchEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  searchEmptyDesc: {
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 19,
  },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  // Visual feedback while the user is mid-drag — slight shadow +
  // background so the dragged row sits above its neighbours.
  groupRowActive: {
    backgroundColor: COLORS.piktag50,
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
  groupDeleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },

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
  // Secondary "or scan a friend's QR" link beneath the primary CTA.
  // Visually lighter than the filled purple button — text + thin
  // border, so it reads as an alternate option, not a competing
  // primary action.
  emptyScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  emptyScanText: { fontSize: 13, color: COLORS.piktag600, fontWeight: '600' },
});
