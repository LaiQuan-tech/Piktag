import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
  Modal,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Settings2,
  MapPin,
  CheckCircle2,
  Check,
  X,
  Tag,
  CheckSquare,
  Square,
  Sparkles,
  UserPlus,
  CalendarHeart,
  Gift,
  Heart,
  Clock,
  QrCode,
  Hash,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import InitialsAvatar from '../components/InitialsAvatar';
import { supabase } from '../lib/supabase';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import { ConnectionsScreenSkeleton } from '../components/SkeletonLoader';
import { useAuth } from '../hooks/useAuth';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FriendsMapModal, { type FriendLocation } from '../components/FriendsMapModal';
import type { Connection, ConnectionTag } from '../types';

type ConnectionWithTags = Connection & {
  tags: string[];
  semanticTypes: string[]; // unique semantic types from all tags
};

type FriendStatus = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  statusText: string;
};

type SortOption = 'newest' | 'oldest' | 'alpha' | 'updated' | 'nearby';

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Memoized list item component ---
type ConnectionItemProps = {
  item: ConnectionWithTags;
  isSelected: boolean;
  selectMode: boolean;
  onPress: (item: ConnectionWithTags) => void;
  onLongPress: (item: ConnectionWithTags) => void;
};

const ConnectionItem = React.memo(({ item, isSelected, selectMode, onPress, onLongPress }: ConnectionItemProps) => {
  const profile = item.connected_user;
  const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
  const username = profile?.username || '';
  const verified = profile?.is_verified || false;
  const avatarUrl = profile?.avatar_url || null;

  return (
    <TouchableOpacity
      style={[styles.connectionItem, isSelected && styles.connectionItemSelected]}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      accessibilityLabel={displayName}
      accessibilityRole="button"
    >
      {selectMode && (
        <View style={styles.checkboxContainer}>
          {isSelected ? (
            <CheckSquare size={22} color={COLORS.piktag600} />
          ) : (
            <Square size={22} color={COLORS.gray400} />
          )}
        </View>
      )}
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <InitialsAvatar name={displayName} size={56} style={styles.avatarInitials} />
      )}
      <View style={styles.textSection}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {item.is_reviewed === false && (
            <View style={styles.newBadge}><Text style={styles.newBadgeText}>{t('connections.newBadge') || '新'}</Text></View>
          )}
        </View>
        <View style={styles.usernameRow}>
          <Text style={styles.username}>@{username}</Text>
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
        {item.tags.length > 0 && (
          <Text style={styles.tagsLine} numberOfLines={1}>
            {item.tags.join('  ')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

type ConnectionsScreenProps = {
  navigation: any;
};

export default function ConnectionsScreen({ navigation }: ConnectionsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const SORT_OPTIONS = useMemo(() => [
    { key: 'newest' as SortOption, label: t('connections.sortNewest') },
    { key: 'oldest' as SortOption, label: t('connections.sortOldest') },
    { key: 'alpha' as SortOption, label: t('connections.sortAlpha') },
    { key: 'updated' as SortOption, label: t('connections.sortUpdated') },
    { key: 'nearby' as SortOption, label: t('connections.sortNearby') },
  ], [t]);

  const lastFetchRef = React.useRef<number>(0);

  const [connections, setConnections] = useState<ConnectionWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // Friend statuses (IG-style stories bar)
  const [friendStatuses, setFriendStatuses] = useState<FriendStatus[]>([]);
  const [viewedStatusIds, setViewedStatusIds] = useState<Set<string>>(new Set());
  const [closeFriendCount, setCloseFriendCount] = useState(0);
  const [unreviewedCount, setUnreviewedCount] = useState(0);

  // CRM reminders (derived from connections data)

  // Tag filter state
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);

  // Batch selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchTagModalVisible, setBatchTagModalVisible] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagLoading, setBatchTagLoading] = useState(false);

  // Location state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapVisible, setMapVisible] = useState(false);

  // FlatList performance: fixed item height for getItemLayout
  // connectionItem: paddingVertical 16*2=32 + borderBottomWidth 1 = 33 overhead
  // No tags: avatar height 56 dominates content → 33 + 56 = 89
  // With tags row: textSection paddingTop 2 + name lineHeight 24 + usernameRow marginTop 2 + lineHeight 20 + tagsRow marginTop 6 + lineHeight 20 = 74 > 56 → 33 + 74 = 107
  // Use maximum (items with tags) to avoid layout clipping
  const CONNECTION_ITEM_HEIGHT = 107;

  // --- Optimized: single nested-select query for connections + tags ---
  const fetchConnections = useCallback(async () => {
    if (!user) return;

    // Stale-while-revalidate: serve from cache instantly, then refresh in background
    const cached = getCache<ConnectionWithTags[]>(CACHE_KEYS.CONNECTIONS);
    if (cached && cached.length > 0) {
      setConnections(cached);
      setLoading(false);
    }

    try {
      // Fetch connections + profiles
      const { data: connectionsData, error: connectionsError } = await supabase
        .from('piktag_connections')
        .select(`
          id, user_id, connected_user_id, nickname, created_at,
          met_at, birthday, is_reviewed,
          connected_user:piktag_profiles!connected_user_id(
            id, full_name, username, avatar_url, is_verified, latitude, longitude, birthday
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      // On error, keep existing data
      if (connectionsError || !connectionsData) {
        console.error('Error fetching connections:', connectionsError);
        return;
      }

      // Empty result only clears if we have no cached data at all
      if (connectionsData.length === 0 && !cached) {
        setConnections([]);
        return;
      }
      if (connectionsData.length === 0) return;

      // Build connections first (without tags — tags are optional)
      const connUserIds = connectionsData.map((c: any) => c.connected_user_id);
      let tagMap = new Map<string, string[]>();

      // Fetch public tags (optional — failure won't break connections)
      try {
        const { data: publicTagsData } = await supabase
          .from('piktag_user_tags')
          .select('user_id, tag_id, tag:piktag_tags!tag_id(name)')
          .in('user_id', connUserIds)
          .eq('is_private', false);

        if (publicTagsData) {
          for (const ut of publicTagsData as any[]) {
            const name = ut.tag?.name;
            if (!name) continue;
            const arr = tagMap.get(ut.user_id) || [];
            if (!arr.includes(`#${name}`)) arr.push(`#${name}`);
            tagMap.set(ut.user_id, arr);
          }
        }
      } catch {}

      const merged: ConnectionWithTags[] = connectionsData.map((conn: any) => ({
        ...conn,
        tags: tagMap.get(conn.connected_user_id) || [],
        semanticTypes: [],
      }));
      setCache(CACHE_KEYS.CONNECTIONS, merged);
      setConnections(merged);

      // --- Fetch friend statuses for stories bar (only followed users) ---
      let statusData: any[] | null = null;
      try {
        // Get users I follow
        const { data: followsData } = await supabase
          .from('piktag_follows')
          .select('following_id')
          .eq('follower_id', user.id);
        const followingIds = new Set((followsData || []).map((f: any) => f.following_id));

        // Only fetch statuses from followed users
        const followedConnUserIds = connUserIds.filter((id: string) => followingIds.has(id));

        if (followedConnUserIds.length > 0) {
          const res = await supabase
            .from('piktag_user_status')
            .select('user_id, text')
            .in('user_id', followedConnUserIds)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });
          statusData = res.data;
        }
      } catch {}

      if (statusData && statusData.length > 0) {
        // Deduplicate: one status per user (latest)
        const seenUsers = new Set<string>();
        const statuses: FriendStatus[] = [];
        for (const s of statusData) {
          if (seenUsers.has(s.user_id)) continue;
          seenUsers.add(s.user_id);
          const conn = connectionsData.find((c: any) => c.connected_user_id === s.user_id);
          const profile = conn?.connected_user as any;
          if (profile) {
            statuses.push({
              userId: s.user_id,
              name: conn.nickname || profile.full_name || profile.username || '?',
              avatarUrl: profile.avatar_url || null,
              statusText: s.text,
            });
          }
        }
        setFriendStatuses(statuses);
      } else {
        setFriendStatuses([]);
      }

      // --- Fetch close friend count ---
      try {
        const { count: cfCount } = await supabase
          .from('piktag_close_friends')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);
        setCloseFriendCount(cfCount ?? 0);
      } catch { setCloseFriendCount(0); }

      // Count unreviewed connections
      try {
        const { count: urCount } = await supabase
          .from('piktag_connections')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_reviewed', false);
        setUnreviewedCount(urCount ?? 0);
      } catch { setUnreviewedCount(0); }

    } catch (err) {
      console.error('Unexpected error fetching connections:', err);
      if (!cached) {
        setConnections([]);
      }
    }
  }, [user, t]);

  // --- Optimized: load connections with cooldown ---
  // Load viewed status IDs from storage
  useEffect(() => {
    AsyncStorage.getItem('piktag_viewed_statuses').then(val => {
      if (val) {
        try { setViewedStatusIds(new Set(JSON.parse(val))); } catch {}
      }
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      const loadAll = async () => {
        if (!user) return;
        const now = Date.now();
        if (now - lastFetchRef.current < 30000 && lastFetchRef.current > 0) return;
        setLoading(true);
        try {
          await fetchConnections();
        } finally {
          setLoading(false);
          lastFetchRef.current = Date.now();
        }
      };
      loadAll();
    }, [fetchConnections])
  );

  // --- Optimized: useMemo for sorted connections ---
  const sortedConnections = useMemo(() => {
    const sorted = [...connections];
    switch (sortBy) {
      case 'newest':
        sorted.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case 'oldest':
        sorted.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
      case 'alpha':
        sorted.sort((a, b) => {
          const nameA = (
            a.nickname || a.connected_user?.full_name || a.connected_user?.username || ''
          ).toLowerCase();
          const nameB = (
            b.nickname || b.connected_user?.full_name || b.connected_user?.username || ''
          ).toLowerCase();
          return nameA.localeCompare(nameB, 'zh-Hant');
        });
        break;
      case 'updated':
        sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
        break;
      case 'nearby':
        if (userLocation) {
          sorted.sort((a, b) => {
            const aLat = a.connected_user?.latitude;
            const aLng = a.connected_user?.longitude;
            const bLat = b.connected_user?.latitude;
            const bLng = b.connected_user?.longitude;
            const aDist =
              aLat != null && aLng != null
                ? haversineDistance(userLocation.latitude, userLocation.longitude, aLat, aLng)
                : Infinity;
            const bDist =
              bLat != null && bLng != null
                ? haversineDistance(userLocation.latitude, userLocation.longitude, bLat, bLng)
                : Infinity;
            return aDist - bDist;
          });
        }
        break;
    }
    // Apply tag filter
    if (filterTag) {
      return sorted.filter((c) => c.tags.includes(filterTag));
    }
    return sorted;
  }, [connections, sortBy, userLocation, filterTag]);

  // All unique semantic types from connections (for filter)
  const allConnectionTags = useMemo(() => {
    const tagCount = new Map<string, number>();
    connections.forEach((c) => c.tags.forEach((t) => {
      tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }));
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [connections]);

  // --- Optimized: useCallback for handlers ---
  const handleConnectionPress = useCallback((item: ConnectionWithTags) => {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    } else {
      navigation.navigate('FriendDetail', {
        connectionId: item.id,
        friendId: item.connected_user_id,
      });
    }
  }, [selectMode, navigation]);

  const handleConnectionLongPress = useCallback((item: ConnectionWithTags) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(new Set([item.id]));
    }
  }, [selectMode]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(connections.map((c) => c.id)));
  }, [connections]);

  const handleBatchTagSubmit = async () => {
    const tagName = batchTagInput.trim().replace(/^#/, '');
    if (!tagName || selectedIds.size === 0) return;

    setBatchTagLoading(true);
    try {
      let tagId: string;
      const { data: existingTag } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', tagName)
        .single();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag, error: createErr } = await supabase
          .from('piktag_tags')
          .insert({ name: tagName, created_by: user!.id })
          .select('id')
          .single();
        if (createErr || !newTag) {
          console.error('Error creating tag:', createErr);
          return;
        }
        tagId = newTag.id;
      }

      const rows = Array.from(selectedIds).map((connectionId) => ({
        connection_id: connectionId,
        tag_id: tagId,
      }));

      const { error: insertErr } = await supabase
        .from('piktag_connection_tags')
        .upsert(rows, { onConflict: 'connection_id,tag_id', ignoreDuplicates: true });

      if (insertErr) {
        console.error('Error batch tagging:', insertErr);
      }

      setBatchTagModalVisible(false);
      setBatchTagInput('');
      exitSelectMode();
      fetchConnections();
    } catch (err) {
      console.error('Batch tag error:', err);
    } finally {
      setBatchTagLoading(false);
    }
  };

  const handleSortSelect = async (option: SortOption) => {
    if (option === 'nearby' && !userLocation) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          if (user) {
            supabase
              .from('piktag_profiles')
              .update({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
              .eq('id', user.id)
              .then(() => {});
          }
        } else {
          Alert.alert(t('connections.alertLocationPermTitle'), t('connections.alertLocationPermMessage'));
          return;
        }
      } catch {
        Alert.alert(t('common.error'), t('connections.alertLocationError'));
        return;
      }
    }
    setSortBy(option);
    setSortModalVisible(false);
  };

  // --- Optimized: useCallback renderItem with memoized ConnectionItem ---
  const renderItem = useCallback(({ item }: { item: ConnectionWithTags }) => (
    <ConnectionItem
      item={item}
      isSelected={selectedIds.has(item.id)}
      selectMode={selectMode}
      onPress={handleConnectionPress}
      onLongPress={handleConnectionLongPress}
    />
  ), [selectedIds, selectMode, handleConnectionPress, handleConnectionLongPress]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <QrCode size={64} color={COLORS.gray200} style={{ marginBottom: 16 }} />
        <Text style={styles.emptyTitle}>{t('connections.emptyGuideTitle')}</Text>
        <Text style={styles.emptyText}>{t('connections.emptyGuideMessage')}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('AddTagTab', { screen: 'CameraScan' })}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#ff5757', '#c44dff', '#8c52ff']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.emptyButton}
          >
            <Text style={styles.emptyButtonText}>{t('connections.emptyGuideButton')}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.emptyButton, { backgroundColor: COLORS.piktag50, borderWidth: 1.5, borderColor: COLORS.piktag500, marginTop: 10 }]}
          onPress={() => navigation.navigate('ProfileTab', { screen: 'ContactSync' })}
          activeOpacity={0.8}
        >
          <Text style={[styles.emptyButtonText, { color: COLORS.piktag600 }]}>{t('connections.syncContactsButton') || '同步通訊錄找朋友'}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, t, navigation]);

  // --- Optimized: stable keyExtractor ---
  const keyExtractor = useCallback((item: ConnectionWithTags) => item.id, []);

  // --- Optimized: stable ListHeaderComponent via useMemo ---
  const listHeader = useMemo(() => {
    const renderStoriesBar = () => {
      const unreadStatuses = friendStatuses.filter(s => !viewedStatusIds.has(s.userId));
      if (unreadStatuses.length === 0 || selectMode) return null;
      return (
        <View style={styles.storiesContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesScroll}>
            {unreadStatuses.map((s) => (
              <TouchableOpacity
                key={s.userId}
                style={styles.storyItem}
                activeOpacity={0.7}
                onPress={() => {
                  // Mark as viewed
                  setViewedStatusIds(prev => {
                    const next = new Set(prev);
                    next.add(s.userId);
                    AsyncStorage.setItem('piktag_viewed_statuses', JSON.stringify([...next]));
                    return next;
                  });
                  const conn = connections.find(c => c.connected_user_id === s.userId);
                  if (conn) navigation.navigate('FriendDetail', { connectionId: conn.id, friendId: s.userId });
                }}
              >
                <LinearGradient
                  colors={['#ff5757', '#c44dff', '#8c52ff']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.storyAvatarRing}
                >
                  <View style={styles.storyAvatarInner}>
                    {s.avatarUrl ? (
                      <Image source={{ uri: s.avatarUrl }} style={styles.storyAvatar} />
                    ) : (
                      <InitialsAvatar name={s.name} size={52} />
                    )}
                  </View>
                </LinearGradient>
                <Text style={styles.storyName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.storyText} numberOfLines={1}>{s.statusText}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      );
    };

    return (
      <>
        {/* IG-style stories bar */}
        {renderStoriesBar()}

        {/* Review banner removed — replaced by inline "X 位待整理 →" in header */}
      </>
    );
  }, [connections, friendStatuses, viewedStatusIds, selectMode, t, navigation]);

  // --- Optimized: stable contentContainerStyle ---
  const contentContainerStyle = useMemo(() => [
    styles.listContent,
    connections.length === 0 && styles.listContentEmpty,
    selectMode && { paddingBottom: 160 },
  ], [connections.length, selectMode]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header: normal or select mode */}
      {selectMode ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {t('connections.selectedCount', { count: selectedIds.size })}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={selectAll}
            >
              <CheckSquare size={24} color={COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={exitSelectMode}
            >
              <X size={24} color={COLORS.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>#piktag</Text>
            <View style={styles.headerSubtitleRow}>
              <Text style={styles.headerSubtitle}>
                <Text style={styles.headerCount}>{sortedConnections.length}</Text>{' '}{t('connections.friendsLabel') || 'friends'}
                {closeFriendCount > 0 && (
                  <Text>{'  ·  '}<Text style={styles.headerCount}>{closeFriendCount}</Text>{' '}{t('connections.closeFriendsLabel') || '摯友'}</Text>
                )}
              </Text>
              {unreviewedCount > 0 && (
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('ActivityReview', { recentMinutes: 10080 })}
                  accessibilityLabel={`${unreviewedCount} 位待整理`}
                  accessibilityRole="link"
                >
                  <Text style={styles.unreviewedLink}>
                    {'  ·  '}{unreviewedCount} {t('connections.unreviewedLabel') || '位待整理'} →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setFilterModalVisible(true)}
              accessibilityLabel="篩選標籤"
              accessibilityRole="button"
            >
              <Tag size={24} color={filterTag ? COLORS.piktag600 : COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setSortModalVisible(true)}
              accessibilityLabel="排序"
              accessibilityRole="button"
            >
              <Settings2 size={24} color={COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setMapVisible(true)}
              accessibilityLabel="地圖檢視"
              accessibilityRole="button"
            >
              <MapPin size={24} color={COLORS.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Sort / Filter indicators */}
      {!selectMode && (sortBy !== 'newest' || filterTag) && (
        <View style={styles.sortIndicator}>
          {sortBy !== 'newest' && (
            <Text style={styles.sortIndicatorText}>
              {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}
            </Text>
          )}
          {filterTag && (
            <TouchableOpacity
              style={styles.filterIndicatorChip}
              onPress={() => setFilterTag(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.filterIndicatorText}>{filterTag}</Text>
              <X size={14} color={COLORS.piktag600} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {loading && connections.length === 0 ? (
        <ConnectionsScreenSkeleton />
      ) : (
        <FlatList
          data={sortedConnections}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={renderEmpty}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          getItemLayout={(_data, index) => ({
            length: CONNECTION_ITEM_HEIGHT,
            offset: CONNECTION_ITEM_HEIGHT * index,
            index,
          })}
        />
      )}

      {/* Batch action bar */}
      {selectMode && selectedIds.size > 0 && (
        <View style={styles.batchBar}>
          <TouchableOpacity
            style={styles.batchBtn}
            activeOpacity={0.7}
            onPress={() => setBatchTagModalVisible(true)}
          >
            <Tag size={20} color={COLORS.white} />
            <Text style={styles.batchBtnText}>
              {t('connections.batchTagButton', { count: selectedIds.size })}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sort Modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View style={styles.sortModal}>
            <Text style={styles.sortModalTitle}>{t('connections.sortModalTitle')}</Text>
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={styles.sortOption}
                activeOpacity={0.7}
                onPress={() => handleSortSelect(option.key)}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === option.key && styles.sortOptionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
                {sortBy === option.key && (
                  <Check size={20} color={COLORS.piktag600} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Tag Filter Modal */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalContainer}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>{t('connections.filterByTag')}</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)} activeOpacity={0.6}>
                <X size={24} color={COLORS.gray900} />
              </TouchableOpacity>
            </View>
            {filterTag && (
              <TouchableOpacity
                style={styles.filterClearBtn}
                onPress={() => { setFilterTag(null); setFilterModalVisible(false); }}
                activeOpacity={0.7}
              >
                <Text style={styles.filterClearText}>{t('connections.clearFilter')}</Text>
              </TouchableOpacity>
            )}

            {/* Quick filter: top tags by usage */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {allConnectionTags.length === 0 ? (
                <Text style={styles.filterEmptyText}>{t('connections.noTagsToFilter')}</Text>
              ) : (
                <View style={styles.filterTagsWrap}>
                  {allConnectionTags.map((st) => (
                    <TouchableOpacity
                      key={st}
                      style={[styles.filterTagChip, filterTag === st && styles.filterTagChipActive]}
                      onPress={() => { setFilterTag(st); setFilterModalVisible(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterTagChipText, filterTag === st && styles.filterTagChipTextActive]}>
                        {st}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Batch Tag Modal */}
      <Modal
        visible={batchTagModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBatchTagModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setBatchTagModalVisible(false)}
        >
          <View style={styles.batchTagModal}>
            <Text style={styles.sortModalTitle}>
              {t('connections.batchTagModalTitle', { count: selectedIds.size })}
            </Text>
            <TextInput
              style={styles.batchTagInput}
              placeholder={t('connections.batchTagPlaceholder')}
              placeholderTextColor={COLORS.gray400}
              value={batchTagInput}
              onChangeText={setBatchTagInput}
              autoFocus
            />
            <TouchableOpacity
              style={[
                styles.batchTagSubmitBtn,
                (!batchTagInput.trim() || batchTagLoading) && styles.batchTagSubmitBtnDisabled,
              ]}
              activeOpacity={0.7}
              onPress={handleBatchTagSubmit}
              disabled={!batchTagInput.trim() || batchTagLoading}
            >
              <Text style={styles.batchTagSubmitText}>
                {batchTagLoading ? t('common.processing') : t('common.confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* Friends Map Modal */}
      <FriendsMapModal
        visible={mapVisible}
        onClose={() => setMapVisible(false)}
        friends={connections
          .filter(c => {
            const p = c.connected_user as any;
            return p?.latitude && p?.longitude && p?.share_location !== false;
          })
          .map(c => {
            const p = c.connected_user as any;
            return {
              id: c.connected_user_id,
              connectionId: c.id,
              name: c.nickname || p?.full_name || p?.username || '?',
              avatarUrl: p?.avatar_url || null,
              latitude: p.latitude,
              longitude: p.longitude,
            };
          })}
        onFriendPress={(connectionId, friendId) => {
          setMapVisible(false);
          navigation.navigate('FriendDetail', { connectionId, friendId });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // --- Stories bar styles ---
  storiesContainer: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    paddingVertical: 12,
  },
  storiesScroll: {
    paddingHorizontal: 12,
    gap: 16,
  },
  storyItem: {
    alignItems: 'center',
    width: 68,
  },
  storyAvatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  storyAvatarInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  storyAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  storyName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gray800,
    marginTop: 4,
    textAlign: 'center',
    width: 68,
  },
  storyText: {
    fontSize: 10,
    color: COLORS.gray500,
    textAlign: 'center',
    width: 68,
    marginTop: 1,
  },
  // --- Main styles ---
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginTop: 2,
    lineHeight: 20,
  },
  headerCount: {
    fontWeight: '700',
    color: COLORS.accent500,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 4,
  },
  headerIconBtn: {
    padding: 4,
  },
  sortIndicator: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.piktag50,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.piktag100,
  },
  sortIndicatorText: {
    fontSize: 13,
    color: COLORS.piktag600,
    fontWeight: '600',
  },
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray700,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 24,
  },
  emptyButton: {
    marginTop: 20,
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  connectionItemSelected: {
    backgroundColor: COLORS.piktag50,
  },
  checkboxContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    paddingTop: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  avatarInitials: {
    borderWidth: 1,
    borderColor: COLORS.gray100,
  },
  textSection: {
    flex: 1,
    marginLeft: 14,
    paddingTop: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 24,
    flexShrink: 1,
  },
  newBadge: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  newBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  username: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  tagsLine: {
    fontSize: 13,
    color: COLORS.gray400,
    lineHeight: 18,
    marginTop: 3,
  },
  // On This Day card
  onThisDayCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#f5f3ff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  // CRM Reminder card
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  unreviewedLink: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  reminderCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#fdf2f8',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fce7f3',
  },
  // Recommendation card
  recCard: {
    margin: 16,
    backgroundColor: COLORS.piktag50,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.piktag100,
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  recHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  recBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.gray100,
  },
  recInfo: {
    flex: 1,
    marginLeft: 12,
  },
  recNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  recUsername: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 1,
  },
  recTagCount: {
    fontSize: 12,
    color: COLORS.piktag600,
    marginTop: 2,
  },
  recAction: {
    padding: 8,
  },
  // Batch bar
  batchBar: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  batchBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  // Sort Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sortModal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  sortModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  sortOptionText: {
    fontSize: 16,
    color: COLORS.gray700,
  },
  sortOptionTextActive: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  // Batch Tag Modal
  batchTagModal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  batchTagInput: {
    borderWidth: 2,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
    marginBottom: 16,
  },
  batchTagSubmitBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  batchTagSubmitBtnDisabled: {
    opacity: 0.5,
  },
  batchTagSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  // Friend statuses row
  statusSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  statusScrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  statusItem: {
    width: 80,
    alignItems: 'center',
  },
  statusAvatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.5,
    borderColor: COLORS.piktag400,
    padding: 2,
    marginBottom: 4,
  },
  statusAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  statusAvatarFallback: {
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusAvatarInitial: {
    fontSize: 20,
    fontWeight: '600',
    color: '#6B7280',
  },
  statusUsername: {
    fontSize: 11,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 2,
  },
  statusPreview: {
    fontSize: 10,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 13,
  },

  // Tag Recommendations
  tagRecCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    paddingVertical: 14,
  },
  tagRecScrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  tagRecItem: {
    width: 100,
    alignItems: 'center',
    gap: 4,
  },
  tagRecAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.gray100,
    marginBottom: 4,
  },
  tagRecName: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  tagRecBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: COLORS.piktag50,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagRecBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  tagRecTags: {
    fontSize: 10,
    color: COLORS.gray500,
    textAlign: 'center',
  },

  // Filter indicator
  filterIndicatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.piktag50,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.piktag300,
  },
  filterIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },

  // Filter Modal
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  filterModalContainer: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  filterModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  filterClearBtn: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  filterClearText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.red500,
  },
  filterEmptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 24,
  },
  filterSearchInput: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.gray900,
    marginBottom: 14,
  },
  filterTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterTagChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  filterTagChipActive: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  filterTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  filterTagChipTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
});
