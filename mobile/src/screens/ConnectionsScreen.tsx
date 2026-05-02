import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowDownAZ,
  CheckCircle2,
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
import RingedAvatar from '../components/RingedAvatar';
import { supabase } from '../lib/supabase';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import { ConnectionsScreenSkeleton } from '../components/SkeletonLoader';
import ErrorState from '../components/ErrorState';
import { useAuth } from '../hooks/useAuth';
import { useAskFeed } from '../hooks/useAskFeed';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AskStoryRow from '../components/ask/AskStoryRow';
import type { Connection, ConnectionTag } from '../types';

type ConnectionWithTags = Connection & {
  tags: string[];
  semanticTypes: string[]; // unique semantic types from all tags
};

// "new" badge auto-expires after this many days. Without expiry the badge
// stays forever on every connection the user never opened ActivityReview
// for, which produces visual noise that doesn't actually map to a real
// "new" relationship anymore. 7 days matches the rough "if you haven't
// processed them this week, you probably won't" behavioral pattern.
//
// Important: both the badge render AND the unreviewedCount banner count
// share this filter, so the header number always matches what the list
// visually shows.
const NEW_BADGE_MAX_DAYS = 7;
const NEW_BADGE_MAX_MS = NEW_BADGE_MAX_DAYS * 86_400_000;
const isWithinNewWindow = (createdAt?: string | null): boolean => {
  if (!createdAt) return false;
  const ts = new Date(createdAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < NEW_BADGE_MAX_MS;
};

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
      <RingedAvatar
        size={59}
        ringStyle="subtle"
        name={displayName}
        avatarUrl={avatarUrl}
      />
      <View style={styles.textSection}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          {item.is_reviewed === false && isWithinNewWindow(item.created_at) && (
            <Text style={styles.newBadgeText}>new</Text>
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
  const { asks: askFeedItems, myAsk: myActiveAsk, refresh: refreshAsks } = useAskFeed();

  const lastFetchRef = React.useRef<number>(0);

  const [connections, setConnections] = useState<ConnectionWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks whether the most recent fetch threw without leaving us
  // anything cached to render. The empty-state branch reads this so a
  // network failure shows a retry CTA instead of the new-user
  // onboarding empty state (which previously made offline failures
  // look like the user had no connections at all).
  const [loadError, setLoadError] = useState(false);

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

  // Sort options. 'recent' = newest connection first (default), 'alphabet'
  // = nickname/full_name A→Z, 'interaction' = piktag_connections.updated_at
  // newest first as a proxy for "you touched this connection lately".
  type SortMode = 'recent' | 'alphabet' | 'alphabet_desc' | 'interaction' | 'birthday';
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // FlatList performance: fixed item height for getItemLayout
  // connectionItem: paddingVertical 16*2=32 + borderBottomWidth 1 = 33 overhead
  // No tags: avatar height 56 dominates content → 33 + 56 = 89
  // With tags row: textSection paddingTop 2 + name lineHeight 24 + usernameRow marginTop 2 + lineHeight 20 + tagsRow marginTop 6 + lineHeight 20 = 74 > 56 → 33 + 74 = 107
  // Use maximum (items with tags) to avoid layout clipping
  const CONNECTION_ITEM_HEIGHT = 107;

  // --- Optimized: parallelized query waves for connections + tags + statuses ---
  const fetchConnections = useCallback(async () => {
    if (!user) return;

    // Stale-while-revalidate: serve from cache instantly, then refresh in background
    const cached = getCache<ConnectionWithTags[]>(CACHE_KEYS.CONNECTIONS);
    if (cached && cached.length > 0) {
      setConnections(cached);
      setLoading(false);
    }

    try {
      // --- Wave 1: 3 independent queries in parallel ---
      // connections + follows + close-friend count fire together. The
      // "待整理" (unreviewed) count used to be its own extra query, but
      // now that the home list is filtered to followed users (see
      // displayedConnections below), the count has to match the list —
      // so we derive it from the filtered result client-side instead
      // of running a fourth server count that can't see follow state.
      const [connRes, followsRes, closeFriendRes] = await Promise.allSettled([
        supabase
          .from('piktag_connections')
          .select(`
            id, user_id, connected_user_id, nickname, created_at,
            met_at, birthday, is_reviewed,
            connected_user:piktag_profiles!connected_user_id(
              id, full_name, username, avatar_url, is_verified, latitude, longitude, location_updated_at, birthday
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('piktag_follows')
          .select('following_id')
          .eq('follower_id', user.id),
        supabase
          .from('piktag_close_friends')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id),
      ]);

      // Apply count results (non-critical — failure shouldn't block connections)
      setCloseFriendCount(
        closeFriendRes.status === 'fulfilled' ? (closeFriendRes.value.count ?? 0) : 0
      );

      // Critical: connections must succeed
      if (connRes.status !== 'fulfilled') {
        console.error('Error fetching connections:', connRes.reason);
        return;
      }
      const { data: connectionsData, error: connectionsError } = connRes.value;
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

      // Extract follow set (used below to scope the status query AND,
      // critically, to filter which connections are actually displayed)
      const followingIds = new Set<string>(
        followsRes.status === 'fulfilled' && followsRes.value.data
          ? (followsRes.value.data as any[]).map((f: any) => f.following_id)
          : []
      );

      // Home list shows connections the viewer is actively following.
      // Why: a connection ("we met at this event") persists forever —
      // it carries hidden tags, met_at, note, birthday — but the home
      // feed is supposed to be the viewer's *current* social circle.
      // Unfollowing someone used to leave their row on the home list
      // because ConnectionsScreen only queried piktag_connections and
      // ignored piktag_follows; now we intersect. The connection row
      // stays in the DB untouched, so re-following restores the full
      // history (tags, note, etc.) rather than starting from scratch.
      const displayedConnections = (connectionsData as any[]).filter(
        (c) => followingIds.has(c.connected_user_id),
      );

      // Derive the "待整理" badge from the filtered list so the number
      // shown in the header ("1 位待整理") always matches what's
      // actually visible in the list below it.
      //
      // Same isWithinNewWindow gate as the per-row "new" pill — keeps the
      // header count and the visible badges in lock-step. A connection
      // older than NEW_BADGE_MAX_DAYS that's still unreviewed silently
      // ages out: the row stops showing "new" and stops counting toward
      // the banner. ActivityReview can still surface it (it queries
      // is_reviewed=false directly with no age filter) for the user who
      // wants to clean up old leftovers.
      setUnreviewedCount(
        displayedConnections.filter(
          (c: any) => c.is_reviewed === false && isWithinNewWindow(c.created_at),
        ).length,
      );

      const connectionIds = displayedConnections.map((c: any) => c.id);

      // --- Wave 2: MY tags on these connections ---
      // The "tags" row underneath each friend's name in the list previously
      // showed each FRIEND's own self-declared public tags. That was
      // misleading — it reflected how the friend described themselves, not
      // how the current user had categorized them. We now show the CURRENT
      // USER's own tags on each connection (both private hidden tags and
      // public picked tags). No is_private filter = both kinds included.
      const myTagsRes = await supabase
        .from('piktag_connection_tags')
        .select('connection_id, is_private, tag:piktag_tags!tag_id(name)')
        .in('connection_id', connectionIds)
        .limit(200);

      // Build tag map from my-tags-on-connections result.
      // Sort: hidden (private) tags first — these are the most identifying
      // personal notes (e.g. #前同事, #某場活動認識), then public picked tags.
      const tagMap = new Map<string, string[]>();
      if (myTagsRes.data) {
        const grouped = new Map<string, { name: string; isPrivate: boolean }[]>();
        for (const ct of myTagsRes.data as any[]) {
          const name = ct.tag?.name;
          if (!name) continue;
          const arr = grouped.get(ct.connection_id) || [];
          if (!arr.some(t => t.name === name)) {
            arr.push({ name, isPrivate: ct.is_private || false });
          }
          grouped.set(ct.connection_id, arr);
        }
        for (const [connId, tags] of grouped) {
          tags.sort((a, b) => {
            if (a.isPrivate !== b.isPrivate) return a.isPrivate ? -1 : 1;
            return 0;
          });
          tagMap.set(connId, tags.map(t => `#${t.name}`));
        }
      }

      const merged: ConnectionWithTags[] = displayedConnections.map((conn: any) => ({
        ...conn,
        tags: tagMap.get(conn.id) || [],
        semanticTypes: [],
      }));
      setCache(CACHE_KEYS.CONNECTIONS, merged);
      setConnections(merged);
    } catch (err) {
      console.error('Unexpected error fetching connections:', err);
      if (!cached) {
        setConnections([]);
        setLoadError(true);
      }
      // If we DID have cache, leave the list as-is and skip the error
      // surface — the user still sees something meaningful, and the
      // pull-to-refresh + reconnect retry will pick up the next attempt.
    }
  }, [user, t]);

  // --- Optimized: load connections with cooldown ---
  useFocusEffect(
    useCallback(() => {
      const loadAll = async () => {
        if (!user) return;
        // Always refresh the Ask feed on focus — independent of the
        // 30s connection-list cooldown. Reported case: A and B are
        // friends, A posts an Ask, B receives the push notification,
        // but B doesn't see the Ask in the rail because B's app is
        // foregrounded mid-session and the realtime INSERT event
        // didn't reach this client (e.g. websocket asleep, race with
        // the push payload). The notification trigger and the feed
        // RPC look at the same connections rows, so if B got the
        // notification B *should* see the Ask. A focus refetch
        // guarantees that without changing the RPC contract.
        refreshAsks();
        const now = Date.now();
        if (now - lastFetchRef.current < 30000 && lastFetchRef.current > 0) return;
        setLoading(true);
        // Clear stale error before attempting again so the empty-state
        // doesn't briefly render the previous failure surface while
        // the new request is in flight.
        setLoadError(false);
        try {
          await fetchConnections();
        } finally {
          setLoading(false);
          lastFetchRef.current = Date.now();
        }
      };
      loadAll();
    }, [fetchConnections, refreshAsks])
  );

  // Auto-refetch when the network comes back if we previously errored.
  // Bypass the 30s cooldown — a manual reconnect signal is a strong
  // hint that the user wants their data right now.
  useNetInfoReconnect(useCallback(() => {
    if (loadError) {
      lastFetchRef.current = 0;
      setLoadError(false);
      void fetchConnections();
    }
  }, [loadError, fetchConnections]));

  // Sort by user-chosen mode, then apply tag filter on top.
  // 'recent'      → created_at desc (newest connection first)
  // 'alphabet'    → display name A→Z, locale-aware (zh stroke / en alpha)
  // 'interaction' → updated_at desc, fall back to created_at when missing
  const sortedConnections = useMemo(() => {
    const displayName = (c: ConnectionWithTags) =>
      c.nickname || c.connected_user?.full_name || c.connected_user?.username || '';
    const recencyTs = (c: ConnectionWithTags) => {
      const v = (c as any).updated_at || c.created_at;
      const ts = new Date(v).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };

    // Days until the connection's next birthday (today = 0). Returns
    // Number.MAX_SAFE_INTEGER for connections without a birthday so
    // they sort to the bottom of the list. Birthdays are stored as
    // YYYY-MM-DD or MM-DD; both work because we only use month + day.
    const daysUntilBirthday = (c: ConnectionWithTags) => {
      const raw = (c as any).birthday;
      if (!raw) return Number.MAX_SAFE_INTEGER;
      const parts = String(raw).split('T')[0].split('-');
      // Accept "YYYY-MM-DD" (3 parts) or "MM-DD" (2 parts).
      const month = parts.length === 3
        ? parseInt(parts[1], 10) - 1
        : parts.length === 2 ? parseInt(parts[0], 10) - 1 : NaN;
      const day = parts.length === 3
        ? parseInt(parts[2], 10)
        : parts.length === 2 ? parseInt(parts[1], 10) : NaN;
      if (Number.isNaN(month) || Number.isNaN(day)) return Number.MAX_SAFE_INTEGER;
      // Range guard: invalid months / days (e.g. "02-30", "13-15", legacy
      // garbage) silently roll over via Date's auto-correct (Feb 30 →
      // Mar 2), which produces the wrong sort order. Reject anything
      // outside the calendar so malformed rows fall to the bottom
      // instead of pretending to have a real birthday.
      if (month < 0 || month > 11 || day < 1 || day > 31) {
        return Number.MAX_SAFE_INTEGER;
      }

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let next = new Date(now.getFullYear(), month, day);
      // Date constructor accepts month=2 day=30 and silently emits
      // Mar 2 — verify the round-trip kept the inputs intact, otherwise
      // treat as invalid (e.g. someone whose birthday was stored as
      // 02-30 from a buggy date picker).
      if (next.getMonth() !== month || next.getDate() !== day) {
        return Number.MAX_SAFE_INTEGER;
      }
      // If the birthday already passed THIS year, target next year.
      if (next.getTime() < today.getTime()) {
        next = new Date(now.getFullYear() + 1, month, day);
      }
      return Math.floor((next.getTime() - today.getTime()) / 86_400_000);
    };

    const sorted = [...connections];
    if (sortMode === 'alphabet') {
      sorted.sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }));
    } else if (sortMode === 'alphabet_desc') {
      sorted.sort((a, b) => displayName(b).localeCompare(displayName(a), undefined, { sensitivity: 'base' }));
    } else if (sortMode === 'interaction') {
      sorted.sort((a, b) => recencyTs(b) - recencyTs(a));
    } else if (sortMode === 'birthday') {
      sorted.sort((a, b) => daysUntilBirthday(a) - daysUntilBirthday(b));
    } else {
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    if (filterTag) {
      return sorted.filter((c) => c.tags.includes(filterTag));
    }
    return sorted;
  }, [connections, filterTag, sortMode]);

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
      // `.maybeSingle()` — a new tag name that nobody has used before
      // is a normal case here, not an error. `.single()` was throwing
      // and falling through to the "create tag" branch by accident;
      // the explicit null check is cleaner.
      const { data: existingTag } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', tagName)
        .maybeSingle();

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
    // Network failure path. Has to come BEFORE the onboarding empty
    // state — otherwise users with a dropped connection see a bunch of
    // CTAs ("scan a QR / sync contacts") that won't actually work.
    if (loadError) {
      return (
        <ErrorState
          onRetry={() => {
            setLoadError(false);
            lastFetchRef.current = 0;
            void fetchConnections();
          }}
        />
      );
    }
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
          onPress={() => navigation.navigate('ContactSync')}
          activeOpacity={0.8}
        >
          <Text style={[styles.emptyButtonText, { color: COLORS.piktag600 }]}>{t('connections.syncContactsButton') || '同步通訊錄找朋友'}</Text>
        </TouchableOpacity>
      </View>
    );
  }, [loading, loadError, fetchConnections, t, navigation]);

  // --- Optimized: stable keyExtractor ---
  const keyExtractor = useCallback((item: ConnectionWithTags) => item.id, []);

  // Fetch my own profile for Ask story row
  const [myProfile, setMyProfile] = useState<{ full_name: string | null; avatar_url: string | null }>({ full_name: null, avatar_url: null });
  useEffect(() => {
    if (!user) return;
    supabase.from('piktag_profiles').select('full_name, avatar_url').eq('id', user.id).single()
      .then(({ data }) => { if (data) setMyProfile(data); });
  }, [user]);

  const handleAskPressUser = useCallback((userId: string) => {
    const conn = connections.find(c => c.connected_user_id === userId);
    if (conn) {
      navigation.navigate('FriendDetail', { connectionId: conn.id, friendId: userId });
    } else {
      navigation.navigate('UserDetail', { userId });
    }
  }, [connections, navigation]);

  // --- Optimized: stable ListHeaderComponent via useMemo ---
  const listHeader = useMemo(() => {
    if (selectMode) return null;
    return (
      <AskStoryRow
        asks={askFeedItems}
        myAsk={myActiveAsk}
        myAvatarUrl={myProfile.avatar_url}
        myName={myProfile.full_name || '?'}
        onRefresh={refreshAsks}
        onPressUser={handleAskPressUser}
      />
    );
  }, [askFeedItems, myActiveAsk, myProfile, selectMode, refreshAsks, handleAskPressUser]);

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
            <Text style={[styles.headerTitle, { color: colors.text }]}>PikTag</Text>
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
                  onPress={() => navigation.navigate('ActivityReview')}
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
              accessibilityLabel={t('connections.sortLabel') || '排序'}
              accessibilityRole="button"
            >
              <ArrowDownAZ
                size={24}
                color={sortMode !== 'recent' ? COLORS.piktag600 : COLORS.gray600}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Filter indicator (tag filter only) */}
      {!selectMode && filterTag && (
        <View style={styles.sortIndicator}>
          <TouchableOpacity
            style={styles.filterIndicatorChip}
            onPress={() => setFilterTag(null)}
            activeOpacity={0.7}
          >
            <Text style={styles.filterIndicatorText}>{filterTag}</Text>
            <X size={14} color={COLORS.piktag600} />
          </TouchableOpacity>
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
                      onPress={() => { setFilterTag(st); setFilterModalVisible(false); require('../lib/analytics').trackTagFilterApplied(st); }}
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

      {/* Sort Modal — same shell as the filter modal so the two feel
          like sibling tools. Three options only: time, alphabet,
          interaction. */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <View style={styles.filterModalOverlay}>
          <View style={styles.filterModalContainer}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>{t('connections.sortLabel') || '排序'}</Text>
              <TouchableOpacity onPress={() => setSortModalVisible(false)} activeOpacity={0.6}>
                <X size={24} color={COLORS.gray900} />
              </TouchableOpacity>
            </View>
            {(
              [
                { key: 'recent', label: t('connections.sortByRecent') || '最近加為好友' },
                { key: 'interaction', label: t('connections.sortByInteraction') || '最近互動' },
                { key: 'birthday', label: t('connections.sortByBirthday') || '最近生日' },
                { key: 'alphabet', label: t('connections.sortByAlphabet') || '字母 A→Z' },
                { key: 'alphabet_desc', label: t('connections.sortByAlphabetDesc') || '字母 Z→A' },
              ] as { key: SortMode; label: string }[]
            ).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.sortOptionRow,
                  sortMode === opt.key && styles.sortOptionRowActive,
                ]}
                onPress={() => {
                  setSortMode(opt.key);
                  setSortModalVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortMode === opt.key && styles.sortOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
                {sortMode === opt.key && (
                  <CheckCircle2 size={18} color={COLORS.piktag500} />
                )}
              </TouchableOpacity>
            ))}
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
        {/* KAV wrapping the bottom-sheet overlay so the sheet floats above
            the soft keyboard instead of being buried under it when the
            autoFocus'd TextInput brings the keyboard up. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
        </KeyboardAvoidingView>
      </Modal>
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
  newBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.piktag600,
    letterSpacing: 0.3,
    marginLeft: 2,
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
  // Shared modal overlay (used by batch-tag modal)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sortModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
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
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  sortOptionRowActive: {
    // No background change — the trailing checkmark is enough signal
    // and matches the filter modal's quiet selection style.
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray800,
  },
  sortOptionTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
});
