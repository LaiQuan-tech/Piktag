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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  CheckCircle2,
  MessageCircle,
  Link as LinkIcon,
  ExternalLink,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { PiktagProfile, Biolink } from '../types';

type UserDetailScreenProps = {
  navigation: any;
  route: any;
};

export default function UserDetailScreen({ navigation, route }: UserDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  const userId = route.params?.userId;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [mutualFriends, setMutualFriends] = useState(0);
  const [mutualTags, setMutualTags] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!authUser || !userId) return;

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

      // Calculate mutual tags
      const { data: myUserTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', authUser.id);

      const { data: theirUserTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', userId);

      if (myUserTags && theirUserTags) {
        const myTagIds = new Set(myUserTags.map((t: any) => t.tag_id));
        const mutualTagCount = theirUserTags.filter((t: any) => myTagIds.has(t.tag_id)).length;
        setMutualTags(mutualTagCount);
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    } finally {
      setLoading(false);
    }
  }, [authUser, userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleToggleFollow = async () => {
    if (!authUser || !userId || followLoading) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        const { error } = await supabase
          .from('piktag_follows')
          .delete()
          .eq('follower_id', authUser.id)
          .eq('following_id', userId);

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
            following_id: userId,
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

  const handleMessage = () => {
    if (!profile) return;
    navigation.navigate('LikesTab', {
      screen: 'ChatDetail',
      params: {
        friendId: userId,
        friendName: profile.full_name || profile.username || 'Unknown',
      },
    });
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
            onPress={() => navigation.goBack()}
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
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>Not Found</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.emptyText}>找不到此用戶</Text>
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

          {/* Tags */}
          {tags.length > 0 && (
            <View style={styles.tagsRow}>
              {tags.map((tag, index) => (
                <Text
                  key={index}
                  style={[
                    styles.tag,
                    index === 0 ? styles.tagPrimary : styles.tagSecondary,
                  ]}
                >
                  {tag}
                </Text>
              ))}
            </View>
          )}

          {/* Mutual Info */}
          <View style={styles.mutualRow}>
            <Text style={styles.mutualText}>
              共同朋友 {mutualFriends} 位
            </Text>
            <Text style={styles.mutualDot}>{'  '}|{'  '}</Text>
            <Text style={styles.mutualText}>
              共同標籤 {mutualTags} 個
            </Text>
          </View>
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
                {isFollowing ? '已追蹤' : '追蹤'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.messageButton}
            onPress={handleMessage}
            activeOpacity={0.8}
          >
            <MessageCircle size={20} color={COLORS.piktag500} />
            <Text style={styles.messageButtonText}>傳訊息</Text>
          </TouchableOpacity>
        </View>

        {/* Biolinks Section */}
        {biolinks.length > 0 && (
          <View style={styles.biolinksSection}>
            <Text style={styles.sectionTitle}>社交連結</Text>
            {biolinks.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.biolinkItem}
                onPress={() => handleOpenLink(link.url)}
                activeOpacity={0.7}
              >
                <LinkIcon size={20} color={COLORS.gray500} />
                <View style={styles.biolinkInfo}>
                  <Text style={styles.biolinkTitle}>{link.label || link.platform}</Text>
                  <Text style={styles.biolinkUrl} numberOfLines={1}>
                    {link.url}
                  </Text>
                </View>
                <ExternalLink size={18} color={COLORS.gray400} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* All Tags Section */}
        {tags.length > 0 && (
          <View style={styles.allTagsSection}>
            <Text style={styles.sectionTitle}>所有標籤</Text>
            <View style={styles.allTagsGrid}>
              {tags.map((tag, index) => (
                <View key={index} style={styles.allTagChip}>
                  <Text style={styles.allTagChipText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
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
  mutualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  mutualText: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
  mutualDot: {
    fontSize: 14,
    color: COLORS.gray400,
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
  messageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  messageButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  biolinksSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 14,
  },
  biolinkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    gap: 12,
  },
  biolinkInfo: {
    flex: 1,
  },
  biolinkTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  biolinkUrl: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  allTagsSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  allTagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  allTagChip: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  allTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
});
