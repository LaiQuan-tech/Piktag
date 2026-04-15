import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  ListRenderItemInfo,
  Alert,
  ScrollView,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  Hash,
  User,
  Clock,
  TrendingUp,
  X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync, Accuracy } from 'expo-location';
import { useTranslation } from 'react-i18next';
import * as Localization from 'expo-localization';
import { supabase } from '../lib/supabase';
import { getCache, setCache } from '../lib/dataCache';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
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
      {profile.avatar_url ? (
        <Image
          source={{ uri: profile.avatar_url }}
          style={styles.profileAvatar}
        />
      ) : (
        <View style={styles.profileAvatarPlaceholder}>
          <User size={20} color={COLORS.gray400} />
        </View>
      )}
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
};

const RecentSearchItem = React.memo(function RecentSearchItem({ query, onPress }: RecentSearchItemProps) {
  const handlePress = useCallback(() => {
    onPress(query);
  }, [onPress, query]);

  return (
    <TouchableOpacity
      style={styles.recentSearchItem}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Clock size={16} color={COLORS.gray400} />
      <Text style={styles.recentSearchText}>{query}</Text>
    </TouchableOpacity>
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
  const [isFocused, setIsFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);

  // Data states
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<PiktagProfile[]>([]);
  const [tagUsers, setTagUsers] = useState<{ tag: Tag; users: any[] }[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchTab, setSearchTab] = useState<'popular' | 'history'>('popular');
  const [tagCategories, setTagCategories] = useState<string[]>([]);
  const [selectedTagCategory, setSelectedTagCategory] = useState<string | null>(null);
  const [trendingTagIds, setTrendingTagIds] = useState<Set<string>>(new Set());

  // Multi-tag selection (toggle only, no fetch until search button pressed)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const selectedTagIdSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  // Smart recommendations
  const [recommendedUsers, setRecommendedUsers] = useState<PiktagProfile[]>([]);


  // Refs for stable closures
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSearch = useRef(false);
  const [intersectionMode, setIntersectionMode] = useState(false);
  const [intersectionProfiles, setIntersectionProfiles] = useState<PiktagProfile[]>([]);
  const recentSearchesRef = useRef(recentSearches);
  recentSearchesRef.current = recentSearches;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    const deviceLocale = Localization.getLocales()?.[0]?.languageCode || 'zh';
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
          .gte('longitude', userLng - range).lte('longitude', userLng + range);
        if (nearbyProfiles && nearbyProfiles.length > 0) {
          const nearbyIds = nearbyProfiles.map((p: any) => p.id);
          const { data: nearbyConns } = await supabase
            .from('piktag_connections').select('id').in('user_id', nearbyIds);
          if (nearbyConns && nearbyConns.length > 0) {
            const { data: tagData } = await supabase
              .from('piktag_connection_tags')
              .select('tag:piktag_tags!tag_id(id, name, semantic_type, usage_count)')
              .in('connection_id', nearbyConns.map((c: any) => c.id));
            if (tagData && tagData.length > 0) {
              const tagMap: Record<string, { tag: any; count: number }> = {};
              for (const ct of tagData) {
                const tItem = (ct as any).tag;
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
        setTags(sorted);
        const cats = [...new Set(sorted.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
        setTagCategories(cats);

        // Calculate trending: count user_tags created in last 7 days per tag
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const tagIds = data.map((t: any) => t.id);
        const { data: recentData } = await supabase
          .from('piktag_user_tags')
          .select('tag_id')
          .in('tag_id', tagIds)
          .gte('created_at', sevenDaysAgo);

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
    } catch {} finally {
      setLoading(false);
      setInitialLoading(false);
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
        if (location) {
          const { lat: userLat, lng: userLng } = location;
          // Sort by distance
          const sorted = data.sort((a: PiktagProfile, b: PiktagProfile) => {
            const distA = Math.sqrt(
              Math.pow((a.latitude || 0) - userLat, 2) + Math.pow((a.longitude || 0) - userLng, 2)
            );
            const distB = Math.sqrt(
              Math.pow((b.latitude || 0) - userLat, 2) + Math.pow((b.longitude || 0) - userLng, 2)
            );
            return distA - distB;
          });
          setProfiles(sorted.filter((p: PiktagProfile) => p.id !== user?.id).slice(0, 20));
        } else {
          setProfiles(data.filter((p: PiktagProfile) => p.id !== user?.id).slice(0, 20));
        }
      }
    } catch {} finally {
      setLoading(false);
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
        .eq('is_private', false);
      if (!myTags || myTags.length === 0) return;

      const myTagIds = myTags.map(t => t.tag_id);

      // Get my existing connection user IDs (to exclude)
      const { data: myConns } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('user_id', user.id);
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
    } catch {}
  }, [user]);

  useEffect(() => {
    Promise.all([loadPopularTags(), loadRecentSearches(), loadRecommendations()]);
  }, [loadPopularTags, loadRecentSearches, loadRecommendations]);

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

      // Use first keyword for main search (profiles + aliases)
      const mainKeyword = keywords[0];

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

        if (mergedTags.length > 0) {
          setTags(mergedTags);

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
          } else {
            setTagUsers([]);
          }
        } else {
          setTags([]);
          setTagUsers([]);
        }

        if (!profilesResult.error && profilesResult.data) {
          setProfiles(profilesResult.data);
        } else {
          setProfiles([]);
        }

        // Save to recent searches
        saveRecentSearch(query.trim());
      } catch {
        setTags([]);
        setProfiles([]);
      } finally {
        setLoading(false);
      }
    },
    [loadPopularTags, saveRecentSearch],
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);

      // Skip if triggered by handleSearchByTags
      if (skipNextSearch.current) {
        skipNextSearch.current = false;
        return;
      }

      // Exit intersection mode when user types
      if (intersectionMode) {
        setIntersectionMode(false);
        setIntersectionProfiles([]);
      }

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        performSearch(text);
      }, 300);
    },
    [performSearch],
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

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
    setSearchQuery(selected.map(t => t.name).join(' + '));
    skipNextSearch.current = true;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

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
        } catch {}

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

      const userIds = [...intersection].slice(0, 30);

      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from('piktag_profiles')
          .select('id, username, full_name, avatar_url, is_verified')
          .in('id', userIds);
        setIntersectionProfiles((profileData || []) as PiktagProfile[]);
      }
    } catch (err) {
      console.warn('Intersection search error:', err);
      setProfiles([]);
    }

    setLoading(false);
    setSelectedTagIds([]);
  }, [selectedTagIds, selectedTagIdSet, tags, navigation]);


  const handleProfilePress = useCallback(
    (profile: PiktagProfile) => {
      navigation.navigate('UserDetail', { userId: profile.id });
    },
    [navigation],
  );

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handleSubmitEditing = useCallback(() => {
    performSearch(searchQuery);
  }, [performSearch, searchQuery]);

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
    | { type: 'recommendedUsers' };

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // 1. Loading
    if (loading || initialLoading) {
      items.push({ type: 'loading' });
      return items;
    }

    // Intersection mode — only show matching profiles
    if (intersectionMode) {
      if (intersectionProfiles.length > 0) {
        intersectionProfiles.forEach((profile) => {
          items.push({ type: 'profileItem', profile });
        });
      } else {
        items.push({ type: 'profilesEmpty' });
      }
      return items;
    }

    // If user is typing, show a single flat, deduplicated list of
    // matching users — no tag pill row, no "#tag 查看全部" grouped
    // sections, no separate profile-vs-tag-match buckets. Algorithm
    // can still be complex (profile match + tag match + concept synonym
    // match happen in performSearch), but the presentation is a single
    // list so the UI stays thin.
    if (trimmedQuery !== '') {
      const seenIds = new Set<string>();
      const mergedProfiles: PiktagProfile[] = [];

      // 1) Direct name/username matches first — higher signal.
      for (const p of profiles) {
        if (p?.id && !seenIds.has(p.id)) {
          seenIds.add(p.id);
          mergedProfiles.push(p);
        }
      }
      // 2) Users matched via their public tags, deduplicated across tag groups.
      for (const tu of tagUsers) {
        for (const u of tu.users) {
          if (u?.id && !seenIds.has(u.id)) {
            seenIds.add(u.id);
            mergedProfiles.push(u as PiktagProfile);
          }
        }
      }

      if (mergedProfiles.length > 0) {
        for (const profile of mergedProfiles) {
          items.push({ type: 'profileItem', profile });
        }
      } else {
        items.push({ type: 'profilesEmpty' });
      }
    } else {
      // No query — show tab content. Note: 熱門標籤 now means
      // "popular tags from nearby users (with global fallback)" — see
      // loadPopularTags. The previously-separate 附近標籤 tab was merged
      // into this one so the user sees a single relevant list.
      switch (searchTab) {
        case 'popular':
          if (recommendedUsers.length > 0) {
            items.push({ type: 'recommendedUsers' });
          }
          if (tags.length > 0) {
            items.push({ type: 'tagsGrid' });
          } else {
            items.push({ type: 'tagsEmpty' });
          }
          break;

        case 'history':
          if (recentSearches.length > 0) {
            items.push({ type: 'sectionLabel', label: '', showClear: true });
            recentSearches.forEach((query, index) => {
              items.push({ type: 'recentItem', query, index });
            });
          } else {
            items.push({ type: 'recentEmpty' });
          }
          break;
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
    searchTab,
    intersectionMode,
    intersectionProfiles,
    recommendedUsers,
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
              <ActivityIndicator size="large" color={COLORS.piktag500} />
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
            <Text style={styles.emptyText}>
              {t('search.noProfilesFound')}
            </Text>
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
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
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
                    {u.avatar_url ? (
                      <Image source={{ uri: u.avatar_url }} style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: COLORS.piktag300 }} cachePolicy="memory-disk" />
                    ) : (
                      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.gray200, alignItems: 'center', justifyContent: 'center' }}>
                        <User size={24} color={COLORS.gray400} />
                      </View>
                    )}
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
    ],
  );

  // ── Memoized search container style ──
  const searchContainerStyle = useMemo(
    () => [styles.searchContainer, isFocused && styles.searchContainerFocused],
    [isFocused],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={topEdges}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('search.headerTitle') || '搜尋'}</Text>
        <View style={searchContainerStyle}>
          <Search
            size={20}
            color={COLORS.gray400}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={t('search.searchPlaceholder')}
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
              onPress={() => handleSearchChange('')}
              style={styles.searchClearBtn}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="清除搜尋"
              accessibilityRole="button"
            >
              <X size={16} color={COLORS.gray400} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab bar: 熱門標籤 | 搜尋紀錄
          (附近標籤 was merged into 熱門標籤 — see loadPopularTags) */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, searchTab === 'popular' && styles.tabItemActive]}
          onPress={() => setSearchTab('popular')}
          activeOpacity={0.7}
          accessibilityLabel="熱門標籤"
          accessibilityRole="tab"
          accessibilityState={{ selected: searchTab === 'popular' }}
        >
          <Hash size={16} color={searchTab === 'popular' ? COLORS.piktag600 : COLORS.gray400} />
          <Text style={[styles.tabItemText, searchTab === 'popular' && styles.tabItemTextActive]}>
            {t('search.popularTagsLabel') || '熱門標籤'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, searchTab === 'history' && styles.tabItemActive]}
          onPress={() => setSearchTab('history')}
          activeOpacity={0.7}
          accessibilityLabel="搜尋紀錄"
          accessibilityRole="tab"
          accessibilityState={{ selected: searchTab === 'history' }}
        >
          <Clock size={16} color={searchTab === 'history' ? COLORS.piktag600 : COLORS.gray400} />
          <Text style={[styles.tabItemText, searchTab === 'history' && styles.tabItemTextActive]}>
            {t('search.recentSearchesLabel') || '搜尋紀錄'}
          </Text>
        </TouchableOpacity>
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
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
    marginBottom: 16,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    paddingHorizontal: 16,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: COLORS.piktag500,
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray400,
  },
  tabItemTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
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
    borderRadius: 20,
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
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
  },
  profileAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    gap: 10,
  },
  recentSearchText: {
    fontSize: 15,
    color: COLORS.gray700,
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
});
