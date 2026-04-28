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
  Gift,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
} from 'lucide-react-native';
import PlatformIcon from '../components/PlatformIcon';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import QrCodeModal from '../components/QrCodeModal';
import RingedAvatar from '../components/RingedAvatar';
import { ProfileScreenSkeleton } from '../components/SkeletonLoader';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PiktagProfile, UserTag, Biolink } from '../types';

type ProfileScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

// --- Memoized Social Circle Item (IG Highlights style) ---
const SocialCircle = React.memo(function SocialCircle({
  biolink,
  onPress,
}: {
  biolink: Biolink;
  onPress: (url: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.socialCircleItem}
      activeOpacity={0.7}
      onPress={() => onPress(biolink.url)}
    >
      <View style={styles.socialCircleRing}>
        <View style={styles.socialCircleInner}>
          <PlatformIcon platform={biolink.platform} size={28} iconUrl={biolink.icon_url} />
        </View>
      </View>
      <Text style={styles.socialCircleLabel} numberOfLines={1}>
        {biolink.label || biolink.platform}
      </Text>
    </TouchableOpacity>
  );
});

// --- Memoized Linktree-style Link Card ---
const LinkCard = React.memo(function LinkCard({
  biolink,
  onPress,
}: {
  biolink: Biolink;
  onPress: (url: string) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.linkCard}
      activeOpacity={0.7}
      onPress={() => onPress(biolink.url)}
    >
      <PlatformIcon platform={biolink.platform} size={22} iconUrl={biolink.icon_url} />
      <Text style={styles.linkCardText} numberOfLines={1}>
        {biolink.label || biolink.platform}
      </Text>
      <ExternalLink size={16} color={COLORS.gray400} />
    </TouchableOpacity>
  );
});

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);

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

  const fetchAllData = useCallback(async () => {
    await Promise.all([fetchProfile(), fetchUserTags(), fetchBiolinks(), fetchFollowerCount(), fetchFriendCount()]);
  }, [fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount, fetchFriendCount]);

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
    }, [fetchAllData]),
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
    if (url) Linking.openURL(url).catch(() => {});
  }, []);

  const handleTagPress = useCallback((tagId: string, tagName: string) => {
    navigation.navigate('TagDetail', { tagId, tagName, initialTab: 'explore' });
  }, [navigation]);

  const handleOpenQr = useCallback(() => setQrVisible(true), []);
  const handleCloseQr = useCallback(() => setQrVisible(false), []);
  const handleNavigateSettings = useCallback(() => navigation.navigate('Settings'), [navigation]);
  const handleNavigateInvite = useCallback(() => navigation.navigate('Invite'), [navigation]);
  const handleNavigateEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

  const qrUsername = useMemo(() => profile?.username || '', [profile?.username]);
  const qrFullName = useMemo(() => profile?.full_name || '', [profile?.full_name]);

  // --- Render ---

  if (loading) return <ProfileScreenSkeleton />;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={TOP_EDGES}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('profile.pageTitle')}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateInvite} accessibilityLabel={t('settings.inviteFriends') || '邀請好友'} accessibilityRole="button">
            <Gift size={24} color={COLORS.piktag600} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateSettings} accessibilityLabel="設定" accessibilityRole="button">
            <Settings size={24} color={COLORS.gray900} />
          </TouchableOpacity>
        </View>
      </View>

      <QrCodeModal visible={qrVisible} onClose={handleCloseQr} username={qrUsername} fullName={qrFullName} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.piktag500} />}
      >
        {/* ============ SECTION 1: Personal Info + Tags (Threads style) ============ */}
        <View style={styles.profileSection}>
          {/* Avatar + Name/Username */}
          <View style={styles.profileRow}>
            {/* Plus-badge ring taps straight into EditProfile — the
                legacy status-note flow is gone. RingedAvatar handles the
                avatar / initials fallback internally. */}
            <RingedAvatar
              size={68}
              ringStyle="gradient"
              badge="plus"
              name={profile?.full_name || profile?.username || ''}
              avatarUrl={profile?.avatar_url}
              onPress={handleNavigateEditProfile}
              accessibilityLabel="編輯個人檔案"
            />
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName}>{headerTitle}</Text>
                {/* {profile?.is_verified && (
                  <CheckCircle2 size={16} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
                )} */}
              </View>
              <Text style={styles.usernameText}>@{displayUsername}</Text>
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

          {/* Stats — one line above buttons */}
          <Text style={styles.statsLine}>
            <Text style={styles.statNumber}>{userTags.length}</Text>
            <Text style={styles.statLabel}>{t('profile.statTags')}</Text>
            <Text style={styles.statDot}> · </Text>
            <Text style={styles.statNumber}>{friendCount}</Text>
            <Text style={styles.statLabel}>{t('profile.statFriends')}</Text>
            <Text style={styles.statDot}> · </Text>
            <Text style={styles.statNumber}>{formattedFollowerCount}</Text>
            <Text style={styles.statLabel}>{t('profile.statFollowers')}</Text>
          </Text>

          {/* P Points */}
          <TouchableOpacity
            onPress={() => navigation.navigate('PointsHistory')}
            activeOpacity={0.7}
            style={styles.pPointsRow}
          >
            <Text style={styles.pPointsText}>
              {profile?.p_points ?? 0} {t('points.pointsUnit')}
            </Text>
          </TouchableOpacity>

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

        {/* ============ SECTION 2: Icon 並排區 (display_mode = 'icon') ============ */}
        {activeBiolinks.filter(bl => bl.display_mode === 'icon' || bl.display_mode === 'both').length > 0 && (
          <View style={styles.iconRow}>
            {activeBiolinks.filter(bl => bl.display_mode === 'icon' || bl.display_mode === 'both').map((bl) => (
              <TouchableOpacity
                key={bl.id}
                style={styles.iconCircle}
                activeOpacity={0.7}
                onPress={() => handleOpenBiolink(bl.url)}
              >
                <View style={styles.iconCircleInner}>
                  <PlatformIcon platform={bl.platform} size={22} iconUrl={bl.icon_url} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ============ SECTION 3: 清單按鈕區 (display_mode = 'card') ============ */}
        {activeBiolinks.filter(bl => bl.display_mode === 'card' || bl.display_mode === 'both').length > 0 && (
          <View style={styles.cardSection}>
            {activeBiolinks.filter(bl => bl.display_mode === 'card' || bl.display_mode === 'both').map((bl) => (
              <TouchableOpacity
                key={bl.id}
                style={styles.socialCard}
                activeOpacity={0.7}
                onPress={() => handleOpenBiolink(bl.url)}
              >
                <View style={styles.socialCardIcon}>
                  <PlatformIcon platform={bl.platform} size={24} iconUrl={bl.icon_url} />
                </View>
                <Text style={styles.socialCardLabel} numberOfLines={1}>
                  {bl.label || bl.platform}
                </Text>
                <ExternalLink size={14} color={COLORS.gray300} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {activeBiolinks.length === 0 && !profile?.phone && !user?.email && (
          <View style={styles.emptySection}>
            <MessageCircle size={32} color={COLORS.gray200} />
            <Text style={styles.emptyText}>{t('profile.noContactMethods')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const TOP_EDGES = ['top'] as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 8,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.gray900,
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
    color: COLORS.gray900,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  usernameText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  statsLine: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 14,
  },
  pPointsRow: {
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  pPointsText: {
    color: COLORS.piktag600,
    fontSize: 14,
    fontWeight: '600',
  },
  statNumber: {
    fontWeight: '700',
    color: COLORS.accent500,
  },
  statLabel: {
    color: COLORS.gray500,
  },
  statDot: {
    color: COLORS.gray400,
  },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: COLORS.gray700,
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
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray600,
  },

  // Action Buttons
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  shareButton: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  editButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.piktag200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },

  // ===== Profile completeness =====
  completenessBar: {
    marginTop: 12,
    padding: 12,
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray100,
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
    color: COLORS.gray700,
  },
  completenessMissing: {
    fontSize: 12,
    color: COLORS.piktag600,
  },
  completenessTrack: {
    height: 4,
    backgroundColor: COLORS.gray200,
    borderRadius: 2,
    overflow: 'hidden',
  },
  completenessFill: {
    height: 4,
    backgroundColor: COLORS.piktag500,
    borderRadius: 2,
  },

  // ===== Icon row (display_mode = 'icon') =====
  iconRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.gray50,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ===== Card section (display_mode = 'card') =====
  cardSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
    gap: 8,
  },

  // ===== Section: Shared =====
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 12,
    marginTop: 12,
  },

  // ===== Section 2: Contact Info =====
  contactSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
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
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray100,
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
    color: COLORS.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  contactValue: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },

  // ===== Section 3: Social Accounts =====
  socialSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  socialGrid: {
    paddingHorizontal: 20,
    gap: 8,
  },
  socialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray100,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  socialCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCardLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
  },

  // ===== Empty state =====
  emptySection: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },

  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingVertical: 8,
  },
});
