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
  Modal,
  Share,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  CheckCircle2,
  Link as LinkIcon,
  ExternalLink,
  Share2,
  MoreHorizontal,
  Heart,
  X,
  AlertTriangle,
  UserPlus,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import PlatformIcon from '../components/PlatformIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { PiktagProfile, Biolink } from '../types';
import { getViewerRelation, filterBiolinksByVisibility } from '../lib/biolinkVisibility';

type UserDetailScreenProps = {
  navigation: any;
  route: any;
};

export default function UserDetailScreen({ navigation, route }: UserDetailScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  const paramUserId = route.params?.userId;
  const paramUsername = route.params?.username;
  const paramSid = route.params?.sid; // Session ID from QR code scan

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
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);
  const [mutualTagModalVisible, setMutualTagModalVisible] = useState(false);
  const [isCloseFriend, setIsCloseFriend] = useState(false);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [similarUsers, setSimilarUsers] = useState<PiktagProfile[]>([]);
  const [showSimilar, setShowSimilar] = useState(false);
  const [similarMutualFriends, setSimilarMutualFriends] = useState<Map<string, any[]>>(new Map());

  // Pick Tag Modal
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [pickTagModalVisible, setPickTagModalVisible] = useState(false);
  const [friendPublicTags, setFriendPublicTags] = useState<{ id: string; name: string }[]>([]);
  const [pickedTagIds, setPickedTagIds] = useState<Set<string>>(new Set());
  const [pickTagLoading, setPickTagLoading] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);

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

      // Fetch user's tags + my tags for mutual check + pick count for sorting
      const [userTagsResult, myTagsResult] = await Promise.all([
        supabase.from('piktag_user_tags').select('*, tag:piktag_tags!tag_id(*)').eq('user_id', userId).eq('is_private', false),
        supabase.from('piktag_user_tags').select('tag_id').eq('user_id', authUser.id).eq('is_private', false),
      ]);

      if (userTagsResult.data && userTagsResult.data.length > 0) {
        const myTagIds = new Set((myTagsResult.data || []).map((t: any) => t.tag_id));

        // Get pick counts — how many connections tagged this user with each tag
        const { data: allConnsToUser } = await supabase.from('piktag_connections').select('id').eq('connected_user_id', userId);
        const connIds = (allConnsToUser || []).map((c: any) => c.id);
        const pickCountMap = new Map<string, number>();
        if (connIds.length > 0) {
          const { data: allPicks } = await supabase.from('piktag_connection_tags').select('tag_id').in('connection_id', connIds).eq('is_private', false);
          (allPicks || []).forEach((p: any) => pickCountMap.set(p.tag_id, (pickCountMap.get(p.tag_id) || 0) + 1));
        }

        // Sort: isPinned → pickCount → mutual → position (no isPicked for strangers)
        const sorted = userTagsResult.data
          .filter((ut: any) => ut.tag?.name)
          .sort((a: any, b: any) => {
            const aPinned = a.is_pinned ? 1 : 0;
            const bPinned = b.is_pinned ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            const aPick = pickCountMap.get(a.tag_id) || 0;
            const bPick = pickCountMap.get(b.tag_id) || 0;
            if (aPick !== bPick) return bPick - aPick;
            const aIsMutual = myTagIds.has(a.tag_id) ? 1 : 0;
            const bIsMutual = myTagIds.has(b.tag_id) ? 1 : 0;
            if (aIsMutual !== bIsMutual) return bIsMutual - aIsMutual;
            return (a.position || 0) - (b.position || 0);
          });

        setTags(sorted.map((ut: any) => `#${ut.tag.name}`));
      }

      // Fetch biolinks
      const { data: biolinksData } = await supabase
        .from('piktag_biolinks')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('position', { ascending: true });
      if (biolinksData) {
        // Filter biolinks by viewer's relationship
        const relation = await getViewerRelation(authUser?.id, userId);
        setBiolinks(filterBiolinksByVisibility(biolinksData, relation));
      }

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

      // Fetch follower count + check existing connection
      const [followerResult, connResult] = await Promise.all([
        supabase.from('piktag_follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
        supabase.from('piktag_connections').select('id').eq('user_id', authUser.id).eq('connected_user_id', userId).single(),
      ]);
      setFollowerCount(followerResult.count ?? 0);
      if (connResult.data) setConnectionId(connResult.data.id);

      // Check close friend
      const { data: cfData } = await supabase
        .from('piktag_close_friends')
        .select('id')
        .eq('user_id', authUser.id)
        .eq('close_friend_id', userId)
        .maybeSingle();
      setIsCloseFriend(!!cfData);

      // Fetch similar users (share same tags, exclude self + this user)
      if (theirUserTags && theirUserTags.length > 0) {
        const theirTagIds = theirUserTags.map((t: any) => t.tag_id);
        const { data: sharedTagUsers } = await supabase
          .from('piktag_user_tags')
          .select('user_id')
          .in('tag_id', theirTagIds)
          .eq('is_private', false);
        if (sharedTagUsers) {
          const userIds = [...new Set(sharedTagUsers.map((u: any) => u.user_id))]
            .filter(id => id !== userId && id !== authUser.id)
            .slice(0, 10);
          if (userIds.length > 0) {
            const { data: profiles } = await supabase
              .from('piktag_profiles')
              .select('id, username, full_name, avatar_url, is_verified')
              .in('id', userIds)
              .eq('is_public', true)
              .limit(6);
            if (profiles) {
              setSimilarUsers(profiles);
              // Fetch mutual friends for each similar user
              const myConns = await supabase.from('piktag_connections').select('connected_user_id').eq('user_id', authUser.id);
              if (myConns.data) {
                const myFriendIds = new Set(myConns.data.map((c: any) => c.connected_user_id));
                const mutualMap = new Map<string, any[]>();
                for (const p of profiles) {
                  const { data: theirConns } = await supabase
                    .from('piktag_connections')
                    .select('connected_user_id, connected_user:piktag_profiles!connected_user_id(id, avatar_url, full_name)')
                    .eq('user_id', p.id)
                    .limit(50);
                  if (theirConns) {
                    const mutuals = theirConns.filter((c: any) => myFriendIds.has(c.connected_user_id)).map((c: any) => c.connected_user).slice(0, 3);
                    if (mutuals.length > 0) mutualMap.set(p.id, mutuals);
                  }
                }
                setSimilarMutualFriends(mutualMap);
              }
            }
          }
        }
      }
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

  // --- QR Code add friend (when sid param is present) ---
  const handleAddFriendFromQr = useCallback(async () => {
    if (!authUser || !resolvedUserId || !paramSid) return;
    if (connectionId) { Alert.alert(t('scanResult.alreadyConnectedTitle')); return; }
    setAddFriendLoading(true);
    try {
      // Fetch session to get event_tags
      const { data: session } = await supabase
        .from('piktag_scan_sessions')
        .select('event_tags, event_date, event_location')
        .eq('id', paramSid)
        .single();

      const eventTags: string[] = session?.event_tags || [];
      const note = [session?.event_date, session?.event_location].filter(Boolean).join(' · ');

      // Create connection (scanner → host)
      const { data: conn } = await supabase
        .from('piktag_connections')
        .insert({ user_id: authUser.id, connected_user_id: resolvedUserId, met_at: new Date().toISOString(), met_location: session?.event_location || '', note, scan_session_id: paramSid || null })
        .select('id').single();

      // Create reverse connection (host → scanner)
      const { data: reverseConn } = await supabase
        .from('piktag_connections')
        .upsert({ user_id: resolvedUserId, connected_user_id: authUser.id, met_at: new Date().toISOString(), met_location: session?.event_location || '', note },
          { onConflict: 'user_id,connected_user_id' })
        .select('id').single();

      // Save event_tags as private connection tags (both sides)
      if (eventTags.length > 0) {
        const tagIds: string[] = [];
        for (const tagName of eventTags) {
          const raw = tagName.startsWith('#') ? tagName.slice(1) : tagName;
          let { data: tag } = await supabase.from('piktag_tags').select('id').eq('name', raw).maybeSingle();
          if (!tag) { const { data: nt } = await supabase.from('piktag_tags').insert({ name: raw }).select('id').single(); tag = nt; }
          if (tag) tagIds.push(tag.id);
        }
        if (conn && tagIds.length > 0) {
          await supabase.from('piktag_connection_tags').insert(
            tagIds.map(tid => ({ connection_id: conn.id, tag_id: tid, is_private: true }))
          );
        }
        if (reverseConn && tagIds.length > 0) {
          await supabase.from('piktag_connection_tags').insert(
            tagIds.map(tid => ({ connection_id: reverseConn.id, tag_id: tid, is_private: true }))
          );
        }
      }

      // Increment scan count
      await supabase.rpc('increment_scan_count', { session_id: paramSid });

      if (conn) setConnectionId(conn.id);
      Alert.alert(t('scanResult.alertSuccessTitle'), t('scanResult.alertSuccessMessage', { name: profile?.full_name || '' }));
    } catch (err) {
      console.error('Error adding friend from QR:', err);
      Alert.alert(t('common.error'), t('scanResult.alertAddFriendError'));
    }
    setAddFriendLoading(false);
  }, [authUser, resolvedUserId, paramSid, connectionId, profile, t]);

  // --- Pick Tag functions ---
  const fetchFriendPublicTags = useCallback(async (): Promise<{ id: string; name: string }[]> => {
    if (!resolvedUserId) return [];
    const { data } = await supabase
      .from('piktag_user_tags')
      .select('tag_id, piktag_tags!inner(id, name)')
      .eq('user_id', resolvedUserId)
      .eq('is_private', false);
    if (data) {
      const tags = data.map((ut: any) => ({ id: ut.piktag_tags?.id, name: ut.piktag_tags?.name })).filter((t: any) => t.id && t.name);
      setFriendPublicTags(tags);
      return tags;
    }
    return [];
  }, [resolvedUserId]);

  const loadPickedTags = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase.from('piktag_connection_tags').select('tag_id').eq('connection_id', connectionId).eq('is_private', false);
    if (data) setPickedTagIds(new Set(data.map((ct: any) => ct.tag_id)));
  }, [connectionId]);

  const openPickTagModal = useCallback(async () => {
    await fetchFriendPublicTags();
    if (connectionId) await loadPickedTags();
    setPickTagModalVisible(true);
  }, [fetchFriendPublicTags, loadPickedTags, connectionId]);

  const togglePickTag = (tagId: string) => {
    setPickedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const handleSavePickedTags = async () => {
    if (!connectionId || !authUser) return;
    setPickTagLoading(true);
    try {
      await supabase.from('piktag_connection_tags').delete().eq('connection_id', connectionId).eq('is_private', false);
      if (pickedTagIds.size > 0) {
        const rows = Array.from(pickedTagIds).map(tagId => ({ connection_id: connectionId, tag_id: tagId, is_private: false }));
        await supabase.from('piktag_connection_tags').insert(rows);
      }
      setPickTagModalVisible(false);
    } catch (err) {
      console.error('Save picked tags error:', err);
    } finally {
      setPickTagLoading(false);
    }
  };

  const handleConfirmUnfollow = async () => {
    if (!authUser || !resolvedUserId) return;
    setUnfollowModalVisible(false);
    await supabase.from('piktag_follows').delete().eq('follower_id', authUser.id).eq('following_id', resolvedUserId);
    setIsFollowing(false);
  };

  const reportUser = async (reason: string) => {
    if (!authUser || !resolvedUserId) return;
    await supabase.from('piktag_reports').insert({
      reporter_id: authUser.id,
      reported_id: resolvedUserId,
      reason,
    });
    Alert.alert(t('userDetail.reportedTitle') || '已檢舉', t('userDetail.reportedMessage') || '感謝你的回報，我們會盡快處理');
  };

  const handleToggleCloseFriend = async () => {
    if (!authUser || !resolvedUserId) return;
    if (isCloseFriend) {
      await supabase.from('piktag_close_friends').delete()
        .eq('user_id', authUser.id).eq('close_friend_id', resolvedUserId);
      setIsCloseFriend(false);
    } else {
      await supabase.from('piktag_close_friends')
        .upsert({ user_id: authUser.id, close_friend_id: resolvedUserId }, { onConflict: 'user_id,close_friend_id' });
      setIsCloseFriend(true);
    }
  };

  const handleToggleFollow = async () => {
    if (!authUser || !resolvedUserId || followLoading) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        setFollowLoading(false);
        setUnfollowModalVisible(true);
        return;
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

        // Create connection if not exists
        let connId = connectionId;
        if (!connId) {
          const { data: newConn } = await supabase
            .from('piktag_connections')
            .insert({ user_id: authUser.id, connected_user_id: resolvedUserId, met_at: new Date().toISOString() })
            .select('id')
            .single();
          if (newConn) {
            connId = newConn.id;
            setConnectionId(connId);
          }
        }

        // Show Pick Tag modal if friend has public tags
        const ftags = await fetchFriendPublicTags();
        if (ftags.length > 0) {
          setPickTagModalVisible(true);
        }
      }
    } catch (err) {
      console.error('Unexpected error toggling follow:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleOpenLink = (url: string) => {
    Linking.openURL(url);
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections") : navigation.navigate('Connections')}
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
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections") : navigation.navigate('Connections')}
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
  const headline = profile.headline || '';
  const bio = profile.bio || '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerUsername}>@{username}</Text>
        <TouchableOpacity
          style={styles.headerMoreBtn}
          onPress={() => setMoreMenuVisible(true)}
          activeOpacity={0.6}
        >
          <MoreHorizontal size={24} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <View style={styles.profileRow}>
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{displayName}</Text>
                {/* {verified && (
                  <CheckCircle2
                    size={16}
                    color={COLORS.blue500}
                    fill={COLORS.blue500}
                    strokeWidth={0}
                    style={styles.verifiedIcon}
                  />
                )} */}
              </View>
              <Text style={styles.usernameText}>@{username}</Text>
            </View>
          </View>

          {/* Headline */}
          {headline ? <Text style={styles.headline}>{headline}</Text> : null}

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

          {/* Stats — one line, mutual tags clickable */}
          <View style={styles.statsRow}>
            {mutualTags > 0 ? (
              <TouchableOpacity onPress={() => setMutualTagModalVisible(true)} activeOpacity={0.6}>
                <Text style={styles.statTextClickable}>
                  <Text style={[styles.statNumber, { color: COLORS.piktag600 }]}>{mutualTags}</Text>
                  <Text style={{ color: COLORS.piktag600 }}>{t('userDetail.statMutualTags')}</Text>
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{mutualTags}</Text>{t('userDetail.statMutualTags')}
              </Text>
            )}
            <Text style={styles.statDot}>·</Text>
            <Text style={styles.statText}>
              <Text style={styles.statNumber}>{mutualFriends}</Text>{t('userDetail.statMutualFriends')}
            </Text>
            <Text style={styles.statDot}>·</Text>
            <Text style={styles.statText}>
              <Text style={styles.statNumber}>{followerCount}</Text>{t('userDetail.statFollowers')}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.actionButtonsRow}>
            {isFollowing ? (
              <TouchableOpacity
                style={[styles.followButton, styles.followButtonFollowing]}
                onPress={handleToggleFollow}
                activeOpacity={0.8}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={COLORS.piktag600} />
                ) : (
                  <Text style={styles.followButtonTextFollowing}>
                    {t('userDetail.following')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleToggleFollow} activeOpacity={0.8} disabled={followLoading} style={{ flex: 1 }}>
                <LinearGradient
                  colors={['#ff5757', '#c44dff', '#8c52ff']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.followButton, { borderRadius: 14 }]}
                >
                  {followLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.followButtonTextDefault}>
                      {t('userDetail.follow')}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            )}
            {isFollowing && (
              <TouchableOpacity
                style={styles.tagButton}
                activeOpacity={0.7}
                onPress={openPickTagModal}
              >
                <Text style={styles.tagButtonText}>{t('userDetail.tagAction')}</Text>
              </TouchableOpacity>
            )}
            {/* Similar users trigger button */}
            <TouchableOpacity
              style={styles.suggestBtn}
              activeOpacity={0.7}
              onPress={() => setShowSimilar(!showSimilar)}
            >
              <UserPlus size={20} color={showSimilar ? COLORS.piktag500 : COLORS.gray500} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Similar Users — IG style "Suggested for you" */}
        {showSimilar && similarUsers.length > 0 && (
          <View style={styles.similarSection}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
              <Text style={styles.similarTitle}>{t('userDetail.similarUsersTitle') || '為你推薦'}</Text>
              <TouchableOpacity onPress={() => setShowSimilar(false)} activeOpacity={0.6}>
                <X size={18} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarScroll}>
              {similarUsers.map((u) => {
                const mutuals = similarMutualFriends.get(u.id) || [];
                return (
                  <View key={u.id} style={styles.similarCard}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => navigation.push('UserDetail', { userId: u.id })}
                    >
                      {u.avatar_url ? (
                        <Image source={{ uri: u.avatar_url }} style={styles.similarAvatar} />
                      ) : (
                        <View style={[styles.similarAvatar, styles.similarAvatarFallback]}>
                          <Text style={styles.similarAvatarInitial}>
                            {(u.full_name || u.username || '?').charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.similarName} numberOfLines={1}>{u.full_name || u.username}</Text>
                    </TouchableOpacity>
                    {/* Mutual friends avatars */}
                    {mutuals.length > 0 && (
                      <View style={styles.mutualAvatarsRow}>
                        {mutuals.map((m: any, i: number) => (
                          <Image
                            key={m.id}
                            source={{ uri: m.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.full_name || '?')}&size=40` }}
                            style={[styles.mutualMiniAvatar, { marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }]}
                          />
                        ))}
                        <Text style={styles.mutualCountText}>{mutuals.length} 共同好友</Text>
                      </View>
                    )}
                    {/* Follow button */}
                    <TouchableOpacity
                      style={styles.similarFollowBtn}
                      activeOpacity={0.8}
                      onPress={async () => {
                        try {
                          await supabase.from('piktag_follows').insert({ follower_id: user?.id, following_id: u.id });
                          setSimilarUsers(prev => prev.filter(s => s.id !== u.id));
                        } catch {}
                      }}
                    >
                      <LinearGradient
                        colors={['#ff5757', '#c44dff', '#8c52ff']}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.similarFollowGradient}
                      >
                        <Text style={styles.similarFollowText}>{t('userDetail.follow') || '追蹤'}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

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

      {/* Pick Tag Modal */}
      <Modal
        visible={pickTagModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPickTagModalVisible(false)}
      >
        <View style={styles.pickModalOverlay}>
          <View style={styles.pickModalContainer}>
            <View style={styles.pickModalHeader}>
              <Text style={styles.pickModalTitle}>{t('userDetail.pickTagTitle')}</Text>
              <TouchableOpacity onPress={() => setPickTagModalVisible(false)} activeOpacity={0.6}>
                <Text style={styles.pickModalCloseText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.pickModalSubtitle}>
              {t('userDetail.pickTagSubtitle', { name: profile?.full_name || profile?.username || '' })}
            </Text>
            {friendPublicTags.length === 0 ? (
              <Text style={styles.pickModalEmpty}>{t('userDetail.pickTagEmpty')}</Text>
            ) : (
              <View style={styles.pickModalTagsWrap}>
                {friendPublicTags.map((tag) => {
                  const isSelected = pickedTagIds.has(tag.id);
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[styles.pickModalTag, isSelected && styles.pickModalTagSelected]}
                      onPress={() => togglePickTag(tag.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickModalTagText, isSelected && styles.pickModalTagTextSelected]}>
                        #{tag.name}
                      </Text>
                      {isSelected && <Text style={styles.pickModalCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <TouchableOpacity
              style={[styles.pickModalSaveBtn, pickTagLoading && { opacity: 0.7 }]}
              onPress={handleSavePickedTags}
              disabled={pickTagLoading}
              activeOpacity={0.8}
            >
              {pickTagLoading ? (
                <ActivityIndicator size="small" color={COLORS.gray900} />
              ) : (
                <Text style={styles.pickModalSaveText}>
                  {t('userDetail.pickTagSave', { count: pickedTagIds.size })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Mutual Tags Modal */}
      <Modal
        visible={mutualTagModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMutualTagModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.mutualModalOverlay}
          activeOpacity={1}
          onPress={() => setMutualTagModalVisible(false)}
        >
          <View style={styles.mutualModalContainer}>
            <Text style={styles.mutualModalTitle}>{t('userDetail.mutualTagsModalTitle')}</Text>
            <View style={styles.mutualModalTagsWrap}>
              {mutualTagList.map((tag) => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.mutualModalTag}
                  activeOpacity={0.7}
                  onPress={() => {
                    setMutualTagModalVisible(false);
                    navigation.navigate('TagDetail', { tagId: tag.id, tagName: tag.name, initialTab: 'explore' });
                  }}
                >
                  <Text style={styles.mutualModalTagText}>#{tag.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Unfollow Confirm Modal */}
      <Modal
        visible={unfollowModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setUnfollowModalVisible(false)}
      >
        <View style={styles.unfollowModalOverlay}>
          <View style={styles.unfollowModalContainer}>
            <Text style={styles.unfollowModalTitle}>{t('userDetail.unfollowTitle')}</Text>
            <Text style={styles.unfollowModalMessage}>
              {t('userDetail.unfollowMessage', { name: profile?.full_name || profile?.username || '' })}
            </Text>
            <View style={styles.unfollowModalButtons}>
              <TouchableOpacity
                style={styles.unfollowModalCancelBtn}
                onPress={() => setUnfollowModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.unfollowModalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.unfollowModalConfirmBtn}
                onPress={handleConfirmUnfollow}
                activeOpacity={0.7}
              >
                <Text style={styles.unfollowModalConfirmText}>{t('userDetail.unfollowConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* More Menu Modal */}
      <Modal visible={moreMenuVisible} transparent animationType="fade" onRequestClose={() => setMoreMenuVisible(false)}>
        <TouchableOpacity style={styles.moreOverlay} activeOpacity={1} onPress={() => setMoreMenuVisible(false)}>
          <View style={[styles.moreSheet, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setMoreMenuVisible(false);
                handleToggleCloseFriend();
              }}
            >
              <Heart size={20} color={isCloseFriend ? COLORS.piktag600 : COLORS.gray600} fill={isCloseFriend ? COLORS.piktag600 : 'transparent'} />
              <Text style={[styles.moreItemText, isCloseFriend && { color: COLORS.piktag600 }]}>
                {isCloseFriend ? (t('userDetail.closeFriendRemove') || '已設為摯友') : (t('userDetail.closeFriendAdd') || '設為摯友')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                const profileUrl = `https://pikt.ag/${username}`;
                try {
                  await Share.share({
                    message: Platform.OS === 'ios'
                      ? `${displayName} (@${username}) on #piktag`
                      : `${displayName} (@${username}) on #piktag\n${profileUrl}`,
                    url: Platform.OS === 'ios' ? profileUrl : undefined,
                  });
                } catch {}
              }}
            >
              <Share2 size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('userDetail.shareProfile') || '分享'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                if (!authUser || !resolvedUserId) return;
                await supabase.from('piktag_blocks')
                  .upsert({ blocker_id: authUser.id, blocked_id: resolvedUserId }, { onConflict: 'blocker_id,blocked_id' });
                Alert.alert(t('userDetail.blockedTitle') || '已封鎖', t('userDetail.blockedMessage') || '你將不再看到此用戶');
                navigation.goBack();
              }}
            >
              <X size={20} color="#EF4444" />
              <Text style={[styles.moreItemText, { color: '#EF4444' }]}>{t('userDetail.blockUser') || '封鎖'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setMoreMenuVisible(false);
                Alert.alert(
                  t('userDetail.reportTitle') || '檢舉用戶',
                  t('userDetail.reportMessage') || '請選擇檢舉原因',
                  [
                    { text: t('userDetail.reportSpam') || '垃圾訊息', onPress: () => reportUser('spam') },
                    { text: t('userDetail.reportHarassment') || '騷擾', onPress: () => reportUser('harassment') },
                    { text: t('userDetail.reportFake') || '假帳號', onPress: () => reportUser('fake_account') },
                    { text: t('common.cancel') || '取消', style: 'cancel' },
                  ]
                );
              }}
            >
              <AlertTriangle size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('userDetail.reportUser') || '檢舉'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreCancelBtn} onPress={() => setMoreMenuVisible(false)}>
              <Text style={styles.moreCancelText}>{t('common.cancel') || '取消'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    gap: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.gray100,
  },
  nameSection: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  usernameText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
    textAlign: 'center',
    marginTop: 6,
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
    gap: 16,
    marginTop: 14,
    marginBottom: 4,
  },
  statText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  statNumber: {
    fontWeight: '700',
    color: COLORS.gray900,
    marginRight: 2,
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
  qrAddFriendBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
  },
  qrAddFriendText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
  followButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonDefault: {
    backgroundColor: COLORS.piktag500,
  },
  followButtonFollowing: {
    backgroundColor: COLORS.piktag50,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
  },
  followButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  followButtonTextDefault: {
    color: '#FFFFFF',
  },
  followButtonTextFollowing: {
    color: COLORS.piktag600,
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

  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  tagButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMoreBtn: { padding: 4 },
  // More menu (bottom sheet style)
  moreOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  moreSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  moreItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray900,
  },
  moreCancelBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  moreCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  // Similar users section
  similarSection: {
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  suggestBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  similarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  similarScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  similarCard: {
    width: 150,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
  },
  similarAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.gray100,
  },
  similarAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  similarAvatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray500,
  },
  similarName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  mutualAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  mutualMiniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.white,
  },
  mutualCountText: {
    fontSize: 11,
    color: COLORS.gray500,
    marginLeft: 2,
  },
  similarFollowBtn: {
    width: '100%',
    marginTop: 8,
  },
  similarFollowGradient: {
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  similarFollowText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  tagButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },

  // Pick Tag Modal
  pickModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickModalContainer: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '75%',
  },
  pickModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pickModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  pickModalCloseText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  pickModalSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 20,
    lineHeight: 20,
  },
  pickModalEmpty: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 30,
  },
  pickModalTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  pickModalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.gray50,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
  },
  pickModalTagSelected: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  pickModalTagText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  pickModalTagTextSelected: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  pickModalCheck: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  pickModalSaveBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pickModalSaveText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },

  statTextClickable: {
    fontSize: 14,
  },
  statDot: {
    fontSize: 14,
    color: COLORS.gray400,
  },

  // Mutual Tags Modal
  mutualModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mutualModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: 300,
    maxWidth: '85%',
  },
  mutualModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
  },
  mutualModalTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  mutualModalTag: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.piktag500,
  },
  mutualModalTagText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
  },

  // Unfollow Modal
  unfollowModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unfollowModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: 300,
    maxWidth: '85%',
    alignItems: 'center',
  },
  unfollowModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 8,
  },
  unfollowModalMessage: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  unfollowModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  unfollowModalCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unfollowModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  unfollowModalConfirmBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unfollowModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
});
