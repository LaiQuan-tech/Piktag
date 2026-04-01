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
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
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

  // CRM reminders (derived from connections data)
  const [crmReminders, setCrmReminders] = useState<any[]>([]);
  const [remindersDismissed, setRemindersDismissed] = useState(false);

  // Tag filter state
  const [filterSemanticType, setFilterSemanticType] = useState<string | null>(null);
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
    if (cached) {
      setConnections(cached);
      setLoading(false);
    }

    try {
      // Single query: connections + profiles + tags (nested select)
      const { data: connectionsData, error: connectionsError } = await supabase
        .from('piktag_connections')
        .select(`
          id, user_id, connected_user_id, nickname, created_at,
          met_at, birthday,
          connected_user:piktag_profiles!connected_user_id(
            id, full_name, username, avatar_url, is_verified, latitude, longitude, birthday, share_location
          ),
          connection_tags:piktag_connection_tags(
            position,
            is_private,
            tag:piktag_tags!tag_id(name, semantic_type)
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (connectionsError) {
        console.error('Error fetching connections:', connectionsError);
        if (!cached) {
          setConnections([]);

          setCrmReminders([]);
        }
        return;
      }

      if (!connectionsData || connectionsData.length === 0) {
        if (!cached) {
          setConnections([]);

          setCrmReminders([]);
        }
        return;
      }

      // Fetch public tags for all connected users (with is_pinned, position, pick_count)
      const connUserIds = connectionsData.map((c: any) => c.connected_user_id);
      const { data: publicTagsData } = await supabase
        .from('piktag_user_tags')
        .select('user_id, tag_id, is_pinned, position, tag:piktag_tags!tag_id(name, pick_count, semantic_type)')
        .in('user_id', connUserIds)
        .eq('is_private', false)
        .order('position');

      // Fetch current user's own tag names for isMutual check
      const { data: myTagsData } = await supabase
        .from('piktag_user_tags')
        .select('tag:piktag_tags!tag_id(name)')
        .eq('user_id', user.id)
        .eq('is_private', false);
      const myTagNames = new Set((myTagsData || []).map((t: any) => t.tag?.name).filter(Boolean));

      // Build public tag map with sorting metadata
      type TagMeta = { name: string; isPinned: boolean; pickCount: number; isMutual: boolean; position: number; semanticType: string | null };
      const publicTagMetaMap = new Map<string, TagMeta[]>();
      if (publicTagsData) {
        for (const ut of publicTagsData as any[]) {
          const name = ut.tag?.name;
          if (!name) continue;
          const arr = publicTagMetaMap.get(ut.user_id) || [];
          if (!arr.find(t => t.name === name)) {
            arr.push({
              name,
              isPinned: !!ut.is_pinned,
              pickCount: ut.tag?.pick_count ?? 0,
              isMutual: myTagNames.has(name),
              position: ut.position ?? 0,
              semanticType: ut.tag?.semantic_type ?? null,
            });
          }
          publicTagMetaMap.set(ut.user_id, arr);
        }
      }

      // Merge with full priority sorting:
      // 1.isPinned  2.isPicked  3.isHidden  4.pickCount  5.isMutual  6.position
      const merged: ConnectionWithTags[] = connectionsData.map((conn: any) => {
        const connTags = conn.connection_tags || [];

        // Build picked tag set (public connection_tags)
        const pickedNames = new Set(
          connTags.filter((ct: any) => !ct.is_private).map((ct: any) => ct.tag?.name).filter(Boolean)
        );
        // Hidden tags (private connection_tags)
        const hiddenNames = new Set(
          connTags.filter((ct: any) => ct.is_private).map((ct: any) => ct.tag?.name).filter(Boolean)
        );

        // Get friend's public tags with metadata
        const friendTags = publicTagMetaMap.get(conn.connected_user_id) || [];

        // Build combined tag list with all sorting fields
        const allTagMetas: { name: string; isPinned: boolean; isPicked: boolean; isHidden: boolean; pickCount: number; isMutual: boolean; position: number }[] = [];
        const seen = new Set<string>();

        // Add friend's public tags
        for (const t of friendTags) {
          seen.add(t.name);
          allTagMetas.push({
            ...t,
            isPicked: pickedNames.has(t.name),
            isHidden: false,
          });
        }
        // Add picked tags not in public tags
        for (const name of pickedNames) {
          if (!seen.has(name)) {
            seen.add(name);
            allTagMetas.push({ name, isPinned: false, isPicked: true, isHidden: false, pickCount: 0, isMutual: myTagNames.has(name), position: 999, semanticType: null });
          }
        }
        // Add hidden tags
        for (const name of hiddenNames) {
          if (!seen.has(name)) {
            seen.add(name);
            allTagMetas.push({ name, isPinned: false, isPicked: false, isHidden: true, pickCount: 0, isMutual: false, position: 999, semanticType: null });
          }
        }

        // Sort by priority: isPinned → isPicked → isHidden → pickCount → isMutual → position
        allTagMetas.sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          if (a.isPicked !== b.isPicked) return a.isPicked ? -1 : 1;
          if (a.isHidden !== b.isHidden) return a.isHidden ? -1 : 1;
          if (a.pickCount !== b.pickCount) return b.pickCount - a.pickCount;
          if (a.isMutual !== b.isMutual) return a.isMutual ? -1 : 1;
          return a.position - b.position;
        });

        const semanticTypes = [...new Set(allTagMetas.map(t => t.semanticType).filter(Boolean))] as string[];
        return { ...conn, tags: allTagMetas.map(t => `#${t.name}`), semanticTypes };
      });
      setCache(CACHE_KEYS.CONNECTIONS, merged);
      setConnections(merged);

      // --- Fetch friend statuses for stories bar ---
      const { data: statusData } = await supabase
        .from('piktag_user_status')
        .select('user_id, text')
        .in('user_id', connUserIds)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

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
      const { count: cfCount } = await supabase
        .from('piktag_close_friends')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);
      setCloseFriendCount(cfCount ?? 0);

      // --- Derive "On This Day" from already-fetched data (no extra query) ---
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();

      // --- Derive CRM reminders from already-fetched data (no extra query) ---
      const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const reminderResults: any[] = [];
      for (const c of connectionsData) {
        // Check connection-level birthday OR profile-level birthday
        const connBday = c.birthday;
        const profileBday = (c.connected_user as any)?.birthday;
        const bday = connBday || profileBday;
        if (bday && bday.includes(mmdd)) {
          reminderResults.push({ ...c, reminderType: 'birthday', reminderLabel: t('connections.reminderBirthday') });
        }
      }
      setCrmReminders(reminderResults);

      // Auto-create birthday notifications (once per day per person)
      if (reminderResults.length > 0) {
        for (const r of reminderResults) {
          const profile = r.connected_user;
          const name = r.nickname || profile?.full_name || profile?.username || '';
          await supabase.from('piktag_notifications').upsert({
            user_id: user.id,
            type: 'birthday',
            title: t('connections.birthdayNotifTitle', { name }) || `${name} 今天生日`,
            body: t('connections.birthdayNotifBody', { name }) || `別忘了祝 ${name} 生日快樂`,
            is_read: false,
            created_at: new Date().toISOString(),
          }, { onConflict: 'user_id,type,title' }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Unexpected error fetching connections:', err);
      if (!cached) {
        setConnections([]);
        setOnThisDay([]);
        setCrmReminders([]);
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
    }, [user, fetchConnections])
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
    if (filterSemanticType) {
      if (filterSemanticType.startsWith('__search:')) {
        // Concept-based search: match by tag names
        const matchTags = filterSemanticType.replace('__search:', '').split(',');
        return sorted.filter((c) => c.tags.some(t => matchTags.includes(t)));
      }
      // Semantic type filter
      return sorted.filter((c) => (c.semanticTypes || []).includes(filterSemanticType));
    }
    return sorted;
  }, [connections, sortBy, userLocation, filterSemanticType]);

  // All unique semantic types from connections (for filter)
  const allSemanticTypes = useMemo(() => {
    const typeCount = new Map<string, number>();
    connections.forEach((c) => (c.semanticTypes || []).forEach((st) => {
      typeCount.set(st, (typeCount.get(st) || 0) + 1);
    }));
    return [...typeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type);
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
          style={styles.emptyButton}
          onPress={() => navigation.navigate('AddTagTab', { screen: 'CameraScan' })}
          activeOpacity={0.8}
        >
          <Text style={styles.emptyButtonText}>{t('connections.emptyGuideButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.emptyButton, { backgroundColor: COLORS.gray100, marginTop: 10 }]}
          onPress={() => navigation.navigate('ProfileTab', { screen: 'ContactSync' })}
          activeOpacity={0.8}
        >
          <Text style={[styles.emptyButtonText, { color: COLORS.gray700 }]}>{t('connections.syncContactsButton') || '同步通訊錄找朋友'}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, t, navigation]);

  // --- Optimized: stable keyExtractor ---
  const keyExtractor = useCallback((item: ConnectionWithTags) => item.id, []);

  // --- Optimized: stable ListHeaderComponent via useMemo ---
  const listHeader = useMemo(() => {
    const renderCrmReminders = () => {
      if (crmReminders.length === 0 || remindersDismissed || selectMode) return null;
      const getIcon = (type: string) => {
        if (type === 'birthday') return <Gift size={16} color="#ec4899" />;
        // anniversary/contract_expiry removed — only birthday
        return <Clock size={16} color="#f97316" />;
      };
      return (
        <View style={styles.reminderCard}>
          <View style={styles.recHeader}>
            <View style={styles.recHeaderLeft}>
              <Gift size={16} color="#ec4899" />
              <Text style={[styles.recHeaderText, { color: '#ec4899' }]}>{t('connections.todayReminderTitle')}</Text>
            </View>
            <TouchableOpacity onPress={() => setRemindersDismissed(true)} activeOpacity={0.6}>
              <X size={18} color={COLORS.gray400} />
            </TouchableOpacity>
          </View>
          {crmReminders.map((conn, idx) => {
            const profile = conn.connected_user;
            const name = conn.nickname || profile?.full_name || profile?.username || 'Unknown';
            const avatarUrl = profile?.avatar_url || null;
            return (
              <TouchableOpacity
                key={`${conn.id}-${conn.reminderType}`}
                style={styles.recBody}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('FriendDetail', { connectionId: conn.id, friendId: conn.connected_user_id })}
              >
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.recAvatar} />
                ) : (
                  <InitialsAvatar name={name} size={48} />
                )}
                <View style={styles.recInfo}>
                  <Text style={styles.recName} numberOfLines={1}>{name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    {getIcon(conn.reminderType)}
                    <Text style={styles.recUsername}>{conn.reminderLabel}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    };

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
                <View style={styles.storyAvatarRing}>
                  {s.avatarUrl ? (
                    <Image source={{ uri: s.avatarUrl }} style={styles.storyAvatar} />
                  ) : (
                    <InitialsAvatar name={s.name} size={56} />
                  )}
                </View>
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

        {/* Review new friends banner */}
        {connections.length > 0 && (
          <TouchableOpacity
            style={styles.reviewBanner}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('ActivityReview', { recentMinutes: 10080 })}
          >
            <View style={styles.reviewBannerLeft}>
              <Text style={styles.reviewBannerTitle}>{t('connections.reviewBannerTitle') || '整理新朋友'}</Text>
              <Text style={styles.reviewBannerSubtitle}>{t('connections.reviewBannerSubtitle') || '快速加標籤和備註'}</Text>
            </View>
            <Text style={styles.reviewBannerArrow}>→</Text>
          </TouchableOpacity>
        )}
        {renderCrmReminders()}
      </>
    );
  }, [connections, friendStatuses, viewedStatusIds, crmReminders, remindersDismissed, selectMode, t, navigation]);

  // --- Optimized: stable contentContainerStyle ---
  const contentContainerStyle = useMemo(() => [
    styles.listContent,
    connections.length === 0 && styles.listContentEmpty,
    selectMode && { paddingBottom: 160 },
  ], [connections.length, selectMode]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header: normal or select mode */}
      {selectMode ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>
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
            <Text style={styles.headerTitle}># PikTag</Text>
            <Text style={styles.headerSubtitle}>
              <Text style={styles.headerCount}>{sortedConnections.length}</Text>{' '}{t('connections.friendsLabel') || 'friends'}
              {closeFriendCount > 0 && (
                <Text>{'  ·  '}<Text style={styles.headerCount}>{closeFriendCount}</Text>{' '}{t('connections.closeFriendsLabel') || '摯友'}</Text>
              )}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setFilterModalVisible(true)}
            >
              <Tag size={24} color={filterSemanticType ? COLORS.piktag600 : COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setSortModalVisible(true)}
            >
              <Settings2 size={24} color={COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setMapVisible(true)}
            >
              <MapPin size={24} color={COLORS.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Sort / Filter indicators */}
      {!selectMode && (sortBy !== 'newest' || filterSemanticType) && (
        <View style={styles.sortIndicator}>
          {sortBy !== 'newest' && (
            <Text style={styles.sortIndicatorText}>
              {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}
            </Text>
          )}
          {filterSemanticType && (
            <TouchableOpacity
              style={styles.filterIndicatorChip}
              onPress={() => setFilterSemanticType(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.filterIndicatorText}>
                {filterSemanticType.startsWith('__search:')
                  ? filterSemanticType.replace('__search:', '').split(',').slice(0, 3).join(' ')
                  : (t(`semanticType.${filterSemanticType}`) || filterSemanticType)}
              </Text>
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
            {filterSemanticType && (
              <TouchableOpacity
                style={styles.filterClearBtn}
                onPress={() => { setFilterSemanticType(null); setFilterModalVisible(false); }}
                activeOpacity={0.7}
              >
                <Text style={styles.filterClearText}>{t('connections.clearFilter')}</Text>
              </TouchableOpacity>
            )}

            {/* Search input with concept matching */}
            <TextInput
              style={styles.filterSearchInput}
              placeholder={t('connections.filterSearchPlaceholder') || '搜尋標籤（如：創業、設計）'}
              placeholderTextColor={COLORS.gray400}
              onSubmitEditing={async (e) => {
                const query = e.nativeEvent.text.trim().replace(/#/g, '');
                if (!query) return;
                // Search by name + concept aliases
                const { data: directTags } = await supabase
                  .from('piktag_tags')
                  .select('name, concept_id')
                  .ilike('name', `%${query}%`)
                  .limit(10);
                const { data: aliasTags } = await supabase
                  .from('tag_aliases')
                  .select('concept_id')
                  .ilike('alias', `%${query}%`)
                  .limit(10);
                // Collect all concept_ids
                const conceptIds = new Set<string>();
                (directTags || []).forEach((t: any) => t.concept_id && conceptIds.add(t.concept_id));
                (aliasTags || []).forEach((a: any) => a.concept_id && conceptIds.add(a.concept_id));
                // Get all tag names under these concepts
                let matchNames = new Set((directTags || []).map((t: any) => `#${t.name}`));
                if (conceptIds.size > 0) {
                  const { data: siblingTags } = await supabase
                    .from('piktag_tags')
                    .select('name')
                    .in('concept_id', [...conceptIds]);
                  (siblingTags || []).forEach((t: any) => matchNames.add(`#${t.name}`));
                }
                // Filter connections that have any of these tags
                setFilterSemanticType(`__search:${[...matchNames].join(',')}`);
                setFilterModalVisible(false);
              }}
              returnKeyType="search"
            />

            {/* Semantic type category chips */}
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 300 }}>
              {allSemanticTypes.length === 0 ? (
                <Text style={styles.filterEmptyText}>{t('connections.noTagsToFilter')}</Text>
              ) : (
                <View style={styles.filterSemanticTypesWrap}>
                  {allSemanticTypes.map((st) => (
                    <TouchableOpacity
                      key={st}
                      style={[styles.filterSemanticTypeChip, filterSemanticType === st && styles.filterSemanticTypeChipActive]}
                      onPress={() => { setFilterSemanticType(st); setFilterModalVisible(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.filterSemanticTypeChipText, filterSemanticType === st && styles.filterSemanticTypeChipTextActive]}>
                        {t(`semanticType.${st}`) || st}
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
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2.5,
    borderColor: '#C13584',
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
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 24,
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
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: 16,
    marginBottom: 8,
    padding: 16,
    backgroundColor: COLORS.piktag50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.piktag400,
  },
  reviewBannerLeft: { flex: 1 },
  reviewBannerTitle: { fontSize: 15, fontWeight: '700', color: COLORS.piktag600 },
  reviewBannerSubtitle: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  reviewBannerArrow: { fontSize: 20, color: COLORS.piktag500 },
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
    borderColor: '#C13584',
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
  filterSemanticTypesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterSemanticTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  filterSemanticTypeChipActive: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  filterSemanticTypeChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  filterSemanticTypeChipTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
});
