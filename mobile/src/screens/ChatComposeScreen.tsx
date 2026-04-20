import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View, type ListRenderItemInfo,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import InitialsAvatar from '../components/InitialsAvatar';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

type ChatComposeParamList = {
  ChatCompose: { prefilledUserId?: string } | undefined;
  ChatThread: {
    conversationId: string;
    otherUserId: string;
    otherDisplayName: string;
    otherAvatarUrl?: string | null;
  };
};

type Props = {
  navigation: NativeStackNavigationProp<ChatComposeParamList, 'ChatCompose'>;
  route: RouteProp<ChatComposeParamList, 'ChatCompose'>;
};

type ProfileRow = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type ToastKind = 'cannotMessageSelf' | 'userBlocked';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

function errorKind(err: unknown): ToastKind | null {
  if (!err) return null;
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_participants/i.test(msg)) return 'cannotMessageSelf';
  if (/block/i.test(msg)) return 'userBlocked';
  return null;
}

// The RPC returns a single uuid; PostgREST may surface it as a plain
// string, a single-element array, or a row object. Normalize all three.
function extractConversationId(data: unknown): string | null {
  if (typeof data === 'string') return data;
  const pickId = (x: unknown): string | null => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') {
      return ((x as Record<string, unknown>).id as string | undefined) ?? null;
    }
    return null;
  };
  if (Array.isArray(data)) return data.length > 0 ? pickId(data[0]) : null;
  return pickId(data);
}

type SearchRowProps = {
  item: ProfileRow;
  onPress: (item: ProfileRow) => void;
};

const SearchRow = React.memo(function SearchRow({ item, onPress }: SearchRowProps) {
  const displayName = item.full_name || item.username || '';
  const handlePress = useCallback(() => onPress(item), [onPress, item]);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={handlePress} style={styles.row}>
      {item.avatar_url
        ? <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
        : <InitialsAvatar name={displayName || item.id} size={44} />}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>{displayName || '—'}</Text>
        {item.username
          ? <Text style={styles.rowUsername} numberOfLines={1}>@{item.username}</Text>
          : null}
      </View>
    </TouchableOpacity>
  );
});

export default function ChatComposeScreen({ navigation, route }: Props): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const prefilledUserId = route.params?.prefilledUserId ?? null;

  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const showToast = useCallback((kind: ToastKind): void => {
    setToast(t(`chat.${kind}`));
    setTimeout(() => { if (isMountedRef.current) setToast(null); }, 2500);
  }, [t]);

  const openConversation = useCallback(async (other: ProfileRow): Promise<void> => {
    if (creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        other_user_id: other.id,
      });
      if (error) {
        const kind = errorKind(error);
        if (kind) showToast(kind);
        else console.warn('get_or_create_conversation failed:', error.message);
        return;
      }
      const conversationId = extractConversationId(data);
      if (!conversationId) {
        console.warn('get_or_create_conversation returned no id');
        return;
      }
      navigation.replace('ChatThread', {
        conversationId,
        otherUserId: other.id,
        otherDisplayName: other.full_name || other.username || '',
        otherAvatarUrl: other.avatar_url,
      });
    } catch (e) {
      const kind = errorKind(e);
      if (kind) showToast(kind);
      else console.warn('Unexpected error starting conversation:', e);
    } finally {
      if (isMountedRef.current) setCreating(false);
    }
  }, [creating, navigation, showToast]);

  // If opened with a prefilled user id, resolve the profile and jump
  // directly into the thread — no search step.
  useEffect(() => {
    if (!prefilledUserId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('piktag_profiles')
          .select('id, username, full_name, avatar_url')
          .eq('id', prefilledUserId)
          .single();
        if (cancelled || error || !data) return;
        await openConversation(data as ProfileRow);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledUserId, user]);

  const runSearch = useCallback(async (raw: string): Promise<void> => {
    const q = raw.trim();
    if (q.length < MIN_QUERY_LEN || !user) {
      setResults([]);
      setSearching(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setSearching(true);
    try {
      const pattern = `%${q.replace(/[%_]/g, '')}%`;
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_public')
        .or(`username.ilike.${pattern},full_name.ilike.${pattern}`)
        .neq('id', user.id).neq('is_public', false).limit(20);
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      if (error) {
        console.warn('Compose search failed:', error.message);
        setResults([]);
        return;
      }
      const rows: ProfileRow[] = Array.isArray(data)
        ? (data as ProfileRow[]).map((r) => ({
            id: r.id, username: r.username,
            full_name: r.full_name, avatar_url: r.avatar_url,
          }))
        : [];
      setResults(rows);
    } catch (e) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      console.warn('Compose search threw:', e);
      setResults([]);
    } finally {
      if (isMountedRef.current && reqId === requestIdRef.current) {
        setSearching(false);
      }
    }
  }, [user]);

  const handleQueryChange = useCallback((text: string): void => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void runSearch(text); }, DEBOUNCE_MS);
  }, [runSearch]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ProfileRow>) => (
      <SearchRow item={item} onPress={openConversation} />
    ), [openConversation]);

  const keyExtractor = useCallback((item: ProfileRow) => item.id, []);

  const listEmpty = useMemo(() => {
    if (searching) return null;
    if (query.trim().length < MIN_QUERY_LEN) return null;
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>—</Text>
      </View>
    );
  }, [searching, query]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack} activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button" accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('chat.compose')}</Text>
        </View>
        <View style={styles.headerIconBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={COLORS.gray400} />
          <TextInput
            style={styles.searchInput} value={query} onChangeText={handleQueryChange}
            placeholder={t('chat.composePlaceholder')} placeholderTextColor={COLORS.gray400}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          />
          {searching ? <ActivityIndicator size="small" color={COLORS.gray400} /> : null}
        </View>
      </View>

      <FlatList
        data={results} renderItem={renderItem} keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled" ListEmptyComponent={listEmpty}
        contentContainerStyle={
          results.length === 0 ? styles.listContentEmpty : styles.listContent
        }
        initialNumToRender={15} maxToRenderPerBatch={15}
        windowSize={7} removeClippedSubviews
      />

      {creating ? (
        <View style={styles.creatingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : null}

      {toast ? (
        <Pressable style={styles.toast} onPress={() => setToast(null)}>
          <Text style={styles.toastText}>{toast}</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.gray100,
  },
  headerIconBtn: {
    padding: 8, width: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray900 },
  searchRow: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.gray100,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: COLORS.gray100, borderRadius: 20,
  },
  searchInput: {
    flex: 1, fontSize: 15, color: COLORS.gray900, paddingVertical: 0,
  },
  listContent: { paddingVertical: 4 },
  listContentEmpty: { flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.gray100,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: '600', color: COLORS.gray900 },
  rowUsername: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },
  emptyWrap: { alignItems: 'center', paddingTop: 48 },
  emptyText: { fontSize: 15, color: COLORS.gray400 },
  creatingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  toast: {
    position: 'absolute', left: 16, right: 16, bottom: 32,
    backgroundColor: COLORS.gray900, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  toastText: { color: COLORS.white, fontSize: 14, textAlign: 'center' },
});
