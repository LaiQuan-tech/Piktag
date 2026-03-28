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
  Image,
  ListRenderItemInfo,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  Hash,
  MapPin,
  CheckCircle2,
  Clock,
  User,
  Flame,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { getCache, setCache } from '../lib/dataCache';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import type { Tag, PiktagProfile } from '../types';

const RECENT_SEARCHES_KEY = 'piktag_recent_searches';
const MAX_RECENT_SEARCHES = 10;
const CACHE_KEY_POPULAR_TAGS = 'search_popular_tags';
const CACHE_KEY_SEARCH_QUERY = 'search_last_query';

type CategoryKey = 'popular' | 'nearby' | 'verified' | 'recent' | 'nearby_tags';

const CATEGORY_DEFS: {
  icon: typeof Hash;
  labelKey: string;
  bgColor: string;
  iconColor: string;
  key: CategoryKey;
}[] = [
  {
    icon: Hash,
    labelKey: 'search.categoryPopular',
    bgColor: COLORS.piktag50,
    iconColor: COLORS.piktag600,
    key: 'popular',
  },
  {
    icon: MapPin,
    labelKey: 'search.categoryNearby',
    bgColor: COLORS.gray50,
    iconColor: COLORS.gray600,
    key: 'nearby',
  },
  {
    icon: CheckCircle2,
    labelKey: 'search.categoryVerified',
    bgColor: COLORS.blue50,
    iconColor: COLORS.blue500,
    key: 'verified',
  },
  {
    icon: Flame,
    labelKey: 'search.categoryNearbyTags',
    bgColor: '#fff7ed',
    iconColor: '#f97316',
    key: 'nearby_tags',
  },
  {
    icon: Clock,
    labelKey: 'search.categoryRecent',
    bgColor: COLORS.gray50,
    iconColor: COLORS.gray600,
    key: 'recent',
  },
];

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
          {profile.is_verified && (
            <CheckCircle2
              size={16}
              color={COLORS.blue500}
              fill={COLORS.blue500}
              strokeWidth={0}
              style={verifiedBadgeStyle}
            />
          )}
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
  isHighlighted: boolean;
  onPress: (tag: Tag) => void;
  countSuffix: string;
};

const TagCard = React.memo(function TagCard({ tag, isHighlighted, onPress, countSuffix }: TagCardProps) {
  const handlePress = useCallback(() => {
    onPress(tag);
  }, [onPress, tag]);

  return (
    <TouchableOpacity
      style={[
        styles.tagCard,
        isHighlighted && styles.tagCardHighlighted,
      ]}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      <View style={styles.tagCardRow}>
        <Hash size={14} color={isHighlighted ? COLORS.white : COLORS.piktag500} strokeWidth={2.5} />
        <Text
          style={[
            styles.tagName,
            isHighlighted && styles.tagNameHighlighted,
          ]}
          numberOfLines={1}
        >
          {tag.name}
        </Text>
      </View>
      <Text
        style={[
          styles.tagCount,
          isHighlighted && styles.tagCountHighlighted,
        ]}
      >
        {tag.usage_count}{countSuffix}
      </Text>
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

type CategoryButtonProps = {
  cat: (typeof CATEGORY_DEFS)[number];
  isActive: boolean;
  onPress: (key: CategoryKey) => void;
  label: string;
};

const CategoryButton = React.memo(function CategoryButton({ cat, isActive, onPress, label }: CategoryButtonProps) {
  const handlePress = useCallback(() => {
    onPress(cat.key);
  }, [onPress, cat.key]);

  const IconComponent = cat.icon;
  const circleStyle = useMemo(
    () => [
      styles.categoryIconCircle,
      { backgroundColor: cat.bgColor },
      isActive && styles.categoryIconCircleActive,
    ],
    [cat.bgColor, isActive],
  );

  return (
    <TouchableOpacity
      style={styles.categoryItem}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      <View style={circleStyle}>
        <IconComponent size={24} color={cat.iconColor} />
      </View>
      <Text
        style={[
          styles.categoryLabel,
          isActive && styles.categoryLabelActive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
});

// ── Helper: get user location (shared by nearby profiles & nearby tags) ──

async function getUserLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
  const [tagCategories, setTagCategories] = useState<string[]>([]);
  const [selectedTagCategory, setSelectedTagCategory] = useState<string | null>(null);

  // Refs for stable closures
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const loadPopularTags = useCallback(async () => {
    const cached = getCache<Tag[]>(CACHE_KEY_POPULAR_TAGS);
    if (cached) {
      setTags(cached);
      // Extract categories
      const cats = [...new Set(cached.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
      setTagCategories(cats);
      setLoading(false);
      setInitialLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('id, name, semantic_type, usage_count')
        .order('usage_count', { ascending: false })
        .limit(50);

      if (!error && data) {
        setCache(CACHE_KEY_POPULAR_TAGS, data);
        setTags(data);
        // Extract unique categories
        const cats = [...new Set(data.map((t: any) => t.semantic_type).filter(Boolean))] as string[];
        setTagCategories(cats);
      }
    } catch {} finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, []);

  const loadVerifiedProfiles = useCallback(async () => {
    setLoading(true);
    setTags([]);
    try {
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_verified')
        .eq('is_verified', true)
        .limit(20);

      if (!error && data) {
        setProfiles(data);
      }
    } catch {} finally {
      setLoading(false);
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
          .update({ latitude: location.lat, longitude: location.lng })
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

  const loadNearbyTags = useCallback(async () => {
    setLoading(true);
    setProfiles([]);
    try {
      const location = await getUserLocation();

      if (!location) {
        // Fallback to regular popular tags
        loadPopularTags();
        return;
      }

      const { lat: userLat, lng: userLng } = location;

      // Find nearby profiles (within ~50km rough filter)
      const latRange = 0.5; // ~50km
      const lngRange = 0.5;
      const { data: nearbyProfiles } = await supabase
        .from('piktag_profiles')
        .select('id')
        .gte('latitude', userLat - latRange)
        .lte('latitude', userLat + latRange)
        .gte('longitude', userLng - lngRange)
        .lte('longitude', userLng + lngRange);

      if (!nearbyProfiles || nearbyProfiles.length === 0) {
        loadPopularTags();
        return;
      }

      const nearbyIds = nearbyProfiles.map((p: any) => p.id);

      // Get tags used by nearby users' connections
      const { data: nearbyConnections } = await supabase
        .from('piktag_connections')
        .select('id')
        .in('user_id', nearbyIds);

      if (!nearbyConnections || nearbyConnections.length === 0) {
        loadPopularTags();
        return;
      }

      const connIds = nearbyConnections.map((c: any) => c.id);

      // Get tag counts for these connections
      const { data: tagData } = await supabase
        .from('piktag_connection_tags')
        .select('tag:piktag_tags!tag_id(id, name, semantic_type, usage_count, created_at)')
        .in('connection_id', connIds);

      if (tagData) {
        const tagMap: Record<string, { tag: any; count: number }> = {};
        for (const ct of tagData) {
          const tItem = (ct as any).tag;
          if (tItem) {
            if (!tagMap[tItem.id]) {
              tagMap[tItem.id] = { tag: tItem, count: 0 };
            }
            tagMap[tItem.id].count++;
          }
        }
        const sorted = Object.values(tagMap)
          .sort((a, b) => b.count - a.count)
          .slice(0, 20)
          .map((item) => ({ ...item.tag, usage_count: item.count }));
        setTags(sorted);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [loadPopularTags]);

  // ── Load initial data on mount (parallel) ──

  useEffect(() => {
    Promise.all([loadPopularTags(), loadRecentSearches()]);
  }, [loadPopularTags, loadRecentSearches]);

  // ── Event handlers (all useCallback) ──

  const handleCategoryPress = useCallback((key: CategoryKey) => {
    setSearchQuery('');
    setProfiles([]);
    setTags([]);

    setActiveCategory((prev) => {
      if (prev === key) {
        // Toggle off - go back to popular
        loadPopularTags();
        return null;
      }

      switch (key) {
        case 'popular':
          loadPopularTags();
          break;
        case 'nearby':
          loadNearbyProfiles();
          break;
        case 'verified':
          loadVerifiedProfiles();
          break;
        case 'nearby_tags':
          loadNearbyTags();
          break;
        case 'recent':
          // Just show recent searches from local state
          setLoading(false);
          break;
      }

      return key;
    });
  }, [loadPopularTags, loadNearbyProfiles, loadVerifiedProfiles, loadNearbyTags]);

  const performSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setActiveCategory(null);
        loadPopularTags();
        return;
      }

      setLoading(true);
      setActiveCategory(null);

      try {
        // Search tags (by name + aliases), profiles in parallel
        const [tagsResult, aliasResult, profilesResult] = await Promise.all([
          supabase
            .from('piktag_tags')
            .select('id, name, semantic_type, usage_count, concept_id')
            .ilike('name', `%${trimmed}%`)
            .order('usage_count', { ascending: false })
            .limit(20),
          // Also search via tag_aliases → tag_concepts → piktag_tags
          supabase
            .from('tag_aliases')
            .select('concept_id, concept:tag_concepts(canonical_name, semantic_type)')
            .ilike('alias', `%${trimmed}%`)
            .limit(10),
          supabase
            .from('piktag_profiles')
            .select('id, username, full_name, avatar_url, is_verified')
            .or(`username.ilike.%${trimmed}%,full_name.ilike.%${trimmed}%`)
            .limit(20),
        ]);

        // Merge alias results: find tags by concept_id
        console.log('[Search] tagsResult:', JSON.stringify(tagsResult.data?.map((t: any) => ({name: t.name, concept_id: t.concept_id}))));
        console.log('[Search] aliasResult:', JSON.stringify(aliasResult.data));
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
              console.log('[Search] tag:', tag.name, 'concept_id:', (tag as any).concept_id);
              if ((tag as any).concept_id) {
                const { data: siblingTags } = await supabase
                  .from('piktag_tags')
                  .select('id')
                  .eq('concept_id', (tag as any).concept_id);
                if (siblingTags) {
                  allTagIds = [...new Set([tag.id, ...siblingTags.map((t: any) => t.id)])];
                  console.log('[Search] siblingTags:', siblingTags.length, 'allTagIds:', allTagIds);
                }
              }

              const { data: utData } = await supabase
                .from('piktag_user_tags')
                .select('user_id, piktag_profiles!inner(id, username, full_name, avatar_url, is_verified, is_public)')
                .in('tag_id', allTagIds)
                .eq('is_private', false)
                .limit(10);

              console.log('[Search] utData for', tag.name, ':', utData?.length, 'results');
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
        saveRecentSearch(trimmed);
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
      navigation.navigate('TagDetail', { tagId: tag.id, tagName: tag.name });
    },
    [navigation],
  );

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
    () =>
      activeCategory === 'nearby' ||
      activeCategory === 'verified' ||
      (trimmedQuery !== '' && profiles.length > 0),
    [activeCategory, trimmedQuery, profiles.length],
  );

  const showTags = useMemo(
    () =>
      (activeCategory !== 'nearby' &&
        activeCategory !== 'verified' &&
        activeCategory !== 'recent') ||
      activeCategory === 'nearby_tags',
    [activeCategory],
  );

  const showRecent = activeCategory === 'recent';

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
    | { type: 'categories' }
    | { type: 'loading' }
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
    | { type: 'tagUsersSection'; tagUserData: { tag: Tag; users: any[] } };

  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // 1. Categories row (always)
    items.push({ type: 'categories' });

    // 2. Loading
    if (loading || initialLoading) {
      items.push({ type: 'loading' });
      return items; // show nothing else while loading
    }

    // 3. Recent searches section
    if (showRecent) {
      if (recentSearches.length === 0) {
        items.push({ type: 'recentEmpty' });
      } else {
        items.push({ type: 'clearHistoryBtn' });
        recentSearches.forEach((query, index) => {
          items.push({ type: 'recentItem', query, index });
        });
      }
    }

    // 4. Profile results section
    if (showProfiles) {
      if (trimmedQuery !== '') {
        items.push({ type: 'profilesHeader' });
      }
      if (profiles.length === 0) {
        items.push({ type: 'profilesEmpty' });
      } else {
        profiles.forEach((profile) => {
          items.push({ type: 'profileItem', profile });
        });
      }
    }

    // 5. Tags section
    if (showTags && !initialLoading) {
      if (trimmedQuery !== '' && tags.length > 0) {
        items.push({ type: 'tagsHeader' });
      }
      if (tags.length === 0 && trimmedQuery !== '') {
        items.push({ type: 'tagsEmpty' });
      } else if (tags.length > 0) {
        items.push({ type: 'tagsGrid' });
      }
    }

    // 6. Tag users preview (people using matched tags)
    if (trimmedQuery !== '' && tagUsers.length > 0) {
      tagUsers.forEach((tu) => {
        items.push({ type: 'tagUsersSection', tagUserData: tu });
      });
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
  ]);

  const keyExtractor = useCallback((item: ListItem, index: number): string => {
    switch (item.type) {
      case 'categories':
        return 'categories';
      case 'loading':
        return 'loading';
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
      case 'tagUsersSection':
        return `tagUsers-${item.tagUserData?.tag?.id || index}`;
      default:
        return `item-${index}`;
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      switch (item.type) {
        case 'categories':
          return (
            <View style={styles.categoriesRow}>
              {CATEGORY_DEFS.map((cat) => (
                <CategoryButton
                  key={cat.key}
                  cat={cat}
                  isActive={activeCategory === cat.key}
                  onPress={handleCategoryPress}
                  label={t(cat.labelKey)}
                />
              ))}
            </View>
          );

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
                {tags.map((tag, index) => (
                  <TagCard
                    key={tag.id}
                    tag={tag}
                    isHighlighted={index === 4}
                    onPress={handleTagPress}
                    countSuffix={tagCountSuffix}
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
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={styles.tagsGrid}>
                {filteredTags.map((tag, index) => (
                  <TagCard
                    key={tag.id}
                    tag={tag}
                    isHighlighted={index === 0}
                    onPress={handleTagPress}
                    countSuffix={tagCountSuffix}
                  />
                ))}
              </View>
            </View>
          );
        }

        case 'tagUsersSection': {
          const { tag: sectionTag, users: sectionUsers } = item.tagUserData;
          return (
            <View style={styles.tagUsersSection}>
              <View style={styles.tagUsersSectionHeader}>
                <View style={styles.tagUsersTitleRow}>
                  <Hash size={14} color={COLORS.piktag600} strokeWidth={2.5} />
                  <Text style={styles.tagUsersSectionTitle}>{sectionTag.name}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => navigation.navigate('TagDetail', {
                    tagId: sectionTag.id,
                    tagName: sectionTag.name,
                    initialTab: 'explore',
                  })}
                  activeOpacity={0.7}
                >
                  <Text style={styles.tagUsersViewAll}>{t('tagDetail.viewAll')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.tagUsersList}>
                {sectionUsers.map((u: any) => (
                  <TouchableOpacity
                    key={u.id}
                    style={styles.tagUserRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('UserDetail', { userId: u.id })}
                  >
                    {u.avatar_url ? (
                      <Image source={{ uri: u.avatar_url }} style={styles.tagUserAvatar} />
                    ) : (
                      <View style={[styles.tagUserAvatar, styles.tagUserAvatarPlaceholder]}>
                        <User size={20} color={COLORS.gray400} />
                      </View>
                    )}
                    <View style={styles.tagUserInfo}>
                      <Text style={styles.tagUserName} numberOfLines={1}>
                        {u.full_name || u.username || ''}
                      </Text>
                      {u.username && (
                        <Text style={styles.tagUserUsername} numberOfLines={1}>
                          @{u.username}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
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
      handleTagPress,
      tags,
      filteredTags,
      tagCategories,
      selectedTagCategory,
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
    <SafeAreaView style={styles.container} edges={topEdges}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}># PikTag</Text>
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
          />
        </View>
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
    </SafeAreaView>
  );
}

// Stable array reference for SafeAreaView edges
const topEdges: ('top')[] = ['top'];

const styles = StyleSheet.create({
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
  categoriesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  categoryItem: {
    alignItems: 'center',
    flex: 1,
  },
  categoryIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  categoryIconCircleActive: {
    borderWidth: 2,
    borderColor: COLORS.piktag500,
  },
  categoryLabel: {
    fontSize: 12,
    color: COLORS.gray700,
    fontWeight: '500',
    lineHeight: 16,
  },
  categoryLabelActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
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

  // Tag Users Section
  tagUsersSection: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  tagUsersSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  tagUsersTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagUsersSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  tagUsersViewAll: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  tagUsersList: {
    paddingHorizontal: 20,
  },
  tagUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  tagUserAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
  },
  tagUserAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  tagUserInfo: {
    flex: 1,
    marginLeft: 12,
  },
  tagUserName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  tagUserUsername: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
});
