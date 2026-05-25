import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ListRenderItemInfo,
  Alert,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Search,
  Hash,
  Clock,
  TrendingUp,
  X,
  MapPin,
} from 'lucide-react-native';
import RingedAvatar from '../components/RingedAvatar';
import FriendsMapModal, { type FriendLocation } from '../components/FriendsMapModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync, Accuracy, reverseGeocodeAsync } from 'expo-location';
import { useTranslation } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { supabase } from '../lib/supabase';
import { getCache, setCache } from '../lib/dataCache';
import { stripSearchStopwords, filterLoneStopwordTokens } from '../lib/searchStopwords';
import { getSiblingTagIds, getTagNamesByIds } from '../lib/tagSiblings';
import { extractSearchIntent } from '../lib/extractSearchIntent';
import { sanitizeQueryForTelemetry } from '../lib/sanitizeTelemetry';
import { COLORS, BORDER_RADIUS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import { useRotatingPlaceholder } from '../hooks/useRotatingPlaceholder';
import ErrorState from '../components/ErrorState';
import LogoLoader from '../components/loaders/LogoLoader';
import { AskCreateModal } from '../components/ask/AskStoryRow';
import { useAskFeed } from '../hooks/useAskFeed';
import type { Tag, PiktagProfile } from '../types';

const RECENT_SEARCHES_KEY = 'piktag_recent_searches';
const MAX_RECENT_SEARCHES = 10;
const CACHE_KEY_POPULAR_TAGS = 'search_popular_tags';
const CACHE_KEY_SEARCH_QUERY = 'search_last_query';

type CategoryKey = 'popular' | 'nearby' | 'recent';

// ── Memoized list item components ──

type ProfileCardProps = {
  profile: PiktagProfile;
  onPress: (profile: PiktagProfile) => void;
  t: (key: string) => string;
};

const ProfileCard = React.memo(function ProfileCard({ profile, onPress, t }: ProfileCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => {
    onPress(profile);
  }, [onPress, profile]);

  return (
    <TouchableOpacity
      style={styles.profileCard}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <RingedAvatar
        size={51}
        ringStyle="subtle"
        name={profile.full_name || profile.username || ''}
        avatarUrl={profile.avatar_url}
      />
      <View style={styles.profileInfo}>
        <View style={styles.profileNameRow}>
          <Text style={styles.profileName} numberOfLines={1}>
            {profile.full_name || profile.username || t('common.unnamed')}
          </Text>
          {/* {profile.is_verified && (
            <CheckCircle2
              size={16}
              color={colors.blue500}
              fill={colors.blue500}
              strokeWidth={0}
              style={verifiedBadgeStyle}
            />
          )} */}
        </View>
        {profile.username && (
          <Text style={styles.profileUsername} numberOfLines={1}>
            @{profile.username}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

const verifiedBadgeStyle = { marginLeft: 4 };

// A local contact (non-member) the viewer manually tagged. Shown in the
// intersection-search Friends tab below member matches. Manual tags are
// owner-private, so this only ever surfaces for the user who set them.
type TaggedContact = {
  id: string;
  name: string;
  avatar_url: string | null;
};

type LocalContactCardProps = {
  contact: TaggedContact;
  onPress: (contact: TaggedContact) => void;
  t: (key: string, opts?: any) => string;
};

const LocalContactCard = React.memo(function LocalContactCard({ contact, onPress, t }: LocalContactCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => {
    onPress(contact);
  }, [onPress, contact]);

  return (
    <TouchableOpacity
      style={styles.profileCard}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <RingedAvatar
        size={51}
        ringStyle="subtle"
        name={contact.name || '?'}
        avatarUrl={contact.avatar_url}
      />
      <View style={styles.profileInfo}>
        <View style={styles.profileNameRow}>
          <Text style={styles.profileName} numberOfLines={1}>
            {contact.name || '?'}
          </Text>
        </View>
        <Text style={styles.profileUsername} numberOfLines={1}>
          {t('connections.notJoinedBadge', { defaultValue: '尚未加入 PikTag' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

type TagCardProps = {
  tag: Tag;
  isSelected?: boolean;
  onPress: (tag: Tag) => void;
  onLongPress?: (tag: Tag) => void;
  countSuffix: string;
  isTrending?: boolean;
  showSemanticType?: boolean;
  semanticTypeLabel?: string;
};

const TagCard = React.memo(function TagCard({ tag, isSelected, onPress, onLongPress, countSuffix, isTrending, showSemanticType, semanticTypeLabel }: TagCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.tagCard, isSelected && styles.tagCardHighlighted]}
      activeOpacity={0.7}
      onPress={() => onPress(tag)}
      onLongPress={onLongPress ? () => onLongPress(tag) : undefined}
    >
      <View style={styles.tagCardRow}>
        <Hash size={14} color={isSelected ? '#FFFFFF' : colors.piktag500} strokeWidth={2.5} />
        <Text style={[styles.tagName, isSelected && styles.tagNameHighlighted]} numberOfLines={1}>
          {tag.name}
        </Text>
        {showSemanticType && semanticTypeLabel ? (
          <View style={[styles.semanticBadge, isSelected && styles.semanticBadgeSelected]}>
            <Text style={[styles.semanticBadgeText, isSelected && styles.semanticBadgeTextSelected]}>{semanticTypeLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.tagCountRow}>
        {isTrending && (
          // accentPop on trending icon — only appears on tags that are
          // genuinely growing right now, exactly the "currently-active
          // high-pop highlight" the design system reserves the accent
          // for. Most tags don't render this, so the magenta jump
          // feels like a deliberate signal, not noise.
          <TrendingUp size={12} color={isSelected ? '#FFFFFF' : colors.accentPop} />
        )}
        <Text style={[styles.tagCount, isSelected && styles.tagCountHighlighted]}>
          {tag.usage_count}{countSuffix}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

type RecentSearchItemProps = {
  query: string;
  onPress: (query: string) => void;
  onDelete: (query: string) => void;
  deleteLabel: string;
};

const RecentSearchItem = React.memo(function RecentSearchItem({ query, onPress, onDelete, deleteLabel }: RecentSearchItemProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const handlePress = useCallback(() => {
    onPress(query);
  }, [onPress, query]);

  const handleDeletePress = useCallback(() => {
    onDelete(query);
  }, [onDelete, query]);

  return (
    <View style={styles.recentSearchItem}>
      <TouchableOpacity
        style={styles.recentSearchItemLeft}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Clock size={16} color={colors.gray400} />
        <Text style={styles.recentSearchText} numberOfLines={1}>{query}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleDeletePress}
        style={styles.recentSearchDeleteBtn}
        activeOpacity={0.6}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel={deleteLabel}
        accessibilityRole="button"
      >
        <X size={14} color={colors.gray400} />
      </TouchableOpacity>
    </View>
  );
});

// ── Helper: get user location (shared by nearby profiles & nearby tags) ──

async function getUserLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}

// ── Main component ──

type SearchScreenProps = {
  navigation: any;
};

export default function SearchScreen({ navigation }: SearchScreenProps) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  // GPS-derived city for {{city}} interpolation in the rotating
  // placeholder prompts. We previously read `profile.location` (a
  // free-text field) but that turned out to be empty for ~all users,
  // so the city prompt always fell back to "我附近". Now we reverse-
  // geocode the user's last shared GPS coords (`profile.latitude`/
  // `profile.longitude` — written every time they tap "Nearby" with
  // location permission). Reverse geocode runs on-device on iOS and
  // through Play Services on Android, so it's fast and offline-safe.
  // Caching: the lat/lng-keyed ref means we only call once per
  // location change, even though the effect re-evaluates on every
  // render.
  const { profile: authProfile } = useAuthProfile();
  const [userCity, setUserCity] = useState<string | null>(null);
  const lastGeocodedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const lat = authProfile?.latitude;
    const lng = authProfile?.longitude;
    if (lat == null || lng == null) {
      setUserCity(null);
      lastGeocodedKeyRef.current = null;
      return;
    }
    // Round to 2 decimals (~1 km granularity) so micro-position
    // drift while sitting still doesn't re-fire the geocode.
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    if (key === lastGeocodedKeyRef.current) return;
    lastGeocodedKeyRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const results = await reverseGeocodeAsync({ latitude: lat, longitude: lng });
        const r = results[0];
        // Order: city > subregion > region. iOS often returns city
        // for urban areas but only subregion for rural; Android can
        // return region (e.g. "Taipei City"). All three render fine
        // in the prompt template across all 15 locales.
        const cityName = r?.city || r?.subregion || r?.region || null;
        if (!cancelled) setUserCity(cityName);
      } catch {
        // Silent — null falls through to the locale's cityFallback
        // ("在我附近的設計師" / "Designers near me" / etc.)
        if (!cancelled) setUserCity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authProfile?.latitude, authProfile?.longitude]);
  const [isFocused, setIsFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);

  // Rotating prompt-style placeholder. Cycles through
  // `search.promptHints` (a per-locale array, e.g. "我需要懂攝影
  // 的朋友" / "在台北附近的設計師") so the search box reads as
  // "tell me what you need" instead of "type a name" — trains
  // users to start with intent, the discovery affordance that
  // distinguishes PikTag from a contacts app.
  //
  // The {{city}} interpolation is Search-specific so it stays
  // here; the calibrated rotation timing lives in the shared
  // useRotatingPlaceholder hook (same code as the "建立 Tag"
  // context input — one tuned implementation, no drift).
  const promptHints = useMemo(() => {
    const raw = t('search.promptHints', { returnObjects: true });
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const cityFallback = t('search.promptHintCityFallback');
    // When the user has a city, swap it in; otherwise replace the
    // whole entry with a locale-specific fallback so the array
    // length stays stable across users with/without location.
    return (raw as string[]).map((h) => {
      if (!h.includes('{{city}}')) return h;
      if (userCity) return h.replace('{{city}}', userCity);
      return cityFallback;
    });
  }, [t, userCity]);
  const placeholder = useRotatingPlaceholder(
    promptHints,
    t('search.searchPlaceholder'),
  );

  // Data states
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<PiktagProfile[]>([]);
  const [tagUsers, setTagUsers] = useState<{ tag: Tag; users: any[] }[]>([]);
  // People found via the SEARCHER'S OWN manual tags for the matched tag
  // words: member friends tagged through piktag_connection_tags, and
  // local contacts tagged through piktag_local_contacts. Text search
  // used to query only piktag_user_tags (public member self-tags), so
  // anyone you'd manually tagged was invisible when you typed that tag.
  // Owner-private by RLS — only the user who set the tags sees them.
  const [searchTaggedFriends, setSearchTaggedFriends] = useState<PiktagProfile[]>([]);
  const [searchTaggedContacts, setSearchTaggedContacts] = useState<TaggedContact[]>([]);
  // LLM zero-results recovery: when the normal substring search yields
  // nothing, the edge function `extract-search-intent` asks Gemini for
  // content nouns hiding inside the user's natural-language query. We
  // then re-run the tag substring search with those nouns. `Recovering`
  // drives the "AI thinking" loading state; `ExtractedKeywords` drives
  // the transparent "PikTag understood you mean:" chip above results.
  const [llmRecovering, setLlmRecovering] = useState(false);
  const [llmExtractedKeywords, setLlmExtractedKeywords] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [tagCategories, setTagCategories] = useState<string[]>([]);
  const [selectedTagCategory, setSelectedTagCategory] = useState<string | null>(null);
  const [trendingTagIds, setTrendingTagIds] = useState<Set<string>>(new Set());

  // Multi-tag selection (toggle only, no fetch until search button pressed)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const selectedTagIdSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  // Smart recommendations
  // Removed `recommendedUsers` (2026-05-25): the horizontal "你可能想
  // 認識" avatar row was generic "people you may know" surface — it
  // competed with the tag-first home and trained users to skim past
  // tags. Founder's call: trust tag-search + Ask (the explicit social
  // mechanisms) rather than algorithmic suggestion. The find_tag_
  // similar_strangers / search_screen_init RPCs still exist server-
  // side in case we revive this; the column is just dropped from
  // payload usage here.
  const [errorToast, setErrorToast] = useState<string | null>(null);
  // Tracks the auto-dismiss timer for the error toast so we can
  // clear it on unmount — otherwise navigating away within the
  // 2.5s dismiss window leaves a setState fire-and-forget that
  // hits an unmounted component.
  const errorToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (errorToastTimerRef.current) {
        clearTimeout(errorToastTimerRef.current);
        errorToastTimerRef.current = null;
      }
    },
    [],
  );
  // Set to `true` when the bootstrap (popular tags + recommendations)
  // returned nothing after both the RPC attempt AND the legacy
  // fallback. We use this — rather than just `!tags.length` — to avoid
  // confusing a brand-new account (legitimately empty) with a network
  // failure. The render path swaps in <ErrorState> with a retry CTA
  // when this is true.
  const [bootstrapFailed, setBootstrapFailed] = useState(false);


  // Refs for stable closures
  const skipNextSearch = useRef(false);
  const [intersectionMode, setIntersectionMode] = useState(false);
  const [intersectionProfiles, setIntersectionProfiles] = useState<PiktagProfile[]>([]);
  const [intersectionFriends, setIntersectionFriends] = useState<PiktagProfile[]>([]);
  const [intersectionExplore, setIntersectionExplore] = useState<PiktagProfile[]>([]);
  // Local contacts that match ALL selected tags (manual tags only —
  // owner-private). Rendered in the Friends tab below member matches.
  const [intersectionContacts, setIntersectionContacts] = useState<TaggedContact[]>([]);
  const [intersectionTab, setIntersectionTab] = useState<'friends' | 'explore'>('friends');
  const [intersectionSelectedTags, setIntersectionSelectedTags] = useState<Tag[]>([]);

  // Cached set of viewer's friend ids so every search result split is
  // a constant-time lookup. Fetched once on mount; stays valid for the
  // session (a freshly-added connection won't show up as "friend" until
  // next mount, but searches happen often enough that the trade-off
  // beats re-querying piktag_connections on every keystroke).
  // Map of friend user_id → connection_id (NOT a Set anymore). The
  // connection_id is needed to navigate to FriendDetail (which shows
  // the searcher's manual/private tags for that friend). Without it,
  // taps fall through to UserDetail (the public-only view) and the
  // manual tags become invisible — the bug founder caught 2026-05-26.
  // .has(userId) still works the same way for the friends-vs-explore
  // bucket logic; .get(userId) gives us the connection_id at tap time.
  const [myFriendIds, setMyFriendIds] = useState<Map<string, string>>(new Map());

  // Default tab for text-query search results. Mirrors intersectionTab's
  // semantics but lives separately because the two modes' result sets
  // and UI containers are different.
  const [searchTab, setSearchTab] = useState<'friends' | 'explore'>('friends');

  // Friends-on-map. Lives on the search screen because the map is now a
  // discovery affordance — same modal we used to host on Connections,
  // just relocated. Phase A keeps the data scope at 1st-degree only;
  // Phase B will expand to friends-of-friends with privacy opt-in.
  const [mapVisible, setMapVisible] = useState(false);
  const [mapFriends, setMapFriends] = useState<FriendLocation[]>([]);
  // Ask conversion from a dead-end search. If the user already has an
  // active ask, the modal opens in view mode (existingAsk); otherwise
  // it's a create form pre-seeded with the failed query.
  const [askVisible, setAskVisible] = useState(false);
  const { myAsk, refresh: refreshAsk } = useAskFeed();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('piktag_connections')
        .select(
          'id, connected_user_id, nickname, connected_user:piktag_profiles!connected_user_id(id, full_name, username, avatar_url, latitude, longitude, share_location)',
        )
        .eq('user_id', user.id);
      if (cancelled || !data) return;
      const friends: FriendLocation[] = [];
      for (const row of data as any[]) {
        const p = row.connected_user;
        if (!p?.latitude || !p?.longitude) continue;
        if (p.share_location === false) continue;
        friends.push({
          id: row.connected_user_id,
          connectionId: row.id,
          name: row.nickname || p.full_name || p.username || '?',
          avatarUrl: p.avatar_url || null,
          latitude: p.latitude,
          longitude: p.longitude,
        });
      }
      setMapFriends(friends);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);
  const recentSearchesRef = useRef(recentSearches);
  recentSearchesRef.current = recentSearches;
  const isMountedRef = useRef(true);

  // LRU cache of recent search results so a user who types a query,
  // deletes back, and retypes the same thing doesn't re-hit the DB.
  // Capped at 20 entries — on overflow we evict the oldest insert.
  type SearchCacheEntry = {
    tags: any[];
    profiles: any[];
    tagUsers: { tag: Tag; users: any[] }[];
    extractedKeywords?: string[];
  };
  const searchCacheRef = useRef<Map<string, SearchCacheEntry>>(new Map());
  const SEARCH_CACHE_MAX = 20;

  // Sequence counter so a slow in-flight search can't overwrite the
  // results of a newer one. Cheaper than AbortController and doesn't
  // require threading a signal through every Supabase query.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch the viewer's friend ids. Used to split every search result
  // set into "friends" / "explore" buckets in O(1) per row. Fired on
  // mount AND on every screen focus so a freshly-followed user from
  // the UserDetail / FriendDetail subscreens immediately moves from
  // the explore bucket to the friends bucket on this user's next
  // search. Without the focus refetch, the cache stayed stale until
  // a full app reload — users reported "I followed them but search
  // still says they're not my friend".
  const fetchMyFriendIds = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('piktag_connections')
      .select('id, connected_user_id')
      .eq('user_id', user.id);
    const m = new Map<string, string>();
    for (const c of (data ?? []) as Array<{ id: string; connected_user_id: string }>) {
      if (c.connected_user_id && c.id) m.set(c.connected_user_id, c.id);
    }
    setMyFriendIds(m);
  }, [user]);

  useEffect(() => {
    fetchMyFriendIds();
  }, [fetchMyFriendIds]);

  useFocusEffect(
    useCallback(() => {
      fetchMyFriendIds();
    }, [fetchMyFriendIds]),
  );

  // ── Data loaders (all wrapped in useCallback) ──

  const loadRecentSearches = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {}
  }, []);

  const saveRecentSearch = useCallback(async (query: string) => {
    try {
      const trimmed = query.trim();
      if (!trimmed) return;
      const current = recentSearchesRef.current;
      const updated = [trimmed, ...current.filter((s) => s !== trimmed)].slice(
        0,
        MAX_RECENT_SEARCHES,
      );
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch {}
  }, []);

  // Detect tag language from text characters
  const detectTagLang = useCallback((name: string): string => {
    if (/[\u4e00-\u9fff]/.test(name)) return 'zh';     // CJK Chinese
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(name)) return 'ja'; // Hiragana/Katakana
    if (/[\uac00-\ud7af]/.test(name)) return 'ko';     // Korean
    if (/[\u0e00-\u0e7f]/.test(name)) return 'th';     // Thai
    if (/[\u0600-\u06ff]/.test(name)) return 'ar';     // Arabic
    if (/[\u0900-\u097f]/.test(name)) return 'hi';     // Hindi
    if (/[\u0980-\u09ff]/.test(name)) return 'bn';     // Bengali
    return 'en'; // Latin/default
  }, []);

  const loadPopularTags = useCallback(async () => {
    const cached = getCache<Tag[]>(CACHE_KEY_POPULAR_TAGS);
    if (cached) {
      setTags(cached);
      const cats = [...new Set(cached.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
      setTagCategories(cats);
      setLoading(false);
      setInitialLoading(false);
    } else {
      setLoading(true);
    }

    // Use device system language (not app setting)
    const deviceLocale = getLocales()?.[0]?.languageCode || 'zh';
    const userLang = deviceLocale;

    // STRATEGY: prefer tags that are popular among NEARBY users. If we can
    // get enough tags from the ~50km radius, those are way more relevant than
    // the global top-150. If nearby returns nothing or too little (no GPS,
    // no neighbors, RLS, etc.), fall back to the global popular set so the
    // tab is never empty.
    //
    // This replaces what used to be two separate tabs (熱門標籤 + 附近標籤)
    // — same name, smarter content.
    try {
      const location = await getUserLocation();
      if (location) {
        const { lat: userLat, lng: userLng } = location;
        const range = 0.5; // ~50km box
        const { data: nearbyProfiles } = await supabase
          .from('piktag_profiles').select('id')
          .gte('latitude', userLat - range).lte('latitude', userLat + range)
          .gte('longitude', userLng - range).lte('longitude', userLng + range)
          .limit(500);
        if (nearbyProfiles && nearbyProfiles.length > 0) {
          const nearbyIds = nearbyProfiles.map((p: any) => p.id);
          // Query SELF-DECLARED public tags of nearby users directly. This
          // replaces the previous 3-hop path that went through piktag_connections
          // → piktag_connection_tags, which had two problems:
          //   1. Semantic: it was counting "tags these nearby users put on
          //      THEIR friends", not "tags these nearby users claim for
          //      themselves" — weird composition for a discovery feature.
          //   2. Privacy: piktag_connection_tags stores private hidden tags
          //      side-by-side with public pick tags; the old query had no
          //      is_private filter, so if RLS ever loosened it could leak
          //      other users' hidden tags into the nearby popular set.
          //
          // The new query aligns with loadRecommendations + the trending
          // detection below — all three now consume piktag_user_tags with
          // is_private=false, so discovery is consistently about self-declared
          // public identity markers.
          const { data: tagData } = await supabase
            .from('piktag_user_tags')
            .select('tag:piktag_tags!tag_id(id, name, semantic_type, usage_count)')
            .in('user_id', nearbyIds)
            .eq('is_private', false)
            .limit(5000);
          if (tagData && tagData.length > 0) {
            const tagMap: Record<string, { tag: any; count: number }> = {};
            for (const ut of tagData) {
              const tItem = (ut as any).tag;
              if (tItem && !tagMap[tItem.id]) tagMap[tItem.id] = { tag: tItem, count: 0 };
              if (tItem) tagMap[tItem.id].count++;
            }
            const nearbySorted = Object.values(tagMap)
              .sort((a, b) => b.count - a.count)
              .slice(0, 50)
              .map((item) => ({ ...item.tag, usage_count: item.count }));
            // Only commit if we got a meaningful number — otherwise the
            // trickle would feel weirder than the global default.
            if (nearbySorted.length >= 5) {
              setCache(CACHE_KEY_POPULAR_TAGS, nearbySorted);
              setTags(nearbySorted);
              const cats = [...new Set(nearbySorted.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
              setTagCategories(cats);
              setTrendingTagIds(new Set()); // trending only meaningful in global view
              setLoading(false);
              setInitialLoading(false);
              return;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[SearchScreen] nearby-first popular tags failed, falling back:', err);
    }

    // Fallback: global popular tags (original behaviour).
    try {
      // Fetch more tags, then sort by language affinity + usage
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('id, name, semantic_type, usage_count')
        .order('usage_count', { ascending: false })
        .limit(150);

      if (!error && data) {
        // Sort: same language first, then by usage_count
        const sorted = [...data].sort((a, b) => {
          const aLang = detectTagLang(a.name);
          const bLang = detectTagLang(b.name);
          const aMatch = aLang === userLang ? 1 : 0;
          const bMatch = bLang === userLang ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
          return b.usage_count - a.usage_count;
        }).slice(0, 50);

        setCache(CACHE_KEY_POPULAR_TAGS, sorted);
        setTags(sorted as Tag[]);
        const cats = [...new Set(sorted.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
        setTagCategories(cats);

        // Calculate trending: count user_tags created in last 7 days per tag
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const tagIds = data.map((t: any) => t.id);
        const { data: recentData } = await supabase
          .from('piktag_user_tags')
          .select('tag_id')
          .in('tag_id', tagIds)
          .gte('created_at', sevenDaysAgo)
          .limit(3000);

        if (recentData && recentData.length > 0) {
          // Count recent additions per tag
          const recentCounts = new Map<string, number>();
          for (const r of recentData) {
            recentCounts.set(r.tag_id, (recentCounts.get(r.tag_id) || 0) + 1);
          }
          // Tag is trending if recent growth >= 3 new users in 7 days,
          // or recent growth is >= 20% of total usage
          const trending = new Set<string>();
          for (const tag of data) {
            const recent = recentCounts.get(tag.id) || 0;
            const growthRate = tag.usage_count > 0 ? recent / tag.usage_count : 0;
            if (recent >= 3 || growthRate >= 0.2) {
              trending.add(tag.id);
            }
          }
          setTrendingTagIds(trending);
        } else {
          setTrendingTagIds(new Set());
        }
      }
    } catch (err) {
      console.warn('[SearchScreen] loadPopularTags fell all the way through — both nearby and global paths failed:', err);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, []);

  const loadNearbyProfiles = useCallback(async () => {
    setLoading(true);
    setTags([]);
    try {
      const location = await getUserLocation();

      // Fire profile‑location update in background (no await)
      if (location && user) {
        supabase
          .from('piktag_profiles')
          .update({ latitude: location.lat, longitude: location.lng, location_updated_at: new Date().toISOString() })
          .eq('id', user.id)
          .then(() => {});
      }

      // Fetch profiles with lat/lng
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_verified, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(50);

      if (!error && data && isMountedRef.current) {
        // Cast once at the Supabase boundary — the `.select(...)`
        // result type is structurally narrower than PiktagProfile but
        // every selected column is on the full type. After this the
        // sort/filter chain types correctly without per-callsite casts.
        const profiles = data as PiktagProfile[];
        if (location) {
          const { lat: userLat, lng: userLng } = location;
          // Sort by distance
          const sorted = profiles.sort((a, b) => {
            const distA = Math.sqrt(
              Math.pow((a.latitude || 0) - userLat, 2) + Math.pow((a.longitude || 0) - userLng, 2)
            );
            const distB = Math.sqrt(
              Math.pow((b.latitude || 0) - userLat, 2) + Math.pow((b.longitude || 0) - userLng, 2)
            );
            return distA - distB;
          });
          setProfiles(sorted.filter((p) => p.id !== user?.id).slice(0, 20));
        } else {
          setProfiles(profiles.filter((p) => p.id !== user?.id).slice(0, 20));
        }
      }
    } catch (err) {
      console.warn('[SearchScreen] loadNearbyProfiles failed:', err);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [user]);

  // ── Load initial data on mount (parallel) ──

  // loadRecommendations REMOVED 2026-05-25. See state-declaration
  // comment near top of the component for the rationale (tag-first +
  // Ask, no algorithmic suggestion surface here).

  // Fast path: one RPC returns popular tags, recommended users, and
  // category roll-up in a single round-trip. Falls back to the legacy
  // parallel loaders if the function is missing or errors. See
  // supabase/migrations/20260428p_search_init_rpc.sql.
  const loadInitialViaRpc = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc('search_screen_init');
      if (error || !data || typeof data !== 'object') return false;
      const payload = data as {
        popular_tags?: any[];
        recent_categories?: any[];
      };
      const popular = Array.isArray(payload.popular_tags) ? payload.popular_tags : [];
      // The RPC still returns recommended_users — we just ignore it.
      // Field is left in the server contract for a possible revival
      // (see state-declaration comment).
      if (popular.length === 0) return false;

      setCache(CACHE_KEY_POPULAR_TAGS, popular as Tag[]);
      setTags(popular as Tag[]);
      const cats = [
        ...new Set(popular.map((t: any) => t.semantic_type).filter(Boolean)),
      ] as string[];
      setTagCategories(cats);
      setLoading(false);
      setInitialLoading(false);
      return true;
    } catch (err) {
      console.warn('[SearchScreen] search_screen_init RPC failed, falling back:', err);
      // Distinct from "RPC succeeded but empty" — this is a real
      // transport failure. Flag it so the legacy fallback's failure
      // can be combined with this signal to surface <ErrorState>
      // instead of a confusingly empty Search tab.
      setBootstrapFailed(true);
      return false;
    }
  }, []);

  // Bootstrap runner extracted so the same code path serves cold-start
  // load and the user-tapped retry. Tracks `bootstrapFailed` only when
  // both the RPC AND the legacy fallback came back empty — that's the
  // signal the network is the problem, not the data.
  const runBootstrap = useCallback(async () => {
    setBootstrapFailed(false);
    setInitialLoading(true);
    // Always load recent searches (local-only, cheap, doesn't need net).
    loadRecentSearches();
    const ok = await loadInitialViaRpc();
    if (ok) return;
    // Legacy fallback. We await so the failure flag is meaningful;
    // both loaders catch internally so we have to inspect the resulting
    // state ourselves.
    try {
      await loadPopularTags();
      // If popular tags came back empty, an empty default surface is
      // still legit (brand-new instance with no tag activity yet) —
      // bootstrapFailed is only flagged when loadInitialViaRpc threw
      // a transport error.
    } catch {
      // Loader threw outright — definitely a network/server problem.
    } finally {
      setInitialLoading(false);
    }
  }, [
    loadInitialViaRpc,
    loadPopularTags,
    loadRecentSearches,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await runBootstrap();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [runBootstrap]);

  // Auto-retry the bootstrap on reconnect when the previous attempt
  // flagged a network failure. Without this, users who opened Search
  // while offline would be stuck on the error surface even after
  // connectivity returned.
  useNetInfoReconnect(useCallback(() => {
    if (bootstrapFailed) {
      void runBootstrap();
    }
  }, [bootstrapFailed, runBootstrap]));

  // ── Event handlers (all useCallback) ──

  const handleCategoryPress = useCallback((key: CategoryKey) => {
    setSearchQuery('');
    setProfiles([]);
    setTags([]);
    setActiveCategory(key === 'popular' ? null : key);
    switch (key) {
      case 'popular': loadPopularTags(); break;
      case 'nearby': loadNearbyProfiles(); break;
      case 'recent': setLoading(false); break;
    }
  }, [loadPopularTags, loadNearbyProfiles]);

  const performSearch = useCallback(
    async (query: string) => {
      // Strip natural-language scaffolding ("找在扶輪社的朋友" →
      // "扶輪社") so the substring search has a chance. Idempotent +
      // falls back to the literal phrase if over-strips. Then split
      // + filter lone stopword tokens ("找 PM 朋友" → ["PM"]).
      const cleaned = stripSearchStopwords(query.trim().replace(/#/g, ''));
      let keywords = cleaned
        .split(/[\s,，、]+/)
        .map(k => k.trim())
        .filter(Boolean);
      keywords = filterLoneStopwordTokens(keywords);
      if (keywords.length === 0) {
        // User typed only stopwords — fall back to the literal phrase
        // so we at least ilike-search what they typed.
        const literal = query.trim().replace(/#/g, '');
        if (literal) keywords = [literal];
      }

      if (keywords.length === 0) {
        setActiveCategory(null);
        setLlmExtractedKeywords([]);
        loadPopularTags();
        return;
      }

      // Cache hit: skip the DB round-trips entirely. Move to
      // most-recently-used position by delete+set.
      const cacheKey = query.trim().toLowerCase();
      const cache = searchCacheRef.current;
      const cached = cache.get(cacheKey);
      if (cached) {
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        setActiveCategory(null);
        setTags(cached.tags);
        setProfiles(cached.profiles);
        setTagUsers(cached.tagUsers);
        // Restore the AI-extracted keywords chip too, so a repeated
        // recovery-fed query shows the same "PikTag understood..." line
        // without paying the LLM again.
        setLlmExtractedKeywords(cached.extractedKeywords || []);
        // Bust the private-world effect's sig guard so it re-fires
        // for the same query+tag combo. Without this, tapping a recent
        // search for a query that was previously searched in this
        // session would restore tags via the cache but the L1829
        // effect — which actually fetches `searchTaggedFriends` /
        // `searchTaggedContacts` — would short-circuit on identical
        // sig, leaving the result list visually empty (chip shown,
        // no people underneath). Symptom the founder caught: a
        // recent-search tap for "天上聖母" rendered the #媽祖 chip
        // but no friend row, while a fresh type of the same query
        // surfaced the friend. Same applies to the searchTab auto-
        // select effect — without this reset the tab can stay on
        // an explore-only bucket when the cached query had only
        // friend matches.
        manualTagSigRef.current = '';
        searchTabAutoQueryRef.current = '';
        saveRecentSearch(query.trim());
        return;
      }

      // Use first keyword for main search (profiles + aliases)
      const mainKeyword = keywords[0];

      const seq = ++searchSeqRef.current;
      setLoading(true);
      setActiveCategory(null);
      // Clear any stale AI-extracted-keywords chip from the previous
      // search; recovery will repopulate this only if it actually fires.
      setLlmExtractedKeywords([]);

      try {
        // Search tags: match ANY keyword
        const tagPromises = keywords.map(kw =>
          supabase
            .from('piktag_tags')
            .select('id, name, semantic_type, usage_count, concept_id')
            .ilike('name', `%${kw}%`)
            .order('usage_count', { ascending: false })
            .limit(20)
        );

        const [aliasResult, profilesResult, biolinkResult, ...tagResults] = await Promise.all([
          // Alias search with first keyword
          supabase
            .from('tag_aliases')
            .select('concept_id, concept:tag_concepts(canonical_name, semantic_type)')
            .ilike('alias', `%${mainKeyword}%`)
            .limit(10),
          // Profile search with first keyword
          supabase
            .from('piktag_profiles')
            .select('id, username, full_name, avatar_url, is_verified')
            .or(`username.ilike.%${mainKeyword}%,full_name.ilike.%${mainKeyword}%,headline.ilike.%${mainKeyword}%,bio.ilike.%${mainKeyword}%`)
            .limit(20),
          // Biolinks search — surfaces a profile when its handle lives
          // in a biolink rather than in the username/headline. Catches
          // the "I know them as @alex_pikt on IG" / "fullwish on LINE"
          // input pattern that profile-field search alone misses. The
          // user_id from a biolink hit gets resolved to its profile
          // via the inner join in one round-trip.
          //
          // Privacy: visibility='public' filter is the guard — only
          // biolinks the owner has explicitly marked public are
          // searchable. is_active filters out soft-deleted rows.
          //
          // Cost note: `url ILIKE` can match domain noise on generic
          // platform-name queries ("instagram" → every IG biolink).
          // Watch telemetry; if that turns out to be a real problem,
          // either blacklist platform domains in stopwords or split
          // out a derived `handle` column. Premature for now.
          supabase
            .from('piktag_biolinks')
            .select('user_id, piktag_profiles!inner(id, username, full_name, avatar_url, is_verified)')
            .or(`label.ilike.%${mainKeyword}%,url.ilike.%${mainKeyword}%`)
            .eq('visibility', 'public')
            .eq('is_active', true)
            .limit(20),
          ...tagPromises,
        ]);

        // Merge tag results, deduplicate by id
        const tagMap = new Map<string, any>();
        for (const result of tagResults) {
          for (const tag of (result.data || [])) {
            if (!tagMap.has(tag.id)) tagMap.set(tag.id, tag);
          }
        }
        const tagsResult = { data: [...tagMap.values()].sort((a, b) => b.usage_count - a.usage_count) };

        // Merge alias results: find tags by concept_id
        let mergedTags = tagsResult.data || [];
        if (!aliasResult.error && aliasResult.data && aliasResult.data.length > 0) {
          const conceptIds = aliasResult.data.map((a: any) => a.concept_id).filter(Boolean);
          if (conceptIds.length > 0) {
            const { data: conceptTags } = await supabase
              .from('piktag_tags')
              .select('id, name, semantic_type, usage_count, concept_id')
              .in('concept_id', conceptIds)
              .order('usage_count', { ascending: false })
              .limit(10);

            if (conceptTags) {
              // Deduplicate by tag id
              const existingIds = new Set(mergedTags.map((t: any) => t.id));
              for (const ct of conceptTags) {
                if (!existingIds.has(ct.id)) {
                  mergedTags.push(ct);
                }
              }
            }
          }
        }

        // Bail if a newer search has started — don't clobber its UI state.
        if (seq !== searchSeqRef.current) return;

        let finalTagUsers: { tag: Tag; users: any[] }[] = [];
        if (mergedTags.length > 0) {
          setTags(mergedTags);

          // Fast path: one RPC returns the page-ready ranked user slice.
          // We then group locally by the top-3 tags so the existing UI
          // (tag-grouped sections) stays unchanged.
          let rpcGrouped: { tag: Tag; users: any[] }[] | null = null;
          try {
            const { data: rpcRows, error: rpcErr } = await supabase.rpc('search_users', {
              // Pass the FULL multi-keyword query — search_users now
              // tokenizes server-side (20260518000000 migration), so
              // "designer taipei" matches tags for both words instead
              // of being ignored after keywords[0]. Re-joined with a
              // space; the RPC re-splits on whitespace.
              p_query: keywords.join(' '),
              p_limit: 50,
            });
            if (!rpcErr && Array.isArray(rpcRows) && rpcRows.length > 0) {
              const seenIds = new Set<string>();
              const flat = (rpcRows as any[])
                .map((r) => ({
                  id: r.id,
                  username: r.username,
                  full_name: r.full_name,
                  avatar_url: r.avatar_url,
                  is_verified: r.is_verified,
                  is_public: true,
                }))
                .filter((p) => p.id !== user?.id && !seenIds.has(p.id) && (seenIds.add(p.id), true));
              if (flat.length > 0) {
                // Group: assign all matched users to the top tag bucket.
                // The legacy UI shows up to 3 buckets — we surface them
                // all under the strongest matched tag, which is the
                // common case anyway (most queries return a single tag).
                const topTag = mergedTags[0];
                rpcGrouped = [{ tag: topTag as Tag, users: flat.slice(0, 10) }];
              } else {
                rpcGrouped = [];
              }
            }
          } catch (rpcCatchErr) {
            // RPC missing or runtime error — fall back to legacy loop.
            console.warn('[SearchScreen] search_users RPC failed, falling back:', rpcCatchErr);
          }

          if (rpcGrouped !== null) {
            setTagUsers(rpcGrouped);
            finalTagUsers = rpcGrouped;
          } else {
          // Fetch users who have the top matched tags OR same concept (max 3 tags, 10 users each)
          const topTags = mergedTags.slice(0, 3);
          if (topTags.length > 0) {
            const tagUserResults: { tag: Tag; users: any[] }[] = [];
            for (const tag of topTags) {
              // Find all tag_ids sharing the same concept
              let allTagIds = [tag.id];
              if ((tag as any).concept_id) {
                const { data: siblingTags } = await supabase
                  .from('piktag_tags')
                  .select('id')
                  .eq('concept_id', (tag as any).concept_id);
                if (siblingTags) {
                  allTagIds = [...new Set([tag.id, ...siblingTags.map((t: any) => t.id)])];
                }
              }

              const { data: utData } = await supabase
                .from('piktag_user_tags')
                .select('user_id, piktag_profiles!inner(id, username, full_name, avatar_url, is_verified, is_public)')
                .in('tag_id', allTagIds)
                .eq('is_private', false)
                .limit(10);

              if (utData && utData.length > 0) {
                // Deduplicate users (same user may have multiple synonym tags)
                const seenIds = new Set<string>();
                const users = utData
                  .map((ut: any) => ut.piktag_profiles)
                  .filter((p: any) => {
                    if (!p || !p.is_public || p.id === user?.id || seenIds.has(p.id)) return false;
                    seenIds.add(p.id);
                    return true;
                  });
                if (users.length > 0) {
                  tagUserResults.push({ tag, users });
                }
              }
            }
            setTagUsers(tagUserResults);
            finalTagUsers = tagUserResults;
          } else {
            setTagUsers([]);
          }
          }
        } else {
          setTags([]);
          setTagUsers([]);
        }

        // Merge direct profile hits + biolink-derived profile hits.
        // Order: direct hits first (stronger signal — name/headline
        // matches the query verbatim), then biolink hits (handle was
        // hiding inside a social URL). Self-exclude + dedupe by id.
        const profileMap = new Map<string, PiktagProfile>();
        if (!profilesResult.error && profilesResult.data) {
          for (const p of profilesResult.data as PiktagProfile[]) {
            if (p && p.id && p.id !== user?.id && !profileMap.has(p.id)) {
              profileMap.set(p.id, p);
            }
          }
        }
        if (!biolinkResult.error && biolinkResult.data) {
          // Supabase types the inner-join column as an array even when
          // the FK is many-to-one — handle both shapes defensively so
          // a runtime shape change doesn't silently drop matches.
          for (const row of biolinkResult.data as any[]) {
            const joined = row?.piktag_profiles;
            const p: PiktagProfile | null = Array.isArray(joined)
              ? (joined[0] ?? null)
              : (joined ?? null);
            if (p && p.id && p.id !== user?.id && !profileMap.has(p.id)) {
              profileMap.set(p.id, p);
            }
          }
        }
        const finalProfiles = [...profileMap.values()];
        setProfiles(finalProfiles);

        // === Zero-results LLM recovery ===
        // When the regular substring search + stopword stripping yields
        // nothing, ask Gemini (via the extract-search-intent edge fn)
        // for the content nouns inside the user's sentence and re-run
        // the tag search with them. Covers natural-language queries in
        // any language the client-side stopword stripper doesn't handle
        // (ja/ko/th/es/fr/...) plus complex multi-concept en/zh queries.
        // `loading` stays true through recovery — listData swaps from
        // generic spinner to the "AI thinking" variant via llmRecovering.
        let postRecoveryTags = mergedTags;
        let postRecoveryKeywords: string[] = [];
        // Captured for telemetry below: was the public-query path
        // empty (and therefore did we enter the LLM recovery path)?
        const directHit =
          mergedTags.length > 0 ||
          finalProfiles.length > 0 ||
          finalTagUsers.length > 0;
        let recoveryTriggered = false;
        if (
          seq === searchSeqRef.current &&
          mergedTags.length === 0 &&
          finalProfiles.length === 0 &&
          finalTagUsers.length === 0
        ) {
          recoveryTriggered = true;
          setLlmRecovering(true);
          try {
            const extracted = await extractSearchIntent(query.trim());
            if (seq === searchSeqRef.current && extracted.length > 0) {
              // Pass A — direct name match on piktag_tags. Hits when a
              // Gemini-extracted keyword is itself a substring of (or
              // contains) a real tag name. Cheap, deterministic.
              const llmResults = await Promise.all(
                extracted.map((kw) =>
                  supabase
                    .from('piktag_tags')
                    .select('id, name, semantic_type, usage_count, concept_id')
                    .ilike('name', `%${kw}%`)
                    .order('usage_count', { ascending: false })
                    .limit(10),
                ),
              );
              const llmTagMap = new Map<string, any>();
              for (const r of llmResults) {
                for (const t of (r.data || [])) {
                  if (!llmTagMap.has(t.id)) llmTagMap.set(t.id, t);
                }
              }
              // Pass B — alias → concept → tag expansion. Required
              // for semantic bridges where the user's natural-language
              // query has zero substring overlap with the canonical
              // tag name (e.g. "賣房子" never substring-matches
              // "商用不動產", but they share a "real estate" concept
              // via curated alias). Aligns the client with what
              // search_users already does server-side.
              //
              // IMPORTANT: only expand keywords of length ≥ 2 chars.
              // Pass A's single-CJK-char keywords (the "養貓" → also
              // "貓" trick we ask Gemini for) are intentionally broad
              // for direct NAME match — ILIKE '%貓%' usefully hits the
              // short tag 「貓派」. But applied to ALIASES, a single
              // char ILIKE explodes — for "天上聖母" Gemini also emits
              // "天 / 聖 / 母", alias ILIKE '%天%' matches dozens of
              // unrelated aliases (天主教 / 春天 / 母語 / …), each
              // pointing to a different concept that drags in all its
              // sibling tags. The launch test surfaced 14 unrelated
              // chips this way. 2-char floor is the cheapest correct
              // fix — real CJK content nouns are ≥ 2 chars by language
              // structure, English/JP keywords already are.
              try {
                const aliasKeywords = extracted.filter(
                  (kw) => typeof kw === 'string' && kw.trim().length >= 2,
                );
                if (aliasKeywords.length > 0) {
                  const aliasResults = await Promise.all(
                    aliasKeywords.map((kw) =>
                      supabase
                        .from('tag_aliases')
                        .select('concept_id')
                        .ilike('alias', `%${kw}%`)
                        .limit(10),
                    ),
                  );
                  const conceptIds = new Set<string>();
                  for (const r of aliasResults) {
                    for (const a of (r.data || []) as any[]) {
                      if (a.concept_id) conceptIds.add(a.concept_id);
                    }
                  }
                  if (conceptIds.size > 0) {
                    const { data: conceptTags } = await supabase
                      .from('piktag_tags')
                      .select('id, name, semantic_type, usage_count, concept_id')
                      .in('concept_id', [...conceptIds])
                      .order('usage_count', { ascending: false })
                      .limit(10);
                    for (const t of (conceptTags || []) as any[]) {
                      if (!llmTagMap.has(t.id)) llmTagMap.set(t.id, t);
                    }
                  }
                }
              } catch (aliasErr) {
                console.warn('[SearchScreen] alias→concept expansion failed:', aliasErr);
              }
              const llmTags = [...llmTagMap.values()];
              if (seq === searchSeqRef.current) {
                postRecoveryKeywords = extracted;
                setLlmExtractedKeywords(extracted);
                if (llmTags.length > 0) {
                  postRecoveryTags = llmTags;
                  setTags(llmTags as Tag[]);
                  // Pull users for the recovered tags too. Without
                  // this, recovery surfaces a "#tag" chip but leaves
                  // the result list empty — the viewer has to tap the
                  // chip to drill in. That's a friend-add miss against
                  // the North Star (the whole point of recovery is to
                  // bridge "natural-language query" → matching people).
                  // search_users tokenizes server-side + does the
                  // alias→concept→tag expansion + filters self/blocks
                  // (mirrors the non-recovery RPC call at L1123).
                  try {
                    const { data: rpcRows, error: rpcErr } = await supabase.rpc(
                      'search_users',
                      { p_query: extracted.join(' '), p_limit: 50 },
                    );
                    if (
                      !rpcErr &&
                      seq === searchSeqRef.current &&
                      Array.isArray(rpcRows) &&
                      rpcRows.length > 0
                    ) {
                      const seenIds = new Set<string>();
                      const flat = (rpcRows as any[])
                        .map((r) => ({
                          id: r.id,
                          username: r.username,
                          full_name: r.full_name,
                          avatar_url: r.avatar_url,
                          is_verified: r.is_verified,
                          is_public: true,
                        }))
                        .filter(
                          (p) =>
                            p.id !== user?.id &&
                            !seenIds.has(p.id) &&
                            (seenIds.add(p.id), true),
                        );
                      if (flat.length > 0) {
                        const recoveredGrouped = [
                          { tag: llmTags[0] as Tag, users: flat.slice(0, 10) },
                        ];
                        setTagUsers(recoveredGrouped);
                        finalTagUsers = recoveredGrouped;
                      }
                    }
                  } catch (rpcCatchErr) {
                    console.warn(
                      '[SearchScreen] recovery search_users RPC failed:',
                      rpcCatchErr,
                    );
                  }
                }
              }
            }
          } catch (recErr) {
            console.warn('[SearchScreen] LLM recovery failed:', recErr);
          } finally {
            if (seq === searchSeqRef.current) setLlmRecovering(false);
          }
        }

        // Cache this result set so typing-then-retyping is free. We
        // cache the POST-recovery state — a repeated recovery-fed
        // query gets the chip + results instantly, no second LLM call.
        const entry: SearchCacheEntry = {
          tags: postRecoveryTags,
          profiles: finalProfiles,
          tagUsers: finalTagUsers,
          extractedKeywords: postRecoveryKeywords,
        };
        cache.set(cacheKey, entry);
        if (cache.size > SEARCH_CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }

        // Save to recent searches
        saveRecentSearch(query.trim());

        // Telemetry — fire-and-forget insert so the founder can see
        // post-launch which queries kept dying (especially "recovery
        // fired but still nothing" — those feed the alias seed work).
        // RLS scopes the row to auth.uid(); a 30-day cron prunes.
        if (user) {
          void supabase
            .from('piktag_search_telemetry')
            .insert({
              user_id: user.id,
              // Sanitize before storing — RLS already scopes rows to
              // auth.uid(), but redacting email/phone-shape strings
              // means future cross-user "what keeps failing" analysis
              // can't accidentally surface a user's contact details.
              query: sanitizeQueryForTelemetry(query),
              direct_hit: directHit,
              recovery_triggered: recoveryTriggered,
              extracted_keywords:
                postRecoveryKeywords.length > 0 ? postRecoveryKeywords : null,
              final_tag_count: postRecoveryTags.length,
              final_profile_count: finalProfiles.length,
              final_tag_user_count: finalTagUsers.length,
              locale: i18n.language || null,
            });
        }
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        console.warn('[SearchScreen] search query failed:', err);
        setTags([]);
        setProfiles([]);
        setErrorToast(t('common.unknownError'));
        if (errorToastTimerRef.current) clearTimeout(errorToastTimerRef.current);
        errorToastTimerRef.current = setTimeout(() => setErrorToast(null), 2500);
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    },
    [loadPopularTags, saveRecentSearch, user, i18n, t],
  );

  // Submit-only search: typing alone never hits the server. The user
  // commits to a query by pressing the keyboard's "Search" key (handled
  // by handleSubmitEditing below), which gives us bounded, predictable
  // server load — a long query at 5 chars/sec used to fan out 5 RPCs +
  // 5 ilike scans per pause; now it's exactly one round-trip per intent.
  //
  // While the user is mid-edit, we KEEP the previous result set on
  // screen (option B from the design discussion) — clearing on every
  // keystroke would flicker, and showing a "press Search" placeholder
  // while there's clearly content the user might still want fights
  // their mental model.
  //
  // The one exception: text fully cleared → restore the default browse
  // (popular tags). That's not "a search", it's "no query intent", and
  // matching the X-button behaviour on backspace-to-empty avoids the
  // weird state of an empty input box still showing yesterday's results.
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);

      // Skip if triggered by handleSearchByTags (programmatic write).
      if (skipNextSearch.current) {
        skipNextSearch.current = false;
        return;
      }

      // Mid-edit invalidates the previous query's AI-recovery chip.
      // The "PikTag understood: …" line belongs to the LAST submitted
      // query — leaving it on screen while the user types something
      // new reads as "AI is interpreting every keystroke" (it isn't).
      // The chip auto-restores on next submit if performSearch's
      // cache hit or recovery path repopulates it.
      setLlmExtractedKeywords([]);
      setLlmRecovering(false);

      // Exit intersection mode when the user starts editing the text
      // box — staying in intersection mode would render a stale chip
      // bar above a query that no longer matches.
      if (intersectionMode) {
        setIntersectionMode(false);
        setIntersectionProfiles([]);
      }

      if (text.trim().length === 0) {
        performSearch('');
      }
    },
    [performSearch, intersectionMode],
  );

  const handleRecentSearchTap = useCallback(
    (query: string) => {
      setSearchQuery(query);
      performSearch(query);
    },
    [performSearch],
  );

  const handleTagPress = useCallback(
    (tag: Tag) => {
      setSelectedTagIds(prev =>
        prev.includes(tag.id)
          ? prev.filter(id => id !== tag.id)
          : [...prev, tag.id]
      );
    },
    [],
  );

  const handleTagLongPress = useCallback(
    (tag: Tag) => {
      navigation.navigate('TagDetail', { tagId: tag.id, tagName: tag.name });
    },
    [navigation],
  );

  const handleSearchByTags = useCallback(async (idsOverride?: string[]) => {
    // idsOverride lets callers pass the freshly-computed id list
    // synchronously, skipping the round-trip through React state
    // (which would otherwise force a setTimeout-races-state hack).
    // The chip-remove handler uses this; the floating search button
    // omits it and reads selectedTagIds straight from closure.
    const tagIds = idsOverride ?? selectedTagIds;
    const tagIdSet = idsOverride ? new Set(idsOverride) : selectedTagIdSet;
    if (tagIds.length === 0 || !user) return;
    // Resolve a full Tag object for EVERY selected id, in selection
    // order. The live `tags` array usually misses earlier-picked tags
    // (each may have been chosen from its own text search), so fill the
    // gaps from piktag_tags. Build by id — a partial DB response must
    // not silently shrink the set and mis-route a genuine 2-tag search
    // to single-tag TagDetail.
    const byId = new Map<string, Tag>();
    for (const t of tags) {
      if (tagIdSet.has(t.id)) byId.set(t.id, t);
    }
    if (byId.size !== tagIds.length) {
      const { data } = await supabase
        .from('piktag_tags')
        .select('id, name, semantic_type, usage_count, concept_id')
        .in('id', tagIds);
      for (const t of (data || []) as Tag[]) byId.set(t.id, t);
    }
    const selected = tagIds
      .map((id) => byId.get(id))
      .filter((t): t is Tag => !!t);

    if (tagIds.length === 1) {
      // Always pass the id (always valid); name is best-effort. The old
      // code skipped navigation entirely when the name didn't resolve.
      navigation.navigate('TagDetail', {
        tagId: tagIds[0],
        tagName: byId.get(tagIds[0])?.name ?? '',
      });
      setSelectedTagIds([]);
      return;
    }

    // Multiple tags: do intersection search
    setIntersectionMode(true);
    setIntersectionProfiles([]);
    setIntersectionFriends([]);
    setIntersectionExplore([]);
    setIntersectionContacts([]);
    setIntersectionSelectedTags(selected);
    setSearchQuery(selected.map(t => t.name).join(' + '));
    skipNextSearch.current = true;
    setLoading(true);

    try {
      // Per-tag entity sets. An "entity" is either a member (key
      // 'u:'+userId) or a local contact (key 'c:'+contactId). A member
      // matches a tag via a PUBLIC self-tag (piktag_user_tags) OR the
      // viewer's own MANUAL tag on the connection (piktag_connection_tags);
      // a contact matches via its text[] tags (piktag_local_contacts).
      // connection_tags + local_contacts are owner-scoped by RLS, so
      // manual tags stay private to the searching user — exactly the
      // founder's "manual tags are owner-only searchable" rule.
      //
      // Each tag's work is independent — run all tags in parallel
      // (a sequential per-tag loop made a 3-tag search visibly slow).
      const entitySets: Set<string>[] = await Promise.all(
        tagIds.map(async (tagId) => {
          // Concept-sibling expansion (same concept = same meaning).
          // Names are needed because piktag_local_contacts.tags stores
          // plain name strings, not FKs, so contacts match by name.
          const allTagIds = await getSiblingTagIds(tagId);
          const siblingNames = await getTagNamesByIds(allTagIds);

          const [publicResult, connTagResult, contactResult] = await Promise.all([
            supabase
              .from('piktag_user_tags')
              .select('user_id')
              .in('tag_id', allTagIds)
              .eq('is_private', false),
            supabase
              .from('piktag_connection_tags')
              .select('connection:piktag_connections!connection_id(connected_user_id)')
              .in('tag_id', allTagIds)
              .limit(1000),
            siblingNames.length > 0
              ? supabase
                  .from('piktag_local_contacts')
                  .select('id')
                  .overlaps('tags', siblingNames)
                  .limit(500)
              : Promise.resolve({ data: [] } as any),
          ]);

          const set = new Set<string>();
          for (const d of publicResult.data || []) {
            set.add('u:' + (d as any).user_id);
          }
          for (const d of connTagResult.data || []) {
            const cu = (d as any).connection?.connected_user_id;
            if (cu) set.add('u:' + cu);
          }
          for (const d of contactResult.data || []) {
            set.add('c:' + (d as any).id);
          }
          return set;
        }),
      );

      let intersection = entitySets[0] || new Set<string>();
      for (let i = 1; i < entitySets.length; i++) {
        intersection = new Set([...intersection].filter(k => entitySets[i].has(k)));
      }

      const memberIds = [...intersection]
        .filter(k => k.startsWith('u:'))
        .map(k => k.slice(2))
        .slice(0, 50);
      const contactIds = [...intersection]
        .filter(k => k.startsWith('c:'))
        .map(k => k.slice(2))
        .slice(0, 50);

      let friends: PiktagProfile[] = [];
      let explore: PiktagProfile[] = [];
      let contacts: TaggedContact[] = [];

      if (memberIds.length > 0) {
        const [profileResult, myConnsResult] = await Promise.all([
          supabase.from('piktag_profiles')
            .select('id, username, full_name, avatar_url, is_verified')
            .in('id', memberIds),
          supabase.from('piktag_connections')
            .select('connected_user_id')
            .eq('user_id', user.id),
        ]);

        const allProfiles = (profileResult.data || []) as PiktagProfile[];
        const friendIds = new Set((myConnsResult.data || []).map((c: any) => c.connected_user_id));

        friends = allProfiles.filter(p => friendIds.has(p.id));
        explore = allProfiles.filter(p => !friendIds.has(p.id) && p.id !== user?.id);
        setIntersectionProfiles(allProfiles);
      }

      if (contactIds.length > 0) {
        const { data: contactRows } = await supabase
          .from('piktag_local_contacts')
          .select('id, name, avatar_url')
          .in('id', contactIds);
        contacts = (contactRows || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          avatar_url: c.avatar_url ?? null,
        }));
      }

      setIntersectionFriends(friends);
      setIntersectionExplore(explore);
      setIntersectionContacts(contacts);
      // Friends-first: contacts count toward the Friends tab, so default
      // there whenever the viewer's own world produced ANY match.
      setIntersectionTab((friends.length + contacts.length) > 0 ? 'friends' : 'explore');
    } catch (err) {
      console.warn('Intersection search error:', err);
      setProfiles([]);
    }

    setLoading(false);
    setSelectedTagIds([]);
  }, [selectedTagIds, selectedTagIdSet, tags, navigation, user]);


  const handleProfilePress = useCallback(
    (profile: PiktagProfile) => {
      // If the tapped profile is a friend, route to FriendDetail with
      // the cached connection_id so the screen can render the
      // searcher's manual/private tags via piktag_connection_tags.
      // Non-friends (or stale-cache misses) fall through to UserDetail.
      const connectionId = myFriendIds.get(profile.id);
      if (connectionId) {
        navigation.navigate('FriendDetail', {
          connectionId,
          friendId: profile.id,
        });
        return;
      }
      navigation.navigate('UserDetail', { userId: profile.id });
    },
    [navigation, myFriendIds],
  );

  const handleLocalContactPress = useCallback(
    (contact: TaggedContact) => {
      navigation.navigate('LocalContactDetail', { contactId: contact.id });
    },
    [navigation],
  );

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleSubmitEditing = useCallback(() => {
    const q = searchQuery.trim();
    // Empty submit is a no-op — handleSearchChange already restored
    // the popular-tags browse view when the box was cleared, so
    // there's nothing further to do.
    if (q.length === 0) return;
    performSearch(searchQuery);
  }, [performSearch, searchQuery]);

  // Universal "back to default view" — used by the header Reset button,
  // the empty-state button, and the search-input X button. Wipes every
  // piece of transient state EXCEPT recent searches (users want their
  // history preserved so they can re-run past queries).
  const handleResetToDefault = useCallback(() => {
    setSearchQuery('');
    setSelectedTagIds([]);
    setSelectedTagCategory(null);
    setIntersectionMode(false);
    setIntersectionProfiles([]);
    setIntersectionFriends([]);
    setIntersectionExplore([]);
    setIntersectionSelectedTags([]);
    // Wipe the LLM-recovery surface too — without these, pressing X
    // briefly shows an "AI understood: …" chip floating over the
    // newly-empty input until the manual-tag effect catches up.
    setLlmExtractedKeywords([]);
    setLlmRecovering(false);
    setSearchTaggedFriends([]);
    setSearchTaggedContacts([]);
    searchInputRef.current?.blur();
  }, []);

  // Remove a single entry from recent searches (per-item × icon).
  // The "clear all history" button stays intact.
  const handleDeleteRecentAt = useCallback(async (query: string) => {
    const updated = recentSearches.filter((q) => q !== query);
    setRecentSearches(updated);
    try {
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch {
      // best-effort — UI already updated
    }
  }, [recentSearches]);

  // ── Computed display flags (memoized) ──

  const trimmedQuery = useMemo(() => searchQuery.trim(), [searchQuery]);

  const showProfiles = useMemo(
    () => trimmedQuery !== '' && profiles.length > 0,
    [trimmedQuery, profiles.length],
  );

  const showTags = useMemo(
    () => trimmedQuery === '' || tags.length > 0,
    [trimmedQuery, tags.length],
  );

  // Show recent searches when search box is empty
  const showRecent = trimmedQuery === '' && recentSearches.length > 0;

  // ── Memoized translated suffix for tag counts ──
  const tagCountSuffix = useMemo(() => t('search.tagCountSuffix'), [t]);

  // Filtered tags by selected category
  const filteredTags = useMemo(() => {
    if (!selectedTagCategory) return tags.slice(0, 20);
    return tags.filter((t) => t.semantic_type === selectedTagCategory).slice(0, 20);
  }, [tags, selectedTagCategory]);

  // ── FlatList data and renderers ──

  // Build a single flat data array for the main FlatList to avoid nested ScrollView/FlatList issues.
  // We use a discriminated‑union item type so we can render different sections.

  type ListItem =
    | { type: 'loading' }
    | { type: 'sectionLabel'; label: string; showClear?: boolean }
    | { type: 'recentHeader' }
    | { type: 'recentEmpty' }
    | { type: 'recentItem'; query: string; index: number }
    | { type: 'clearHistoryBtn' }
    | { type: 'profilesHeader' }
    | { type: 'profilesEmpty' }
    | { type: 'profileItem'; profile: PiktagProfile }
    | { type: 'localContactItem'; contact: TaggedContact }
    | { type: 'tagsHeader' }
    | { type: 'tagsHomeHeader' }
    | { type: 'tagsEmpty' }
    | { type: 'tagsGrid' }
    | { type: 'bootstrapError' }
    | { type: 'intersectionTabs' }
    | { type: 'searchTabs'; friendsCount: number; exploreCount: number }
    | { type: 'aiThinking' }
    | { type: 'aiKeywordsChip'; keywords: string[] };

  // Merge profile-match + tag-match results into one deduplicated list,
  // then split by friend status. Mirrors the friends/explore split that
  // intersection mode already does, just on a different result source.
  const { searchFriends, searchExplore } = useMemo(() => {
    const seenIds = new Set<string>();
    const merged: PiktagProfile[] = [];
    for (const p of profiles) {
      if (p?.id && !seenIds.has(p.id)) {
        seenIds.add(p.id);
        merged.push(p);
      }
    }
    for (const tu of tagUsers) {
      for (const u of tu.users) {
        if (u?.id && !seenIds.has(u.id)) {
          seenIds.add(u.id);
          merged.push(u as PiktagProfile);
        }
      }
    }
    // Member friends matched via the searcher's own manual tags. These
    // come from piktag_connection_tags — i.e. people the viewer already
    // has a connection with — so they are friends BY DEFINITION and must
    // bucket as friends even when the session-cached `myFriendIds` is
    // stale (a connection added after mount isn't in that snapshot).
    const taggedFriendIds = new Set<string>();
    for (const p of searchTaggedFriends) {
      if (p?.id) {
        taggedFriendIds.add(p.id);
        if (!seenIds.has(p.id)) {
          seenIds.add(p.id);
          merged.push(p);
        }
      }
    }
    const friends: PiktagProfile[] = [];
    const explore: PiktagProfile[] = [];
    for (const p of merged) {
      if (myFriendIds.has(p.id) || taggedFriendIds.has(p.id)) friends.push(p);
      else explore.push(p);
    }
    return { searchFriends: friends, searchExplore: explore };
  }, [profiles, tagUsers, searchTaggedFriends, myFriendIds]);

  // Whenever a fresh search produces results, default the tab to
  // "friends" if any matched, else "explore". Mirrors the intersection
  // tab default at the call site of handleSearchByTags.
  //
  // Auto-set ONCE per committed query: results arrive in waves (text
  // results, then the async manual-tag results), and without this guard
  // the late wave re-fires this effect and yanks the tab back to
  // "friends" even after the user has manually tapped "explore".
  const searchTabAutoQueryRef = useRef<string>('');
  useEffect(() => {
    if (trimmedQuery === '') {
      searchTabAutoQueryRef.current = '';
      return;
    }
    if (searchTabAutoQueryRef.current === trimmedQuery) return;
    if (searchFriends.length + searchExplore.length + searchTaggedContacts.length === 0) return;
    searchTabAutoQueryRef.current = trimmedQuery;
    setSearchTab(
      searchFriends.length + searchTaggedContacts.length > 0 ? 'friends' : 'explore',
    );
  }, [trimmedQuery, searchFriends.length, searchExplore.length, searchTaggedContacts.length]);

  // Private-world search — populates the Friends tab with people from
  // the SEARCHER'S OWN world that the public RPC can't find:
  //   • connection_tags  — viewer's manual tags on a member friend
  //   • local_contacts.tags — viewer's manual tags on a contact
  //   • local_contacts.name / headline / note / met_location
  //   • connections.nickname / met_location — viewer's custom nickname
  //     + the place you noted meeting them
  // All sources are owner-scoped by RLS, so this stays private.
  // (Bio is also matched, but in performSearch's piktag_profiles
  // query — bio is public.)
  //
  // Driven by `tags` (set by the debounced performSearch) — that's the
  // committed-search signal. trimmedQuery is read via closure to avoid
  // firing the effect on every keystroke; the sig key includes both
  // so a same-tag-set but different-text query still re-fetches.
  const manualTagSigRef = useRef<string>('');
  useEffect(() => {
    if (trimmedQuery === '' || intersectionMode) {
      setSearchTaggedFriends([]);
      setSearchTaggedContacts([]);
      manualTagSigRef.current = '';
      return;
    }
    const sig = trimmedQuery + '|' + tags.map((t: any) => t.id).join(',');
    if (sig === manualTagSigRef.current) return;
    manualTagSigRef.current = sig;
    // New query/tag combo — drop the previous query's results immediately
    // so they don't linger on screen during the re-fetch.
    setSearchTaggedFriends([]);
    setSearchTaggedContacts([]);
    let cancelled = false;
    (async () => {
      try {
        // 1. Resolve concept-sibling tag ids/names (only if any tag matched).
        let allTagIds: string[] = [];
        let allTagNames: string[] = [];
        if (tags.length > 0) {
          const baseTagIds = tags.map((t: any) => t.id).filter(Boolean);
          const conceptIds = [
            ...new Set(tags.map((t: any) => t.concept_id).filter(Boolean)),
          ];
          allTagIds = [...baseTagIds];
          if (conceptIds.length > 0) {
            const { data: sib } = await supabase
              .from('piktag_tags')
              .select('id')
              .in('concept_id', conceptIds);
            if (sib && sib.length > 0) {
              allTagIds = [...new Set([...allTagIds, ...sib.map((s: any) => s.id)])];
            }
          }
          const { data: nameRows } = await supabase
            .from('piktag_tags')
            .select('name')
            .in('id', allTagIds);
          allTagNames = (nameRows || [])
            .map((r: any) => r.name)
            .filter(Boolean);
        }

        // 2. Reduce the query to content nouns (same pass performSearch
        //    uses) so a natural-language query like "找在扶輪社的朋友"
        //    reduces to "扶輪社" for the name/headline ilike match too.
        //    Then strip characters that would break PostgREST's .or()
        //    filter grammar (comma / paren / percent). Plain Chinese
        //    + English names survive untouched.
        const qSafe = stripSearchStopwords(trimmedQuery)
          .replace(/[,()%]/g, '')
          .trim();

        // 3. Run all private-world queries in parallel: 2 tag-based,
        //    2 text-based. The tag-based ones short-circuit when no
        //    tag matched the query.
        const [ctByTagRes, lcByTagRes, lcByTextRes, connByNickRes] = await Promise.all([
          allTagIds.length > 0
            ? supabase
                .from('piktag_connection_tags')
                .select(
                  'connection:piktag_connections!connection_id(connected_user_id, connected_user:piktag_profiles!connected_user_id(id, username, full_name, avatar_url, is_verified))',
                )
                .in('tag_id', allTagIds)
                .limit(500)
            : Promise.resolve({ data: [] } as any),
          allTagNames.length > 0
            ? supabase
                .from('piktag_local_contacts')
                .select('id, name, avatar_url')
                .overlaps('tags', allTagNames)
                .limit(200)
            : Promise.resolve({ data: [] } as any),
          qSafe.length > 0
            ? supabase
                .from('piktag_local_contacts')
                .select('id, name, avatar_url')
                .or(`name.ilike.%${qSafe}%,headline.ilike.%${qSafe}%,note.ilike.%${qSafe}%,met_location.ilike.%${qSafe}%`)
                .limit(50)
            : Promise.resolve({ data: [] } as any),
          qSafe.length > 0
            ? supabase
                .from('piktag_connections')
                .select(
                  'nickname, connected_user_id, connected_user:piktag_profiles!connected_user_id(id, username, full_name, avatar_url, is_verified)',
                )
                .or(`nickname.ilike.%${qSafe}%,met_location.ilike.%${qSafe}%`)
                .limit(50)
            : Promise.resolve({ data: [] } as any),
        ]);

        if (cancelled) return;

        // Merge member friends (tag-based + nickname-based). Dedupe by id.
        const seenFriendIds = new Set<string>();
        const friends: PiktagProfile[] = [];
        const pushFriend = (p: any) => {
          if (p?.id && p.id !== user?.id && !seenFriendIds.has(p.id)) {
            seenFriendIds.add(p.id);
            friends.push(p as PiktagProfile);
          }
        };
        for (const row of (ctByTagRes.data || []) as any[]) {
          pushFriend(row.connection?.connected_user);
        }
        for (const row of (connByNickRes.data || []) as any[]) {
          pushFriend(row.connected_user);
        }
        setSearchTaggedFriends(friends);

        // Merge contacts (tag-based + name/headline-based). Dedupe by id.
        const seenContactIds = new Set<string>();
        const contacts: TaggedContact[] = [];
        const pushContact = (c: any) => {
          if (c?.id && !seenContactIds.has(c.id)) {
            seenContactIds.add(c.id);
            contacts.push({ id: c.id, name: c.name, avatar_url: c.avatar_url ?? null });
          }
        };
        for (const c of (lcByTagRes.data || []) as any[]) pushContact(c);
        for (const c of (lcByTextRes.data || []) as any[]) pushContact(c);
        setSearchTaggedContacts(contacts);
      } catch (privateErr) {
        console.warn('[SearchScreen] private-world search failed:', privateErr);
      }
    })();
    return () => {
      cancelled = true;
    };
    // trimmedQuery intentionally read via closure (NOT in deps): it
    // changes per keystroke, but `tags` is the debounced committed-
    // search signal, so we only want to fetch when performSearch has
    // settled. The closure always sees the current value at run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, intersectionMode, user]);

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // 1. Loading
    if (loading || initialLoading) {
      // Swap the generic spinner for the "AI thinking" variant when
      // zero-results recovery is running — the user sees a clear
      // signal that the system is trying harder, not just hanging.
      items.push({ type: llmRecovering ? 'aiThinking' : 'loading' });
      return items;
    }

    // 1b. Bootstrap failure — RPC + fallback both yielded nothing AND
    // we have no cached tags / recommendations to show. Render the
    // retry surface in place of the (otherwise blank) default screen.
    if (
      bootstrapFailed &&
      trimmedQuery === '' &&
      !intersectionMode &&
      tags.length === 0
    ) {
      items.push({ type: 'bootstrapError' });
      return items;
    }

    // Intersection mode — tabbed Friends / Explore results. The Friends
    // tab holds member matches AND manually-tagged local contacts (both
    // are the viewer's own world); Explore holds non-friend members.
    if (intersectionMode) {
      items.push({ type: 'intersectionTabs' as any });
      if (intersectionTab === 'friends') {
        if (intersectionFriends.length + intersectionContacts.length > 0) {
          intersectionFriends.forEach((profile) => {
            items.push({ type: 'profileItem', profile });
          });
          intersectionContacts.forEach((contact) => {
            items.push({ type: 'localContactItem', contact });
          });
        } else {
          items.push({ type: 'profilesEmpty' });
        }
      } else {
        if (intersectionExplore.length > 0) {
          intersectionExplore.forEach((profile) => {
            items.push({ type: 'profileItem', profile });
          });
        } else {
          items.push({ type: 'profilesEmpty' });
        }
      }
      return items;
    }

    // Text-query mode. Results are grouped under a Friends / Explore tab
    // pair, mirroring intersection mode — friends-first when present so
    // the user sees their network before strangers. Falls through to the
    // explore tab when there are no friend matches.
    if (trimmedQuery !== '') {
      // AI-recovery transparency: when the LLM extracted content nouns
      // from a natural-language query, surface them above the results
      // so the user can see how PikTag understood their sentence (and
      // course-correct if it's wrong).
      if (llmExtractedKeywords.length > 0) {
        items.push({ type: 'aiKeywordsChip', keywords: llmExtractedKeywords });
      }
      // Tags section — always show when search found matching tags.
      if (tags.length > 0) {
        items.push({ type: 'tagsHeader' });
        items.push({ type: 'tagsGrid' });
      }

      // Friends tab also holds the searcher's manually-tagged local
      // contacts, so they count toward the friends total + tab badge.
      const friendsCount = searchFriends.length + searchTaggedContacts.length;
      const totalCount = friendsCount + searchExplore.length;
      if (totalCount > 0) {
        items.push({
          type: 'searchTabs',
          friendsCount,
          exploreCount: searchExplore.length,
        });
        if (searchTab === 'friends') {
          if (friendsCount > 0) {
            for (const profile of searchFriends) {
              items.push({ type: 'profileItem', profile });
            }
            for (const contact of searchTaggedContacts) {
              items.push({ type: 'localContactItem', contact });
            }
          } else {
            items.push({ type: 'profilesEmpty' });
          }
        } else {
          if (searchExplore.length > 0) {
            for (const profile of searchExplore) {
              items.push({ type: 'profileItem', profile });
            }
          } else {
            items.push({ type: 'profilesEmpty' });
          }
        }
      } else {
        // totalCount === 0: no people matched the committed query.
        // Previously, when tag matches existed we pushed NOTHING
        // here, so a query that found tags but zero people read as
        // success (no "no members matched" feedback). Always surface
        // it — the tags grid above + this make the result honest.
        items.push({ type: 'profilesEmpty' });
      }
    } else if (isFocused && recentSearches.length > 0) {
      // IG-style: recent searches only appear when the user taps the input.
      // Unfocused (default) state just shows popular tags + recommendations.
      items.push({ type: 'sectionLabel', label: '', showClear: true });
      recentSearches.forEach((query, index) => {
        items.push({ type: 'recentItem', query, index });
      });
    } else {
      // Default unfocused view — tag-first home.
      //
      // Order: header → tag grid → recommended users. Previously
      // recommended-users came FIRST, which buried tags below an avatar
      // row and read as a generic "people you may know" surface. The
      // founder's North Star is tag-first discovery (the brand is
      // *PikTag*), so tags now lead the home column and the avatar row
      // moves below — supporting context rather than top billing.
      items.push({ type: 'tagsHomeHeader' });
      if (tags.length > 0) {
        items.push({ type: 'tagsGrid' });
      } else {
        items.push({ type: 'tagsEmpty' });
      }
    }

    return items;
  }, [
    loading,
    initialLoading,
    showRecent,
    recentSearches,
    showProfiles,
    trimmedQuery,
    profiles,
    showTags,
    tags,
    tagUsers,
    isFocused,
    intersectionMode,
    intersectionProfiles,
    intersectionFriends,
    intersectionExplore,
    intersectionContacts,
    intersectionTab,
    searchFriends,
    searchExplore,
    searchTaggedContacts,
    searchTab,
    llmRecovering,
    llmExtractedKeywords,
    bootstrapFailed,
  ]);

  const keyExtractor = useCallback((item: ListItem, index: number): string => {
    switch (item.type) {
      case 'loading':
        return 'loading';
      case 'sectionLabel':
        return `section-${item.label}`;
      case 'recentHeader':
        return 'recentHeader';
      case 'recentEmpty':
        return 'recentEmpty';
      case 'recentItem':
        return `recent-${item.index}`;
      case 'profilesHeader':
        return 'profilesHeader';
      case 'profilesEmpty':
        return 'profilesEmpty';
      case 'profileItem':
        return `profile-${item.profile.id}`;
      case 'localContactItem':
        return `contact-${item.contact.id}`;
      case 'tagsHeader':
        return 'tagsHeader';
      case 'tagsHomeHeader':
        return 'tagsHomeHeader';
      case 'tagsEmpty':
        return 'tagsEmpty';
      case 'tagsGrid':
        return 'tagsGrid';
      case 'clearHistoryBtn':
        return 'clearHistoryBtn';
      case 'intersectionTabs':
        return 'intersectionTabs';
      case 'searchTabs':
        return 'searchTabs';
      case 'aiThinking':
        return 'aiThinking';
      case 'aiKeywordsChip':
        return 'aiKeywordsChip-' + item.keywords.join(',');
      case 'bootstrapError':
        return 'bootstrapError';
      default:
        return `item-${index}`;
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      switch (item.type) {
        case 'loading':
          return (
            <View style={styles.loadingContainer}>
              <LogoLoader size={64} />
            </View>
          );

        case 'aiThinking':
          return (
            <View style={styles.loadingContainer}>
              <LogoLoader size={64} />
              <Text style={styles.aiThinkingText}>
                {t('search.aiThinking', { defaultValue: 'Reading your intent…' })}
              </Text>
            </View>
          );

        case 'aiKeywordsChip':
          return (
            <View style={styles.aiChipRow}>
              <Text style={styles.aiChipLabel}>
                {t('search.aiExtractedLabel', { defaultValue: 'PikTag understood you mean:' })}
              </Text>
              <View style={styles.aiChipKeywordsRow}>
                {item.keywords.map((kw) => (
                  <View key={kw} style={styles.aiChipKeyword}>
                    <Text style={styles.aiChipKeywordText}>#{kw}</Text>
                  </View>
                ))}
              </View>
            </View>
          );

        case 'bootstrapError':
          return (
            <ErrorState onRetry={() => void runBootstrap()} />
          );

        case 'intersectionTabs':
          return (
            <View>
              {/* Google-style selected tag chips */}
              {intersectionSelectedTags.length > 0 && (
                <View style={styles.selectedChipsRow}>
                  {intersectionSelectedTags.map((tag) => (
                    <View key={tag.id} style={styles.selectedChip}>
                      <Text style={styles.selectedChipText}>#{tag.name}</Text>
                      <TouchableOpacity
                        onPress={() => {
                          const remaining = intersectionSelectedTags.filter(t => t.id !== tag.id);
                          setIntersectionSelectedTags(remaining);
                          if (remaining.length <= 1) {
                            setIntersectionMode(false);
                            setSearchQuery('');
                            if (remaining.length === 1) {
                              navigation.navigate('TagDetail', { tagId: remaining[0].id, tagName: remaining[0].name });
                            }
                            return;
                          }
                          // Re-filter results with remaining tags. We
                          // pass the freshly-computed ids directly so
                          // handleSearchByTags doesn't read stale
                          // selectedTagIds from React's closure — the
                          // old setTimeout(…, 100) hack used to bridge
                          // that gap is now obsolete (and racy if the
                          // user removed two chips in quick succession).
                          const remainingIds = remaining.map(t => t.id);
                          setSelectedTagIds(remainingIds);
                          void handleSearchByTags(remainingIds);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <X size={14} color={'#FFFFFF'} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              {/* Friends / Explore tabs */}
              <View style={styles.intersectionTabRow}>
                <TouchableOpacity
                  style={[styles.intersectionTabBtn, intersectionTab === 'friends' && styles.intersectionTabBtnActive]}
                  onPress={() => setIntersectionTab('friends')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.intersectionTabText, intersectionTab === 'friends' && styles.intersectionTabTextActive]}>
                    {t('tagDetail.tabConnections')} ({intersectionFriends.length + intersectionContacts.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.intersectionTabBtn, intersectionTab === 'explore' && styles.intersectionTabBtnActive]}
                  onPress={() => setIntersectionTab('explore')}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.intersectionTabText, intersectionTab === 'explore' && styles.intersectionTabTextActive]}>
                    {t('tagDetail.tabExplore')} ({intersectionExplore.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );

        case 'searchTabs':
          // Same Friends / Explore tab strip as intersection mode but
          // bound to text-query state, with counts coming from the
          // pre-split useMemo above.
          return (
            <View style={styles.intersectionTabRow}>
              <TouchableOpacity
                style={[styles.intersectionTabBtn, searchTab === 'friends' && styles.intersectionTabBtnActive]}
                onPress={() => setSearchTab('friends')}
                activeOpacity={0.7}
              >
                <Text style={[styles.intersectionTabText, searchTab === 'friends' && styles.intersectionTabTextActive]}>
                  {t('tagDetail.tabConnections')} ({item.friendsCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.intersectionTabBtn, searchTab === 'explore' && styles.intersectionTabBtnActive]}
                onPress={() => setSearchTab('explore')}
                activeOpacity={0.7}
              >
                <Text style={[styles.intersectionTabText, searchTab === 'explore' && styles.intersectionTabTextActive]}>
                  {t('tagDetail.tabExplore')} ({item.exploreCount})
                </Text>
              </TouchableOpacity>
            </View>
          );

        case 'clearHistoryBtn':
          return (
            <TouchableOpacity
              style={styles.clearHistoryBtn}
              onPress={() => {
                Alert.alert(
                  t('search.clearHistoryConfirmTitle'),
                  t('search.clearHistoryConfirmMessage'),
                  [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                      text: t('common.confirm'),
                      style: 'destructive',
                      onPress: async () => {
                        await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
                        setRecentSearches([]);
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.clearHistoryText}>{t('search.clearHistory')}</Text>
            </TouchableOpacity>
          );

        case 'sectionLabel':
          return (
            <View style={styles.sectionLabelRow}>
              <Text style={styles.sectionLabelText}>{item.label}</Text>
              {item.showClear && (
                <TouchableOpacity
                  onPress={async () => {
                    await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
                    setRecentSearches([]);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionLabelClear}>{t('search.clearHistory', { defaultValue: '清除' })}</Text>
                </TouchableOpacity>
              )}
            </View>
          );

        case 'recentEmpty':
          return (
            <Text style={styles.emptyText}>
              {t('search.noRecentSearches')}
            </Text>
          );

        case 'recentItem':
          return (
            <RecentSearchItem
              query={item.query}
              onPress={handleRecentSearchTap}
              onDelete={handleDeleteRecentAt}
              deleteLabel={t('search.deleteRecentItem', { defaultValue: '刪除這筆紀錄' })}
            />
          );

        case 'profilesHeader':
          return (
            <Text style={styles.resultSectionLabel}>
              {t('search.profilesSectionLabel')}
            </Text>
          );

        case 'profilesEmpty':
          return (
            <View style={styles.emptyStateContainer}>
              <Text
                style={styles.emptyStateTitle}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {t('search.noProfilesFoundTitle', { query: trimmedQuery })}
              </Text>
              {/* "Try a #tag" is redundant when the AI chip is already
                  shown above — recovery already tried that. Only show
                  the hint when there was no AI assist. */}
              {llmExtractedKeywords.length === 0 && (
                <Text style={styles.emptyStateHint}>
                  {t('search.tryTagSearchHint')}
                </Text>
              )}
              {/* Dead-end search → highest-intent moment to capture a
                  demand signal. The button label carries its own
                  motivation now ("📣 發 Ask 幫忙找") so we don't need
                  a separate explanatory sentence — one element. */}
              {trimmedQuery !== '' && (
                <TouchableOpacity
                  style={styles.askCtaButton}
                  onPress={() => setAskVisible(true)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('search.askEmptyStateButton', {
                    defaultValue: '📣 Post an Ask',
                  })}
                >
                  <Text style={styles.askCtaButtonText}>
                    {t('search.askEmptyStateButton', {
                      defaultValue: '📣 Post an Ask',
                    })}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.clearRetryButton}
                onPress={handleResetToDefault}
                activeOpacity={0.7}
              >
                <Text style={styles.clearRetryButtonText}>
                  {t('search.clearAndRetry')}
                </Text>
              </TouchableOpacity>
            </View>
          );

        case 'profileItem':
          return (
            <ProfileCard
              profile={item.profile}
              onPress={handleProfilePress}
              t={t}
            />
          );

        case 'localContactItem':
          return (
            <LocalContactCard
              contact={item.contact}
              onPress={handleLocalContactPress}
              t={t}
            />
          );

        case 'tagsHeader':
          return (
            <Text style={styles.resultSectionLabel}>
              {t('search.tagsSectionLabel')}
            </Text>
          );

        case 'tagsHomeHeader':
          // The visual "招牌" of the search home: a #-prefixed title in
          // PikTag purple makes the tag-first identity obvious at a
          // glance, and the subtitle explicitly invites the tap-a-tag
          // path so users without a search-sentence in mind have a
          // clear next move.
          return (
            <View style={styles.tagsHomeHeader}>
              <Text style={styles.tagsHomeHeaderTitle}>
                <Text style={styles.tagsHomeHeaderHash}>#</Text>
                {t('search.popularTagsLabel')}
              </Text>
              <Text style={styles.tagsHomeHeaderSubtitle}>
                {t('search.tagsHomePrompt', {
                  defaultValue: '點任一標籤直接找朋友，或用上方搜尋框打一句話',
                })}
              </Text>
            </View>
          );

        case 'tagsEmpty':
          return (
            <Text style={styles.emptyText}>
              {t('search.noTagsFound')}
            </Text>
          );

        case 'tagsGrid': {
          // When searching, show flat grid
          if (trimmedQuery !== '') {
            return (
              <View style={styles.tagsGrid}>
                {tags.map((tag) => (
                  <TagCard
                    key={tag.id}
                    tag={tag}
                    isSelected={selectedTagIdSet.has(tag.id)}
                    onPress={handleTagPress}
                    onLongPress={handleTagLongPress}
                    countSuffix={tagCountSuffix}
                    isTrending={trendingTagIds.has(tag.id)}
                    showSemanticType
                    semanticTypeLabel={tag.semantic_type ? t(`semanticType.${tag.semantic_type}`) : undefined}
                  />
                ))}
              </View>
            );
          }

          // Category chips + filtered grid
          return (
            <View>
              {tagCategories.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoryChipsRow}
                >
                  <TouchableOpacity
                    style={[styles.categoryChip, !selectedTagCategory && styles.categoryChipActive]}
                    onPress={() => setSelectedTagCategory(null)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.categoryChipText, !selectedTagCategory && styles.categoryChipTextActive]}>
                      {t('search.allCategories')}
                    </Text>
                  </TouchableOpacity>
                  {tagCategories.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryChip, selectedTagCategory === cat && styles.categoryChipActive]}
                      onPress={() => setSelectedTagCategory(selectedTagCategory === cat ? null : cat)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.categoryChipText, selectedTagCategory === cat && styles.categoryChipTextActive]}>
                        {t(`semanticType.${cat}`) || cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={styles.tagsGrid}>
                {filteredTags.map((tag) => (
                  <TagCard
                    key={tag.id}
                    tag={tag}
                    isSelected={selectedTagIdSet.has(tag.id)}
                    onPress={handleTagPress}
                    onLongPress={handleTagLongPress}
                    countSuffix={tagCountSuffix}
                    isTrending={trendingTagIds.has(tag.id)}
                  />
                ))}
              </View>

            </View>
          );
        }

        default:
          return null;
      }
    },
    [
      activeCategory,
      handleCategoryPress,
      handleRecentSearchTap,
      handleProfilePress,
      handleLocalContactPress,
      handleTagPress,
      handleTagLongPress,
      selectedTagIdSet,
      tags,
      filteredTags,
      tagCategories,
      selectedTagCategory,
      trendingTagIds,
      tagCountSuffix,
      tagUsers,
      navigation,
      t,
      trimmedQuery,
      llmExtractedKeywords,
      handleResetToDefault,
      handleDeleteRecentAt,
      intersectionTab,
      intersectionFriends,
      intersectionExplore,
      intersectionContacts,
      intersectionSelectedTags,
      searchTab,
      handleSearchByTags,
      runBootstrap,
      styles,
      colors,
    ],
  );

  // ── Memoized search container style ──
  const searchContainerStyle = useMemo(
    () => [styles.searchContainer, isFocused && styles.searchContainerFocused],
    [isFocused, styles],
  );

  // Manual focus fallback: on some devices (e.g. iPhone XR) the native
  // hit-testing on the TextInput occasionally misses. Wrapping the whole
  // pill in a Pressable that forwards tap → textInput.focus() makes the
  // search box bulletproof regardless of which sub-view the touch lands on.
  const searchInputRef = useRef<TextInput>(null);
  const focusSearchInput = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={topEdges}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('search.headerTitle', { defaultValue: '搜尋' })}</Text>
          <TouchableOpacity
            style={styles.headerMapBtn}
            activeOpacity={0.6}
            onPress={() => setMapVisible(true)}
            accessibilityLabel={t('search.openMap', { defaultValue: '地圖檢視' })}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MapPin size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Pressable style={searchContainerStyle} onPress={focusSearchInput}>
          <Search
            size={20}
            color={colors.gray400}
            style={styles.searchIcon}
            pointerEvents="none"
          />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder={placeholder}
            placeholderTextColor={colors.gray400}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            returnKeyType="search"
            onSubmitEditing={handleSubmitEditing}
            accessibilityLabel={t('search.searchInputLabel', { defaultValue: '搜尋' })}
            accessibilityRole="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={handleResetToDefault}
              style={styles.searchClearBtn}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('search.clearSearchLabel', { defaultValue: '清除搜尋' })}
              accessibilityRole="button"
            >
              <X size={16} color={colors.gray400} />
            </TouchableOpacity>
          )}
        </Pressable>
      </View>

      <FlatList
        data={listData}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={7}
        initialNumToRender={8}
      />

      {/* Floating search button when tags are selected */}
      {selectedTagIds.length > 0 && (
        <View style={styles.floatingSearchBar}>
          <Text style={styles.floatingSearchText}>
            {selectedTagIds.length} {t('search.tagsSelected', { defaultValue: '個標籤已選' })}
          </Text>
          <TouchableOpacity style={styles.floatingClearBtn} onPress={() => setSelectedTagIds([])} activeOpacity={0.7}>
            <Text style={styles.floatingClearText}>{t('search.clearAll', { defaultValue: '清除' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingSearchBtn} onPress={() => handleSearchByTags()} activeOpacity={0.8}>
            <Search size={16} color={'#FFFFFF'} />
            <Text style={styles.floatingSearchBtnText}>{t('search.searchBtn', { defaultValue: '搜尋' })}</Text>
          </TouchableOpacity>
        </View>
      )}
      {errorToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{errorToast}</Text>
        </View>
      )}

      <FriendsMapModal
        visible={mapVisible}
        onClose={() => setMapVisible(false)}
        friends={mapFriends}
        onFriendPress={(connectionId, friendId) => {
          setMapVisible(false);
          navigation.navigate('FriendDetail', { connectionId, friendId });
        }}
      />

      <AskCreateModal
        visible={askVisible}
        onClose={() => setAskVisible(false)}
        existingAsk={myAsk}
        seedBody={trimmedQuery}
        onCreated={refreshAsk}
      />
    </SafeAreaView>
  );
}

// Stable array reference for SafeAreaView edges
const topEdges: ('top')[] = ['top'];

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  // Semantic type badge
  semanticBadge: {
    backgroundColor: c.gray100,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 4,
  },
  semanticBadgeSelected: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  semanticBadgeText: {
    fontSize: 10,
    color: c.gray500,
    fontWeight: '500',
  },
  semanticBadgeTextSelected: {
    color: 'rgba(255,255,255,0.8)',
  },
  // Floating search bar
  floatingSearchBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.gray200,
    gap: 10,
  },
  floatingSearchText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: c.gray700,
  },
  floatingClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  floatingClearText: {
    fontSize: 13,
    color: c.gray500,
  },
  floatingSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  floatingSearchBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Selected tags bar (unused, kept for reference)
  selectedTagsBar: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.gray200,
    backgroundColor: c.gray50,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  selectedTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  clearAllText: {
    fontSize: 13,
    color: c.gray500,
  },
  intersectionHint: {
    fontSize: 12,
    color: c.gray400,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 6,
  },
  selectedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  intersectionTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.gray200,
    marginBottom: 8,
  },
  intersectionTabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  intersectionTabBtnActive: {
    borderBottomColor: c.piktag500,
  },
  intersectionTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray500,
  },
  intersectionTabTextActive: {
    fontWeight: '600',
    color: c.piktag600,
  },
  // Main styles
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: c.gray900,
    lineHeight: 32,
  },
  // Map button sits next to the title — quick entry to "where are
  // people I might know geographically". Sized 44dp to hit the
  // recommended tap target while the icon stays at 22dp visually.
  headerMapBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchContainerFocused: {
    backgroundColor: c.white,
    borderColor: c.piktag500,
    shadowColor: c.piktag200,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchClearBtn: {
    padding: 4,
    marginLeft: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: c.gray900,
    lineHeight: 22,
    padding: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 100,
  },
  categorySectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: c.gray700,
    marginBottom: 16,
  },
  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 9999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  tagCardHighlighted: {
    backgroundColor: c.piktag500,
  },
  tagCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagName: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray900,
    lineHeight: 20,
  },
  tagNameHighlighted: {
    color: '#FFFFFF',
  },
  tagCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tagCount: {
    fontSize: 11,
    color: c.gray400,
    lineHeight: 14,
  },
  tagCountHighlighted: {
    color: 'rgba(255,255,255,0.7)',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  // "Reading your intent..." text under the spinner during zero-results
  // LLM recovery. Sits below the existing LogoLoader so the visual is
  // familiar but the message tells the user we're trying harder.
  aiThinkingText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray500,
    marginTop: 14,
    textAlign: 'center',
  },
  // "PikTag understood you mean:" chip strip — shown above results when
  // the LLM-recovery path produced the keywords that ultimately matched.
  // Transparent surface for the user to course-correct if the model
  // mis-read their sentence.
  aiChipRow: {
    // No paddingTop / paddingHorizontal here — scrollContent already
    // provides 24px top + 20px horizontal. Adding our own stacked
    // them and left the chip indented 16px more than the result
    // cards below.
    paddingBottom: 12,
  },
  aiChipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: c.gray500,
    marginBottom: 8,
  },
  aiChipKeywordsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  aiChipKeyword: {
    backgroundColor: c.fill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BORDER_RADIUS.full,
  },
  aiChipKeywordText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.piktag500,
  },
  emptyText: {
    fontSize: 14,
    color: c.gray400,
    textAlign: 'center',
    paddingVertical: 24,
  },
  // Empty-state (profilesEmpty) — used when a query yields no users.
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: c.gray700,
    textAlign: 'center',
  },
  emptyStateHint: {
    fontSize: 13,
    color: c.gray500,
    textAlign: 'center',
    marginTop: 8,
  },
  clearRetryButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: c.gray100,
  },
  clearRetryButtonText: {
    fontSize: 14,
    color: c.gray700,
    fontWeight: '500',
  },
  // Ask conversion CTA in the no-results state. Single emphasized
  // pill (the prompt sentence was folded into the button label in
  // the empty-state slim refactor) — productive next step. The
  // "clear and retry" below stays the neutral grey secondary.
  askCtaButton: {
    marginTop: 12,
    paddingVertical: 11,
    paddingHorizontal: 24,
    borderRadius: 22,
    backgroundColor: c.piktag500,
  },
  askCtaButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    // No marginTop — this row is only ever rendered as the first
    // list item (the recent-searches "clear" header), so scrollContent's
    // own paddingTop: 24 already provides the top breathing room.
    // Stacking added 16 more, leaving the X button floating ~40px
    // below the search box.
  },
  sectionLabelText: {
    fontSize: 16,
    fontWeight: '700',
    color: c.gray900,
  },
  sectionLabelClear: {
    fontSize: 13,
    fontWeight: '500',
    color: c.gray400,
  },
  resultSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray500,
    marginBottom: 12,
    marginTop: 4,
  },
  // The home-header "招牌" — bigger and bolder than resultSectionLabel
  // because this is the visual anchor of the entire default search
  // surface (tag-first branding lives here).
  tagsHomeHeader: {
    marginBottom: 16,
    marginTop: 4,
  },
  tagsHomeHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: c.gray900,
    letterSpacing: -0.3,
  },
  tagsHomeHeaderHash: {
    color: c.piktag500,
    fontWeight: '900',
  },
  tagsHomeHeaderSubtitle: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 4,
    lineHeight: 18,
  },
  profilesSection: {
    marginBottom: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  profileInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: c.gray900,
  },
  profileUsername: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 2,
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  recentSearchItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  recentSearchText: {
    flex: 1,
    fontSize: 15,
    color: c.gray700,
  },
  recentSearchDeleteBtn: {
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 4,
  },
  clearHistoryBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  clearHistoryText: {
    fontSize: 13,
    color: c.red500,
    fontWeight: '500',
  },

  // Tag Category
  tagCategorySection: {
    marginBottom: 16,
  },
  tagCategoryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray700,
    paddingHorizontal: 20,
    marginBottom: 10,
    marginTop: 8,
  },

  // Category Chips
  categoryChipsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    flexDirection: 'row',
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: c.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: c.piktag50,
    borderColor: c.piktag500,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray600,
  },
  categoryChipTextActive: {
    color: c.piktag600,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    backgroundColor: c.gray900,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
  });
}
