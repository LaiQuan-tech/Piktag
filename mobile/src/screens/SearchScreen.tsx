import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Image,
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
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import type { Tag, PiktagProfile } from '../types';

const RECENT_SEARCHES_KEY = 'piktag_recent_searches';
const MAX_RECENT_SEARCHES = 10;

type CategoryKey = 'popular' | 'nearby' | 'verified' | 'recent' | 'nearby_tags';

const CATEGORIES: {
  icon: typeof Hash;
  label: string;
  bgColor: string;
  iconColor: string;
  key: CategoryKey;
}[] = [
  {
    icon: Hash,
    label: '\u71b1\u9580\u6a19\u7c64',
    bgColor: COLORS.piktag50,
    iconColor: COLORS.piktag600,
    key: 'popular',
  },
  {
    icon: MapPin,
    label: '\u9644\u8fd1\u6703\u54e1',
    bgColor: COLORS.gray50,
    iconColor: COLORS.gray600,
    key: 'nearby',
  },
  {
    icon: CheckCircle2,
    label: '\u8a8d\u8b49\u6703\u54e1',
    bgColor: COLORS.blue50,
    iconColor: COLORS.blue500,
    key: 'verified',
  },
  {
    icon: Flame,
    label: '\u9644\u8fd1\u71b1\u6a19',
    bgColor: '#fff7ed',
    iconColor: '#f97316',
    key: 'nearby_tags',
  },
  {
    icon: Clock,
    label: '\u6700\u8fd1\u641c\u5c0b',
    bgColor: COLORS.gray50,
    iconColor: COLORS.gray600,
    key: 'recent',
  },
];

type SearchScreenProps = {
  navigation: any;
};

export default function SearchScreen({ navigation }: SearchScreenProps) {
  const { user } = useAuth();
  const [isFocused, setIsFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);

  // Data states
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<PiktagProfile[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Debounce timer ref
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load popular tags on mount
  useEffect(() => {
    loadPopularTags();
    loadRecentSearches();
  }, []);

  const loadRecentSearches = async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        setRecentSearches(JSON.parse(stored));
      }
    } catch {}
  };

  const saveRecentSearch = async (query: string) => {
    try {
      const trimmed = query.trim();
      if (!trimmed) return;
      const updated = [trimmed, ...recentSearches.filter((s) => s !== trimmed)].slice(
        0,
        MAX_RECENT_SEARCHES,
      );
      setRecentSearches(updated);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch {}
  };

  const loadPopularTags = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(20);

      if (!error && data) {
        setTags(data);
      }
    } catch {} finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  const loadVerifiedProfiles = async () => {
    setLoading(true);
    setTags([]);
    try {
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('*')
        .eq('is_verified', true)
        .limit(20);

      if (!error && data) {
        setProfiles(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const loadNearbyProfiles = async () => {
    setLoading(true);
    setTags([]);
    try {
      // Request GPS permission and get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      let userLat: number | null = null;
      let userLng: number | null = null;

      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          userLat = loc.coords.latitude;
          userLng = loc.coords.longitude;
          // Update own profile location
          if (user) {
            supabase
              .from('piktag_profiles')
              .update({ latitude: userLat, longitude: userLng })
              .eq('id', user.id)
              .then(() => {});
          }
        } catch {}
      }

      // Fetch profiles with lat/lng
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('*')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(50);

      if (!error && data) {
        if (userLat != null && userLng != null) {
          // Sort by distance
          const sorted = data.sort((a: PiktagProfile, b: PiktagProfile) => {
            const distA = Math.sqrt(
              Math.pow((a.latitude || 0) - userLat!, 2) + Math.pow((a.longitude || 0) - userLng!, 2)
            );
            const distB = Math.sqrt(
              Math.pow((b.latitude || 0) - userLat!, 2) + Math.pow((b.longitude || 0) - userLng!, 2)
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
  };

  const loadNearbyTags = async () => {
    setLoading(true);
    setProfiles([]);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let userLat: number | null = null;
      let userLng: number | null = null;

      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          userLat = loc.coords.latitude;
          userLng = loc.coords.longitude;
        } catch {}
      }

      if (userLat == null || userLng == null) {
        // Fallback to regular popular tags
        loadPopularTags();
        return;
      }

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
        .select('tag:piktag_tags!tag_id(id, name, category, usage_count, created_at)')
        .in('connection_id', connIds);

      if (tagData) {
        const tagMap: Record<string, { tag: any; count: number }> = {};
        for (const ct of tagData) {
          const t = (ct as any).tag;
          if (t) {
            if (!tagMap[t.id]) {
              tagMap[t.id] = { tag: t, count: 0 };
            }
            tagMap[t.id].count++;
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
  };

  const handleCategoryPress = (key: CategoryKey) => {
    setSearchQuery('');
    setProfiles([]);
    setTags([]);

    if (activeCategory === key) {
      // Toggle off - go back to popular
      setActiveCategory(null);
      loadPopularTags();
      return;
    }

    setActiveCategory(key);

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
  };

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
        // Search both tags and profiles in parallel
        const [tagsResult, profilesResult] = await Promise.all([
          supabase
            .from('piktag_tags')
            .select('*')
            .ilike('name', `%${trimmed}%`)
            .order('usage_count', { ascending: false })
            .limit(20),
          supabase
            .from('piktag_profiles')
            .select('*')
            .or(`username.ilike.%${trimmed}%,full_name.ilike.%${trimmed}%`)
            .limit(20),
        ]);

        if (!tagsResult.error && tagsResult.data) {
          setTags(tagsResult.data);
        } else {
          setTags([]);
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
    [recentSearches],
  );

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      performSearch(text);
    }, 300);
  };

  const handleRecentSearchTap = (query: string) => {
    setSearchQuery(query);
    performSearch(query);
  };

  const handleTagPress = (tag: Tag) => {
    navigation.navigate('UserDetail', { tagId: tag.id, tagName: tag.name });
  };

  const handleProfilePress = (profile: PiktagProfile) => {
    navigation.navigate('UserDetail', { userId: profile.id });
  };

  // Determine what content mode to show
  const showProfiles =
    activeCategory === 'nearby' ||
    activeCategory === 'verified' ||
    (searchQuery.trim() && profiles.length > 0);
  const showTags =
    (activeCategory !== 'nearby' &&
    activeCategory !== 'verified' &&
    activeCategory !== 'recent') ||
    activeCategory === 'nearby_tags';
  const showRecent = activeCategory === 'recent';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{'\u641c\u5c0b'}</Text>
        <View
          style={[
            styles.searchContainer,
            isFocused && styles.searchContainerFocused,
          ]}
        >
          <Search
            size={20}
            color={COLORS.gray400}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={'\u6a19\u7c64\u3001\u6703\u54e1\u5e33\u865f\u7b49'}
            placeholderTextColor={COLORS.gray400}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            returnKeyType="search"
            onSubmitEditing={() => performSearch(searchQuery)}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Category section label */}
        <Text style={styles.categorySectionLabel}>
          {'\u4f9d\u5206\u985e\u641c\u5c0b'}
        </Text>

        {/* Category buttons */}
        <View style={styles.categoriesRow}>
          {CATEGORIES.map((cat, index) => {
            const IconComponent = cat.icon;
            const isActive = activeCategory === cat.key;
            return (
              <TouchableOpacity
                key={index}
                style={styles.categoryItem}
                activeOpacity={0.7}
                onPress={() => handleCategoryPress(cat.key)}
              >
                <View
                  style={[
                    styles.categoryIconCircle,
                    { backgroundColor: cat.bgColor },
                    isActive && styles.categoryIconCircleActive,
                  ]}
                >
                  <IconComponent size={24} color={cat.iconColor} />
                </View>
                <Text
                  style={[
                    styles.categoryLabel,
                    isActive && styles.categoryLabelActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Loading indicator */}
        {(loading || initialLoading) && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.piktag500} />
          </View>
        )}

        {/* Recent searches */}
        {showRecent && !loading && (
          <View>
            {recentSearches.length === 0 ? (
              <Text style={styles.emptyText}>
                {'\u9084\u6c92\u6709\u641c\u5c0b\u7d00\u9304'}
              </Text>
            ) : (
              recentSearches.map((query, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.recentSearchItem}
                  onPress={() => handleRecentSearchTap(query)}
                  activeOpacity={0.7}
                >
                  <Clock size={16} color={COLORS.gray400} />
                  <Text style={styles.recentSearchText}>{query}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Profile results (search results or category) */}
        {showProfiles && !loading && (
          <View style={styles.profilesSection}>
            {searchQuery.trim() !== '' && (
              <Text style={styles.resultSectionLabel}>
                {'\u6703\u54e1'}
              </Text>
            )}
            {profiles.length === 0 && !loading ? (
              <Text style={styles.emptyText}>
                {'\u627e\u4e0d\u5230\u76f8\u95dc\u6703\u54e1'}
              </Text>
            ) : (
              profiles.map((profile) => (
                <TouchableOpacity
                  key={profile.id}
                  style={styles.profileCard}
                  onPress={() => handleProfilePress(profile)}
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
                        {profile.full_name || profile.username || '\u672a\u547d\u540d'}
                      </Text>
                      {profile.is_verified && (
                        <CheckCircle2
                          size={16}
                          color={COLORS.blue500}
                          fill={COLORS.blue500}
                          strokeWidth={0}
                          style={{ marginLeft: 4 }}
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
              ))
            )}
          </View>
        )}

        {/* Tag results (search results or category) */}
        {showTags && !loading && !initialLoading && (
          <View>
            {searchQuery.trim() !== '' && tags.length > 0 && (
              <Text style={styles.resultSectionLabel}>
                {'\u6a19\u7c64'}
              </Text>
            )}
            {tags.length === 0 && searchQuery.trim() !== '' ? (
              <Text style={styles.emptyText}>
                {'\u627e\u4e0d\u5230\u76f8\u95dc\u6a19\u7c64'}
              </Text>
            ) : (
              <View style={styles.tagsGrid}>
                {tags.map((tag, index) => {
                  const isHighlighted = index === 4;
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[
                        styles.tagCard,
                        isHighlighted && styles.tagCardHighlighted,
                      ]}
                      activeOpacity={0.7}
                      onPress={() => handleTagPress(tag)}
                    >
                      <Text
                        style={[
                          styles.tagName,
                          isHighlighted && styles.tagNameHighlighted,
                        ]}
                        numberOfLines={1}
                      >
                        #{tag.name}
                      </Text>
                      <Text
                        style={[
                          styles.tagCount,
                          isHighlighted && styles.tagCountHighlighted,
                        ]}
                      >
                        {tag.usage_count}{'\u4f4d\u64c1\u6709'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    gap: 12,
  },
  tagCard: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  tagCardHighlighted: {
    backgroundColor: COLORS.piktag500,
    borderColor: COLORS.piktag500,
  },
  tagName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 24,
    marginBottom: 4,
  },
  tagNameHighlighted: {
    color: COLORS.gray900,
  },
  tagCount: {
    fontSize: 12,
    color: COLORS.gray500,
    lineHeight: 16,
  },
  tagCountHighlighted: {
    color: COLORS.gray800,
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
});
