import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  CheckCircle2,
  MessageCircle,
  Hash,
} from 'lucide-react-native';
import BiolinkSocialSection from '../components/BiolinkSocialSection';
import CoachMark from '../components/CoachMark';
import { StatsRow, StatDot } from '../components/StatsLine';
import { useTranslation } from 'react-i18next';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import {
  getCache,
  setCache,
  CACHE_KEYS,
  setPersistentCache,
  getPersistentCache,
} from '../lib/dataCache';
import { openOrCopyBiolink } from '../lib/biolinks';
import QrCodeModal from '../components/QrCodeModal';
import RingedAvatar from '../components/RingedAvatar';
import { AskCreateModal } from '../components/ask/AskStoryRow';
import { useAskFeed } from '../hooks/useAskFeed';
import { ProfileScreenSkeleton } from '../components/SkeletonLoader';
import ErrorState from '../components/ErrorState';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import { useLoadDeadline } from '../hooks/useLoadDeadline';
import { checkOffline } from '../lib/netStatus';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PiktagProfile, UserTag, Biolink } from '../types';
import { hashDisplay } from '../lib/normalizeTag';

type ProfileScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

// Each stat is its own (small) tap target — generous hitSlop so the
// touch area stays comfortable even though the visible text is short.
const STAT_HITSLOP = { top: 8, bottom: 8, left: 4, right: 4 };

// (Removed: `SocialCircle` (IG-Highlights-style) and `LinkCard`
// (Linktree-style) memoized components — both were defined here but
// never rendered anywhere in this file, leftover from an earlier
// biolinks-UI prototype. Their style references (`socialCircleItem`,
// `socialCircleRing`, `socialCircleInner`, `socialCircleLabel`,
// `linkCard`, `linkCardText`) were never added to the StyleSheet
// either, so the components would have rendered un-styled if anyone
// had wired them up. Delete-and-restore-from-git is cheaper than
// keeping dead wiring around.)

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  // Read the (already hydrated) profile from AuthContext so we don't
  // re-fetch piktag_profiles on every mount. The local `profile`
  // state mirrors the cached one and is only updated by the
  // on-focus refresh below.
  const { profile: ctxProfile, refreshProfile } = useAuthProfile();
  const userId = user?.id;

  const [profile, setProfile] = useState<PiktagProfile | null>(ctxProfile);
  const [userTags, setUserTags] = useState<UserTag[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [friendCount, setFriendCount] = useState<number>(0);
  // (Tribe invite-lineage size removed 2026-06-25 — the invite-code system
  //  is retired, so it was a dead PikTag-vanity number. The "how my people
  //  connect" view now lives on the Friends-page friend count → NetworkGraph.)
  // (tag-graph health state removed 2026-05-29 — see the comment
  // where the pill used to render. RPC stays; client-side fetching
  // it was only for the pill, so we drop the network call too.)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  // Do the numbers on screen mean anything yet? Tags/friends/followers
  // all default to 0/[], and offline-with-only-an-auth-profile that
  // would render "0 標籤 · 0 朋友 · 0 追蹤者" — a confident lie about the
  // user's own account. Until a snapshot or a live answer sets this,
  // the stat row shows an em dash instead.
  const [statsKnown, setStatsKnown] = useState(false);
  // True once THIS screen's five queries have all answered. The disk
  // writer below refuses to run without it, so a partial or failed load
  // can never overwrite a good snapshot.
  const [dataFresh, setDataFresh] = useState(false);
  // Set ONLY where we have positive evidence the network was the
  // problem: the offline short-circuit, and the paint deadline. It gates
  // the error surface, so an account that genuinely has no profile row
  // still falls through to the normal (mostly empty) profile render
  // rather than being told to check its connection.
  const [unreachable, setUnreachable] = useState(false);

  // Ask creation entry — the avatar's "+" badge launches the same
  // AskCreateModal used by AskStoryRow on the Connections tab. Reuses
  // the existing useAskFeed hook so we share state with whichever
  // other tab last opened the modal (the modal's existingAsk prop
  // automatically flips to view/delete mode when there's an active
  // ask, matching AskStoryRow's behaviour).
  const { myAsk, refresh: refreshAskFeed } = useAskFeed();
  const [askModalVisible, setAskModalVisible] = useState(false);

  // --- Data fetching ---

  // Sync local state with the AuthContext profile.
  // `refreshProfile` is the canonical "go fetch the fresh row" call;
  // `fetchProfile` keeps its old name for back-compat with the
  // `fetchAllData` call site below.
  useEffect(() => {
    if (ctxProfile) setProfile(ctxProfile);
  }, [ctxProfile]);

  // Every loader below answers TRUE only when the SERVER answered.
  // supabase-js resolves `{data: null, error}` on a transport failure
  // rather than rejecting, so "didn't throw" proves nothing — and the
  // disk writer keys off these booleans.
  const fetchProfile = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    // Delegate to AuthContext — one place to coalesce concurrent
    // callers + update the cross-screen cache.
    return await refreshProfile();
  }, [userId, refreshProfile]);

  const fetchUserTags = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', userId)
      .order('position');
    if (error || !data) return false;
    // Pinned tags first, then by position
    const sorted = [...data].sort((a: UserTag, b: UserTag) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (a.position || 0) - (b.position || 0);
    });
    setUserTags(sorted as UserTag[]);
    return true;
  }, [userId]);

  const fetchBiolinks = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    if (error || !data) return false;
    setBiolinks(data as Biolink[]);
    return true;
  }, [userId]);

  const fetchFollowerCount = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { count, error } = await supabase
      .from('piktag_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId);
    if (error || count === null) return false;
    setFollowerCount(count);
    return true;
  }, [userId]);

  const fetchFriendCount = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const { count, error } = await supabase
      .from('piktag_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error || count === null) return false;
    setFriendCount(count);
    return true;
  }, [userId]);

  const fetchAllData = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    // Offline these five queries do not fail — they each sit through
    // auth-js's ~25s refresh backoff (see lib/netStatus.ts) and only
    // then resolve with an error. Skip them; the caches have already
    // painted and useNetInfoReconnect below retries when signal returns.
    if (await checkOffline()) return false;
    const results = await Promise.all([
      fetchProfile(),
      fetchUserTags(),
      fetchBiolinks(),
      fetchFollowerCount(),
      fetchFriendCount(),
    ]);
    const complete = results.every(Boolean);
    if (complete) {
      setStatsKnown(true);
      setDataFresh(true);
      setUnreachable(false);
    }
    return complete;
  }, [userId, fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount, fetchFriendCount]);

  // Persist the five state slices to the in-memory dataCache so that
  // re-entering ProfileScreen within the TTL window paints instantly
  // instead of waiting for 5 queries. The effect is gated on state
  // actually being present to avoid caching an intermediate blank.
  useEffect(() => {
    if (!userId) return;
    if (!profile) return; // profile is the anchor; no point caching without it
    // Never write while the first load is still in flight. On mount the
    // list slices are still empty, and racing that half-empty snapshot
    // onto disk would clobber a good offline snapshot before the loader
    // below has had a chance to read it back.
    if (loading) return;
    // ...and never write a snapshot the network did not fully back.
    //
    // `loading === false` is NOT proof of a good load, which is how the
    // offline profile got emptied out: AuthContext writes the narrow
    // `{ profile }` object under the SAME in-memory key this screen uses
    // for its 5-field snapshot, the loader below accepted it as a cache
    // hit and cleared `loading` with userTags/biolinks still [] and both
    // counts still 0 — and this effect then wrote exactly that onto
    // disk. Online the real fetch repaired it within a second. Offline
    // it stood, so the disk snapshot degraded to "name only" simply
    // because the user opened their Profile tab. `dataFresh` is set in
    // ONE place: fetchAllData, and only when all five queries answered.
    if (!dataFresh) return;
    const snapshot = {
      profile,
      userTags,
      biolinks,
      followerCount,
      friendCount,
    };
    setCache(CACHE_KEYS.PROFILE, snapshot);
    // Same snapshot to disk. The in-memory copy dies with the process, so
    // without this an offline COLD start at a venue paints an empty
    // profile — and hands QrCodeModal an empty username, i.e. a QR nobody
    // can scan. This is the single most important thing to have offline.
    void setPersistentCache(CACHE_KEYS.PROFILE, userId, snapshot);
  }, [userId, loading, dataFresh, profile, userTags, biolinks, followerCount, friendCount]);

  useEffect(() => {
    let isMounted = true;
    type ProfileSnapshot = {
      profile: PiktagProfile;
      userTags: UserTag[];
      biolinks: Biolink[];
      followerCount: number;
      friendCount: number;
    };
    // Is this actually the 5-field snapshot, or the narrow `{ profile }`
    // object AuthContext.fetchProfileFor puts under the same in-memory
    // key? Accepting the narrow one used to blank the tags, the links
    // and both counts — and then get that written to disk. The array
    // check is the discriminator: only this screen's writer ever sets
    // `userTags`.
    const isFullSnapshot = (snap: unknown): snap is ProfileSnapshot => {
      const s = snap as ProfileSnapshot | null;
      return !!s?.profile && Array.isArray(s.userTags) && Array.isArray(s.biolinks);
    };
    const applySnapshot = (snap: ProfileSnapshot) => {
      setProfile(snap.profile);
      // Defensive defaults: an older/partial snapshot must not put
      // `undefined` into a list that render calls `.length` on.
      setUserTags(snap.userTags ?? []);
      setBiolinks(snap.biolinks ?? []);
      setFollowerCount(snap.followerCount ?? 0);
      setFriendCount(snap.friendCount ?? 0);
      // The numbers came from a real (if stale) snapshot, so they may
      // be shown. NOT `dataFresh` — that one gates the disk WRITE and
      // may only be set by a completed live fetch.
      setStatsKnown(true);
      setLoading(false);
    };
    const load = async () => {
      // This effect re-runs only when `userId` changes, so a different
      // account starts from "we know nothing": otherwise A's completed
      // load would leave `dataFresh` true and the writer would persist
      // A's still-in-state tags under B's cache key.
      setDataFresh(false);
      setStatsKnown(false);
      // Stale-while-revalidate: if we have a cached snapshot, paint it
      // immediately and refetch in the background without a loading state.
      const cached = getCache<ProfileSnapshot>(CACHE_KEYS.PROFILE);

      let painted = false;
      if (isFullSnapshot(cached)) {
        applySnapshot(cached);
        painted = true;
      } else {
        // Cold start: fall back to the disk snapshot before showing a
        // skeleton. Works with no network at all.
        const persisted = await getPersistentCache<ProfileSnapshot>(
          CACHE_KEYS.PROFILE,
          userId,
        );
        if (!isMounted) return;
        if (isFullSnapshot(persisted)) {
          applySnapshot(persisted);
          painted = true;
        }
      }

      // NOTHING CACHED. What we do next depends on whether a fetch can
      // plausibly work — never on waiting to find out. Offline we stop
      // here so the render below can show the profile we DO have (the
      // AuthContext row, hydrated from AUTH_PROFILE on disk) or, failing
      // that, the honest offline surface. Previously this path left
      // `loading` true through ~25s of auth-refresh backoff, which is
      // the all-skeleton Profile tab in the founder's screenshot.
      if (!painted && (await checkOffline())) {
        if (!isMounted) return;
        setUnreachable(true);
        setLoading(false);
        return;
      }

      await fetchAllData();
      if (!isMounted) return;
      setLoading(false);
    };
    load();
    return () => { isMounted = false; };
  }, [fetchAllData, userId]);

  // Refetch on focus
  const lastFocusFetchRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      // Always refetch on focus to catch edits from EditProfile
      fetchAllData();
      // Also refetch ask feed — each useAskFeed() call has independent
      // state, so when the user deletes their ask from a different
      // screen (ConnectionsScreen's AskStoryRow, or the AskCreateModal
      // there), this screen's myAsk pointer would otherwise stay stale
      // until the realtime DELETE event lands. Belt-and-suspenders
      // alongside the realtime listener in the hook itself.
      refreshAskFeed();
    }, [fetchAllData, refreshAskFeed]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllData();
    setRefreshing(false);
  }, [fetchAllData]);

  // Connectivity returned mid-session: fetchAllData short-circuits while
  // offline, so something has to restart it. A successful pass also
  // replaces the em-dash stats and retires the error surface, since both
  // are derived from `statsKnown` / `profile`.
  useNetInfoReconnect(
    useCallback(() => {
      setUnreachable(false);
      void fetchAllData();
    }, [fetchAllData]),
  );

  // Online but the request is going nowhere (captive portal, dead venue
  // wifi). Drop the skeleton rather than hold it through the ~25s
  // auth-refresh backoff; the fetch still paints if it ever lands.
  useLoadDeadline(loading, () => {
    setLoading(false);
    setUnreachable(true);
  });

  // --- Computed values ---

  // Em dash, not 0, while the counts are unknown — see `statsKnown`.
  const statText = useCallback(
    (value: string | number): string => (statsKnown ? String(value) : '—'),
    [statsKnown],
  );

  const formattedFollowerCount = useMemo((): string => {
    if (followerCount >= 1000000) return `${(followerCount / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (followerCount >= 1000) return followerCount.toLocaleString();
    return followerCount.toString();
  }, [followerCount]);

  const activeBiolinks = useMemo(() => biolinks.filter((bl) => bl.is_active), [biolinks]);

  const headerTitle = useMemo(() => profile?.full_name || t('profile.nameNotSet'), [profile?.full_name, t]);
  const displayUsername = useMemo(() => profile?.username || t('profile.usernameNotSet'), [profile?.username, t]);
  const displayBio = useMemo(() => profile?.bio || t('profile.noBio'), [profile?.bio, t]);

  // --- Callbacks ---

  const handleOpenBiolink = useCallback((bl: Biolink) => {
    // Copy-or-open is centralised in openOrCopyBiolink: WeChat (idMode)
    // copies its bare 微信號 to the clipboard, everything else gates on
    // the isSafeBiolinkUrl allowlist and opens. Routing through the
    // shared helper also kills the old double-prefix bug where a bare
    // ID got `https://` prepended and opened as a dead `https://<id>`.
    void openOrCopyBiolink({ platform: bl.platform, url: bl.url, id: bl.id }, t);
  }, [t]);

  const handleTagPress = useCallback((tagId: string, tagName: string) => {
    navigation.navigate('TagDetail', { tagId, tagName });
  }, [navigation]);

  const handleOpenQr = useCallback(() => setQrVisible(true), []);
  const handleCloseQr = useCallback(() => setQrVisible(false), []);
  const handleNavigateSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  // 建立活動 QR — moved here from the Friends header (founder 2026-06-25:
  // too heavy next to the scan CTA). Sits with the personal QR (分享檔案) —
  // both are "a QR I generate/show". QrGroupList lives in RootStack.
  const handleNavigateEventQr = useCallback(() => navigation.navigate('QrGroupList'), [navigation]);
  const handleNavigateEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);
  // Each profile stat now drills into its OWN destination (was: the
  // whole row dumped every tap onto the Tribe graph). Tags → tag
  // manager, Friends → the Home/Connections list, Followers → the
  // followers list, Tribe → the constellation.
  const handleNavigateTags = useCallback(() => navigation.navigate('ManageTags'), [navigation]);
  const handleNavigateFriends = useCallback(
    () => navigation.navigate('Main', { screen: 'HomeTab' }),
    [navigation]
  );
  const handleNavigateFollowers = useCallback(
    () =>
      navigation.navigate('Followers', {
        userId,
        displayName: profile?.full_name || profile?.username || '',
      }),
    [navigation, userId, profile?.full_name, profile?.username]
  );

  const qrUsername = useMemo(() => profile?.username || '', [profile?.username]);
  const qrFullName = useMemo(() => profile?.full_name || '', [profile?.full_name]);
  // Public identity tags for the share card (private tags stay off
  // a QR meant to be shown to others). Capped so the single tag
  // line doesn't overflow the card; order follows the profile's
  // own pinned/position sort.
  const qrTags = useMemo(
    () =>
      userTags
        .filter((ut) => !ut.is_private && !!ut.tag?.name)
        .slice(0, 6)
        .map((ut) => ut.tag!.name as string),
    [userTags],
  );

  // --- Render ---

  // The skeleton is now gated on HAVING NOTHING, not on "a request is in
  // flight". `profile` may already be here from AuthContext, which
  // hydrates it from the AUTH_PROFILE disk cache before any network call
  // — that snapshot is written on every successful launch, so the second
  // launch offline shows the user their own name, avatar, bio and a
  // scannable QR instead of the all-grey placeholder they reported.
  if (loading && !profile) return <ProfileScreenSkeleton />;

  // Nothing cached and the network could not be reached. Say so, in one
  // screen, with a retry — ErrorState reads NetInfo itself and picks the
  // offline copy. Deliberately NOT `if (!profile)`: an account whose
  // profile row is genuinely missing is not a connectivity problem and
  // must keep falling through to the normal render below.
  if (!profile && unreachable) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={TOP_EDGES}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('profile.pageTitle')}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateSettings} accessibilityLabel={t('settings.headerTitle', { defaultValue: '設定' })} accessibilityRole="button">
              <Settings size={24} color={colors.gray900} />
            </TouchableOpacity>
          </View>
        </View>
        <ErrorState
          onRetry={() => {
            setUnreachable(false);
            setLoading(true);
            void fetchAllData().finally(() => setLoading(false));
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={TOP_EDGES}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header
          Gift icon was removed — the old "earn points, redeem for
          future paid features" loop was the rare top-right surface
          that nobody actually used. (The invite-code/redeem gate has
          since been fully retired — open signup, no codes. Plain
          "share PikTag with a contact" still exists in ContactSync.)
          The motivator now lives further down as the Tribe size
          number — see comment below. */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('profile.pageTitle')}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateEventQr} accessibilityLabel={t('connections.createEventQr', { defaultValue: '建立活動 QR' })} accessibilityRole="button">
            <Hash size={24} color={colors.gray900} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateSettings} accessibilityLabel={t('settings.headerTitle', { defaultValue: '設定' })} accessibilityRole="button">
            <Settings size={24} color={colors.gray900} />
          </TouchableOpacity>
        </View>
      </View>

      <QrCodeModal visible={qrVisible} onClose={handleCloseQr} username={qrUsername} fullName={qrFullName} tags={qrTags} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.piktag500} />}
      >
        {/* ============ SECTION 1: Personal Info + Tags (Threads style) ============ */}
        <View style={styles.profileSection}>
          {/* Avatar + Name/Username */}
          <View style={styles.profileRow}>
            {/* "+" on an avatar is reserved for "create new ask" across
                the app — same affordance as AskStoryRow's my-Ask card.
                Tapping here opens AskCreateModal; if the viewer already
                has an active ask the modal switches to view/delete mode
                automatically. EditProfile is reachable via the "編輯
                個人檔案" button below the stats row. */}
            {/* Ring style is the visual signal for "I have an active Ask".
                When myAsk is null we drop to the subtle 1.5px border so
                the gradient stops being visual noise that everyone has
                all the time. The "+" badge stays in both states (it's
                the affordance for creating an Ask, independent of the
                current Ask state) — onPress branches to view/delete or
                create inside AskCreateModal. */}
            <RingedAvatar
              size={68}
              ringStyle={myAsk ? 'gradient' : 'subtle'}
              badge="plus"
              name={profile?.full_name || profile?.username || ''}
              avatarUrl={profile?.avatar_url}
              onPress={() => setAskModalVisible(true)}
              accessibilityLabel={t('ask.newAsk', { defaultValue: '新增 Ask' })}
            />
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName}>{headerTitle}</Text>
                {/* {profile?.is_verified && (
                  <CheckCircle2 size={16} color={colors.blue500} fill={colors.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
                )} */}
              </View>
              <Text style={styles.usernameText}>@{displayUsername}</Text>
              {/* "Tap + to ask · I need…" hint — surfaces the reverse-
                  lookup affordance that distinguishes PikTag from a
                  contacts app. Only shown when the user has no active
                  ask; once they post one, the surrounding UI (Profile
                  ask card / connections AskFeed) takes over speaking
                  for the same affordance, so the hint becomes noise. */}
              {!myAsk && (
                <Text style={styles.askPromptHint} numberOfLines={1}>
                  {t('profile.askPromptHint')}
                </Text>
              )}
            </View>
          </View>

          {/* Headline */}
          {profile?.headline ? <Text style={styles.headline}>{profile.headline}</Text> : null}

          {/* Bio (max 3 lines) */}
          {profile?.bio ? <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text> : null}

          {/* Tags — flat inline, all clickable */}
          <View style={styles.tagsWrap}>
            {userTags.length > 0 ? (
              userTags.map((ut) => (
                <TouchableOpacity
                  key={ut.id}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => {
                    if (ut.tag?.id && ut.tag?.name) handleTagPress(ut.tag.id, ut.tag.name);
                  }}
                  accessibilityLabel={`標籤 ${ut.tag?.name || t('profile.tagFallback')}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.tagChipText}>{hashDisplay(ut.tag?.name || t('profile.tagFallback'))}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>{t('profile.noTags')}</Text>
            )}
          </View>

          {/* Stats — one line above buttons. Tribe size joins
              tags / friends / followers as the fourth public stat
              — same visual weight, same row. Tappable: opens the
              private anonymous Tribe constellation view.
              "Tribe" replaces the old p_points system. The
              motivation flips from "earn points → redeem for
              vague future features" to "visible status number
              that grows as your invites compound." */}
          <StatsRow>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={handleNavigateTags}
              hitSlop={STAT_HITSLOP}
              accessibilityRole="button"
              accessibilityLabel={t('profile.statTagsA11y', { defaultValue: '查看我的標籤' })}
            >
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{statText(userTags.length)}</Text>
                <Text style={styles.statLabel}>{t('profile.statTags')}</Text>
              </Text>
            </TouchableOpacity>
            <StatDot />
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={handleNavigateFriends}
              hitSlop={STAT_HITSLOP}
              accessibilityRole="button"
              accessibilityLabel={t('profile.statFriendsA11y', { defaultValue: '查看我的朋友' })}
            >
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{statText(friendCount)}</Text>
                <Text style={styles.statLabel}>{t('profile.statFriends')}</Text>
              </Text>
            </TouchableOpacity>
            <StatDot />
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={handleNavigateFollowers}
              hitSlop={STAT_HITSLOP}
              accessibilityRole="button"
              accessibilityLabel={t('profile.statFollowersA11y', { defaultValue: '查看我的追蹤者' })}
            >
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{statText(formattedFollowerCount)}</Text>
                <Text style={styles.statLabel}>{t('profile.statFollowers')}</Text>
              </Text>
            </TouchableOpacity>
          </StatsRow>

          {/* Tag-graph health pill REMOVED 2026-05-29 — founder
              decision after the TestFlight screenshot showed
              the score reading as implicit blame ("我朋友怎麼都
              不認同我"). The score itself is fine; surfacing a
              context-free number to users without an actionable
              breakdown panel was the bug. Existing organic
              surfaces cover every component of the formula:
                - has_self      → EditProfile completion hint
                - has_friend    → principle #3 endorsement_request cron
                                  (server-side, no user nag needed)
                - has_ask       → AskStoryRow placeholder
                - has_event     → QR / card scan naturally accrues
                - distinct_concepts → exposing would cause tag spam
              RPC get_tag_graph_health stays for admin dashboard
              + post-launch analytics. If user research later shows
              a true gap, revisit with a proper breakdown panel
              that gives users a path to action — never a bare score. */}

          {/* Action buttons */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity style={styles.shareButton} activeOpacity={0.7} onPress={handleOpenQr}>
              <Text style={styles.shareButtonText}>{t('profile.shareProfile')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editButton} activeOpacity={0.7} onPress={handleNavigateEditProfile} accessibilityLabel={t('profile.editProfile', { defaultValue: '編輯個人檔案' })} accessibilityRole="button">
              <Text style={styles.editButtonText}>{t('profile.editProfile')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Social biolinks (icon row + card section). Migrated to the
            shared BiolinkSocialSection component 2026-05-31 (task #38).
            Unified to variant="highlight" on 2026-06-03 — founder
            asked for visual consistency with FriendDetail/UserDetail
            ("好友資訊頁跟使用者個人資訊頁，社交連結...設計卻有一點
            不同，像是大小，可以一致嗎"). Reasoning: own-profile is
            also a share surface (QR, deep-link views), so North
            Star "every friend-add moment" applies symmetrically.
            IG-Highlights treatment (60px ring + 52px inner, icon 28)
            wins as the canonical because it reads as tappable across
            both contexts. The 'compact' branch remains in
            BiolinkSocialSection.tsx as dead-but-reversible code in
            case the founder pivots back. */}
        <BiolinkSocialSection
          biolinks={activeBiolinks}
          onPress={(bl) => handleOpenBiolink(bl)}
          variant="highlight"
        />

        {activeBiolinks.length === 0 && !profile?.phone && !user?.email && (
          <View style={styles.emptySection}>
            <MessageCircle size={32} color={colors.gray200} />
            <Text style={styles.emptyText}>{t('profile.noContactMethods')}</Text>
          </View>
        )}
      </ScrollView>

      <AskCreateModal
        visible={askModalVisible}
        onClose={() => setAskModalVisible(false)}
        existingAsk={myAsk}
        onCreated={refreshAskFeed}
      />

      <CoachMark
        hintId="profile_tags"
        text={t('coach.profileTags')}
        style={{ top: 66, left: 24, right: 24 }}
        arrow="up"
      />
    </SafeAreaView>
  );
}

const TOP_EDGES = ['top'] as const;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 8,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: c.gray900,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIconBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },

  // ===== Section 1: Profile Info + Tags =====
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 14,
  },
  nameSection: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: c.gray900,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  usernameText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray500,
  },
  // Faint italic caption that hints at the reverse-lookup affordance
  // sitting on the avatar's `+` badge. Faded enough to read as
  // "suggestion" rather than "label" — once the user has an active
  // ask the hint is hidden so it doesn't compete with the real status.
  askPromptHint: {
    fontSize: 12,
    color: c.gray400,
    marginTop: 3,
    fontStyle: 'italic',
  },
  // (statsRow + statDot moved into the shared StatsLine component.
  // statText / statNumber / statLabel kept — they style the per-stat
  // text rendering which legitimately varies per screen. task #38.)
  statText: {
    fontSize: 14,
    color: c.gray500,
  },
  statNumber: {
    fontWeight: '700',
    color: c.accent500,
  },
  statLabel: {
    color: c.gray500,
  },
  // (healthPill style dropped 2026-05-29 — see the inline removal
  // comment in the JSX above.)
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag600,
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: c.gray700,
    lineHeight: 21,
    marginBottom: 14,
  },

  // Tags — flat inline clickable
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  tagChip: {
    backgroundColor: c.fill,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    // Visible hairline so the (secondary, gray) profile tags have a
    // defined edge in dark mode — they sit on a near-black page and
    // c.gray100 fill alone barely separated.
    borderColor: c.gray200,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray600,
  },

  // Action Buttons
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareButton: {
    flex: 1,
    backgroundColor: c.piktag500,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // 編輯資訊 is a SECONDARY action — 分享檔案 (solid piktag500) is the
  // one true CTA on this page (sharing your profile = a friend-add
  // opportunity, the North Star). IG-style filled-gray secondary
  // button (c.gray200 = #e5e7eb light / #363636 dark) — clearly a
  // button, clearly not the primary. Matches FriendDetail's
  // secondaryBtn so the app's non-CTA buttons read consistently.
  editButton: {
    flex: 1,
    backgroundColor: c.fill,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray900,
  },

  // ===== Profile completeness =====
  completenessBar: {
    marginTop: 12,
    padding: 12,
    backgroundColor: c.gray50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.gray100,
  },
  completenessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  completenessText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.gray700,
  },
  completenessMissing: {
    fontSize: 12,
    color: c.piktag600,
  },
  completenessTrack: {
    height: 4,
    backgroundColor: c.gray200,
    borderRadius: 2,
    overflow: 'hidden',
  },
  completenessFill: {
    height: 4,
    backgroundColor: c.piktag500,
    borderRadius: 2,
  },

  // (sectionTitle was defined here but never used in JSX — dead style
  // removed. The shared SectionTitle component is the canonical
  // source if a section title is added back. task #38.)

  // ===== Section 2: Contact Info =====
  contactSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: c.gray100,
  },
  contactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
  },
  contactCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: c.white,
    borderWidth: 1.5,
    borderColor: c.gray100,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 6,
  },
  contactIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  contactLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: c.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray900,
  },

  // ===== Empty state =====
  emptySection: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },

  emptyText: {
    fontSize: 14,
    color: c.gray400,
    paddingVertical: 8,
  },
  });
}
