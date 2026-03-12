import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  QrCode,
  Settings,
  CheckCircle2,
  Phone,
  Mail,
  Link,
  Tag,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import QrCodeModal from '../components/QrCodeModal';
import type { PiktagProfile, UserTag, Biolink } from '../types';

type ProfileScreenProps = {
  navigation: any;
};

// --- Memoized sub-components to prevent unnecessary re-renders ---

const BiolinkItem = React.memo(function BiolinkItem({
  biolink,
  onPress,
}: {
  biolink: Biolink;
  onPress: (url: string) => void;
}) {
  const handlePress = useCallback(() => {
    onPress(biolink.url);
  }, [biolink.url, onPress]);

  return (
    <TouchableOpacity
      style={styles.contactButton}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      {(biolink as any).icon_url ? (
        <Image source={{ uri: (biolink as any).icon_url }} style={styles.biolinkIcon} />
      ) : (
        <Link size={20} color={COLORS.gray900} />
      )}
      <Text style={styles.contactButtonText}>
        {biolink.label || biolink.platform}
      </Text>
    </TouchableOpacity>
  );
});

const TagItem = React.memo(function TagItem({
  userTag,
  isPrimary,
  fallbackLabel,
}: {
  userTag: UserTag;
  isPrimary: boolean;
  fallbackLabel: string;
}) {
  return (
    <Text
      style={[
        styles.tag,
        isPrimary ? styles.tagPrimary : styles.tagSecondary,
      ]}
    >
      #{userTag.tag?.name || fallbackLabel}
    </Text>
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);

  // --- Data fetching (already uses Promise.all for parallel calls) ---

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error && data) {
      setProfile(data as PiktagProfile);
    }
  }, [userId]);

  const fetchUserTags = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', userId);
    if (!error && data) {
      setUserTags(data as UserTag[]);
    }
  }, [userId]);

  const fetchBiolinks = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    if (!error && data) {
      setBiolinks(data as Biolink[]);
    }
  }, [userId]);

  const fetchFollowerCount = useCallback(async () => {
    if (!userId) return;
    const { count, error } = await supabase
      .from('piktag_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId);
    if (!error && count !== null) {
      setFollowerCount(count);
    }
  }, [userId]);

  const fetchAllData = useCallback(async () => {
    await Promise.all([
      fetchProfile(),
      fetchUserTags(),
      fetchBiolinks(),
      fetchFollowerCount(),
    ]);
  }, [fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      await fetchAllData();
      if (isMounted) setLoading(false);
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [fetchAllData]);

  // Refetch data when navigating back from EditProfile
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchAllData();
    });
    return unsubscribe;
  }, [navigation, fetchAllData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllData();
    setRefreshing(false);
  }, [fetchAllData]);

  // --- Memoized computed values ---

  const formattedFollowerCount = useMemo((): string => {
    if (followerCount >= 1000000) {
      return `${(followerCount / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (followerCount >= 1000) {
      return followerCount.toLocaleString();
    }
    return followerCount.toString();
  }, [followerCount]);

  const activeBiolinks = useMemo(
    () => biolinks.filter((bl) => bl.is_active),
    [biolinks],
  );

  const avatarSource = useMemo(
    () =>
      profile?.avatar_url
        ? { uri: profile.avatar_url }
        : { uri: 'https://picsum.photos/seed/profile/200/200' },
    [profile?.avatar_url],
  );

  const headerTitle = useMemo(
    () => profile?.full_name || t('profile.nameNotSet'),
    [profile?.full_name, t],
  );

  const displayUsername = useMemo(
    () => profile?.username || t('profile.usernameNotSet'),
    [profile?.username, t],
  );

  const displayBio = useMemo(
    () => profile?.bio || t('profile.noBio'),
    [profile?.bio, t],
  );

  const hasNoContactMethods = useMemo(
    () => !profile?.phone && !user?.email && activeBiolinks.length === 0,
    [profile?.phone, user?.email, activeBiolinks.length],
  );

  // --- Stable callback references for child components ---

  const handleOpenBiolink = useCallback((url: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {});
    }
  }, []);

  const handleOpenQr = useCallback(() => {
    setQrVisible(true);
  }, []);

  const handleCloseQr = useCallback(() => {
    setQrVisible(false);
  }, []);

  const handleNavigateSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const handleNavigateEditProfile = useCallback(() => {
    navigation.navigate('EditProfile');
  }, [navigation]);

  const handleNavigateManageTags = useCallback(() => {
    navigation.navigate('ManageTags');
  }, [navigation]);

  const handleCallPhone = useCallback(() => {
    if (profile?.phone) {
      Linking.openURL(`tel:${profile.phone}`).catch(() => {});
    }
  }, [profile?.phone]);

  const handleSendEmail = useCallback(() => {
    if (user?.email) {
      Linking.openURL(`mailto:${user.email}`).catch(() => {});
    }
  }, [user?.email]);

  // --- Memoized QrCodeModal props ---

  const qrUsername = useMemo(() => profile?.username || '', [profile?.username]);
  const qrFullName = useMemo(() => profile?.full_name || '', [profile?.full_name]);

  // --- Render ---

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={TOP_EDGES}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{' '}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6}>
              <QrCode size={24} color={COLORS.gray900} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6}>
              <Settings size={24} color={COLORS.gray900} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={TOP_EDGES}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Sticky Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {headerTitle}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.6}
            onPress={handleOpenQr}
          >
            <QrCode size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.6}
            onPress={handleNavigateSettings}
          >
            <Settings size={24} color={COLORS.gray900} />
          </TouchableOpacity>
        </View>
      </View>

      <QrCodeModal
        visible={qrVisible}
        onClose={handleCloseQr}
        username={qrUsername}
        fullName={qrFullName}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.piktag500}
          />
        }
      >
        {/* Profile section: username left, avatar right */}
        <View style={styles.profileRow}>
          <View style={styles.profileLeft}>
            <View style={styles.usernameRow}>
              <Text style={styles.usernameText}>
                {displayUsername}
              </Text>
              {profile?.is_verified && (
                <CheckCircle2
                  size={18}
                  color={COLORS.blue500}
                  fill={COLORS.blue500}
                  strokeWidth={0}
                  style={styles.verifiedIcon}
                />
              )}
            </View>
          </View>
          <Image
            source={avatarSource}
            style={styles.avatar}
          />
        </View>

        {/* Bio */}
        <Text style={styles.bio}>
          {displayBio}
        </Text>

        {/* Tags */}
        <View style={styles.tagsRow}>
          {userTags.length > 0 ? (
            userTags.map((ut, index) => (
              <TagItem
                key={ut.id}
                userTag={ut}
                isPrimary={index === 0}
                fallbackLabel={t('profile.tagFallback')}
              />
            ))
          ) : (
            <Text style={styles.emptyText}>{t('profile.noTags')}</Text>
          )}
        </View>

        {/* Friend count */}
        <Text style={styles.friendCount}>
          {formattedFollowerCount}{t('profile.friendCountSuffix')}
        </Text>

        {/* Two action buttons side by side */}
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={styles.shareButton}
            activeOpacity={0.7}
            onPress={handleOpenQr}
          >
            <Text style={styles.shareButtonText}>{t('profile.shareProfile')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.editButton}
            activeOpacity={0.7}
            onPress={handleNavigateEditProfile}
          >
            <Text style={styles.editButtonText}>{t('profile.editProfile')}</Text>
          </TouchableOpacity>
        </View>

        {/* Manage Tags Button */}
        <TouchableOpacity
          style={styles.manageTagsButton}
          activeOpacity={0.7}
          onPress={handleNavigateManageTags}
        >
          <Tag size={18} color={COLORS.piktag600} />
          <Text style={styles.manageTagsText}>{t('profile.manageTags')}</Text>
        </TouchableOpacity>

        {/* Contact buttons */}
        <View style={styles.contactSection}>
          {profile?.phone ? (
            <TouchableOpacity
              style={styles.contactButton}
              activeOpacity={0.7}
              onPress={handleCallPhone}
            >
              <Phone size={20} color={COLORS.gray900} />
              <Text style={styles.contactButtonText}>{t('common.phone')}</Text>
            </TouchableOpacity>
          ) : null}

          {user?.email ? (
            <TouchableOpacity
              style={styles.contactButton}
              activeOpacity={0.7}
              onPress={handleSendEmail}
            >
              <Mail size={20} color={COLORS.gray900} />
              <Text style={styles.contactButtonText}>{t('common.email')}</Text>
            </TouchableOpacity>
          ) : null}

          {activeBiolinks.map((bl) => (
            <BiolinkItem
              key={bl.id}
              biolink={bl}
              onPress={handleOpenBiolink}
            />
          ))}

          {hasNoContactMethods && (
            <Text style={styles.emptyText}>{t('profile.noContactMethods')}</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Stable array reference for SafeAreaView edges prop
const TOP_EDGES = ['top'] as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
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
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  profileLeft: {
    flex: 1,
    marginRight: 16,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  usernameText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    lineHeight: 22,
  },
  verifiedIcon: {
    marginLeft: 6,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray100,
  },
  bio: {
    fontSize: 14,
    color: COLORS.gray700,
    lineHeight: 22,
    marginBottom: 12,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    columnGap: 12,
    rowGap: 4,
    marginBottom: 12,
  },
  tag: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagPrimary: {
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  tagSecondary: {
    color: COLORS.gray500,
  },
  friendCount: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 20,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  shareButton: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  editButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  contactSection: {
    gap: 12,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.gray100,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 10,
  },
  contactButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  biolinkIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: COLORS.gray100,
  },
  manageTagsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 20,
  },
  manageTagsText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
});
