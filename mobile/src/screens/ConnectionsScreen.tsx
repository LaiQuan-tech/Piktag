import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Modal,
  TextInput,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  CalendarHeart,
  Gift,
  Heart,
  Clock,
  Hash,
  ChevronRight,
  Users,
  Share2,
  Circle,
  Plus,
  ScanLine,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import RingedAvatar from '../components/RingedAvatar';
import { supabase } from '../lib/supabase';
import { ilikeEscape } from '../lib/normalizeTag';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import { ConnectionsScreenSkeleton } from '../components/SkeletonLoader';
import ErrorState from '../components/ErrorState';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import { useAskFeed } from '../hooks/useAskFeed';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldShowPhonePrompt, dismissPhonePrompt } from '../lib/phonePrompt';
import AskStoryRow from '../components/ask/AskStoryRow';
import type { Connection, ConnectionTag } from '../types';

// PikTag official account (fixed UUID, auto-friended at wizard completion).
// Used to detect the "only friend is @piktag" cold-start state.
const OFFICIAL_USER_ID = '00000000-0000-4000-a000-000000000001';

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
  // True iff this friend has an active Ask in the viewer's
  // fetch_ask_feed result. Drives the avatar gradient ring —
  // same visual convention FriendDetailScreen uses, so the same
  // brand-purple gradient consistently means "this person is
  // currently asking for something" across every surface.
  hasActiveAsk: boolean;
  // Short preview of the friend's active Ask body. When set,
  // renders as a subtle chip below the tags row — same idea as
  // IG story captions: a glanceable hint of WHAT they're asking
  // for, without forcing a tap-through. Caller is responsible
  // for truncating to a reasonable length (Map-side, not here).
  askPreview?: string | null;
  onPress: (item: ConnectionWithTags) => void;
  onLongPress: (item: ConnectionWithTags) => void;
};

const ConnectionItem = React.memo(({ item, isSelected, selectMode, hasActiveAsk, askPreview, onPress, onLongPress }: ConnectionItemProps) => {
  // Sub-components need their own theme hooks — parent's `styles`
  // and `colors` are scoped inside its function and not visible here.
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const profile = item.connected_user;
  const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
  const username = profile?.username || '';
  const verified = profile?.is_verified || false;
  const avatarUrl = profile?.avatar_url || null;

  // Manually-added, not-yet-on-PikTag contact. Same outer row +
  // RingedAvatar(59) + textSection structure as a real connection
  // so the fixed getItemLayout height still holds — just dimmed,
  // showing the contact's uploaded avatar (or initials when none),
  // a "尚未加入" badge where @username would be,
  // no ask gradient, no select checkbox. Tap → edit it.
  // Not-yet-on-PikTag: a manually-added local contact. Same dim row;
  // tap → edit it. (The web "scanned + left a name" pending-scan rail
  // / 絕招一 was removed — it produced name-only, untaggable records
  // that contradicted the tag-is-memory thesis.)
  const notJoined = (item as any).__localContact;
  if (notJoined) {
    return (
      <TouchableOpacity
        style={[styles.connectionItem, styles.connectionItemLocal]}
        activeOpacity={0.7}
        onPress={() => onPress(item)}
        accessibilityLabel={displayName}
        accessibilityRole="button"
      >
        <RingedAvatar size={59} ringStyle="subtle" name={displayName} avatarUrl={notJoined.avatar_url ?? null} />
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          </View>
          <View style={styles.localBadge}>
            <Text style={styles.localBadgeText}>
              {/* i18n via t at call site isn't available in this
                  memo'd component; use a stable literal — every
                  locale's qrGroup work kept "Tag"/brand English,
                  and this string is set from the screen below via
                  the item so it stays translatable. */}
              {(item as any).__notJoinedLabel || '尚未加入 PikTag'}
            </Text>
          </View>
          {item.tags.length > 0 && (
            <Text style={styles.tagsLine} numberOfLines={1}>
              {item.tags.join('  ')}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.connectionItem, isSelected && styles.connectionItemSelected]}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      accessibilityLabel={displayName}
      accessibilityRole="button"
    >
      {/* Buzz tint — soft brand-purple wash that fades to clear on
          the right when this friend has a live Ask. Reads as
          "this row is alive" without competing with the chip's
          gradient pill or the avatar's rotating ring. pointerEvents
          none so taps still land on the parent TouchableOpacity. */}
      {hasActiveAsk && !isSelected ? (
        <LinearGradient
          colors={['rgba(140,82,255,0.07)', 'rgba(140,82,255,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {selectMode && (
        <View style={styles.checkboxContainer}>
          {isSelected ? (
            <CheckSquare size={22} color={colors.piktag600} />
          ) : (
            <Square size={22} color={colors.gray400} />
          )}
        </View>
      )}
      <RingedAvatar
        size={59}
        ringStyle={hasActiveAsk ? 'gradient' : 'subtle'}
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
              color={colors.blue500}
              fill={colors.blue500}
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
        {/* Ask-preview chip — gradient-filled pill that visually
            echoes the rotating gradient ring on the avatar above.
            Z-gen "this person is buzzing right now" cue, not a
            subtle hint. Same gradient colors as the renderQrMode /
            Vibe hero / QR share screen — single brand-purple
            language across every "this is alive" surface. Caption
            style mirrors IG story captions; tap the row to read
            the full ask on FriendDetail. */}
        {askPreview ? (
          <LinearGradient
            colors={['#ff5757', '#c44dff', '#8c52ff']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.askPreviewChip}
          >
            <Text style={styles.askPreviewText} numberOfLines={1}>
              {askPreview}
            </Text>
          </LinearGradient>
        ) : null}
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  // Single-player CRM layer: manually-added people who aren't on
  // PikTag yet (owner-private piktag_local_contacts). They surface
  // in the SAME list, dimmed + a "尚未加入" badge; when they later
  // register, the server trigger promotes them into real
  // connections and they drop out of this (un-promoted) query.
  const { contacts: localContacts, refresh: refreshLocalContacts } = useLocalContacts();
  const { asks: askFeedItems, myAsk: myActiveAsk, refresh: refreshAsks } = useAskFeed();

  // Ask create modal visibility — opened from the cold-start
  // "broadcast an Ask" card so a brand-new user (zero friends) has
  // a one-tap path to find people through the platform without
  // needing a network first. AskStoryRow has its OWN modal-trigger
  // for users with at least some asks; this is the explicit
  // empty-state-only path.
  // (askCreateVisible removed 2026-06-04 — cold-start Ask card cut;
  // the AskStoryRow owns Ask creation now.)

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

  // "+" add-contact action sheet — surfaces the four ways to grow
  // your connections (search, contact-sync, manual local-contact,
  // invite). Used to be discoverable only on the empty state's
  // 4-action card; once the list filled up the entry points
  // disappeared. This menu restores them at any list size.

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
        // Refresh local contacts every focus (independent of the 30s
        // connection cooldown) — EditLocalContactScreen holds its own
        // useLocalContacts instance, so a create/edit/delete there
        // won't reflect here without an explicit refetch on return.
        refreshLocalContacts();
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
    }, [fetchConnections, refreshAsks, refreshLocalContacts])
  );

  // Pull-to-refresh (founder 2026-06-26: the Friends list lacked the
  // yank-down-to-refresh gesture every contact list trains users to expect).
  // Bypasses the 30s cooldown — an explicit pull is a "give me data now" intent.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    lastFetchRef.current = 0;
    refreshAsks();
    refreshLocalContacts();
    try {
      await fetchConnections();
    } finally {
      setRefreshing(false);
      lastFetchRef.current = Date.now();
    }
  }, [fetchConnections, refreshAsks, refreshLocalContacts]);

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

    // Promote friends with an active Ask to the top — same idea as
    // IG's "story rail" pushing has-story friends ahead, just on the
    // vertical list instead of the horizontal rail. This is a STATUS
    // override, not a sort mode: within both groups (has-ask vs not)
    // the user's chosen sort still wins. ES2019 Array.sort is stable
    // so the secondary pass cleanly partitions the list without
    // disturbing the order inside each partition. When an Ask expires
    // the friend naturally falls back into their normal slot.
    const askAuthorSet = new Set((askFeedItems || []).map((a) => a.author_id));
    sorted.sort((a, b) => {
      const aHas = askAuthorSet.has(a.connected_user_id) ? 1 : 0;
      const bHas = askAuthorSet.has(b.connected_user_id) ? 1 : 0;
      return bHas - aHas;
    });

    if (filterTag) {
      return sorted.filter((c) => c.tags.includes(filterTag));
    }
    return sorted;
  }, [connections, filterTag, sortMode, askFeedItems]);

  // Map un-promoted local contacts into the connection row shape and
  // append AFTER real connections (keeps the tuned real-connection
  // sort + ask-promotion untouched; not-yet-joined people group at
  // the end behind the badge). is_reviewed:true makes them invisible
  // to all the 待整理 / "new" badge / select logic with zero extra
  // guards. filterTag applies to their tags too.
  const notJoinedLabel = t('connections.notJoinedBadge', { defaultValue: '尚未加入 PikTag' });
  const listData = useMemo(() => {
    // Local-contact tags are stored as raw names; member connection
    // tags are "#name" (built at line ~439). Normalize local tags the
    // SAME way so (a) the list row renders them unmistakably as TAGS —
    // #商用不動產 etc. — not a 職稱-looking blob (tags are the whole
    // point of this app), and (b) the tag filter, which compares
    // against "#name", actually includes matching local contacts
    // (it silently didn't before).
    const hashTag = (n: string) => '#' + String(n).replace(/^#+/, '');
    const mapped = (localContacts || [])
      .filter(
        (lc) => !filterTag || (lc.tags ?? []).some((n) => hashTag(n) === filterTag),
      )
      .map((lc) => ({
        id: 'lc:' + lc.id,
        user_id: '',
        connected_user_id: '',
        nickname: lc.name,
        note: lc.note,
        met_at: lc.met_at,
        met_location: lc.met_location,
        birthday: lc.birthday,
        anniversary: null,
        scan_session_id: null,
        is_reviewed: true,
        created_at: lc.created_at,
        connected_user: undefined,
        tags: (lc.tags ?? []).map(hashTag),
        semanticTypes: [],
        __localContact: lc,
        __notJoinedLabel: notJoinedLabel,
      })) as any as ConnectionWithTags[];

    return mapped.length
      ? [...sortedConnections, ...mapped]
      : sortedConnections;
  }, [sortedConnections, localContacts, filterTag, notJoinedLabel]);

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
    const lc = (item as any).__localContact;
    if (lc) {
      // Not-yet-on-PikTag manual contact → its profile VIEW (the
      // contact analog of FriendDetail; 編輯 there opens the form).
      // Select-mode is N/A for these.
      navigation.navigate('LocalContactDetail', { contactId: lc.id });
      return;
    }
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
  }, [selectMode, navigation, t]);

  const handleConnectionLongPress = useCallback((item: ConnectionWithTags) => {
    // Local contacts aren't bulk-selectable (batch ops act on real
    // connections only).
    if ((item as any).__localContact) return;
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
    // Select what's actually visible — sortedConnections has the
    // active filterTag applied (and excludes the merged non-member
    // local contacts). Selecting the raw unfiltered `connections`
    // meant "全選" picked 200 rows when the user saw 5 filtered.
    setSelectedIds(new Set(sortedConnections.map((c) => c.id)));
  }, [sortedConnections]);

  const handleBatchTagSubmit = async () => {
    const tagName = batchTagInput.trim().replace(/^#/, '');
    if (!tagName || selectedIds.size === 0) return;

    setBatchTagLoading(true);
    try {
      let tagId: string;
      // Case-insensitive (ilike + escape wildcards) — a tagName typed here
      // can differ in case from the stored piktag_tags row; a case-sensitive
      // .eq would MISS it, fall into the INSERT branch, then violate the
      // UNIQUE(lower(name)) index → 23505 → "標籤加不了". See normalizeTag.ts.
      // `.limit(1)` (not maybeSingle) tolerates legacy mixed-case dupe rows.
      const { data: lookup } = await supabase
        .from('piktag_tags')
        .select('id')
        .ilike('name', ilikeEscape(tagName))
        .limit(1);
      const existingTag = lookup && lookup[0];

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag, error: createErr } = await supabase
          .from('piktag_tags')
          .insert({ name: tagName, created_by: user!.id })
          .select('id')
          .single();
        if (createErr || !newTag) {
          // A dupe race (another insert of the same lower(name) landed
          // first) surfaces as 23505 on the UNIQUE(lower(name)) index.
          // Re-select case-insensitively and use that row rather than
          // dead-ending the batch-tag with an error.
          if (createErr?.code === '23505') {
            const { data: raced } = await supabase
              .from('piktag_tags')
              .select('id')
              .ilike('name', ilikeEscape(tagName))
              .limit(1);
            if (raced && raced[0]) {
              tagId = raced[0].id;
            } else {
              console.error('Error creating tag:', createErr);
              return;
            }
          } else {
            console.error('Error creating tag:', createErr);
            return;
          }
        } else {
          tagId = newTag.id;
        }
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

  // Per-author lookup table for active Asks. Stores both the
  // existence flag (drives the avatar gradient ring) and a
  // truncated body preview (drives the IG-caption-style chip
  // beneath the tags row). Built once per askFeedItems change so
  // the per-row render stays O(1).
  //
  // Preview length cap: 40 visible characters. Empirically that
  // fits roughly one line at the row's natural width without
  // pushing the layout taller, and is long enough to convey
  // "I'm looking for a frontend engineer" sized intents.
  const ASK_PREVIEW_LEN = 40;
  const askPreviewByAuthor = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of askFeedItems || []) {
      if (!a?.author_id || !a?.body) continue;
      // Collapse whitespace + truncate. ellipsis ASCII to keep
      // the renderable width tight on iOS Pinyin Mono Dot.
      const oneLine = a.body.replace(/\s+/g, ' ').trim();
      const preview =
        oneLine.length > ASK_PREVIEW_LEN
          ? oneLine.slice(0, ASK_PREVIEW_LEN).trimEnd() + '…'
          : oneLine;
      m.set(a.author_id, preview);
    }
    return m;
  }, [askFeedItems]);

  // --- Optimized: useCallback renderItem with memoized ConnectionItem ---
  const renderItem = useCallback(({ item }: { item: ConnectionWithTags }) => {
    const preview = askPreviewByAuthor.get(item.connected_user_id) ?? null;
    return (
      <ConnectionItem
        item={item}
        isSelected={selectedIds.has(item.id)}
        selectMode={selectMode}
        hasActiveAsk={preview != null}
        askPreview={preview}
        onPress={handleConnectionPress}
        onLongPress={handleConnectionLongPress}
      />
    );
  }, [selectedIds, selectMode, askPreviewByAuthor, handleConnectionPress, handleConnectionLongPress]);

  // Phone-prompt banner state. Async check (AsyncStorage + Supabase)
  // so we render the cold-start view first, then upgrade once known.
  // Declared before renderEmpty since the callback's deps reference it.
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    shouldShowPhonePrompt(user.id)
      .then((show) => {
        if (!cancelled) setShowPhonePrompt(show);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
  const handlePhonePromptPress = useCallback(() => {
    setShowPhonePrompt(false);
    navigation.navigate('ProfileTab', { screen: 'EditProfile', params: { focusPhone: true } });
  }, [navigation]);

  // (openAddPersonMenu reverted 2026-06-05 — the 2-option menu added a
  // tap to the highest-frequency "+person → add contact (scan)" flow,
  // a commodity-speed regression the founder caught. The +person icon
  // goes STRAIGHT to EditLocalContact / the scan again. ContactSync
  // needs a different home — TBD with the founder.)
  const handlePhonePromptDismiss = useCallback(() => {
    setShowPhonePrompt(false);
    dismissPhonePrompt();
  }, []);

  // Shared cold-start action rows (card-scan leads — single-player value).
  // Rendered from BOTH the true-empty state AND the ListFooter when the only
  // connection is the auto-added @piktag. The footer is the one users
  // actually SEE: the official auto-friend means the list is never truly
  // empty, so a ListEmptyComponent-only placement never rendered (caught by
  // the founder testing SMOKE step 3, 2026-06-29).
  // 2026-06-29 update (founder: 精簡成一個): the four nav rows collapsed
  // into ONE action button. Card scan is the one action that works ALONE
  // (organized contact + AI tags, no second person needed); the wizard
  // payoff step now teaches the same move. Nothing is lost — QR-scan
  // lives in the header "+", search has its own tab, contacts import is
  // in Settings.
  const coldStartActions = useCallback(() => (
    <View style={styles.coldStartWrap}>
      <TouchableOpacity
        style={styles.coldStartBtn}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('CardCamera', { forNewContact: true })}
      >
        <ScanLine size={20} color={'#FFFFFF'} />
        <Text style={styles.coldStartBtnText}>
          {t('connections.coldStartActionCard', { defaultValue: '掃一張名片試試' })}
        </Text>
      </TouchableOpacity>
      <Text style={styles.coldStartDesc}>
        {t('connections.coldStartActionCardDesc', { defaultValue: '一個人也能用——拍下名片，AI 幫你整理好聯絡人' })}
      </Text>
    </View>
  ), [styles, navigation, t]);

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
    // Cold-start onboarding action list — 4 sequential steps to
    // give first-batch users (no one in their network yet) a clear
    // path from "PikTag is empty" to "I have a usable personal CRM
    // + shareable profile". Replaces the old single-CTA "scan a QR"
    // empty state which dead-ended for users whose friends weren't
    // on PikTag yet.
    return (
      <View style={styles.emptyOnboardingContainer}>
        <Text style={styles.emptyOnboardingTitle}>
          {t('connections.coldStartTitle', { defaultValue: '還沒有朋友？' })}
        </Text>
        {coldStartActions()}
      </View>
    );
    // 2026-06-03 fix: added styles + colors to deps. This callback
    // builds themed JSX (styles.emptyOnboarding*, colors.piktag500
    // etc.) but omitted them, so a theme toggle while viewing the
    // cold-start empty state froze the cards on the launch theme
    // (the sibling listHeader already lists them — this one was
    // missed). Both are fresh objects per theme switch.
  }, [loading, loadError, fetchConnections, t, styles, colors, coldStartActions]);

  // --- Optimized: stable keyExtractor ---
  const keyExtractor = useCallback((item: ConnectionWithTags) => item.id, []);

  // My own profile for the Ask story row. Sourced from AuthContext —
  // the central cache fetches piktag_profiles ONCE at login, so we
  // no longer pay a per-mount round-trip here. Shape downstream:
  // { full_name, avatar_url } — both nullable, same as before.
  const { profile: authProfile } = useAuthProfile();
  const myProfile = useMemo(
    () => ({
      full_name: authProfile?.full_name ?? null,
      avatar_url: authProfile?.avatar_url ?? null,
    }),
    [authProfile?.full_name, authProfile?.avatar_url],
  );

  // (Invite-code redeem resume removed — the invite/redeem gate was
  // retired; open signup, no codes.)

  const handleAskPressUser = useCallback((userId: string, askId?: string, authorId?: string) => {
    // Track Ask view for response analytics
    if (askId && authorId) {
      import('../lib/searchLearning').then(({ recordAskResponse }) => {
        recordAskResponse({ askId, authorId, action: 'view' });
      }).catch(() => {});
    }
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
      <>
        {/* Phone-discovery nudge for users registered via Apple/Google
            who never supplied a phone. Without it, contact-sync from
            their friends won't match them — they're invisible. Lives
            in the list header (not just the cold-start empty state)
            so active users with friends but no phone still see it. */}
        {showPhonePrompt && (
          <Pressable
            style={styles.phonePromptCard}
            onPress={handlePhonePromptPress}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.phonePromptTitle}>
                {t('connections.phonePromptTitle', { defaultValue: '加上手機號碼，讓朋友找到你' })}
              </Text>
              <Text style={styles.phonePromptBody}>
                {t('connections.phonePromptBody', { defaultValue: '朋友通訊錄同步時會自動加你為好友。只有 PikTag 用得到，永遠不會公開。' })}
              </Text>
            </View>
            <Pressable
              hitSlop={12}
              onPress={handlePhonePromptDismiss}
              style={styles.phonePromptDismiss}
            >
              <X size={16} color={colors.gray500} />
            </Pressable>
          </Pressable>
        )}
        <AskStoryRow
          asks={askFeedItems}
          myAsk={myActiveAsk}
          myAvatarUrl={myProfile.avatar_url}
          myName={myProfile.full_name || '?'}
          onRefresh={refreshAsks}
          onPressUser={handleAskPressUser}
        />
      </>
    );
  }, [askFeedItems, myActiveAsk, myProfile, selectMode, refreshAsks, handleAskPressUser, showPhonePrompt, handlePhonePromptPress, handlePhonePromptDismiss, t, styles, colors]);

  // --- Optimized: stable contentContainerStyle ---
  const contentContainerStyle = useMemo(() => [
    styles.listContent,
    connections.length === 0 && styles.listContentEmpty,
    selectMode && { paddingBottom: 160 },
  ], [connections.length, selectMode, styles]);

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
              <CheckSquare size={24} color={colors.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={exitSelectMode}
            >
              <X size={24} color={colors.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, styles.brandWordmark, { color: colors.text }]}>PikTag</Text>
            <View style={styles.headerSubtitleRow}>
              {/* The friend count is the entry to the network graph (founder
                  2026-06-25: tap the count → see how your people connect). */}
              <TouchableOpacity
                style={styles.networkLink}
                activeOpacity={0.6}
                onPress={() => navigation.navigate('NetworkGraph')}
                accessibilityRole="button"
                accessibilityLabel={t('network.openLabel', { defaultValue: '查看人脈圖' })}
              >
                <Text style={[styles.headerSubtitle, isDark && { color: '#FFFFFF' }]}>
                  <Text style={styles.headerCount}>{sortedConnections.length}</Text>{' '}{t('connections.friendsLabel', { defaultValue: 'friends' })}
                  {closeFriendCount > 0 && (
                    <Text>{'  ·  '}<Text style={styles.headerCount}>{closeFriendCount}</Text>{' '}{t('connections.closeFriendsLabel', { defaultValue: '摯友' })}</Text>
                  )}
                </Text>
                <ChevronRight size={14} color={isDark ? '#FFFFFF' : colors.gray400} />
              </TouchableOpacity>
              {unreviewedCount > 0 && (
                <TouchableOpacity
                  activeOpacity={0.6}
                  onPress={() => {
                    // Reviewing flips is_reviewed in the DB, but the 30s
                    // focus cooldown (loadAll) would otherwise skip the
                    // refetch on return and leave this banner stuck at its
                    // pre-review number (e.g. "1 位待整理" after the user
                    // already cleared everyone). Reset the cooldown so the
                    // focus effect always re-derives unreviewedCount when
                    // the user comes back from ActivityReview.
                    lastFetchRef.current = 0;
                    navigation.navigate('ActivityReview');
                  }}
                  accessibilityLabel={`${unreviewedCount} 位待整理`}
                  accessibilityRole="link"
                >
                  <Text style={styles.unreviewedLink}>
                    {'  ·  '}{unreviewedCount} {t('connections.unreviewedLabel', { defaultValue: '位待整理' })} →
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            {/* "+" add-contact action sheet was removed after user
                feedback that the Connections page was too busy at
                first glance. The same three entry points (search /
                contact-sync / invite) remain reachable from
                Settings and the empty-state CTA — they don't need
                a third surface on this already-tag-and-sort-heavy
                header. */}
            {/* +person → STRAIGHT to the card camera. Founder model
                (2026-06-05): "拍照就是點選 icon 就要看到鏡頭" — tapping
                this opens the live viewfinder immediately, ONE
                transition, no EditLocalContact form flashing in between.
                The camera owns the handoff: shutter → prefilled form,
                "手動輸入" → blank form, X → back here. This is the
                highest-frequency commodity flow and the perceived-speed
                red line lives here — keep it icon→鏡頭, never route it
                through a menu or an intermediate screen again. */}
            {/* "+" opens the UNIFIED scanner (founder 2026-06-24/25): point
                at a QR → connect, or tap 拍名片 → OCR a card, with a flip to
                "show my QR". Plain "+" (was UserPlus) = the friend-add CTA;
                keep it a one-tap straight-to-camera open (perceived-speed
                red line) — never route it through a menu. */}
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => navigation.navigate('CameraScan')}
              accessibilityLabel={t('connections.addContact', { defaultValue: '新增聯絡人' })}
              accessibilityRole="button"
            >
              <Plus size={24} color={isDark ? '#FFFFFF' : colors.gray600} />
            </TouchableOpacity>
            {/* 建立活動 QR moved OFF this header (founder 2026-06-25: a QR
                icon next to the scan CTA was too heavy + read ambiguously).
                It now lives on the Profile tab, next to the personal QR —
                both are "a QR I generate/show". This header stays focused on
                the North-Star friend-add: scan ("+") + sort. */}
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setSortModalVisible(true)}
              accessibilityLabel={t('connections.sortLabel', { defaultValue: '排序' })}
              accessibilityRole="button"
            >
              <ArrowDownAZ
                size={24}
                color={sortMode !== 'recent' ? colors.piktag600 : (isDark ? '#FFFFFF' : colors.gray600)}
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
            <X size={14} color={colors.piktag600} />
          </TouchableOpacity>
        </View>
      )}

      {loading && connections.length === 0 ? (
        <ConnectionsScreenSkeleton />
      ) : (
        <FlatList
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.piktag500} />
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={
            // Cold-start guidance under the auto-added @piktag row
            // (founder 2026-06-29, SMOKE step-3 catch): @piktag means the
            // list is never truly empty, so ListEmptyComponent never
            // renders — THIS is the real cold-start surface. Shown only
            // while the ONLY connection is the official account; plain
            // nav rows, no banner (2026-06-07 rule stands).
            !loading &&
            connections.length === 1 &&
            connections[0]?.connected_user_id === OFFICIAL_USER_ID ? (
              <View style={styles.emptyOnboardingContainer}>
                {coldStartActions()}
              </View>
            ) : null
          }
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
            <Tag size={20} color={'#FFFFFF'} />
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
                <X size={24} color={colors.gray900} />
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
              <Text style={styles.filterModalTitle}>{t('connections.sortLabel', { defaultValue: '排序' })}</Text>
              <TouchableOpacity onPress={() => setSortModalVisible(false)} activeOpacity={0.6}>
                <X size={24} color={colors.gray900} />
              </TouchableOpacity>
            </View>
            {(
              [
                { key: 'recent', label: t('connections.sortByRecent', { defaultValue: '最近加為好友' }) },
                { key: 'interaction', label: t('connections.sortByInteraction', { defaultValue: '最近互動' }) },
                { key: 'birthday', label: t('connections.sortByBirthday', { defaultValue: '最近生日' }) },
                { key: 'alphabet', label: t('connections.sortByAlphabet', { defaultValue: '字母 A→Z' }) },
                { key: 'alphabet_desc', label: t('connections.sortByAlphabetDesc', { defaultValue: '字母 Z→A' }) },
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
                  <CheckCircle2 size={18} color={colors.piktag500} />
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
                placeholderTextColor={colors.gray400}
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

      {/* (Cold-start Ask modal removed 2026-06-04 — the ask card was
          cut from the empty state; the AskStoryRow above owns its own
          AskCreateModal, so this duplicate instance is no longer
          needed.) */}
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  // --- Stories bar styles ---
  storiesContainer: {
    borderBottomWidth: 1,
    borderBottomColor: c.gray200,
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
    color: c.gray800,
    marginTop: 4,
    textAlign: 'center',
    width: 68,
  },
  storyText: {
    fontSize: 10,
    color: c.gray500,
    textAlign: 'center',
    width: 68,
    marginTop: 1,
  },
  // --- Main styles ---
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    // Solid theme background (was a hardcoded rgba(255,255,255,0.9)
    // — the migration couldn't see a non-COLORS literal, so the
    // header stayed a light band in dark mode). c.background =
    // white in light, pure black in dark.
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: c.gray900,
    lineHeight: 32,
  },
  // PikTag brand wordmark only (NOT the localized select-mode title which
  // shares headerTitle) → League Spartan brand typeface.
  brandWordmark: {
    fontFamily: 'LeagueSpartan-Bold',
  },
  headerSubtitle: {
    fontSize: 14,
    color: c.gray500,
    marginTop: 2,
    lineHeight: 20,
  },
  headerCount: {
    fontWeight: '700',
    color: c.accent500,
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
    backgroundColor: c.piktag50,
    borderBottomWidth: 1,
    borderBottomColor: c.piktag100,
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
    // `flexGrow: 1` (not `flex: 1`) — flex:1 caps the contentContainer
    // at viewport height, which made the 5-card cold-start
    // ListEmptyComponent clip with NO scroll past the 2nd card.
    // flexGrow allows it to fill the viewport when small AND grow
    // taller when content overflows (the scroll restores naturally).
    flexGrow: 1,
    paddingBottom: 100,
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
    color: c.gray700,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: c.gray500,
    textAlign: 'center',
    lineHeight: 24,
  },
  emptyButton: {
    marginTop: 20,
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Cold-start onboarding action-list empty state. Replaces the
  // single-CTA "scan a QR" empty state for users with 0 friends.
  emptyOnboardingContainer: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  phonePromptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag50,
    borderColor: c.piktag500,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    // 16px horizontal breathing room so the bordered card doesn't
    // run flush against the screen edge — the friend rows below
    // are edge-to-edge by design (no outline) but this banner
    // has a visible border that needs the inset to read as a
    // card, not a full-bleed bar.
    marginHorizontal: 16,
    marginBottom: 20,
  },
  phonePromptTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: c.piktag600,
    marginBottom: 4,
  },
  phonePromptBody: {
    fontSize: 12,
    lineHeight: 17,
    color: c.gray700,
  },
  phonePromptDismiss: {
    paddingLeft: 8,
    alignSelf: 'flex-start',
  },
  emptyOnboardingTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: c.gray900,
    marginBottom: 6,
  },
  // Cold-start single action (2026-06-29). Button = the locked tier-2
  // primary-CTA token (solid piktag500, white, radius 14, py 15, 700/16);
  // white icon/text intentionally fixed on the saturated fill.
  coldStartWrap: {
    marginTop: 10,
    gap: 10,
  },
  coldStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 15,
  },
  coldStartBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  coldStartDesc: {
    fontSize: 13,
    color: c.gray400,
    textAlign: 'center',
    lineHeight: 19,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  connectionItemSelected: {
    backgroundColor: c.piktag50,
  },
  // Not-yet-on-PikTag manual contact: same row metrics (so the
  // fixed getItemLayout height is unaffected), just slightly muted.
  connectionItemLocal: {
    opacity: 0.78,
  },
  localBadge: {
    alignSelf: 'flex-start',
    backgroundColor: c.gray100,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  localBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.gray500,
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
    color: c.gray900,
    lineHeight: 24,
    flexShrink: 1,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    // accentPop = high-saturation magenta. The "new" pill is exactly
    // the kind of "currently-highlighted moment" the accent is reserved
    // for — a temporary visual flag that should jump the eye on a row
    // amid otherwise-stable primary purple UI.
    color: c.accentPop,
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
    color: c.gray500,
    lineHeight: 20,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  tagsLine: {
    fontSize: 13,
    color: c.gray400,
    lineHeight: 18,
    marginTop: 3,
  },
  // Ask-preview chip — gradient-filled, white-text pill. Sits
  // below the tags row when the friend has a live Ask. Inline-
  // sized via alignSelf flex-start so the chip wraps tight to
  // the text width instead of stretching. The gradient + white
  // text deliberately uses the same red→magenta→deep-purple
  // sweep as the QR share screen + Vibe hero gradient + the
  // avatar's rotating ring — single brand-purple vocabulary for
  // "this surface is alive right now". Stronger visual weight
  // than the previous soft piktag50 pill because: the user
  // explicitly asked for Z-gen "buzz" energy, and a friend
  // ASK is genuinely a high-priority event worth interrupting
  // the row's neutral rhythm for.
  askPreviewChip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  askPreviewText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  // On This Day card
  onThisDayCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: 'rgba(140, 82, 255, 0.12)',
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
  networkLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  unreviewedLink: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag600,
  },
  reminderCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: 'rgba(236, 72, 153, 0.12)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fce7f3',
  },
  // Recommendation card
  recCard: {
    margin: 16,
    backgroundColor: c.piktag50,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: c.piktag100,
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
    color: c.piktag600,
  },
  recBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.gray100,
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
    color: c.gray900,
  },
  recUsername: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 1,
  },
  recTagCount: {
    fontSize: 12,
    color: c.piktag600,
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
    backgroundColor: c.white,
    borderTopWidth: 1,
    borderTopColor: c.gray100,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  batchBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
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
    color: c.gray900,
    marginBottom: 16,
  },
  // Batch Tag Modal
  batchTagModal: {
    backgroundColor: c.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  batchTagInput: {
    borderWidth: 2,
    borderColor: c.gray200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.gray900,
    marginBottom: 16,
  },
  batchTagSubmitBtn: {
    backgroundColor: c.piktag500,
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
    color: c.gray900,
  },
  // Friend statuses row
  statusSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    // Was a hardcoded #F3F4F6 (gray100 light value) — stayed a light
    // separator line on the dark friends list. c.gray100 themes it.
    borderBottomColor: c.gray100,
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
    borderColor: c.piktag400,
    padding: 2,
    marginBottom: 4,
  },
  statusAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  statusAvatarFallback: {
    backgroundColor: c.gray200,
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
    backgroundColor: c.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.gray100,
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
    backgroundColor: c.gray100,
    marginBottom: 4,
  },
  tagRecName: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray900,
    textAlign: 'center',
  },
  tagRecBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: c.piktag50,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tagRecBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: c.piktag600,
  },
  tagRecTags: {
    fontSize: 10,
    color: c.gray500,
    textAlign: 'center',
  },

  // Filter indicator
  filterIndicatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.piktag50,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.piktag300,
  },
  filterIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.piktag600,
  },

  // ─── Add-contact action sheet ────────────────────────────────
  addMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  addMenuSheet: {
    backgroundColor: c.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 16,
    // Generous bottom padding so the last row clears iPhone home
    // indicator on devices with safe area; SafeAreaView at the
    // screen root already sets the per-device offset, this is
    // additional buffer below the menu rows.
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
  },
  addMenuHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.gray200,
    marginBottom: 12,
  },
  addMenuTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: c.gray900,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  addMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: c.gray100,
  },
  addMenuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMenuTextWrap: {
    flex: 1,
  },
  addMenuRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray900,
    marginBottom: 2,
  },
  addMenuRowDesc: {
    fontSize: 12,
    color: c.gray500,
    lineHeight: 16,
  },

  // Filter Modal
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  filterModalContainer: {
    backgroundColor: c.white,
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
    color: c.gray900,
  },
  filterClearBtn: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  filterClearText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.red500,
  },
  filterEmptyText: {
    fontSize: 14,
    color: c.gray400,
    textAlign: 'center',
    paddingVertical: 24,
  },
  filterSearchInput: {
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: c.gray900,
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
    backgroundColor: c.fill,
    borderWidth: 1.5,
    // Visible hairline (was 'transparent' — the chip then had no
    // defined edge against the dark filter sheet in dark mode).
    // The 1.5px width was already reserved so the active-state
    // border swap stays layout-shift-free.
    borderColor: c.gray200,
  },
  filterTagChipActive: {
    backgroundColor: c.piktag50,
    borderColor: c.piktag500,
  },
  filterTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray700,
  },
  filterTagChipTextActive: {
    color: c.piktag600,
    fontWeight: '700',
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  sortOptionRowActive: {
    // No background change — the trailing checkmark is enough signal
    // and matches the filter modal's quiet selection style.
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '500',
    color: c.gray800,
  },
  sortOptionTextActive: {
    color: c.piktag600,
    fontWeight: '700',
  },
  });
}
