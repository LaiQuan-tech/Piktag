import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search, X, PenSquare } from 'lucide-react-native';
import { COLORS, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import InitialsAvatar from '../components/InitialsAvatar';
import type { PiktagProfile } from '../types';

type ChatInboxScreenProps = {
  navigation: any;
};

type ChatTab = 'primary' | 'requests' | 'general';
const TAB_KEYS: ChatTab[] = ['primary', 'requests', 'general'];

type SearchResult = PiktagProfile & { isFriend?: boolean };

export default function ChatInboxScreen({ navigation }: ChatInboxScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<ChatTab>('primary');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim() || !user) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    try {
      const q = query.trim().toLowerCase();

      // Fetch friends and matching profiles in parallel
      const [friendsResult, profilesResult] = await Promise.all([
        supabase
          .from('piktag_connections')
          .select('connected_user_id')
          .eq('user_id', user.id),
        supabase
          .from('piktag_profiles')
          .select('id, username, full_name, avatar_url, is_verified')
          .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
          .neq('id', user.id)
          .limit(30),
      ]);

      const friendIds = new Set(
        (friendsResult.data || []).map((c: any) => c.connected_user_id)
      );

      const results: SearchResult[] = (profilesResult.data || []).map(
        (p: any) => ({ ...p, isFriend: friendIds.has(p.id) })
      );

      // Sort: friends first, then alphabetical
      results.sort((a, b) => {
        if (a.isFriend && !b.isFriend) return -1;
        if (!a.isFriend && b.isFriend) return 1;
        return (a.full_name || a.username || '').localeCompare(
          b.full_name || b.username || ''
        );
      });

      setSearchResults(results);
    } catch (err) {
      console.warn('Chat search error:', err);
    } finally {
      setSearchLoading(false);
    }
  }, [user]);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      setSearchLoading(true);
      debounceRef.current = setTimeout(() => performSearch(text), 300);
    },
    [performSearch]
  );

  const handleUserPress = useCallback(
    (profile: PiktagProfile) => {
      // TODO: navigate to ChatConversation when messaging is implemented
      navigation.navigate('UserDetail', { userId: profile.id });
    },
    [navigation]
  );

  const enterSearch = useCallback(() => {
    setIsSearching(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const exitSearch = useCallback(() => {
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    inputRef.current?.blur();
  }, []);

  // ── Render helpers ──

  const renderSearchResult = useCallback(
    ({ item }: { item: SearchResult }) => {
      const name = item.full_name || item.username || t('common.unnamed');
      return (
        <TouchableOpacity
          style={styles.resultRow}
          onPress={() => handleUserPress(item)}
          activeOpacity={0.6}
        >
          {item.avatar_url ? (
            <Image
              source={{ uri: item.avatar_url }}
              style={styles.resultAvatar}
              cachePolicy="memory-disk"
            />
          ) : (
            <InitialsAvatar name={name} size={48} />
          )}
          <View style={styles.resultInfo}>
            <Text style={[styles.resultName, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            {item.username && (
              <Text style={styles.resultUsername} numberOfLines={1}>
                @{item.username}
              </Text>
            )}
          </View>
          {item.isFriend && (
            <View style={styles.friendBadge}>
              <Text style={styles.friendBadgeText}>{t('tagDetail.tabConnections')}</Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [handleUserPress, colors.text, t]
  );

  const tabLabels: Record<ChatTab, string> = useMemo(
    () => ({
      primary: t('chat.tabs.primary'),
      requests: t('chat.tabs.requests'),
      general: t('chat.tabs.general'),
    }),
    [t]
  );

  // ── Main render ──

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={topEdges}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: isDark ? '#262626' : COLORS.gray100 }]}>
        {isSearching ? (
          <View style={styles.searchBarRow}>
            <TouchableOpacity onPress={exitSearch} hitSlop={hitSlop}>
              <ArrowLeft size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={[styles.searchInput, { backgroundColor: isDark ? '#262626' : COLORS.gray100 }]}>
              <Search size={16} color={COLORS.gray400} />
              <TextInput
                ref={inputRef}
                style={[styles.searchTextInput, { color: colors.text }]}
                value={searchQuery}
                onChangeText={handleSearchChange}
                placeholder={t('chat.composePlaceholder')}
                placeholderTextColor={COLORS.gray400}
                returnKeyType="search"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={hitSlop}>
                  <X size={16} color={COLORS.gray400} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={hitSlop}>
              <ArrowLeft size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{t('chat.inbox')}</Text>
            <TouchableOpacity onPress={enterSearch} hitSlop={hitSlop}>
              <PenSquare size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {isSearching ? (
        // ── Search mode ──
        <View style={styles.flex1}>
          {searchLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={COLORS.piktag500} />
            </View>
          ) : searchQuery.trim() && searchResults.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>{t('search.noProfilesFound')}</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={renderSearchResult}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      ) : (
        // ── Inbox mode ──
        <View style={styles.flex1}>
          {/* Tabs */}
          <View style={[styles.tabRow, { borderBottomColor: isDark ? '#262626' : COLORS.gray200 }]}>
            {TAB_KEYS.map((key) => (
              <TouchableOpacity
                key={key}
                style={[styles.tab, activeTab === key && styles.tabActive]}
                onPress={() => setActiveTab(key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: colors.textSecondary },
                    activeTab === key && styles.tabTextActive,
                  ]}
                >
                  {tabLabels[key]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Inbox search bar (not focused = just a tappable bar) */}
          <TouchableOpacity
            style={[styles.inboxSearchBar, { backgroundColor: isDark ? '#262626' : COLORS.gray100 }]}
            onPress={enterSearch}
            activeOpacity={0.7}
          >
            <Search size={16} color={COLORS.gray400} />
            <Text style={styles.inboxSearchPlaceholder}>{t('chat.composePlaceholder')}</Text>
          </TouchableOpacity>

          {/* Empty state */}
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('chat.emptyInbox')}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const topEdges: ('top')[] = ['top'];
const hitSlop = { top: 12, bottom: 12, left: 12, right: 12 };

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex1: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchTextInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  // Tabs
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.piktag500,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // Inbox search bar
  inboxSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  inboxSearchPlaceholder: {
    fontSize: 15,
    color: COLORS.gray400,
  },
  // Search results
  listContent: {
    paddingVertical: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  resultAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
  },
  resultUsername: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  friendBadge: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  friendBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
