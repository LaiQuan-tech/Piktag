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
} from 'lucide-react-native';
import BiolinkSocialSection from '../components/BiolinkSocialSection';
import { StatsRow, StatDot } from '../components/StatsLine';
import { useTranslation } from 'react-i18next';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import QrCodeModal from '../components/QrCodeModal';
import RingedAvatar from '../components/RingedAvatar';
import { AskCreateModal } from '../components/ask/AskStoryRow';
import { useAskFeed } from '../hooks/useAskFeed';
import { ProfileScreenSkeleton } from '../components/SkeletonLoader';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PiktagProfile, UserTag, Biolink } from '../types';

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
  // Tribe = transitive count of people you invited to PikTag,
  // either via the redeem_invite_code path or by them scanning
  // a Vibe QR before signup. Backed by the get_tribe_size RPC
  // which does a recursive CTE; cached client-side until refresh.
  const [tribeSize, setTribeSize] = useState<number>(0);
  // (tag-graph health state removed 2026-05-29 — see the comment
  // where the pill used to render. RPC stays; client-side fetching
  // it was only for the pill, so we drop the network call too.)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);

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

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    // Delegate to AuthContext — one place to coalesce concurrent
    // callers + update the cross-screen cache.
    await refreshProfile();
  }, [userId, refreshProfile]);

  const fetchUserTags = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', userId)
      .order('position');
    if (!error && data) {
      // Pinned tags first, then by position
      const sorted = [...data].sort((a: UserTag, b: UserTag) => {
        const aPinned = a.is_pinned ? 1 : 0;
        const bPinned = b.is_pinned ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return (a.position || 0) - (b.position || 0);
      });
      setUserTags(sorted as UserTag[]);
    }
  }, [userId]);

  const fetchBiolinks = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    if (!error && data) setBiolinks(data as Biolink[]);
  }, [userId]);

  const fetchFollowerCount = useCallback(async () => {
    if (!userId) return;
    const { count, error } = await supabase
      .from('piktag_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId);
    if (!error && count !== null) setFollowerCount(count);
  }, [userId]);

  const fetchFriendCount = useCallback(async () => {
    if (!userId) return;
    const { count, error } = await supabase
      .from('piktag_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (!error && count !== null) setFriendCount(count);
  }, [userId]);

  // Tribe size via RPC (recursive CTE over piktag_profiles.invited_by_user_id).
  // PGRST202 = function not deployed yet (migration tolerance): treat as 0.
  const fetchTribeSize = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.rpc('get_tribe_size', { p_user_id: userId });
      if (error) {
        const isMissing =
          (error as any).code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(error.message);
        if (!isMissing) console.warn('[Profile] tribe size fetch failed:', error);
        setTribeSize(0);
      } else if (typeof data === 'number') {
        setTribeSize(data);
      }
    } catch (err) {
      console.warn('[Profile] tribe size threw:', err);
      setTribeSize(0);
    }
  }, [userId]);

  const fetchAllData = useCallback(async () => {
    await Promise.all([fetchProfile(), fetchUserTags(), fetchBiolinks(), fetchFollowerCount(), fetchFriendCount(), fetchTribeSize()]);
  }, [fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount, fetchFriendCount, fetchTribeSize]);

  // Persist the five state slices to the in-memory dataCache so that
  // re-entering ProfileScreen within the TTL window paints instantly
  // instead of waiting for 5 queries. The effect is gated on state
  // actually being present to avoid caching an intermediate blank.
  useEffect(() => {
    if (!userId) return;
    if (!profile) return; // profile is the anchor; no point caching without it
    setCache(CACHE_KEYS.PROFILE, {
      profile,
      userTags,
      biolinks,
      followerCount,
      friendCount,
    });
  }, [userId, profile, userTags, biolinks, followerCount, friendCount]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      // Stale-while-revalidate: if we have a cached snapshot, paint it
      // immediately and refetch in the background without a loading state.
      const cached = getCache<{
        profile: PiktagProfile;
        userTags: UserTag[];
        biolinks: Biolink[];
        followerCount: number;
        friendCount: number;
      }>(CACHE_KEYS.PROFILE);

      if (cached) {
        setProfile(cached.profile);
        setUserTags(cached.userTags);
        setBiolinks(cached.biolinks);
        setFollowerCount(cached.followerCount);
        setFriendCount(cached.friendCount);
        setLoading(false);
      } else {
        setLoading(true);
      }

      await fetchAllData();
      if (isMounted) setLoading(false);
    };
    load();
    return () => { isMounted = false; };
  }, [fetchAllData]);

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

  // --- Computed values ---

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

  const handleOpenBiolink = useCallback((url: string) => {
    if (!url) return;
    // Defensive scheme prepend — covers legacy `custom` biolink
    // rows saved before buildPlatformUrl learned to auto-prepend
    // https:// (2026-05-31 fix). Without this, tapping a bare-
    // domain biolink looks completely dead — iOS Linking.openURL
    // silently refuses URLs without a scheme. Founder verbatim
    // "圖片並排最右邊，根本沒有網址可以前往，這簡直是我們產品
    // 存在的基本價值都做不到".
    const safeUrl = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    Linking.openURL(safeUrl).catch(() => {});
  }, []);

  const handleTagPress = useCallback((tagId: string, tagName: string) => {
    navigation.navigate('TagDetail', { tagId, tagName, initialTab: 'explore' });
  }, [navigation]);

  const handleOpenQr = useCallback(() => setQrVisible(true), []);
  const handleCloseQr = useCallback(() => setQrVisible(false), []);
  const handleNavigateSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleNavigateEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);
  const handleNavigateTribe = useCallback(() => navigation.navigate('TribeConstellation'), [navigation]);
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

  if (loading) return <ProfileScreenSkeleton />;

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
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateSettings} accessibilityLabel="設定" accessibilityRole="button">
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
                  <Text style={styles.tagChipText}>#{ut.tag?.name || t('profile.tagFallback')}</Text>
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
                <Text style={styles.statNumber}>{userTags.length}</Text>
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
                <Text style={styles.statNumber}>{friendCount}</Text>
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
                <Text style={styles.statNumber}>{formattedFollowerCount}</Text>
                <Text style={styles.statLabel}>{t('profile.statFollowers')}</Text>
              </Text>
            </TouchableOpacity>
            <StatDot />
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={handleNavigateTribe}
              hitSlop={STAT_HITSLOP}
              accessibilityRole="button"
              accessibilityLabel={t('profile.statTribeA11y', { defaultValue: '查看 Tribe 星圖' })}
            >
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{tribeSize}</Text>
                <Text style={styles.statLabel}>{t('profile.statTribe', { defaultValue: 'Tribe' })}</Text>
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
            <TouchableOpacity style={styles.editButton} activeOpacity={0.7} onPress={handleNavigateEditProfile} accessibilityLabel="編輯個人檔案" accessibilityRole="button">
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
          onPress={(bl) => handleOpenBiolink(bl.url)}
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
