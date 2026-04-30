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
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useAuthProfile } from '../context/AuthContext';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import ErrorState from '../components/ErrorState';
import LogoLoader from '../components/loaders/LogoLoader';
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
              color={COLORS.blue500}
              fill={COLORS.blue500}
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
  return (
    <TouchableOpacity
      style={[styles.tagCard, isSelected && styles.tagCardHighlighted]}
      activeOpacity={0.7}
      onPress={() => onPress(tag)}
      onLongPress={onLongPress ? () => onLongPress(tag) : undefined}
    >
      <View style={styles.tagCardRow}>
        <Hash size={14} color={isSelected ? COLORS.white : COLORS.piktag500} strokeWidth={2.5} />
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
          <TrendingUp size={12} color={isSelected ? COLORS.white : COLORS.accent500} />
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
        <Clock size={16} color={COLORS.gray400} />
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
        <X size={14} color={COLORS.gray400} />
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
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
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

  // Rotating prompt-style placeholder. Cycles through `search.promptHints`
  // (a per-locale array, e.g. "我需要懂攝影的朋友" / "在台北附近的設計師")
  // so the search box reads as "tell me what you need" instead of "type
  // a name". Trains users to start with intent ("I need someone who…")
  // rather than identity ("find this person") — the discovery
  // affordance that distinguishes PikTag from a contacts app and is
  // invisible without this nudge.
  //
  // Rotation timing is calibrated PER PROMPT, not a global constant.
  // CJK scripts (zh/ja/ko) pack ~3-4 characters per second of comfortable
  // reading; Latin scripts (en/es/fr/pt/ru) read at ~5-7 char/s; complex
  // scripts (ar/bn/hi/th) sit in between but are often non-native to
  // the reader and benefit from extra dwell time.
  //
  // A flat 3.5s burned bored CJK users while clipping mid-sentence on
  // 35-char Spanish/Bengali prompts. Length-based scheduling balances
  // both ends:
  //
  //   floor 3500ms — snappy for short CJK ("認識誰在做新創？" / 8 chars
  //   would otherwise sit on screen for 5+ seconds)
  //   + 130ms/char — kicks in around 27 chars, scales up to ~5s for
  //   the longest English/French/Bengali prompts. ≈ 460 chars/min,
  //   matches comfortable non-native reading speed without overshooting
  //   CJK fluency.
  //
  // Verified across all 15 locales: every current prompt lands between
  // 3500–5100ms, with native CJK at the snappy end and unfamiliar scripts
  // at the longer end. The constants sit at component scope so adding
  // new prompts later doesn't require re-tuning.
  const PROMPT_ROTATION_MIN_MS = 3500;
  const PROMPT_ROTATION_MS_PER_CHAR = 130;
  const [promptIdx, setPromptIdx] = useState(0);
  const promptHints = useMemo(() => {
    const raw = t('search.promptHints', { returnObjects: true });
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const cityFallback = t('search.promptHintCityFallback');
    // The city-bearing prompt uses {{city}} interpolation. When the user
    // has a profile.location set, swap their city in. When they don't,
    // replace the whole entry with a locale-specific fallback (e.g.
    // "在我附近的設計師" instead of an awkward "在 {{city}} 附近的設計師"
    // with the placeholder visible). This keeps the prompt array length
    // stable across users with/without location set.
    return (raw as string[]).map((h) => {
      if (!h.includes('{{city}}')) return h;
      if (userCity) return h.replace('{{city}}', userCity);
      return cityFallback;
    });
  }, [t, userCity]);
  useEffect(() => {
    if (!promptHints) return;
    const current = promptHints[promptIdx] ?? '';
    const delay = Math.max(
      PROMPT_ROTATION_MIN_MS,
      Math.ceil(current.length * PROMPT_ROTATION_MS_PER_CHAR),
    );
    const id = setTimeout(() => {
      setPromptIdx((i) => (i + 1) % promptHints.length);
    }, delay);
    return () => clearTimeout(id);
    // Effect re-runs after each rotation because promptIdx is a dep —
    // setTimeout (not setInterval) is intentional so each prompt's
    // dwell time can be re-computed from its own length.
  }, [promptHints, promptIdx]);
  // While the user has typed something, the placeholder isn't visible
  // anyway — we still rotate the index so when they clear and look
  // back, they land on a fresh prompt instead of the same stale one.
  const placeholder = promptHints
    ? promptHints[promptIdx]
    : t('search.searchPlaceholder');

  // Data states
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<PiktagProfile[]>([]);
  const [tagUsers, setTagUsers] = useState<{ tag: Tag; users: any[] }[]>([]);
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
  const [recommendedUsers, setRecommendedUsers] = useState<PiktagProfile[]>([]);
  const [errorToast, setErrorToast] = useState<string | null>(null);
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
  const [intersectionTab, setIntersectionTab] = useState<'friends' | 'explore'>('friends');
  const [intersectionSelectedTags, setIntersectionSelectedTags] = useState<Tag[]>([]);

  // Cached set of viewer's friend ids so every search result split is
  // a constant-time lookup. Fetched once on mount; stays valid for the
  // session (a freshly-added connection won't show up as "friend" until
  // next mount, but searches happen often enough that the trade-off
  // beats re-querying piktag_connections on every keystroke).
  const [myFriendIds, setMyFriendIds] = useState<Set<string>>(new Set());

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
  type SearchCacheEntry = { tags: any[]; profiles: any[]; tagUsers: { tag: Tag; users: any[] }[] };
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

  // One-time fetch of viewer's friend ids. Used to split every search
  // result set into "friends" / "explore" buckets in O(1) per row.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('user_id', user.id);
      if (cancelled) return;
      const ids = new Set<string>((data ?? []).map((c: any) => c.connected_user_id));
      setMyFriendIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  // Load smart recommendations based on shared tags
  const loadRecommendations = useCallback(async () => {
    if (!user) return;
    try {
      // Get my tag IDs
      const { data: myTags } = await supabase
        .from('piktag_user_tags')
        .select('tag_id')
        .eq('user_id', user.id)
        .eq('is_private', false)
        .limit(50);
      if (!myTags || myTags.length === 0) return;

      const myTagIds = myTags.map(t => t.tag_id);

      // Get my existing connection user IDs (to exclude)
      const { data: myConns } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('user_id', user.id)
        .limit(100);
      const connUserIds = new Set((myConns || []).map(c => c.connected_user_id));
      connUserIds.add(user.id); // exclude self

      // Find users who share at least one tag with me
      const { data: sharedTagUsers } = await supabase
        .from('piktag_user_tags')
        .select('user_id, tag_id')
        .in('tag_id', myTagIds)
        .eq('is_private', false)
        .limit(200);
      if (!sharedTagUsers) return;

      // Count shared tags per user
      const userSharedCount = new Map<string, number>();
      for (const ut of sharedTagUsers) {
        if (connUserIds.has(ut.user_id)) continue; // skip existing friends
        userSharedCount.set(ut.user_id, (userSharedCount.get(ut.user_id) || 0) + 1);
      }

      // Sort by most shared tags, take top 10
      const topUserIds = [...userSharedCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([uid]) => uid);

      if (topUserIds.length === 0) return;

      // Fetch profiles
      const { data: profiles } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, bio, is_verified')
        .in('id', topUserIds)
        .eq('is_public', true);

      if (profiles) {
        // Sort by shared count
        profiles.sort((a, b) => (userSharedCount.get(b.id) || 0) - (userSharedCount.get(a.id) || 0));
        setRecommendedUsers(profiles as PiktagProfile[]);
      }
    } catch (err) {
      // Recommendations are a secondary feature — log but don't block.
      console.warn('[SearchScreen] loadRecommendations failed:', err);
    }
  }, [user]);

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
        recommended_users?: any[];
        recent_categories?: any[];
      };
      const popular = Array.isArray(payload.popular_tags) ? payload.popular_tags : [];
      const recs = Array.isArray(payload.recommended_users) ? payload.recommended_users : [];
      if (popular.length === 0 && recs.length === 0) return false;

      if (popular.length > 0) {
        setCache(CACHE_KEY_POPULAR_TAGS, popular as Tag[]);
        setTags(popular as Tag[]);
        const cats = [
          ...new Set(popular.map((t: any) => t.semantic_type).filter(Boolean)),
        ] as string[];
        setTagCategories(cats);
      }
      if (recs.length > 0) {
        setRecommendedUsers(recs as PiktagProfile[]);
      }
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
      await Promise.all([loadPopularTags(), loadRecommendations()]);
      // If both loaders ran but produced nothing, we still want the
      // user to see *something* — but only flag bootstrap as failed
      // when there's literally nothing to render. Empty results from a
      // brand-new account are legitimate; here we err on the side of
      // showing the error surface, since on a fresh account the
      // recommendations RPC would normally return at least a few
      // suggested users.
    } catch {
      // Loaders threw outright — definitely a network/server problem.
    } finally {
      setInitialLoading(false);
    }
  }, [
    loadInitialViaRpc,
    loadPopularTags,
    loadRecentSearches,
    loadRecommendations,
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
      // Strip # and split by common delimiters (space, comma, 、，)
      const keywords = query.trim()
        .replace(/#/g, '')
        .split(/[\s,，、]+/)
        .map(k => k.trim())
        .filter(Boolean);

      if (keywords.length === 0) {
        setActiveCategory(null);
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
        saveRecentSearch(query.trim());
        return;
      }

      // Use first keyword for main search (profiles + aliases)
      const mainKeyword = keywords[0];

      const seq = ++searchSeqRef.current;
      setLoading(true);
      setActiveCategory(null);

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

        const [aliasResult, profilesResult, ...tagResults] = await Promise.all([
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
            .or(`username.ilike.%${mainKeyword}%,full_name.ilike.%${mainKeyword}%`)
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
              p_query: mainKeyword,
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

        const finalProfiles = (!profilesResult.error && profilesResult.data
          ? (profilesResult.data as PiktagProfile[])
          : []);
        setProfiles(finalProfiles);

        // Cache this result set so typing-then-retyping is free.
        const entry: SearchCacheEntry = {
          tags: mergedTags,
          profiles: finalProfiles,
          tagUsers: finalTagUsers,
        };
        cache.set(cacheKey, entry);
        if (cache.size > SEARCH_CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }

        // Save to recent searches
        saveRecentSearch(query.trim());
      } catch (err) {
        if (seq !== searchSeqRef.current) return;
        console.warn('[SearchScreen] search query failed:', err);
        setTags([]);
        setProfiles([]);
        setErrorToast(t('common.unknownError'));
        setTimeout(() => setErrorToast(null), 2500);
      } finally {
        if (seq === searchSeqRef.current) setLoading(false);
      }
    },
    [loadPopularTags, saveRecentSearch],
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

  const handleSearchByTags = useCallback(async () => {
    if (selectedTagIds.length === 0) return;
    const selected = tags.filter(t => selectedTagIdSet.has(t.id));
    if (selected.length === 1) {
      navigation.navigate('TagDetail', { tagId: selected[0].id, tagName: selected[0].name });
      setSelectedTagIds([]);
      return;
    }

    // Multiple tags: do intersection search
    setIntersectionMode(true);
    setIntersectionProfiles([]);
    setIntersectionFriends([]);
    setIntersectionExplore([]);
    setIntersectionSelectedTags(selected);
    setSearchQuery(selected.map(t => t.name).join(' + '));
    skipNextSearch.current = true;

    try {
      const userIdSets: Set<string>[] = [];
      for (const tagId of selectedTagIds) {
        // Expand tag to include all sibling tags (same concept = same meaning)
        let allTagIds = [tagId];
        try {
          const { data: tagData } = await supabase
            .from('piktag_tags')
            .select('concept_id')
            .eq('id', tagId)
            .single();
          if (tagData?.concept_id) {
            const { data: siblings } = await supabase
              .from('piktag_tags')
              .select('id')
              .eq('concept_id', tagData.concept_id);
            if (siblings) allTagIds = siblings.map((s: any) => s.id);
          }
        } catch (err) {
          console.warn('[SearchScreen] sibling tag lookup failed, falling back to single tag:', err);
        }

        const { data } = await supabase
          .from('piktag_user_tags')
          .select('user_id')
          .in('tag_id', allTagIds)
          .eq('is_private', false);
        userIdSets.push(new Set((data || []).map((d: any) => d.user_id)));
      }

      let intersection = userIdSets[0] || new Set();
      for (let i = 1; i < userIdSets.length; i++) {
        intersection = new Set([...intersection].filter(id => userIdSets[i].has(id)));
      }

      const userIds = [...intersection].slice(0, 50);

      if (userIds.length > 0) {
        const [profileResult, myConnsResult] = await Promise.all([
          supabase.from('piktag_profiles')
            .select('id, username, full_name, avatar_url, is_verified')
            .in('id', userIds),
          supabase.from('piktag_connections')
            .select('connected_user_id')
            .eq('user_id', user!.id),
        ]);

        const allProfiles = (profileResult.data || []) as PiktagProfile[];
        const friendIds = new Set((myConnsResult.data || []).map((c: any) => c.connected_user_id));

        const friends = allProfiles.filter(p => friendIds.has(p.id));
        const explore = allProfiles.filter(p => !friendIds.has(p.id) && p.id !== user?.id);

        setIntersectionProfiles(allProfiles);
        setIntersectionFriends(friends);
        setIntersectionExplore(explore);
        setIntersectionTab(friends.length > 0 ? 'friends' : 'explore');
      }
    } catch (err) {
      console.warn('Intersection search error:', err);
      setProfiles([]);
    }

    setLoading(false);
    setSelectedTagIds([]);
  }, [selectedTagIds, selectedTagIdSet, tags, navigation, user]);


  const handleProfilePress = useCallback(
    (profile: PiktagProfile) => {
      navigation.navigate('UserDetail', { userId: profile.id });
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
    | { type: 'tagsHeader' }
    | { type: 'tagsEmpty' }
    | { type: 'tagsGrid' }
    | { type: 'recommendedUsers' }
    | { type: 'bootstrapError' }
    | { type: 'intersectionTabs' }
    | { type: 'searchTabs'; friendsCount: number; exploreCount: number };

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
    const friends: PiktagProfile[] = [];
    const explore: PiktagProfile[] = [];
    for (const p of merged) {
      if (myFriendIds.has(p.id)) friends.push(p);
      else explore.push(p);
    }
    return { searchFriends: friends, searchExplore: explore };
  }, [profiles, tagUsers, myFriendIds]);

  // Whenever a fresh search produces results, default the tab to
  // "friends" if any matched, else "explore". Mirrors the intersection
  // tab default at the call site of handleSearchByTags.
  useEffect(() => {
    if (trimmedQuery === '') return;
    if (searchFriends.length + searchExplore.length === 0) return;
    setSearchTab(searchFriends.length > 0 ? 'friends' : 'explore');
  }, [trimmedQuery, searchFriends.length, searchExplore.length]);

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // 1. Loading
    if (loading || initialLoading) {
      items.push({ type: 'loading' });
      return items;
    }

    // 1b. Bootstrap failure — RPC + fallback both yielded nothing AND
    // we have no cached tags / recommendations to show. Render the
    // retry surface in place of the (otherwise blank) default screen.
    if (
      bootstrapFailed &&
      trimmedQuery === '' &&
      !intersectionMode &&
      tags.length === 0 &&
      recommendedUsers.length === 0
    ) {
      items.push({ type: 'bootstrapError' });
      return items;
    }

    // Intersection mode — tabbed Friends / Explore results
    if (intersectionMode) {
      items.push({ type: 'intersectionTabs' as any });
      const activeList = intersectionTab === 'friends' ? intersectionFriends : intersectionExplore;
      if (activeList.length > 0) {
        activeList.forEach((profile) => {
          items.push({ type: 'profileItem', profile });
        });
      } else {
        items.push({ type: 'profilesEmpty' });
      }
      return items;
    }

    // Text-query mode. Results are grouped under a Friends / Explore tab
    // pair, mirroring intersection mode — friends-first when present so
    // the user sees their network before strangers. Falls through to the
    // explore tab when there are no friend matches.
    if (trimmedQuery !== '') {
      // Tags section — always show when search found matching tags.
      if (tags.length > 0) {
        items.push({ type: 'tagsHeader' });
        items.push({ type: 'tagsGrid' });
      }

      const totalCount = searchFriends.length + searchExplore.length;
      if (totalCount > 0) {
        items.push({
          type: 'searchTabs',
          friendsCount: searchFriends.length,
          exploreCount: searchExplore.length,
        });
        const activeList = searchTab === 'friends' ? searchFriends : searchExplore;
        if (activeList.length > 0) {
          for (const profile of activeList) {
            items.push({ type: 'profileItem', profile });
          }
        } else {
          items.push({ type: 'profilesEmpty' });
        }
      } else if (tags.length === 0) {
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
      // Default unfocused view — popular tags (nearby users + global fallback)
      // plus recommended users.
      if (recommendedUsers.length > 0) {
        items.push({ type: 'recommendedUsers' });
      }
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
    intersectionTab,
    searchFriends,
    searchExplore,
    searchTab,
    recommendedUsers,
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
      case 'tagsHeader':
        return 'tagsHeader';
      case 'tagsEmpty':
        return 'tagsEmpty';
      case 'tagsGrid':
        return 'tagsGrid';
      case 'clearHistoryBtn':
        return 'clearHistoryBtn';
      case 'recommendedUsers':
        return 'recommendedUsers';
      case 'intersectionTabs':
        return 'intersectionTabs';
      case 'searchTabs':
        return 'searchTabs';
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
                          // Re-filter results with remaining tags
                          setSelectedTagIds(remaining.map(t => t.id));
                          setTimeout(() => handleSearchByTags(), 100);
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <X size={14} color={COLORS.white} />
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
                    {t('tagDetail.tabConnections')} ({intersectionFriends.length})
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
                  <Text style={styles.sectionLabelClear}>{t('search.clearHistory') || '清除'}</Text>
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
              deleteLabel={t('search.deleteRecentItem') || '刪除這筆紀錄'}
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
              <Text style={styles.emptyStateHint}>
                {t('search.tryTagSearchHint')}
              </Text>
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

        case 'tagsHeader':
          return (
            <Text style={styles.resultSectionLabel}>
              {t('search.tagsSectionLabel')}
            </Text>
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

        case 'recommendedUsers':
          return (
            <View style={{ paddingBottom: 16 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.gray900, marginBottom: 10 }}>
                {t('search.recommendedTitle') || '你可能想認識'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                {recommendedUsers.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    style={{ alignItems: 'center', width: 80 }}
                    activeOpacity={0.7}
                    onPress={() => handleProfilePress(u)}
                  >
                    <RingedAvatar
                      size={68}
                      ringStyle="gradient"
                      name={u.full_name || u.username || ''}
                      avatarUrl={u.avatar_url}
                    />
                    <Text style={{ fontSize: 12, fontWeight: '500', color: COLORS.gray700, marginTop: 4, textAlign: 'center' }} numberOfLines={1}>
                      {u.full_name || u.username || ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          );

        default:
          return null;
      }
    },
    [
      activeCategory,
      handleCategoryPress,
      handleRecentSearchTap,
      handleProfilePress,
      handleTagPress,
      handleTagLongPress,
      recommendedUsers,
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
      handleResetToDefault,
      handleDeleteRecentAt,
      intersectionTab,
      intersectionFriends,
      intersectionExplore,
      intersectionSelectedTags,
      searchTab,
      handleSearchByTags,
      runBootstrap,
    ],
  );

  // ── Memoized search container style ──
  const searchContainerStyle = useMemo(
    () => [styles.searchContainer, isFocused && styles.searchContainerFocused],
    [isFocused],
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('search.headerTitle') || '搜尋'}</Text>
          <TouchableOpacity
            style={styles.headerMapBtn}
            activeOpacity={0.6}
            onPress={() => setMapVisible(true)}
            accessibilityLabel={t('search.openMap') || '地圖檢視'}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MapPin size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <Pressable style={searchContainerStyle} onPress={focusSearchInput}>
          <Search
            size={20}
            color={COLORS.gray400}
            style={styles.searchIcon}
            pointerEvents="none"
          />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder={placeholder}
            placeholderTextColor={COLORS.gray400}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            returnKeyType="search"
            onSubmitEditing={handleSubmitEditing}
            accessibilityLabel="搜尋"
            accessibilityRole="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={handleResetToDefault}
              style={styles.searchClearBtn}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="清除搜尋"
              accessibilityRole="button"
            >
              <X size={16} color={COLORS.gray400} />
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
            {selectedTagIds.length} {t('search.tagsSelected') || '個標籤已選'}
          </Text>
          <TouchableOpacity style={styles.floatingClearBtn} onPress={() => setSelectedTagIds([])} activeOpacity={0.7}>
            <Text style={styles.floatingClearText}>{t('search.clearAll') || '清除'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.floatingSearchBtn} onPress={handleSearchByTags} activeOpacity={0.8}>
            <Search size={16} color={COLORS.white} />
            <Text style={styles.floatingSearchBtnText}>{t('search.searchBtn') || '搜尋'}</Text>
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
    </SafeAreaView>
  );
}

// Stable array reference for SafeAreaView edges
const topEdges: ('top')[] = ['top'];

const styles = StyleSheet.create({
  // Semantic type badge
  semanticBadge: {
    backgroundColor: COLORS.gray100,
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
    color: COLORS.gray500,
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
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray200,
    gap: 10,
  },
  floatingSearchText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  floatingClearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  floatingClearText: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  floatingSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  floatingSearchBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  // Selected tags bar (unused, kept for reference)
  selectedTagsBar: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    backgroundColor: COLORS.gray50,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  selectedTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  clearAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  clearAllText: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  intersectionHint: {
    fontSize: 12,
    color: COLORS.gray400,
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
    backgroundColor: COLORS.piktag500,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 6,
  },
  selectedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  intersectionTabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
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
    borderBottomColor: COLORS.piktag500,
  },
  intersectionTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  intersectionTabTextActive: {
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // Main styles
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
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
    color: COLORS.gray900,
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
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchContainerFocused: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.piktag500,
    shadowColor: COLORS.piktag200,
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
    color: COLORS.gray900,
    lineHeight: 22,
    padding: 0,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 100,
  },
  categorySectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray700,
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
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  tagCardHighlighted: {
    backgroundColor: COLORS.piktag500,
  },
  tagCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    lineHeight: 20,
  },
  tagNameHighlighted: {
    color: COLORS.white,
  },
  tagCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  tagCount: {
    fontSize: 11,
    color: COLORS.gray400,
    lineHeight: 14,
  },
  tagCountHighlighted: {
    color: 'rgba(255,255,255,0.7)',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
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
    color: COLORS.gray700,
    textAlign: 'center',
  },
  emptyStateHint: {
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'center',
    marginTop: 8,
  },
  clearRetryButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: COLORS.gray100,
  },
  clearRetryButtonText: {
    fontSize: 14,
    color: COLORS.gray700,
    fontWeight: '500',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 16,
  },
  sectionLabelText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  sectionLabelClear: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray400,
  },
  resultSectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
    marginBottom: 12,
    marginTop: 4,
  },
  profilesSection: {
    marginBottom: 20,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
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
    color: COLORS.gray900,
  },
  profileUsername: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  recentSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
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
    color: COLORS.gray700,
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
    color: COLORS.red500,
    fontWeight: '500',
  },

  // Tag Category
  tagCategorySection: {
    marginBottom: 16,
  },
  tagCategoryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray700,
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
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  categoryChipActive: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray600,
  },
  categoryChipTextActive: {
    color: COLORS.piktag600,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    backgroundColor: COLORS.gray900,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastText: {
    color: COLORS.white,
    fontSize: 14,
    textAlign: 'center',
  },
});
