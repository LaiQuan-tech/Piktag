import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Hash, CheckCircle2, Users, UserPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import InitialsAvatar from '../components/InitialsAvatar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type TagDetailScreenProps = {
  navigation: any;
  route: any;
};

type ConnectionWithProfile = {
  id: string;
  connected_user_id: string;
  nickname: string | null;
  note: string | null;
  met_at: string | null;
  met_location: string | null;
  connected_user: {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
    is_verified: boolean;
  } | null;
};

type ExploreUser = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  mutual_tag_count: number;
};

type TabKey = 'connections' | 'explore';

export default function TagDetailScreen({ navigation, route }: TagDetailScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const paramTagId = route.params?.tagId;
  const tagName = route.params?.tagName;
  const initialTab = route.params?.initialTab as TabKey | undefined;

  const [resolvedTagId, setResolvedTagId] = useState<string | null>(paramTagId || null);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || 'explore');
  const [connections, setConnections] = useState<ConnectionWithProfile[]>([]);
  const [exploreUsers, setExploreUsers] = useState<ExploreUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [usageCount, setUsageCount] = useState(0);
  const [totalUserCount, setTotalUserCount] = useState(0);
  const [tagSemanticType, setTagSemanticType] = useState<string | null>(null);
  const [parentTagName, setParentTagName] = useState<string | null>(null);
  const [relatedTags, setRelatedTags] = useState<{ id: string; name: string; usage_count: number }[]>([]);

  // Resolve tagId from tagName if not provided
  useEffect(() => {
    if (paramTagId) { setResolvedTagId(paramTagId); return; }
    if (!tagName) return;
    const resolve = async () => {
      const { data } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', tagName)
        .single();
      if (data) setResolvedTagId(data.id);
      else setLoading(false); // tag not found
    };
    resolve();
  }, [paramTagId, tagName]);

  const tagId = resolvedTagId;

  // --- Helper: get all sibling tag_ids sharing the same concept ---
  const getSiblingTagIds = useCallback(async (tid: string): Promise<string[]> => {
    // Get concept_id for this tag
    const { data: tagData } = await supabase
      .from('piktag_tags')
      .select('concept_id')
      .eq('id', tid)
      .single();

    if (!tagData?.concept_id) return [tid];

    // Get all tags with the same concept
    const { data: siblings } = await supabase
      .from('piktag_tags')
      .select('id')
      .eq('concept_id', tagData.concept_id);

    if (!siblings || siblings.length === 0) return [tid];
    return [...new Set([tid, ...siblings.map((s: any) => s.id)])];
  }, []);

  // --- Fetch connections with this tag (existing logic) ---
  const fetchTagConnections = useCallback(async () => {
    if (!user || !tagId) return;
    try {
      setLoading(true);

      // Get all sibling tag_ids (same concept)
      const allTagIds = await getSiblingTagIds(tagId);

      const { data, error } = await supabase
        .from('piktag_connection_tags')
        .select(`
          connection:piktag_connections!connection_id(
            id, connected_user_id, nickname, met_at, met_location,
            connected_user:piktag_profiles!connected_user_id(
              id, username, full_name, avatar_url, is_verified
            )
          )
        `)
        .in('tag_id', allTagIds)
        .limit(1000);

      if (error) {
        console.error('Error fetching tag connections:', error);
        setConnections([]);
        setUsageCount(0);
        return;
      }

      if (!data || data.length === 0) {
        setConnections([]);
        setUsageCount(0);
        return;
      }

      const allConnections = data
        .map((ct: any) => ct.connection)
        .filter((conn: any) => conn && conn.connected_user_id);

      setConnections(allConnections);
      setUsageCount(data.length);
    } catch (err) {
      console.error('Unexpected error:', err);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [user, tagId, getSiblingTagIds]);

  // --- Fetch all public users with this tag (NEW: explore) ---
  const fetchExploreUsers = useCallback(async () => {
    if (!user || !tagId) return;
    try {
      setExploreLoading(true);

      // Get all sibling tag_ids (same concept)
      const allTagIds = await getSiblingTagIds(tagId);

      // 1. Get all public user_ids who have this tag OR same concept (non-private)
      const { data: userTagsData, error: utError } = await supabase
        .from('piktag_user_tags')
        .select('user_id')
        .in('tag_id', allTagIds)
        .eq('is_private', false)
        .limit(2000);

      if (utError || !userTagsData) {
        setExploreUsers([]);
        setTotalUserCount(0);
        return;
      }

      // Exclude self + deduplicate
      const otherUserIds = [...new Set(
        userTagsData
          .map((ut: any) => ut.user_id)
          .filter((uid: string) => uid !== user.id)
      )];

      setTotalUserCount(otherUserIds.length);

      if (otherUserIds.length === 0) {
        setExploreUsers([]);
        return;
      }

      // 2. Fetch profiles (only public)
      const { data: profilesData, error: pError } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_verified')
        .in('id', otherUserIds)
        .eq('is_public', true);

      if (pError || !profilesData) {
        setExploreUsers([]);
        return;
      }

      // 3. Get current user's tag_ids for mutual count
      const { data: myTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', user.id)
        .limit(500);

      const myTagIds = new Set((myTags || []).map((t: any) => t.tag_id));

      // 4. For each explore user, count mutual tags
      const userIds = profilesData.map((p: any) => p.id);
      const { data: theirTags } = await supabase
        .from('piktag_user_tags')
        .select('user_id, tag_id')
        .in('user_id', userIds)
        .eq('is_private', false)
        .limit(2000);

      const mutualCountMap = new Map<string, number>();
      (theirTags || []).forEach((t: any) => {
        if (myTagIds.has(t.tag_id)) {
          mutualCountMap.set(t.user_id, (mutualCountMap.get(t.user_id) || 0) + 1);
        }
      });

      // 5. Build explore user list, sorted by mutual tag count desc
      const result: ExploreUser[] = profilesData.map((p: any) => ({
        id: p.id,
        username: p.username,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        is_verified: p.is_verified,
        mutual_tag_count: mutualCountMap.get(p.id) || 0,
      }));

      result.sort((a, b) => b.mutual_tag_count - a.mutual_tag_count);
      setExploreUsers(result);
    } catch (err) {
      console.error('Explore fetch error:', err);
      setExploreUsers([]);
    } finally {
      setExploreLoading(false);
    }
  }, [user, tagId, getSiblingTagIds]);

  // --- Fetch tag metadata (semantic_type, parent) ---
  const fetchTagMeta = useCallback(async () => {
    if (!tagId) return;
    const { data } = await supabase
      .from('piktag_tags')
      .select('semantic_type, parent_tag_id, concept_id')
      .eq('id', tagId)
      .single();
    if (data) {
      setTagSemanticType(data.semantic_type);
      if (data.parent_tag_id) {
        const { data: parent } = await supabase
          .from('piktag_tags')
          .select('name')
          .eq('id', data.parent_tag_id)
          .single();
        if (parent) setParentTagName(parent.name);
      }
      // Fetch related tags (same concept, excluding self)
      if (data.concept_id) {
        const { data: siblings } = await supabase
          .from('piktag_tags')
          .select('id, name, usage_count')
          .eq('concept_id', data.concept_id)
          .neq('id', tagId)
          .order('usage_count', { ascending: false })
          .limit(10);
        if (siblings && siblings.length > 0) setRelatedTags(siblings);
      }
    }
  }, [tagId]);

  useEffect(() => {
    fetchTagConnections();
    fetchExploreUsers();
    fetchTagMeta();
  }, [fetchTagConnections, fetchExploreUsers, fetchTagMeta]);

  // --- Connection item renderer ---
  const renderConnectionItem = useCallback(({ item }: { item: ConnectionWithProfile }) => {
    const profile = item.connected_user;
    const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
    const username = profile?.username || '';
    const verified = profile?.is_verified || false;

    return (
      <TouchableOpacity
        style={styles.userItem}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('FriendDetail', {
          connectionId: item.id,
          friendId: item.connected_user_id,
        })}
      >
        {profile?.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <InitialsAvatar name={displayName} size={48} style={styles.avatar} />
        )}
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {/* {verified && (
              <CheckCircle2 size={16} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
            )} */}
          </View>
          {username ? <Text style={styles.username}>@{username}</Text> : null}
          {item.met_location ? (
            <Text style={styles.metLocation} numberOfLines={1}>{item.met_location}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  // --- Explore user item renderer ---
  const renderExploreItem = useCallback(({ item }: { item: ExploreUser }) => {
    const displayName = item.full_name || item.username || 'Unknown';

    return (
      <TouchableOpacity
        style={styles.userItem}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('UserDetail', { userId: item.id })}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
        ) : (
          <InitialsAvatar name={displayName} size={48} style={styles.avatar} />
        )}
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {/* {item.is_verified && (
              <CheckCircle2 size={16} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
            )} */}
          </View>
          {item.username ? <Text style={styles.username}>@{item.username}</Text> : null}
          {item.mutual_tag_count > 0 && (
            <View style={styles.mutualBadge}>
              <Hash size={12} color={COLORS.piktag600} strokeWidth={2} />
              <Text style={styles.mutualText}>
                {t('tagDetail.mutualTags', { count: item.mutual_tag_count })}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.viewProfileBtn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('UserDetail', { userId: item.id })}
        >
          <UserPlus size={18} color={COLORS.piktag600} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [navigation, t]);

  const connectionKeyExtractor = useCallback((item: ConnectionWithProfile) => item.id, []);
  const exploreKeyExtractor = useCallback((item: ExploreUser) => item.id, []);

  const isConnectionsTab = activeTab === 'connections';
  const currentLoading = isConnectionsTab ? loading : exploreLoading;
  const currentData = isConnectionsTab ? connections : exploreUsers;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.tagBadge}>
            <Hash size={18} color={COLORS.piktag600} strokeWidth={2.5} />
            <Text style={styles.tagTitle}>{tagName || t('tagDetail.unknownTag')}</Text>
          </View>
          {tagSemanticType && (
            <Text style={styles.tagSemanticLabel}>
              {t(`semanticType.${tagSemanticType}`)}
            </Text>
          )}
          {parentTagName && (
            <Text style={styles.tagParent}>
              {t('semanticType.parentTag')}: #{parentTagName}
            </Text>
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Related Tags */}
      {relatedTags.length > 0 && (
        <View style={styles.relatedContainer}>
          <Text style={styles.relatedTitle}>{t('tagDetail.relatedTags') || '相關標籤'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {relatedTags.map((rt) => (
              <TouchableOpacity
                key={rt.id}
                style={styles.relatedChip}
                activeOpacity={0.7}
                onPress={() => navigation.push('TagDetail', { tagId: rt.id, tagName: rt.name })}
              >
                <Text style={styles.relatedChipText}>#{rt.name}</Text>
                <Text style={styles.relatedChipCount}>{rt.usage_count}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Tab Bar — 追蹤 on the LEFT (my actual followed connections for
          this tag), 探索 on the RIGHT (all public users for this tag).
          The left tab used to be 探索 but the user explicitly asked to
          swap so the personal view comes first. */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'connections' && styles.tabActive]}
          onPress={() => setActiveTab('connections')}
          activeOpacity={0.7}
        >
          <Hash size={16} color={activeTab === 'connections' ? COLORS.piktag600 : COLORS.gray500} />
          <Text style={[styles.tabText, activeTab === 'connections' && styles.tabTextActive]}>
            {t('tagDetail.tabConnections')}
          </Text>
          {usageCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{usageCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'explore' && styles.tabActive]}
          onPress={() => setActiveTab('explore')}
          activeOpacity={0.7}
        >
          <Users size={16} color={activeTab === 'explore' ? COLORS.piktag600 : COLORS.gray500} />
          <Text style={[styles.tabText, activeTab === 'explore' && styles.tabTextActive]}>
            {t('tagDetail.tabExplore')}
          </Text>
          {totalUserCount > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{totalUserCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      {currentLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : isConnectionsTab ? (
        <FlatList
          data={connections}
          renderItem={renderConnectionItem}
          keyExtractor={connectionKeyExtractor}
          contentContainerStyle={[
            styles.listContent,
            connections.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Hash size={48} color={COLORS.gray200} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>{t('tagDetail.emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('tagDetail.emptyText')}</Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      ) : (
        <FlatList
          data={exploreUsers}
          renderItem={renderExploreItem}
          keyExtractor={exploreKeyExtractor}
          contentContainerStyle={[
            styles.listContent,
            exploreUsers.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Users size={48} color={COLORS.gray200} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>{t('tagDetail.exploreEmptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('tagDetail.exploreEmptyText')}</Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
    </SafeAreaView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  tagSemanticLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  tagParent: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 2,
  },

  // Tab Bar
  relatedContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  relatedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  relatedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  relatedChipCount: {
    fontSize: 11,
    color: COLORS.gray400,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.piktag500,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  tabTextActive: {
    color: COLORS.piktag600,
  },
  tabBadge: {
    backgroundColor: COLORS.gray100,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray600,
  },

  // List
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  textSection: {
    flex: 1,
    marginLeft: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    lineHeight: 22,
  },
  username: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 1,
  },
  metLocation: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 2,
  },
  mutualBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    backgroundColor: COLORS.piktag50,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mutualText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  viewProfileBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: COLORS.piktag50,
  },

  // Empty
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray700,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
});
