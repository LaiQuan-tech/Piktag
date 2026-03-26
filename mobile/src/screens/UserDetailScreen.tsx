import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  CheckCircle2,
  Link as LinkIcon,
  ExternalLink,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import PlatformIcon from '../components/PlatformIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { PiktagProfile, Biolink } from '../types';

type UserDetailScreenProps = {
  navigation: any;
  route: any;
};

export default function UserDetailScreen({ navigation, route }: UserDetailScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  const paramUserId = route.params?.userId;
  const paramUsername = route.params?.username;

  const [resolvedUserId, setResolvedUserId] = useState<string | null>(paramUserId || null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [mutualFriends, setMutualFriends] = useState(0);
  const [mutualTags, setMutualTags] = useState(0);
  const [mutualTagList, setMutualTagList] = useState<{ id: string; name: string }[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!authUser) return;

    // Resolve userId: either passed directly or looked up from username
    let userId = resolvedUserId;
    if (!userId && paramUsername) {
      const { data: lookupData } = await supabase
        .from('piktag_profiles')
        .select('id')
        .eq('username', paramUsername)
        .single();
      if (lookupData) {
        userId = lookupData.id;
        setResolvedUserId(userId);
      } else {
        setLoading(false);
        return;
      }
    }
    if (!userId) return;

    try {
      setLoading(true);

      // Fetch user profile
      const { data: profileData } = await supabase
        .from('piktag_profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (profileData) setProfile(profileData);

      // Check follow status
      const { data: followData } = await supabase
        .from('piktag_follows')
        .select('id')
        .eq('follower_id', authUser.id)
        .eq('following_id', userId)
        .maybeSingle();
      setIsFollowing(!!followData);

      // Fetch user's tags (exclude private tags from other users)
      const { data: userTagsData } = await supabase
        .from('piktag_user_tags')
        .select('*, tag:piktag_tags!tag_id(*)')
        .eq('user_id', userId)
        .eq('is_private', false)
        .order('position', { ascending: true });

      if (userTagsData && userTagsData.length > 0) {
        setTags(userTagsData.map((ut: any) => ut.tag?.name ? `#${ut.tag.name}` : '').filter(Boolean));
      }

      // Fetch biolinks
      const { data: biolinksData } = await supabase
        .from('piktag_biolinks')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('position', { ascending: true });
      if (biolinksData) setBiolinks(biolinksData);

      // Calculate mutual friends
      const { data: myConnections } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('user_id', authUser.id);

      const { data: theirConnections } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('user_id', userId);

      if (myConnections && theirConnections) {
        const myFriendIds = new Set(myConnections.map((c: any) => c.connected_user_id));
        const mutual = theirConnections.filter((c: any) => myFriendIds.has(c.connected_user_id));
        setMutualFriends(mutual.length);
      }

      // Calculate mutual tags (with names for clickable display)
      const { data: myUserTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id, piktag_tags!inner(id, name)')
        .eq('user_id', authUser.id);

      const { data: theirUserTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', userId)
        .eq('is_private', false);

      if (myUserTags && theirUserTags) {
        const myTagIds = new Set(myUserTags.map((t: any) => t.tag_id));
        const myTagMap = new Map(myUserTags.map((t: any) => [t.tag_id, { id: (t.piktag_tags as any)?.id, name: (t.piktag_tags as any)?.name }]));
        const mutualIds = theirUserTags.filter((t: any) => myTagIds.has(t.tag_id));
        setMutualTags(mutualIds.length);
        setMutualTagList(mutualIds.map((t: any) => myTagMap.get(t.tag_id)).filter(Boolean) as { id: string; name: string }[]);
      }

      // Fetch follower count
      const { count: fCount } = await supabase
        .from('piktag_follows')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', userId);
      setFollowerCount(fCount ?? 0);
    } catch (err) {
      console.error('Error fetching user data:', err);
    } finally {
      setLoading(false);
    }
  }, [authUser, resolvedUserId, paramUsername]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleToggleFollow = async () => {
    if (!authUser || !resolvedUserId || followLoading) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        const { error } = await supabase
          .from('piktag_follows')
          .delete()
          .eq('follower_id', authUser.id)
          .eq('following_id', resolvedUserId);

        if (error) {
          console.error('Error unfollowing:', error);
          return;
        }
        setIsFollowing(false);
      } else {
        // Follow
        const { error } = await supabase
          .from('piktag_follows')
          .insert({
            follower_id: authUser.id,
            following_id: resolvedUserId,
          });

        if (error) {
          console.error('Error following:', error);
          return;
        }
        setIsFollowing(true);
      }
    } catch (err) {
      console.error('Unexpected error toggling follow:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleOpenLink = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>...</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>{t('userDetail.headerNotFound')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyText}>{t('userDetail.userNotFound')}</Text>
        </View>
      </View>
    );
  }

  const displayName = profile.full_name || profile.username || 'Unknown';
  const username = profile.username || '';
  const verified = profile.is_verified || false;
  const avatarUri = profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f3f4f6&color=6b7280`;
  const bio = profile.bio || '';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerUsername}>@{username}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <View style={styles.profileRow}>
            <View style={styles.profileTextCol}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{displayName}</Text>
                {verified && (
                  <CheckCircle2
                    size={20}
                    color={COLORS.blue500}
                    fill={COLORS.blue500}
                    strokeWidth={0}
                    style={styles.verifiedIcon}
                  />
                )}
              </View>
              <Text style={styles.usernameText}>@{username}</Text>
            </View>
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          </View>

          {/* Bio */}
          {bio ? <Text style={styles.bio}>{bio}</Text> : null}

          {/* Tags — flat inline clickable chips */}
          {tags.length > 0 && (
            <View style={styles.tagsWrap}>
              {tags.map((tag, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => {
                    // Navigate to tag detail - need to find tag id first
                    navigation.navigate('TagDetail', { tagName: tag.replace('#', ''), initialTab: 'explore' });
                  }}
                >
                  <Text style={styles.tagChipText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Stats: 共同標籤 | 共同好友 | 追蹤者 */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, mutualTags > 0 && { color: COLORS.piktag600 }]}>{mutualTags}</Text>
              <Text style={styles.statLabel}>{t('userDetail.statMutualTags')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{mutualFriends}</Text>
              <Text style={styles.statLabel}>{t('userDetail.statMutualFriends')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{followerCount}</Text>
              <Text style={styles.statLabel}>{t('userDetail.statFollowers')}</Text>
            </View>
          </View>

          {/* Clickable mutual tags */}
          {mutualTagList.length > 0 && (
            <View style={styles.mutualTagsRow}>
              {mutualTagList.map((tag) => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.mutualTagChip}
                  onPress={() => navigation.navigate('TagDetail', { tagId: tag.id, tagName: tag.name, initialTab: 'explore' })}
                  activeOpacity={0.7}
                >
                  <Text style={styles.mutualTagChipText}>#{tag.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsSection}>
          <TouchableOpacity
            style={[
              styles.followButton,
              isFollowing ? styles.followButtonFollowing : styles.followButtonDefault,
            ]}
            onPress={handleToggleFollow}
            activeOpacity={0.8}
            disabled={followLoading}
          >
            {followLoading ? (
              <ActivityIndicator size="small" color={isFollowing ? COLORS.gray700 : COLORS.gray900} />
            ) : (
              <Text
                style={[
                  styles.followButtonText,
                  isFollowing
                    ? styles.followButtonTextFollowing
                    : styles.followButtonTextDefault,
                ]}
              >
                {isFollowing ? t('userDetail.following') : t('userDetail.follow')}
              </Text>
            )}
          </TouchableOpacity>

        </View>

        {/* Social Links — IG Highlights style circles */}
        {biolinks.length > 0 && (
          <View style={styles.socialSection}>
            <Text style={styles.sectionTitle}>{t('userDetail.socialLinksTitle')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.socialScrollContent}>
              {biolinks.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.socialCircleItem}
                  onPress={() => handleOpenLink(link.url)}
                  activeOpacity={0.7}
                >
                  <View style={styles.socialCircleRing}>
                    <View style={styles.socialCircleInner}>
                      <PlatformIcon platform={link.platform} size={28} />
                    </View>
                  </View>
                  <Text style={styles.socialCircleLabel} numberOfLines={1}>
                    {link.label || link.platform}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Link Bio — Linktree style cards */}
        {biolinks.length > 0 && (
          <View style={styles.linkBioSection}>
            <Text style={styles.sectionTitle}>{t('userDetail.linkBioTitle')}</Text>
            {biolinks.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.linkCard}
                onPress={() => handleOpenLink(link.url)}
                activeOpacity={0.7}
              >
                <PlatformIcon platform={link.platform} size={22} />
                <Text style={styles.linkCardText} numberOfLines={1}>
                  {link.label || link.platform}
                </Text>
                <ExternalLink size={16} color={COLORS.gray400} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* All Tags Section removed — tags now shown inline in profile section */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerBackBtn: {
    padding: 4,
  },
  headerUsername: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray500,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileTextCol: {
    flex: 1,
    marginRight: 16,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  verifiedIcon: {
    marginLeft: 8,
  },
  usernameText: {
    fontSize: 15,
    color: COLORS.gray500,
    marginTop: 4,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  bio: {
    fontSize: 15,
    color: COLORS.gray700,
    lineHeight: 22,
    marginTop: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 4,
    columnGap: 12,
    rowGap: 4,
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 4,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray500,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.gray200,
  },
  mutualTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  mutualTagChip: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.piktag300,
  },
  mutualTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  actionsSection: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 24,
    gap: 12,
  },
  followButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonDefault: {
    backgroundColor: COLORS.piktag500,
  },
  followButtonFollowing: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray200,
  },
  followButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  followButtonTextDefault: {
    color: COLORS.gray900,
  },
  followButtonTextFollowing: {
    color: COLORS.gray700,
  },
  // Tags — flat inline clickable (matching ProfileScreen)
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
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

  // Social Circles (IG Highlights style)
  socialSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
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

  // Link Bio (Linktree style)
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
});
