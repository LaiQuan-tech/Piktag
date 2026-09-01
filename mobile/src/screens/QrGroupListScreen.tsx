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

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
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
  ArrowLeft,
} from 'lucide-react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  CACHE_KEYS,
  dropPersistentQrGroupDetail,
  getPersistentCache,
  setPersistentCache,
} from '../lib/dataCache';
import { useAuth } from '../hooks/useAuth';
import { useLoadDeadline } from '../hooks/useLoadDeadline';
import { checkOffline } from '../lib/netStatus';
import { joinEventRoom } from '../lib/eventRoom';
import { bidiMark } from '../lib/normalizeTag';

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


// Rows kept on disk per section. A host with more than 50 event tags
// is not scrolling past 50 with no signal, and the list is already
// ordered by the user's own sort/recency, so the cap keeps exactly the
// rows they reach for.
const QR_GROUP_LIST_CACHE_MAX = 50;
const QR_ATTENDED_CACHE_MAX = 50;

type Props = { navigation: any };

export default function QrGroupListScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [groups, setGroups] = useState<QrGroup[]>([]);

  // 我參加的 (UX fix 2026-07-05, founder: "離開 app 後找不到掃過的人") —
  // the attendee-side mirror of the host list above: every ACTIVE session
  // the viewer scanned into (their own connection rows carry the
  // scan_session_id; RLS only exposes is_active sessions, so closed
  // events drop off automatically). Tapping a row IS the visibility
  // opt-in (same labeled-consent contract as the FriendDetail row) and
  // opens the room. This is the durable, global way back to 這場的人.
  type AttendedSession = {
    id: string;
    name: string | null;
    event_date: string | null;
    event_location: string | null;
    hostName: string | null;
  };
  const [attended, setAttended] = useState<AttendedSession[]>([]);
  const [loading, setLoading] = useState(true);
  // The last groups fetch did not get an answer. Only ever consulted
  // when there is nothing to show: with no cache and no signal this
  // screen used to fall through to "一場活動，一個 QR — build your
  // first one", which tells a host who has ten events that they have
  // none. Tracked off the GROUPS query alone (the primary one for this
  // surface); a groups answer of "zero rows" is a real empty state even
  // if the attended query failed alongside it.
  const [loadFailed, setLoadFailed] = useState(false);

  // Flipped the first time each section lands from the network, so a
  // slow disk read can never paint over fresher server data. One flag
  // per section because the two fetches fail independently.
  const liveGroupsDoneRef = useRef(false);
  const liveAttendedDoneRef = useRef(false);

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
    // The disk hydration below has already painted whatever this account
    // has; with no signal these queries would only add ~25s of
    // auth-refresh backoff (lib/netStatus.ts) before failing. Return
    // BEFORE setLoading(true) so an empty-cache launch lands on the
    // load-failed card in a second instead of a spinner. Nothing is
    // written here, so no snapshot can be degraded.
    if (await checkOffline()) {
      setLoadFailed(true);
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
        // supabase-js RESOLVES with { data: null, error } when the
        // request never left the phone, so this is the offline path.
        // Blanking the list here is what made this screen useless at a
        // venue — keep whatever is on screen (cached or older) and,
        // crucially, do NOT write the snapshot.
        console.warn('[QrGroupList] load failed:', error);
        setLoadFailed(true);
        return;
      }
      const rows = ((data ?? []) as Array<Partial<Omit<QrGroup, 'member_count'>>>).map(
        (r) => ({
          ...r,
          name: (r as any).name ?? null,
          sort_position: (r as any).sort_position ?? null,
        }) as Omit<QrGroup, 'member_count'>,
      );
      // Member counts are a separate RPC per row and can fail on their
      // own. A failed count must not be written as 0 over a good cached
      // count — fall back to the last known value for that group.
      const cachedGroups = await getPersistentCache<QrGroup[]>(CACHE_KEYS.QR_GROUPS, user.id);
      const cachedCountById = new Map(
        (cachedGroups ?? []).map((g) => [g.id, g.member_count] as const),
      );
      const counts = await Promise.all(
        rows.map(async (r) => {
          const { data: c, error: cErr } = await supabase.rpc('qr_group_member_count', {
            p_group_id: r.id,
          });
          if (!cErr && typeof c === 'number') return c;
          return cachedCountById.get(r.id as string) ?? 0;
        }),
      );
      const merged = rows.map((r, i) => ({ ...r, member_count: counts[i] }));
      liveGroupsDoneRef.current = true;
      setLoadFailed(false);
      setGroups(merged);
      void setPersistentCache(
        CACHE_KEYS.QR_GROUPS,
        user.id,
        merged.slice(0, QR_GROUP_LIST_CACHE_MAX),
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const loadAttended = useCallback(async () => {
    if (!user) {
      setAttended([]);
      return;
    }
    // Same reasoning as loadGroups. This section keeps whatever the
    // cache painted; it never writes on this path.
    if (await checkOffline()) return;
    try {
      // Every query below is error-checked, not just try/caught: on a
      // transport failure supabase-js RESOLVES with { data: null,
      // error }, so `data ?? []` used to turn "no signal" into "you
      // attended nothing" — wiping the section AND, now, its snapshot.
      const { data: conns, error: connsErr } = await supabase
        .from('piktag_connections')
        .select('scan_session_id')
        .eq('user_id', user.id)
        .not('scan_session_id', 'is', null);
      if (connsErr) return;
      const sids = [
        ...new Set(
          ((conns ?? []) as { scan_session_id: string | null }[])
            .map((c) => c.scan_session_id)
            .filter((s): s is string => !!s && !s.startsWith('local_')),
        ),
      ];
      if (sids.length === 0) {
        // Answered, and the answer is genuinely empty.
        liveAttendedDoneRef.current = true;
        setAttended([]);
        void setPersistentCache<AttendedSession[]>(CACHE_KEYS.QR_ATTENDED, user.id, []);
        return;
      }
      // neq(host) = only sessions OTHERS host — my own live in `groups`.
      const { data: sess, error: sessErr } = await supabase
        .from('piktag_scan_sessions')
        .select('id, name, event_date, event_location, host_user_id')
        .in('id', sids)
        .neq('host_user_id', user.id);
      if (sessErr) return;
      const rows = ((sess ?? []) as any[]);
      const hostIds = [...new Set(rows.map((r) => r.host_user_id).filter(Boolean))];
      const hostNames = new Map<string, string>();
      let hostsFailed = false;
      if (hostIds.length > 0) {
        const { data: hosts, error: hostsErr } = await supabase
          .from('piktag_profiles')
          .select('id, full_name, username')
          .in('id', hostIds);
        if (hostsErr) hostsFailed = true;
        for (const h of (hosts ?? []) as any[]) {
          hostNames.set(h.id, h.full_name || h.username || '');
        }
      }
      // Host names are a nice-to-have subtitle, but writing them back as
      // null because that ONE query failed would degrade a good
      // snapshot. Reuse the last known name instead.
      const cachedHostNameById = hostsFailed
        ? new Map(
            (
              (await getPersistentCache<AttendedSession[]>(
                CACHE_KEYS.QR_ATTENDED,
                user.id,
              )) ?? []
            ).map((s) => [s.id, s.hostName] as const),
          )
        : null;
      const mapped: AttendedSession[] = rows.map((r) => ({
        id: String(r.id),
        name: r.name ?? null,
        event_date: r.event_date ?? null,
        event_location: r.event_location ?? null,
        hostName:
          hostNames.get(r.host_user_id) ?? cachedHostNameById?.get(String(r.id)) ?? null,
      }));
      liveAttendedDoneRef.current = true;
      setAttended(mapped);
      void setPersistentCache<AttendedSession[]>(
        CACHE_KEYS.QR_ATTENDED,
        user.id,
        mapped.slice(0, QR_ATTENDED_CACHE_MAX),
      );
    } catch {
      /* section simply stays hidden */
    }
  }, [user?.id]);

  const openAttendedRoom = useCallback(
    async (sessionId: string) => {
      await joinEventRoom(navigation, sessionId);
    },
    [navigation],
  );

  // Stale-while-revalidate, disk layer. Runs once per account: paint
  // the last known lists immediately so the screen is not blank at a
  // venue with no signal, then let the fetches above overwrite them.
  useEffect(() => {
    // Reset per account so signing in as someone else re-hydrates from
    // THEIR snapshot instead of being suppressed by the previous user's
    // completed fetch.
    liveGroupsDoneRef.current = false;
    liveAttendedDoneRef.current = false;
    const uid = user?.id;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const [cachedGroups, cachedAttended] = await Promise.all([
        getPersistentCache<QrGroup[]>(CACHE_KEYS.QR_GROUPS, uid),
        getPersistentCache<AttendedSession[]>(CACHE_KEYS.QR_ATTENDED, uid),
      ]);
      if (cancelled) return;
      let painted = false;
      if (
        !liveGroupsDoneRef.current &&
        Array.isArray(cachedGroups) &&
        cachedGroups.length > 0
      ) {
        // Never clobber rows that already landed from the network.
        setGroups((prev) => (prev.length > 0 ? prev : cachedGroups));
        painted = true;
      }
      if (
        !liveAttendedDoneRef.current &&
        Array.isArray(cachedAttended) &&
        cachedAttended.length > 0
      ) {
        setAttended((prev) => (prev.length > 0 ? prev : cachedAttended));
        painted = true;
      }
      // Only stop the spinner if we actually put something on screen —
      // otherwise the empty state would flash while a live fetch is
      // still in flight.
      if (painted) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadGroups();
      void loadAttended();
    }, [loadGroups, loadAttended]),
  );

  // Online but going nowhere. Stop the spinner and let the render fall
  // through to the load-failed card. `loadFailed` is only ever CONSULTED
  // when both lists are empty (see the render), so setting it here
  // cannot hide a cached list; a successful load clears it again.
  useLoadDeadline(loading, () => {
    setLoading(false);
    setLoadFailed(true);
  });


  const handleCreateNew = useCallback(() => {
    navigation.navigate('AddTagCreate');
  }, [navigation]);

  // Quick create, straight from this list. Creating an event QR was two
  // levels down (a + in the header, then a setup screen) for what is a
  // North-Star add-friend moment — you are usually standing at the event
  // when you need it. Tags are the substance of an event QR, so they are
  // asked for here and the setup step is skipped; the QR view's back
  // button still opens setup, so date / location / presets are one tap
  // away rather than mandatory. The header + remains the full-setup path.
  const [quickTagInput, setQuickTagInput] = useState('');
  const handleQuickCreate = useCallback(() => {
    const initialTags = quickTagInput
      .split(/[,，\s]+/)
      .map((v) => v.trim().replace(/^#/, ''))
      .filter(Boolean);
    setQuickTagInput('');
    navigation.navigate('AddTagCreate', { initialTags, autoGenerate: true });
  }, [navigation, quickTagInput]);

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
              if (!error && !nothingDeleted) {
                // Really gone. Prune both snapshots so an offline cold
                // start can't resurrect the row or present its dead QR.
                const uid = user?.id;
                if (uid) {
                  void dropPersistentQrGroupDetail(uid, g.id);
                  void (async () => {
                    const cached = await getPersistentCache<QrGroup[]>(
                      CACHE_KEYS.QR_GROUPS,
                      uid,
                    );
                    if (!Array.isArray(cached)) return;
                    await setPersistentCache(
                      CACHE_KEYS.QR_GROUPS,
                      uid,
                      cached.filter((x) => x.id !== g.id),
                    );
                  })();
                }
              }
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
    [t, loadGroups, user?.id],
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
                    {bidiMark() + tagPreview.map((t) => `#${t}`).join('  ')}
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
          {t('qrGroup.emptyTitle', { defaultValue: '一場活動，一個 QR' })}
        </Text>
        <Text style={styles.emptyDesc}>
          {/* Repositioned 2026-07-03 (founder-approved event-tag rework):
              this surface speaks to the ORGANIZER — its unique value is
              "one QR for the whole room, everyone auto-tagged with the
              event, searchable months later". The old copy (2026-06-07
              name-blanking sting) described the PERSONAL mutual-scan QR,
              which lives on Profile — wrong feature on this screen. The
              attendee-side / no-foresight case is now covered by the
              burst batch-tag prompt (lib/burstTag.ts), not this page. */}
          {t('qrGroup.emptyDesc', {
            defaultValue:
              '辦聚會、跑活動？建一個活動標籤，現場的人掃同一個 QR，就自動互加好友、帶上這場活動的標籤。幾個月後搜這個標籤，那晚認識的人全部都在。',
          })}
        </Text>
        <TouchableOpacity
          style={styles.emptyCta}
          activeOpacity={0.85}
          onPress={handleCreateNew}
        >
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.emptyCtaText}>
            {t('qrGroup.createFirst', { defaultValue: '建立活動 QR' })}
          </Text>
        </TouchableOpacity>
        {/* Secondary "scan someone else's QR" link removed from the
            empty state for a cleaner screen — the scan action still
            lives in the header (ScanLine icon, top-right), so no
            navigation path is lost, just visual noise. */}
      </View>
    ),
    // styles/colors ARE deps: this JSX is memoized and both change on a
    // theme switch (repo rule — omitting them froze surfaces on
    // whichever theme rendered first).
    [t, handleCreateNew, styles, colors],
  );

  // Nothing cached AND the fetch never got an answer. Same distinction
  // the detail screen already draws, worded with the same two keys —
  // both already ship in all 19 locales, so no new i18n. Saying "you
  // have no Tags yet" here would be a lie about the user's own data.
  const listLoadFailed = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIconWrap}>
          <QrCode size={36} color={colors.piktag500} />
        </View>
        <Text style={styles.emptyTitle}>
          {t('common.loadFailed', { defaultValue: '載入失敗' })}
        </Text>
        <Text style={styles.emptyDesc}>
          {t('common.checkConnection', { defaultValue: '請檢查網路連線後重試' })}
        </Text>
      </View>
    ),
    [t, styles, colors],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {/* Back arrow — QrGroupList is now a full-screen RootStack push
                (event-QR demoted from the tab 2026-06-24), so it needs a way
                back to where it was opened from (the Home header QR icon).
                Gated on canGoBack so it stays clean if ever shown as a root. */}
            {navigation.canGoBack() && (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.headerBackBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('common.back', { defaultValue: '返回' })}
              >
                <ArrowLeft size={24} color={colors.gray900} />
              </TouchableOpacity>
            )}
          <View style={styles.headerTitleWrap}>
            {/* Title renamed 記住新朋友 → 活動標籤 (founder, 2026-07-03):
                the screen IS the event-tag list, name the artifact.
                The "Pick. Tag. Connect." brand-signature subtitle was
                REMOVED from this header on the same founder call —
                the signature still lives on SplashOverlay / landing /
                scan.html; this screen just doesn't carry it anymore.
                Don't re-add a subtitle here. */}
            <Text style={styles.headerTitle}>
              {t('qrGroup.headerTitle', { defaultValue: '活動標籤' })}
            </Text>
          </View>
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
        {/* Quick create — above the list on purpose, so the common
            path (type the tags, get the QR) needs no + and no setup
            screen. Sits outside the DraggableFlatList so it is present
            in the empty state too and never joins the drag surface. */}
        <View style={styles.quickCreate}>
          <TextInput
            style={styles.quickCreateInput}
            value={quickTagInput}
            onChangeText={setQuickTagInput}
            placeholder={t('qrGroup.quickCreatePlaceholder', {
              defaultValue: '這場活動的標籤，例：讀書會 設計',
            })}
            placeholderTextColor={colors.gray400}
            returnKeyType="go"
            onSubmitEditing={handleQuickCreate}
            maxLength={80}
          />
          <TouchableOpacity
            style={styles.quickCreateBtn}
            activeOpacity={0.85}
            onPress={handleQuickCreate}
            accessibilityRole="button"
          >
            <Text style={styles.quickCreateBtnText}>
              {t('qrGroup.quickCreateCta', { defaultValue: '建立' })}
            </Text>
          </TouchableOpacity>
        </View>

        {loading && groups.length === 0 && attended.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.piktag500} />
          </View>
        ) : groups.length === 0 && attended.length === 0 ? (
          loadFailed ? listLoadFailed : listEmpty
        ) : (
          <DraggableFlatList
            data={groups}
            keyExtractor={(g) => g.id}
            renderItem={renderItem}
            onDragEnd={handleDragEnd}
            contentContainerStyle={styles.listContent}
            activationDistance={Platform.OS === 'ios' ? 10 : 5}
            ListFooterComponent={
              attended.length > 0 ? (
                <View style={styles.attendedSection}>
                  <Text style={styles.attendedTitle}>
                    {t('eventRoom.myEventsSection', { defaultValue: '我參加的' })}
                  </Text>
                  <Text style={styles.attendedHint}>
                    {t('eventRoom.myEventsHint', {
                      defaultValue: '點開即加入名單 — 這場已同意的參加者能互相看到、直接加好友。',
                    })}
                  </Text>
                  {attended.map((s) => {
                    const sub = [s.hostName, s.event_date, s.event_location]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <TouchableOpacity
                        key={s.id}
                        style={styles.attendedRow}
                        activeOpacity={0.7}
                        onPress={() => { void openAttendedRoom(s.id); }}
                      >
                        <View style={styles.attendedIconWrap}>
                          <Users size={18} color={colors.piktag500} />
                        </View>
                        <View style={styles.attendedTextWrap}>
                          <Text style={styles.attendedName} numberOfLines={1}>
                            {s.name ||
                              t('qrGroup.untitledFallback', { defaultValue: '未命名活動' })}
                          </Text>
                          {sub ? (
                            <Text style={styles.attendedSub} numberOfLines={1}>
                              {sub}
                            </Text>
                          ) : null}
                        </View>
                        <ChevronRight size={18} color={colors.gray400} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null
            }
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  // 我參加的 attendee section (UX fix 2026-07-05) — the durable global
  // way back into 這場的人.
  attendedSection: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  attendedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.gray600,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  attendedHint: {
    fontSize: 12,
    color: c.gray400,
    lineHeight: 17,
    marginBottom: 10,
  },
  attendedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.gray200,
    backgroundColor: c.white,
    marginBottom: 8,
  },
  attendedIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  attendedName: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray900,
  },
  attendedSub: {
    fontSize: 12,
    color: c.gray400,
    marginTop: 1,
  },
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 8,
  },
  headerBackBtn: {
    padding: 4,
    marginLeft: -4,
  },
  headerTitleWrap: {
    flexShrink: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: c.gray900,
  },
  // (headerSubtitle style removed with the brand-line subtitle,
  // founder 2026-07-03.)
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
  quickCreate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  quickCreateInput: {
    flex: 1,
    backgroundColor: c.gray100,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: c.gray900,
  },
  quickCreateBtn: {
    backgroundColor: c.piktag500,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  quickCreateBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
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
