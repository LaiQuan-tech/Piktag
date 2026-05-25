import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Hash, CheckCircle2, Users, UserPlus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import RingedAvatar from '../components/RingedAvatar';
import AskListByTag from '../components/ask/AskListByTag';
import { supabase } from '../lib/supabase';
import { getSiblingTagIds } from '../lib/tagSiblings';
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

// A not-yet-on-PikTag local contact the owner manually tagged with
// this tag. Shows in the 追蹤/connections tab alongside member
// connections — manual tags (connection_tags + local-contact tags)
// are owner-private, so this list is searchable only by its owner.
type TaggedLocalContact = {
  __localContact: true;
  id: string;
  name: string;
  avatar_url: string | null;
};

// The connections-tab list holds both: real member connections and
// manually-tagged local contacts.
type ConnTabItem = ConnectionWithProfile | TaggedLocalContact;

type TabKey = 'connections' | 'explore';

export default function TagDetailScreen({ navigation, route }: TagDetailScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const paramTagId = route.params?.tagId;
  const tagName = route.params?.tagName;
  const initialTab = route.params?.initialTab as TabKey | undefined;

  const [resolvedTagId, setResolvedTagId] = useState<string | null>(paramTagId || null);
  // Default tab is "connections" (friends-first) — matches how people
  // actually look at a tag: "who that I know uses this?". After the
  // initial fetch lands, if the viewer has zero friends with this tag
  // we silently flip to 'explore' so the screen isn't useless. Caller
  // can pin a starting tab via route.params.initialTab to override.
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab || 'connections');
  // Tracks whether the user (or initialTab override) has already locked
  // a tab choice. Prevents the auto-default effect from yanking the
  // tab out from under them on a slow connections re-fetch.
  const userPickedTabRef = useRef<boolean>(!!initialTab);
  const [connections, setConnections] = useState<ConnectionWithProfile[]>([]);
  // Local contacts the owner manually tagged with this tag — merged
  // into the connections tab below member connections.
  const [taggedContacts, setTaggedContacts] = useState<TaggedLocalContact[]>([]);
  const [exploreUsers, setExploreUsers] = useState<ExploreUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [exploreLoading, setExploreLoading] = useState(true);
  const [totalUserCount, setTotalUserCount] = useState(0);
  const [tagSemanticType, setTagSemanticType] = useState<string | null>(null);
  const [parentTagName, setParentTagName] = useState<string | null>(null);
  const [relatedTags, setRelatedTags] = useState<{ id: string; name: string; usage_count: number }[]>([]);

  // Map of friend user_id → connection_id (mirrors SearchScreen's
  // pattern from 2026-05-26). Needed so that taps on a profile in the
  // Explore tab OR on an Ask author route to FriendDetail (with the
  // searcher's manual tags) when the user is actually a friend, vs.
  // UserDetail when they're not. Without this, the manual/private tags
  // disappear from the screen the searcher expects them on.
  const [myFriendIds, setMyFriendIds] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('piktag_connections')
        .select('id, connected_user_id')
        .eq('user_id', user.id);
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const c of (data ?? []) as Array<{ id: string; connected_user_id: string }>) {
        if (c.connected_user_id && c.id) m.set(c.connected_user_id, c.id);
      }
      setMyFriendIds(m);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Single helper used by all three "tap a profile" entry points in
  // this screen (Explore row, Explore "view profile" button, Ask
  // author). Routes friends to FriendDetail (manual tags visible) and
  // non-friends to UserDetail (public-only view).
  const navigateToProfile = useCallback(
    (userId: string) => {
      const connectionId = myFriendIds.get(userId);
      if (connectionId) {
        navigation.navigate('FriendDetail', { connectionId, friendId: userId });
        return;
      }
      navigation.navigate('UserDetail', { userId });
    },
    [navigation, myFriendIds],
  );

  // Resolve tagId from tagName if not provided
  useEffect(() => {
    if (paramTagId) { setResolvedTagId(paramTagId); return; }
    if (!tagName) return;
    const resolve = async () => {
      // .single() ERRORS (not just empties) when the name has
      // duplicate rows (legacy mixed-case dupes) — so an existing
      // tag failed to resolve and the screen dead-ended. limit(1)
      // tolerates dupes (take the first) and 0 rows (empty array).
      const { data } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', tagName)
        .limit(1);
      if (data && data[0]) setResolvedTagId(data[0].id);
      else setLoading(false); // tag genuinely not found
    };
    resolve();
  }, [paramTagId, tagName]);

  const tagId = resolvedTagId;

  // --- Fetch connections with this tag (existing logic) ---
  const fetchTagConnections = useCallback(async () => {
    if (!user || !tagId) return;
    try {
      setLoading(true);

      // Get all sibling tag_ids (same concept)
      const allTagIds = await getSiblingTagIds(tagId);

      // Sibling tag NAMES — local-contact tags are stored as plain
      // name strings (piktag_local_contacts.tags is text[]), not FKs,
      // so contacts are matched by name, not tag_id.
      const { data: siblingTagRows } = await supabase
        .from('piktag_tags')
        .select('name')
        .in('id', allTagIds);
      const siblingNames = (siblingTagRows || [])
        .map((r: any) => r.name)
        .filter(Boolean);

      const [{ data, error }, contactsResult] = await Promise.all([
        supabase
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
          .limit(1000),
        // Manually-tagged local contacts. RLS scopes piktag_local_contacts
        // to the owner, so this is private to the searching user — the
        // founder's "manual tags are owner-only searchable" rule holds.
        siblingNames.length > 0
          ? supabase
              .from('piktag_local_contacts')
              .select('id, name, avatar_url, tags')
              .overlaps('tags', siblingNames)
              .limit(500)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const matchedContacts: TaggedLocalContact[] = (contactsResult.data || [])
        .map((c: any) => ({
          __localContact: true as const,
          id: c.id,
          name: c.name,
          avatar_url: c.avatar_url ?? null,
        }));
      setTaggedContacts(matchedContacts);

      if (error) {
        console.error('Error fetching tag connections:', error);
        setConnections([]);
        return;
      }

      if (!data || data.length === 0) {
        setConnections([]);
        return;
      }

      const allConnections = data
        .map((ct: any) => ct.connection)
        .filter((conn: any) => conn && conn.connected_user_id);

      setConnections(allConnections);
    } catch (err) {
      console.error('Unexpected error:', err);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [user, tagId]);

  // --- Fetch all public users with this tag (NEW: explore) ---
  const fetchExploreUsers = useCallback(async () => {
    if (!user || !tagId) return;
    try {
      setExploreLoading(true);

      // Fast path: a single SQL RPC does the sibling expansion, candidate
      // dedupe, mutual-tag count and ordering server-side, returning a
      // page-ready slice. ~5x fewer round-trips and ~10x less wire data
      // than the legacy 5-step pipeline below.
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'explore_users_for_tag',
        { p_tag_id: tagId, p_limit: 100 },
      );

      if (!rpcError && Array.isArray(rpcData)) {
        const rows = rpcData as Array<{
          id: string;
          username: string;
          full_name: string | null;
          avatar_url: string | null;
          is_verified: boolean;
          mutual_tag_count: number;
          total_count: number;
        }>;
        const result: ExploreUser[] = rows.map((r) => ({
          id: r.id,
          username: r.username,
          full_name: r.full_name,
          avatar_url: r.avatar_url,
          is_verified: r.is_verified,
          mutual_tag_count: r.mutual_tag_count ?? 0,
        }));
        setExploreUsers(result);
        setTotalUserCount(rows[0]?.total_count != null ? Number(rows[0].total_count) : result.length);
        return;
      }

      // Fallback (RPC missing or errored): legacy multi-query pipeline.
      // Keeps the screen working until the migration is applied.
      const allTagIds = await getSiblingTagIds(tagId);

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

      const otherUserIds = [
        ...new Set(
          userTagsData
            .map((ut: any) => ut.user_id)
            .filter((uid: string) => uid !== user.id),
        ),
      ];

      setTotalUserCount(otherUserIds.length);
      if (otherUserIds.length === 0) {
        setExploreUsers([]);
        return;
      }

      const { data: profilesData, error: pError } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_verified')
        .in('id', otherUserIds)
        .eq('is_public', true);
      if (pError || !profilesData) {
        setExploreUsers([]);
        return;
      }

      const { data: myTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', user.id)
        .limit(500);
      const myTagIds = new Set((myTags || []).map((t: any) => t.tag_id));

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
  }, [user, tagId]);

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

  // Refetch connections list on screen focus so a freshly-followed
  // user (via UserDetail subscreen) appears immediately when the
  // viewer comes back to the tag page. Without this, the user
  // followed someone but the "好友" tab still says they're not a
  // friend until full app reload.
  useFocusEffect(
    useCallback(() => {
      fetchTagConnections();
    }, [fetchTagConnections]),
  );

  // Friends-first auto-default: once the connections fetch completes,
  // if the viewer has nobody tagged here AND they haven't manually
  // picked a tab yet, slip over to 'explore' so they aren't staring
  // at "no friends use this tag". If they DO have friends, we stay on
  // 'connections' (the social-priority view).
  useEffect(() => {
    if (loading) return;
    if (userPickedTabRef.current) return;
    // Stay on 'connections' if EITHER member connections OR manually-
    // tagged local contacts exist — both live in that tab now.
    if (
      connections.length === 0 &&
      taggedContacts.length === 0 &&
      activeTab === 'connections'
    ) {
      setActiveTab('explore');
    }
  }, [loading, connections.length, taggedContacts.length, activeTab]);

  // --- Connection item renderer ---
  const renderConnectionItem = useCallback(({ item }: { item: ConnTabItem }) => {
    // Manually-tagged local contact (not yet on PikTag) → its
    // read-only detail screen, with the "尚未加入" badge.
    if ('__localContact' in item) {
      return (
        <TouchableOpacity
          style={styles.userItem}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('LocalContactDetail', { contactId: item.id })}
        >
          <RingedAvatar
            size={51}
            ringStyle="subtle"
            name={item.name || '?'}
            avatarUrl={item.avatar_url}
          />
          <View style={styles.textSection}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{item.name || '?'}</Text>
            </View>
            <Text style={styles.username} numberOfLines={1}>
              {t('connections.notJoinedBadge', { defaultValue: '尚未加入 PikTag' })}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    const profile = item.connected_user;
    const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
    const username = profile?.username || '';

    return (
      <TouchableOpacity
        style={styles.userItem}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('FriendDetail', {
          connectionId: item.id,
          friendId: item.connected_user_id,
        })}
      >
        <RingedAvatar
          size={51}
          ringStyle="subtle"
          name={displayName}
          avatarUrl={profile?.avatar_url}
        />
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          </View>
          {username ? <Text style={styles.username}>@{username}</Text> : null}
          {item.met_location ? (
            <Text style={styles.metLocation} numberOfLines={1}>{item.met_location}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, [navigation, styles, colors, t]);

  // --- Explore user item renderer ---
  const renderExploreItem = useCallback(({ item }: { item: ExploreUser }) => {
    const displayName = item.full_name || item.username || 'Unknown';

    return (
      <TouchableOpacity
        style={styles.userItem}
        activeOpacity={0.7}
        onPress={() => navigateToProfile(item.id)}
      >
        <RingedAvatar
          size={51}
          ringStyle="subtle"
          name={displayName}
          avatarUrl={item.avatar_url}
        />
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {/* {item.is_verified && (
              <CheckCircle2 size={16} color={colors.blue500} fill={colors.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
            )} */}
          </View>
          {item.username ? <Text style={styles.username}>@{item.username}</Text> : null}
          {item.mutual_tag_count > 0 && (
            <View style={styles.mutualBadge}>
              <Hash size={12} color={colors.piktag600} strokeWidth={2} />
              <Text style={styles.mutualText}>
                {t('tagDetail.mutualTags', { count: item.mutual_tag_count })}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.viewProfileBtn}
          activeOpacity={0.7}
          onPress={() => navigateToProfile(item.id)}
        >
          <UserPlus size={18} color={colors.piktag600} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [navigateToProfile, t, styles, colors]);

  const connectionKeyExtractor = useCallback(
    (item: ConnTabItem) => ('__localContact' in item ? `c_${item.id}` : item.id),
    [],
  );
  const exploreKeyExtractor = useCallback((item: ExploreUser) => item.id, []);

  // Connections tab = member connections + manually-tagged local
  // contacts (the founder's "manual tags must be searchable" fix).
  const connectionsData = useMemo<ConnTabItem[]>(
    () => [...connections, ...taggedContacts],
    [connections, taggedContacts],
  );

  const isConnectionsTab = activeTab === 'connections';
  const currentLoading = isConnectionsTab ? loading : exploreLoading;
  const currentData = isConnectionsTab ? connectionsData : exploreUsers;

  // Active asks tagged with this tag — surfaces "who is currently
  // asking about #X" above the user list. Auto-hides when there are
  // none. Same render on both tabs so the discovery moment doesn't
  // disappear when the user toggles 追蹤 / 探索.
  const handleAskAuthorPress = useCallback(
    (userId: string) => {
      navigateToProfile(userId);
    },
    [navigateToProfile],
  );
  const asksHeader = useMemo(
    () => (tagId ? <AskListByTag tagId={tagId} onPressAsk={handleAskAuthorPress} /> : null),
    [tagId, handleAskAuthorPress],
  );

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
          <ArrowLeft size={24} color={colors.gray900} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.tagBadge}>
            <Hash size={18} color={colors.piktag600} strokeWidth={2.5} />
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
          <Text style={styles.relatedTitle}>{t('tagDetail.relatedTags', { defaultValue: '相關標籤' })}</Text>
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
          onPress={() => {
            userPickedTabRef.current = true;
            setActiveTab('connections');
          }}
          activeOpacity={0.7}
        >
          <Hash size={16} color={activeTab === 'connections' ? colors.piktag600 : colors.gray500} />
          <Text style={[styles.tabText, activeTab === 'connections' && styles.tabTextActive]}>
            {t('tagDetail.tabConnections')}
          </Text>
          {connectionsData.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{connectionsData.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'explore' && styles.tabActive]}
          onPress={() => {
            userPickedTabRef.current = true;
            setActiveTab('explore');
          }}
          activeOpacity={0.7}
        >
          <Users size={16} color={activeTab === 'explore' ? colors.piktag600 : colors.gray500} />
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
        <PageLoader />
      ) : isConnectionsTab ? (
        <FlatList
          data={connectionsData}
          renderItem={renderConnectionItem}
          keyExtractor={connectionKeyExtractor}
          ListHeaderComponent={asksHeader}
          contentContainerStyle={[
            styles.listContent,
            connectionsData.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Hash size={48} color={colors.gray200} strokeWidth={1.5} />
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
          ListHeaderComponent={asksHeader}
          contentContainerStyle={[
            styles.listContent,
            exploreUsers.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Users size={48} color={colors.gray200} strokeWidth={1.5} />
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
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
    color: c.gray900,
  },
  tagSemanticLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  tagParent: {
    fontSize: 12,
    color: c.gray400,
    marginTop: 2,
  },

  // Tab Bar
  relatedContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.gray200,
  },
  relatedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray500,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  relatedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  relatedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.piktag600,
  },
  relatedChipCount: {
    fontSize: 11,
    color: c.gray400,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
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
    borderBottomColor: c.piktag500,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray500,
  },
  tabTextActive: {
    color: c.piktag600,
  },
  tabBadge: {
    backgroundColor: c.gray100,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  tabBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.gray600,
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
    borderBottomColor: c.gray100,
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
    color: c.gray900,
    lineHeight: 22,
  },
  username: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 1,
  },
  metLocation: {
    fontSize: 12,
    color: c.gray400,
    marginTop: 2,
  },
  mutualBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    backgroundColor: c.piktag50,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mutualText: {
    fontSize: 12,
    fontWeight: '600',
    color: c.piktag600,
  },
  viewProfileBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: c.piktag50,
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
    color: c.gray700,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: c.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  });
}
