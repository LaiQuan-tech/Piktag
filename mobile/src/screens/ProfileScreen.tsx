import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  RefreshControl,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  CheckCircle2,
  Pencil,
  ExternalLink,
} from 'lucide-react-native';
import PlatformIcon from '../components/PlatformIcon';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import QrCodeModal from '../components/QrCodeModal';
import InitialsAvatar from '../components/InitialsAvatar';
import { ProfileScreenSkeleton } from '../components/SkeletonLoader';
import StatusModal from '../components/StatusModal';
import type { PiktagProfile, UserTag, Biolink } from '../types';

type ProfileScreenProps = {
  navigation: any;
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
          <PlatformIcon platform={biolink.platform} size={28} />
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
      <PlatformIcon platform={biolink.platform} size={22} />
      <Text style={styles.linkCardText} numberOfLines={1}>
        {biolink.label || biolink.platform}
      </Text>
      <ExternalLink size={16} color={COLORS.gray400} />
    </TouchableOpacity>
  );
});

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;

  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [userTags, setUserTags] = useState<UserTag[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [friendCount, setFriendCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipOpacity = useRef(new Animated.Value(0)).current;

  // --- Data fetching ---

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error && data) setProfile(data as PiktagProfile);
  }, [userId]);

  const fetchUserTags = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', userId);
    if (!error && data) setUserTags(data as UserTag[]);
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

  const fetchStatus = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('piktag_user_status')
      .select('text')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    setCurrentStatus(data?.text ?? null);
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
    await Promise.all([fetchProfile(), fetchUserTags(), fetchBiolinks(), fetchFollowerCount(), fetchFriendCount(), fetchStatus()]);
  }, [fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount, fetchFriendCount, fetchStatus]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      await fetchAllData();
      if (isMounted) setLoading(false);
    };
    load();
    return () => { isMounted = false; };
  }, [fetchAllData]);

  // Tooltip
  useEffect(() => {
    AsyncStorage.getItem('status_tooltip_seen').then((seen) => {
      if (!seen) {
        setShowTooltip(true);
        Animated.timing(tooltipOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
        const timer = setTimeout(() => {
          Animated.timing(tooltipOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setShowTooltip(false));
          AsyncStorage.setItem('status_tooltip_seen', '1');
        }, 3000);
        return () => clearTimeout(timer);
      }
    });
  }, [tooltipOpacity]);

  // Refetch on focus
  const lastFocusFetchRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusFetchRef.current < 30000 && lastFocusFetchRef.current > 0) return;
      lastFocusFetchRef.current = now;
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

  const hasAvatar = !!profile?.avatar_url;
  const avatarSource = useMemo(() => profile?.avatar_url ? { uri: profile.avatar_url } : null, [profile?.avatar_url]);

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
  const handleNavigateEditProfile = useCallback(() => navigation.navigate('EditProfile'), [navigation]);

  const qrUsername = useMemo(() => profile?.username || '', [profile?.username]);
  const qrFullName = useMemo(() => profile?.full_name || '', [profile?.full_name]);

  // --- Render ---

  if (loading) return <ProfileScreenSkeleton />;

  return (
    <SafeAreaView style={styles.container} edges={TOP_EDGES}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{displayUsername}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6} onPress={handleNavigateSettings}>
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
        {/* ============ SECTION 1: Personal Info + Tags ============ */}
        <View style={styles.profileSection}>
          {/* Avatar + Stats Row (IG layout) */}
          <View style={styles.profileRow}>
            <View>
              <TouchableOpacity onPress={() => setStatusModalVisible(true)} activeOpacity={0.8}>
                <View style={[styles.avatarWrapper, currentStatus ? styles.avatarRing : null]}>
                  {hasAvatar ? (
                    <Image source={avatarSource!} style={styles.avatar} />
                  ) : (
                    <InitialsAvatar name={profile?.full_name || profile?.username || ''} size={80} style={styles.avatar} />
                  )}
                </View>
                <View style={styles.pencilBadge}>
                  <Pencil size={10} color={COLORS.white} />
                </View>
              </TouchableOpacity>
              {showTooltip && (
                <Animated.View style={[styles.tooltip, { opacity: tooltipOpacity }]}>
                  <Text style={styles.tooltipText}>{t('profile.statusTooltip')}</Text>
                  <View style={styles.tooltipArrow} />
                </Animated.View>
              )}
            </View>
            {/* Stats — right side of avatar */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{userTags.length}</Text>
                <Text style={styles.statLabel}>{t('profile.statTags')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{friendCount}</Text>
                <Text style={styles.statLabel}>{t('profile.statFriends')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{formattedFollowerCount}</Text>
                <Text style={styles.statLabel}>{t('profile.statFollowers')}</Text>
              </View>
            </View>
          </View>

          {/* Name + Username */}
          <View style={styles.nameSection}>
            <Text style={styles.displayName}>{headerTitle}</Text>
            <View style={styles.usernameRow}>
              <Text style={styles.usernameText}>@{displayUsername}</Text>
              {profile?.is_verified && (
                <CheckCircle2 size={14} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
              )}
            </View>
          </View>

          {/* Bio */}
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

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
                >
                  <Text style={styles.tagChipText}>#{ut.tag?.name || t('profile.tagFallback')}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>{t('profile.noTags')}</Text>
            )}
          </View>

          {/* Action buttons */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity style={styles.shareButton} activeOpacity={0.7} onPress={handleOpenQr}>
              <Text style={styles.shareButtonText}>{t('profile.shareProfile')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editButton} activeOpacity={0.7} onPress={handleNavigateEditProfile}>
              <Text style={styles.editButtonText}>{t('profile.editProfile')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ============ SECTION 2: Social Links (IG Highlights style) ============ */}
        {activeBiolinks.length > 0 && (
          <View style={styles.socialSection}>
            <Text style={styles.sectionTitle}>{t('profile.socialLinksTitle')}</Text>
            <FlatList
              horizontal
              data={activeBiolinks}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.socialScrollContent}
              renderItem={({ item }) => (
                <SocialCircle biolink={item} onPress={handleOpenBiolink} />
              )}
            />
          </View>
        )}

        {/* ============ SECTION 3: Link Bio (Linktree style cards) ============ */}
        <View style={styles.linkBioSection}>
          <Text style={styles.sectionTitle}>{t('profile.linkBioTitle')}</Text>

          {activeBiolinks.map((bl) => (
            <LinkCard key={bl.id} biolink={bl} onPress={handleOpenBiolink} />
          ))}

          {profile?.phone && (
            <TouchableOpacity
              style={styles.linkCard}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(`tel:${profile.phone}`).catch(() => {})}
            >
              <Text style={styles.linkCardEmoji}>📞</Text>
              <Text style={styles.linkCardText}>{profile.phone}</Text>
              <ExternalLink size={16} color={COLORS.gray400} />
            </TouchableOpacity>
          )}

          {user?.email && (
            <TouchableOpacity
              style={styles.linkCard}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(`mailto:${user.email}`).catch(() => {})}
            >
              <Text style={styles.linkCardEmoji}>✉️</Text>
              <Text style={styles.linkCardText}>{user.email}</Text>
              <ExternalLink size={16} color={COLORS.gray400} />
            </TouchableOpacity>
          )}

          {activeBiolinks.length === 0 && !profile?.phone && !user?.email && (
            <Text style={styles.emptyText}>{t('profile.noContactMethods')}</Text>
          )}
        </View>
      </ScrollView>

      <StatusModal
        visible={statusModalVisible}
        onClose={() => setStatusModalVisible(false)}
        initialText={currentStatus}
        onStatusUpdated={(text) => setCurrentStatus(text)}
      />
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
    marginBottom: 12,
    gap: 20,
  },
  avatarWrapper: {
    borderRadius: 50,
    padding: 2,
  },
  avatarRing: {
    borderWidth: 3,
    borderColor: '#C13584',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray100,
  },
  nameSection: {
    marginBottom: 6,
  },
  displayName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 22,
  },
  pencilBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.piktag500,
    borderWidth: 2,
    borderColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tooltip: {
    position: 'absolute',
    bottom: -38,
    left: '50%',
    transform: [{ translateX: -52 }],
    backgroundColor: COLORS.gray900,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    width: 104,
    alignItems: 'center',
    zIndex: 10,
  },
  tooltipText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '500',
  },
  tooltipArrow: {
    position: 'absolute',
    top: -5,
    left: '50%',
    transform: [{ translateX: -5 }],
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: COLORS.gray900,
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
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.gray500,
    marginTop: 2,
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
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray800,
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
    color: COLORS.gray900,
  },
  editButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },

  // ===== Section 2: Social Links (IG Highlights) =====
  socialSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
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
  socialScrollContent: {
    paddingHorizontal: 16,
    gap: 16,
  },
  socialCircleItem: {
    alignItems: 'center',
    width: 68,
  },
  socialCircleRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  socialCircleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCircleLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray700,
    textAlign: 'center',
  },

  // ===== Section 3: Link Bio (Linktree style) =====
  linkBioSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
    gap: 10,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 12,
  },
  linkCardText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  linkCardEmoji: {
    fontSize: 20,
  },

  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingVertical: 8,
  },
});
