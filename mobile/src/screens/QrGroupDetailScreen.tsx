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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ArrowLeft, Share2, Plus, X, Hash, Edit3, ScanLine, Copy, Pencil } from 'lucide-react-native';
import BoltIcon from '../components/BoltIcon';
import TagChip from '../components/TagChip';
import SectionTitle from '../components/SectionTitle';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
// react-native-qrcode-svg is the same lib AddTagScreen uses. Import
// inline so the bundle only pulls it on this screen too.
import QRCode from 'react-native-qrcode-svg';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import {
  dropPersistentQrGroupDetail,
  getPersistentQrGroupDetail,
  setPersistentQrGroupDetail,
} from '../lib/dataCache';
import { useAuth } from '../hooks/useAuth';
import RingedAvatar from '../components/RingedAvatar';
import QrShareBody from '../components/QrShareBody';
import { appendLang } from '../lib/shareProfile';
import { hashDisplay } from '../lib/normalizeTag';

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

// Everything this screen needs to paint with no signal: the QR payload
// itself, the group's event tags, the name in the header/card, the
// host's @handle printed on the present card, plus the member list and
// the Vibe-shift chips so the edit view isn't hollow offline.
//
// Bounds are per group; the number of GROUPS kept is bounded in
// dataCache (QR_GROUP_DETAIL_CACHE_MAX_GROUPS).
type GroupDetailSnapshot = {
  group: Group;
  qrUsername: string;
  members: Member[];
  currentTags: CurrentVibeTag[];
};

// 50 members ≈ a room's worth of scans; past that nobody is scrolling a
// cached list at a venue. 12 chips is what the Vibe-shift row can show
// before it stops being scannable at a glance.
const GROUP_DETAIL_CACHE_MAX_MEMBERS = 50;
const GROUP_DETAIL_CACHE_MAX_CURRENT_TAGS = 12;

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
  // The server answered and said this group isn't ours / doesn't exist.
  // Kept apart from "we couldn't reach the server" so the placeholder
  // doesn't tell someone to check a connection that is working fine.
  const [notFound, setNotFound] = useState(false);
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

  // The stored qr_code_data is annotated with the sharer's UI language
  // at READ time only — we never mutate the persisted DB row (a group
  // can be shared by users in different languages over its lifetime, and
  // an older row may carry no lang at all). appendLang is idempotent, so
  // a row already created lang-tagged (via AddTagScreen) won't double up.
  const qrShareUrl = useMemo(
    () => (group?.qr_code_data ? appendLang(group.qr_code_data) : ''),
    [group?.qr_code_data],
  );

  // Flipped the first time the network ANSWERS about this row —
  // including when the answer is "it's gone". The disk hydration below
  // refuses to paint after that, so a slow AsyncStorage read can never
  // resurrect a snapshot over fresher server data, and in particular
  // can never redraw a group the server just told us was deleted.
  const liveFetchDoneRef = useRef(false);

  // ── Identity invariant: what is on screen belongs to params.groupId ─
  //
  // React Navigation REUSES this mounted instance when something
  // navigates to QrGroupDetail with a different groupId (a notification
  // tap does exactly that — notificationRouter calls navigate(
  // 'QrGroupDetail', { groupId })), swapping the param without
  // remounting and without a `getId` to force a new screen. Every piece
  // of per-group state therefore has to be dropped by hand: leaving it
  // meant a host presenting the PREVIOUS event's QR, name and tags with
  // nothing on screen hinting that anything was wrong — a far worse
  // failure than a blank screen, and offline it was never corrected
  // because the fetch returns early with no signal.
  //
  // Done DURING RENDER rather than in an effect: an effect fires after
  // the commit, so the first frame after a param swap would still paint
  // the old group. Adjusting state while rendering makes React re-run
  // this component before anything reaches the screen. (React's
  // documented "adjusting state when a prop changes" pattern; the block
  // is idempotent, so a double render is harmless.)
  const [renderedGroupId, setRenderedGroupId] = useState<string | undefined>(groupId);
  // Mirrors the CURRENT param for async continuations. Every fetch and
  // every disk read stamps the id it was issued for and compares
  // against this before touching state, so an in-flight response for
  // the previous group cannot land on top of the new one.
  const groupIdRef = useRef(groupId);
  if (renderedGroupId !== groupId) {
    setRenderedGroupId(groupId);
    groupIdRef.current = groupId;
    liveFetchDoneRef.current = false;
    setGroup(null);
    setMembers([]);
    setCurrentTags([]);
    setSelectedFilterTag(null);
    setQrUsername('');
    setNameInput('');
    setTagInput('');
    setEditingName(false);
    setNotFound(false);
    setMode('present');
    setLoading(true);
  }

  const fetchGroup = useCallback(async () => {
    if (!user || !groupId) return;
    // Stamp the request with the group it was issued for. Every await
    // below is a chance for the route param to change under us, so
    // anything that comes back for a group that is no longer on screen
    // is dropped. Disk writes are keyed by reqGroupId and stay correct
    // whatever is being displayed, so those are deliberately NOT gated.
    const reqGroupId = groupId;
    const onScreen = () => groupIdRef.current === reqGroupId;
    // Stamped like every other setState in here. writeTags and
    // handleSaveName re-call fetchGroup from closures captured under a
    // PREVIOUS groupId, so an unstamped setLoading(true) could switch
    // group Y's spinner on while this request's own `finally` — which
    // IS gated on onScreen() — never switches it off, freezing the
    // placeholder on "processing" instead of letting it fall through to
    // load-failed.
    if (onScreen()) setLoading(true);
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
      if (gErr) {
        // We never got an answer (or got a refusal). supabase-js
        // RESOLVES with { data: null, error } when the request never
        // reached the server, so this is the OFFLINE path, not an
        // exception — treating it as "no such group" is what used to
        // strand a host on a spinner at a venue. Keep whatever is on
        // screen and leave the snapshot untouched: writing here is
        // exactly how a good offline copy gets poisoned.
        console.warn('[QrGroupDetail] group fetch failed:', gErr);
        // "We couldn't ask" retracts an earlier "it's gone": notFound
        // exists only to suppress the check-your-connection line when
        // the server DID answer, and right now it demonstrably didn't.
        // Leaving it set produced the contradictory placeholder that
        // said 載入失敗 while hiding the one line that explains why.
        if (onScreen()) setNotFound(false);
        return;
      }
      if (!g) {
        // The server answered, and the answer is "not yours / gone".
        // THAT is authoritative — drop the row and its snapshot so a
        // deleted group can't keep presenting a dead QR offline. The
        // disk drop is keyed by reqGroupId, so it runs even if the user
        // has already moved to another group.
        void dropPersistentQrGroupDetail(user.id, reqGroupId);
        if (!onScreen()) return;
        // The network HAS answered — "gone" is an answer. Setting the
        // flag only on the success path let a disk read that resolved
        // later sail past the hydration guard and redraw the deleted
        // group over this placeholder.
        liveFetchDoneRef.current = true;
        setGroup(null);
        setNotFound(true);
        return;
      }
      const freshGroup = g as Group;
      // RENDERED state, therefore gated — but ONLY the rendered state.
      // This used to be a bare `return`, which also skipped the snapshot
      // write at the bottom of the try: a host who opened a group and
      // navigated away before the fetch landed never got that group's
      // offline copy refreshed, and the "disk writes are deliberately
      // NOT gated" claim in the header comment was false. The write is
      // keyed by reqGroupId, so it is correct no matter what is on
      // screen; only the setStates care about that.
      // liveFetchDoneRef is gated WITH them on purpose, not with the
      // disk write: it suppresses the disk hydration effect, so letting
      // a response for the previous group set it would starve the group
      // now on screen of its cached first paint.
      if (onScreen()) {
        liveFetchDoneRef.current = true;
        setNotFound(false);
        setGroup(freshGroup);
        setNameInput(freshGroup.name ?? '');
      }

      // Host's @username for the present-mode card (same derivation
      // as AddTagScreen: profile username, fallback to the id).
      let freshUsername: string | null = null;
      try {
        const { data: prof, error: profErr } = await supabase
          .from('piktag_profiles')
          .select('username')
          .eq('id', user.id)
          .maybeSingle();
        if (!profErr && (prof as any)?.username) {
          freshUsername = String((prof as any).username);
        }
      } catch {
        // fall through to the value already on screen
      }
      // On failure keep the handle we already have (hydrated from disk
      // a moment ago) instead of stamping a raw uuid onto the card.
      if (onScreen()) setQrUsername((prev) => freshUsername ?? (prev || user.id));

      let freshMembers: Member[] | null = null;
      const { data: m, error: mErr } = await supabase.rpc('qr_group_members', {
        p_group_id: reqGroupId,
      });
      if (!mErr && Array.isArray(m)) {
        freshMembers = m as Member[];
        // Members carry no group id of their own, so the stamp check is
        // the only thing standing between this list and the previous
        // group's attendees being shown under the new group's name.
        if (onScreen()) setMembers(freshMembers);
      }

      // P0: fetch the "Vibe-to-Vibe" reactivation tags. Wrapped
      // in its own try so a missing RPC (migration not yet run
      // on this DB) just hides the section instead of breaking
      // the page. PGRST202 = "the requested function … was not
      // found"; treat it like 42703 — silent fall-through.
      let freshCurrentTags: CurrentVibeTag[] | null = null;
      try {
        const { data: tags, error: tagsErr } = await supabase.rpc(
          'vibe_member_current_tags',
          { p_group_id: reqGroupId },
        );
        if (!tagsErr && Array.isArray(tags)) {
          freshCurrentTags = tags as CurrentVibeTag[];
          if (onScreen()) setCurrentTags(freshCurrentTags);
        } else if (tagsErr) {
          const isMissing =
            (tagsErr as any).code === 'PGRST202' ||
            /could not find the function|does not exist/i.test(tagsErr.message);
          if (isMissing) {
            // Deployment fact, not a network hiccup — an empty section
            // here is the truth, so record it.
            freshCurrentTags = [];
            if (onScreen()) setCurrentTags([]);
          } else {
            // Could be transport. Keep what we have rather than blanking
            // the section (and the snapshot) on a bad connection.
            console.warn('[QrGroupDetail] currentTags fetch failed:', tagsErr);
          }
        }
      } catch (err) {
        console.warn('[QrGroupDetail] currentTags threw:', err);
      }

      // Persist. Anything that failed above keeps its LAST GOOD value
      // from the existing snapshot instead of being written as empty —
      // a partially-failed refetch must not degrade what's on disk.
      const prevSnapshot = await getPersistentQrGroupDetail<GroupDetailSnapshot>(
        user.id,
        reqGroupId,
      );
      void setPersistentQrGroupDetail<GroupDetailSnapshot>(user.id, reqGroupId, {
        group: freshGroup,
        qrUsername: freshUsername ?? prevSnapshot?.qrUsername ?? user.id,
        members: (freshMembers ?? prevSnapshot?.members ?? []).slice(
          0,
          GROUP_DETAIL_CACHE_MAX_MEMBERS,
        ),
        currentTags: (freshCurrentTags ?? prevSnapshot?.currentTags ?? []).slice(
          0,
          GROUP_DETAIL_CACHE_MAX_CURRENT_TAGS,
        ),
      });
    } finally {
      // A response for a group the user has already navigated away from
      // must not clear the spinner belonging to the group now on
      // screen: that would drop the placeholder straight to "load
      // failed" while the real fetch is still in flight.
      if (onScreen()) setLoading(false);
    }
  }, [groupId, user]);

  // Stale-while-revalidate, disk layer. Paint the last known state of
  // this group immediately so a host with no signal can still SHOW the
  // QR; fetchGroup then overwrites it when (if) the network answers.
  useEffect(() => {
    // Account switch resets the flag too (a groupId switch is already
    // handled by the identity block above, which runs during render).
    liveFetchDoneRef.current = false;
    const uid = user?.id;
    if (!uid || !groupId) return;
    let cancelled = false;
    void (async () => {
      const cached = await getPersistentQrGroupDetail<GroupDetailSnapshot>(uid, groupId);
      if (cancelled || liveFetchDoneRef.current) return;
      // Third guard on the same invariant: the map is keyed by group id
      // AND the row carries its own id AND the param may have moved on
      // while this disk read was resolving. All three must agree before
      // a single pixel of this snapshot reaches the screen.
      if (!cached?.group?.id) return;
      if (cached.group.id !== groupId || groupIdRef.current !== groupId) return;
      // Never clobber anything that already landed from the network.
      setGroup((prev) => prev ?? cached.group);
      setNameInput((prev) => prev || (cached.group.name ?? ''));
      setQrUsername((prev) => prev || cached.qrUsername || '');
      setMembers((prev) => (prev.length > 0 ? prev : cached.members ?? []));
      setCurrentTags((prev) => (prev.length > 0 ? prev : cached.currentTags ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, groupId]);

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
    if (!qrShareUrl) return;
    try {
      // Wrap the raw qr_code_data URL in the same LINE-style
      // shareMessage as AddTagScreen so the recipient sees a
      // friendly invite line + tappable URL rather than a bare
      // URL with no context.
      await Share.share({
        message: t('addTag.shareMessage', { url: qrShareUrl }),
      });
    } catch {
      /* user cancelled */
    }
  }, [qrShareUrl, t]);

  const handleCopyLink = useCallback(async () => {
    if (!qrShareUrl) return;
    try {
      await setClipboardStringAsync(qrShareUrl);
      Alert.alert(
        t('addTag.alertLinkCopiedTitle', { defaultValue: '已複製' }),
        t('addTag.alertLinkCopiedMessage', { defaultValue: '連結已複製到剪貼簿' }),
      );
    } catch {
      /* no-op */
    }
  }, [qrShareUrl, t]);

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

        {/* Shared body: card (uses QrNameCard) + bottom pill row.
            Single source of truth so the activity-QR + personal-QR
            sheets can't drift apart visually. (task #38 follow-up
            2026-05-31.) */}
        <QrShareBody
          qrValue={qrShareUrl}
          handle={qrUsername}
          name={presentName}
          tags={group.event_tags}
          actions={[
            {
              // Order unified 2026-06-03: 複製連結 LEFT, 分享檔案
              // next, 編輯 last — same copy-before-share order as the
              // personal QR sheet (QrCodeModal). Copy icon = universal
              // clipboard glyph, matches QrCodeModal.
              icon: <Copy size={22} color={'#111827'} />,
              label: t('addTag.copyLink', { defaultValue: '複製連結' }),
              onPress: handleCopyLink,
            },
            {
              icon: <Share2 size={22} color={'#111827'} />,
              label: t('addTag.shareFile', { defaultValue: '分享檔案' }),
              onPress: handleShare,
            },
            {
              icon: <Pencil size={22} color={'#111827'} />,
              label: t('addTag.editQr', { defaultValue: '編輯 QR' }),
              onPress: () => setMode('edit'),
            },
          ]}
          bottomInset={insets.bottom}
        />
      </LinearGradient>
    );
  };

  // Gate on "is there anything to show FOR THIS groupId", NOT on
  // `loading`. A refetch fires on every focus, and gating on loading
  // meant a cached (or already-loaded) group blinked back to this
  // placeholder every time the screen regained focus — and offline it
  // would hide a perfectly good cached QR behind a spinner forever. The
  // genuinely-uncached case is unchanged: no row, no snapshot, still
  // this screen.
  //
  // The id comparison is the invariant stated directly against the row
  // itself rather than inferred from bookkeeping: group.id is the id
  // the DB returned, so a group belonging to a previous route param
  // cannot be rendered even if some future edit forgets a reset.
  const mismatchedGroup = !!group && group.id !== groupId;
  if (!group || mismatchedGroup) {
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
          {loading || mismatchedGroup ? (
            // A row left over from the previous route param is treated as
            // "still loading the real one" — never as content, and never
            // as a failure we'd word wrongly.
            <Text style={styles.loadingText}>
              {t('common.processing', { defaultValue: '處理中…' })}
            </Text>
          ) : (
            // Nothing fetched AND nothing cached. Previously this showed
            // "處理中…" forever, which reads as a hang. Both keys below
            // already ship in all 19 locales — no new i18n. The connection
            // line is suppressed when the server DID answer (notFound):
            // telling someone to check a working network is worse than
            // saying nothing.
            <>
              <Text style={styles.loadingText}>
                {t('common.loadFailed', { defaultValue: '載入失敗' })}
              </Text>
              {notFound ? null : (
                <Text style={styles.loadingText}>
                  {t('common.checkConnection', { defaultValue: '請檢查網路連線後重試' })}
                </Text>
              )}
            </>
          )}
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
              <QRCode value={qrShareUrl} size={220} color={'#000000'} backgroundColor="#FFFFFF" />
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
          <SectionTitle variant="detail" style={{ marginBottom: 10, paddingHorizontal: 0 }}>
            {t('qrGroup.tagsTitle', { defaultValue: 'Tag 標籤' })}
          </SectionTitle>
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
              <BoltIcon size={16} color={colors.piktag500} strokeWidth={2.2} />
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
                      {hashDisplay(ct.tag_name)}
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
                  <SectionTitle variant="detail" style={{ marginBottom: 10, paddingHorizontal: 0 }}>
                    {t('qrGroup.membersTitle', {
                      count: filteredMembers.length,
                      defaultValue: `成員（${filteredMembers.length}）`,
                    })}
                  </SectionTitle>
                  {filterEntry != null ? (
                    <TouchableOpacity
                      onPress={() => setSelectedFilterTag(null)}
                      style={styles.memberFilterClearBtn}
                      hitSlop={6}
                    >
                      <Text style={styles.memberFilterClearText}>
                        {hashDisplay(filterEntry.tag_name)}
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
  // (presentCardWrap / presentBottomRow / presentBottomBtn /
  // presentBottomBtnText all moved into the shared QrShareBody
  // component — single source of truth for the QR-share inner
  // layout, including the card centring + the pill row.
  // 2026-05-31 task #38 follow-up.)

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
  // (sectionTitle moved into shared SectionTitle. Drift fixed in the
  // migration: was gray600 + letterSpacing:0.3, now gray500 +
  // letterSpacing:0.8 from variant="detail" defaults. task #38.)
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
  // list, visually distinct (Bolt icon + light purple chip
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
    borderRadius: 9999,
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
