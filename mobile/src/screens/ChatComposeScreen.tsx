import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList, Pressable, StatusBar, StyleSheet,
  Text, TextInput, TouchableOpacity, View, type ListRenderItemInfo,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import InitialsAvatar from '../components/InitialsAvatar';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { checkOffline } from '../lib/netStatus';
import { useLoadDeadline } from '../hooks/useLoadDeadline';
import { CACHE_KEYS, getPersistentCache } from '../lib/dataCache';

// The two fields of a cached inbox row the offline path needs. Narrow
// and structural on purpose — mirrors FriendDetailScreen /
// UserDetailScreen, and cannot break when the chat types move.
type CachedInboxRow = {
  id?: string;
  other_user_id?: string;
  other_username?: string | null;
  other_full_name?: string | null;
  other_avatar_url?: string | null;
};

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

export default function ChatComposeScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const prefilledUserId = route.params?.prefilledUserId ?? null;

  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  // Did the last search actually reach the server? supabase-js resolves
  // a transport failure as `{data: null, error}` rather than throwing,
  // so an empty `results` array says nothing on its own — and this
  // screen's empty state is a bare 「—」, which reads as "no such person"
  // when the truth is "we never asked".
  const [searchUnreachable, setSearchUnreachable] = useState<boolean>(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const showMessage = useCallback((text: string): void => {
    setToast(text);
    setTimeout(() => { if (isMountedRef.current) setToast(null); }, 2500);
  }, []);

  const showToast = useCallback((kind: ToastKind): void => {
    showMessage(t(`chat.${kind}`));
  }, [showMessage, t]);

  const openConversation = useCallback(async (other: ProfileRow): Promise<void> => {
    if (creating) return;
    setCreating(true);
    const openThread = (conversationId: string): void => {
      navigation.replace('ChatThread', {
        conversationId,
        otherUserId: other.id,
        otherDisplayName: other.full_name || other.username || '',
        otherAvatarUrl: other.avatar_url,
      });
    };
    try {
      // ── Offline: resolve the conversation from the inbox snapshot ──
      // Untouched by the offline pass until now. With no signal this RPC
      // sat through supabase-js's ~25s auth-refresh backoff behind a
      // FULL-SCREEN `pointerEvents:'none'` overlay — the user could not
      // even back out — and then failed into a `console.warn` the user
      // never sees, leaving them staring at a screen that had simply
      // stopped responding.
      //
      // Same shape as the fix on FriendDetailScreen / UserDetailScreen:
      // CACHE_KEYS.CHAT_INBOX already holds the conversation id keyed by
      // `other_user_id`, so anyone the user has talked to from this
      // device opens straight into their (cached) thread. Read-only —
      // nothing here writes a cache.
      if (await checkOffline()) {
        const cachedInbox = user
          ? await getPersistentCache<CachedInboxRow[]>(CACHE_KEYS.CHAT_INBOX, user.id)
          : null;
        const row = Array.isArray(cachedInbox)
          ? cachedInbox.find((c) => c?.other_user_id === other.id)
          : null;
        if (row?.id) {
          openThread(String(row.id));
          return;
        }
        // A brand-new conversation can only be minted by the server.
        showMessage(t('app.offline'));
        return;
      }

      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        other_user_id: other.id,
      });
      if (error) {
        const kind = errorKind(error);
        if (kind) showToast(kind);
        else {
          console.warn('get_or_create_conversation failed:', error.message);
          // Was a silent console.warn: the row just did nothing when
          // tapped. Tell the user, in their language.
          showMessage(t('common.checkConnection'));
        }
        return;
      }
      const conversationId = extractConversationId(data);
      if (!conversationId) {
        console.warn('get_or_create_conversation returned no id');
        showMessage(t('common.loadFailed'));
        return;
      }
      openThread(conversationId);
    } catch (e) {
      const kind = errorKind(e);
      if (kind) showToast(kind);
      else {
        console.warn('Unexpected error starting conversation:', e);
        showMessage(t('common.checkConnection'));
      }
    } finally {
      if (isMountedRef.current) setCreating(false);
    }
  }, [creating, navigation, showToast, showMessage, t, user]);

  // If opened with a prefilled user id, resolve the profile and jump
  // directly into the thread — no search step.
  useEffect(() => {
    if (!prefilledUserId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        // Offline the profile lookup is unreachable, and hanging on it
        // left this screen blank and unexplained for the whole ~25s
        // backoff — the user tapped 傳訊息 somewhere and arrived at
        // nothing. The cached inbox carries both the conversation id and
        // enough of the person to title the thread, so anyone already
        // talked to from this device still gets straight in.
        if (await checkOffline()) {
          const cachedInbox = await getPersistentCache<CachedInboxRow[]>(
            CACHE_KEYS.CHAT_INBOX,
            user.id,
          );
          if (cancelled || !isMountedRef.current) return;
          const row = Array.isArray(cachedInbox)
            ? cachedInbox.find((c) => c?.other_user_id === prefilledUserId)
            : null;
          if (row?.id) {
            navigation.replace('ChatThread', {
              conversationId: String(row.id),
              otherUserId: prefilledUserId,
              otherDisplayName: row.other_full_name || row.other_username || '',
              otherAvatarUrl: row.other_avatar_url ?? null,
            });
            return;
          }
          showMessage(t('app.offline'));
          return;
        }
        const { data, error } = await supabase
          .from('piktag_profiles')
          .select('id, username, full_name, avatar_url')
          .eq('id', prefilledUserId)
          .single();
        if (cancelled || !isMountedRef.current) return;
        if (error || !data) {
          // Was a silent return: the screen just stayed empty. The user
          // asked to message someone, so say why it did not happen.
          showMessage(t('common.checkConnection'));
          return;
        }
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
      setSearchUnreachable(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setSearching(true);
    setSearchUnreachable(false);
    // FAIL FAST WHEN THERE IS NO NETWORK. Profile search is one of the
    // things that genuinely cannot work offline, and without this guard
    // the spinner ran through the ~25s auth-refresh backoff (see
    // lib/netStatus.ts) before landing on the same empty list — which
    // renders a bare 「—」, i.e. "no such person". Say the true thing in
    // a second instead.
    if (await checkOffline()) {
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      setResults([]);
      setSearchUnreachable(true);
      setSearching(false);
      return;
    }
    try {
      const pattern = `%${q.replace(/[%_]/g, '')}%`;
      const { data, error } = await supabase
        .from('piktag_profiles')
        .select('id, username, full_name, avatar_url, is_public')
        .or(`username.ilike.${pattern},full_name.ilike.${pattern}`)
        // .neq('is_public', false) excluded NULL-is_public profiles
        // (PostgREST: NULL != false → NULL → filtered out), so older
        // accounts that never set the flag were unmessageable. Treat
        // null as public (the app default everywhere else).
        .neq('id', user.id)
        .or('is_public.is.null,is_public.eq.true')
        .limit(20);
      if (!isMountedRef.current || reqId !== requestIdRef.current) return;
      if (error) {
        console.warn('Compose search failed:', error.message);
        setResults([]);
        // The query resolved with an error rather than throwing (the
        // normal supabase-js shape for a transport failure), so the
        // `catch` below never runs. Without this the empty list said
        // "no such person" about a search that never happened.
        setSearchUnreachable(true);
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
      setSearchUnreachable(true);
    } finally {
      if (isMountedRef.current && reqId === requestIdRef.current) {
        setSearching(false);
      }
    }
  // user?.id, not `user`: AuthContext hands out a NEW user object on
  // every token refresh (hourly, and on every foreground). This only
  // needs the identity, and depending on the object re-ran the whole
  // query on every refresh — wasted bandwidth on exactly the weak venue
  // networks this app exists for.
  }, [user?.id]);

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

  // ── Paint deadlines ────────────────────────────────────────────────
  // checkOffline() above handles airplane mode; these cover the case it
  // cannot see — NetInfo reports a connection but the request is doomed
  // anyway (captive portal, venue wifi that associates and routes
  // nowhere). Neither cancels its request; a late answer still paints.
  useLoadDeadline(searching, () => {
    setSearching(false);
    setSearchUnreachable(true);
  });
  // This one matters most: `creating` renders a full-screen overlay with
  // `pointerEvents:'none'`, so a request that never returns locked the
  // user out of their own screen for the whole ~25s backoff.
  useLoadDeadline(creating, () => {
    setCreating(false);
    showMessage(t('common.checkConnection'));
  });

  const listEmpty = useMemo(() => {
    if (searching) return null;
    if (query.trim().length < MIN_QUERY_LEN) return null;
    // We could not ask — never let the bare 「—」 stand in for "no such
    // person" when no search actually reached the server.
    if (searchUnreachable) {
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t('common.loadFailed')}</Text>
          <Text style={styles.emptyHint}>{t('common.checkConnection')}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>—</Text>
      </View>
    );
  }, [searching, searchUnreachable, query, styles, t]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack} activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button" accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color={colors.gray900} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('chat.compose')}</Text>
        </View>
        <View style={styles.headerIconBtn} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={colors.gray400} />
          <TextInput
            style={styles.searchInput} value={query} onChangeText={handleQueryChange}
            placeholder={t('chat.composePlaceholder')} placeholderTextColor={colors.gray400}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          />
          {searching ? <BrandSpinner size={20} /> : null}
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
          <PageLoader />
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.gray100,
  },
  headerIconBtn: {
    padding: 8, width: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: c.gray900 },
  searchRow: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: c.gray100,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: c.gray100, borderRadius: 20,
  },
  searchInput: {
    flex: 1, fontSize: 15, color: c.gray900, paddingVertical: 0,
  },
  listContent: { paddingVertical: 4 },
  listContentEmpty: { flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.gray100,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: '600', color: c.gray900 },
  rowUsername: { fontSize: 13, color: c.gray500, marginTop: 2 },
  emptyWrap: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, color: c.gray400, textAlign: 'center' },
  emptyHint: {
    fontSize: 13, color: c.gray400,
    textAlign: 'center', marginTop: 6,
  },
  creatingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  toast: {
    position: 'absolute', left: 16, right: 16, bottom: 32,
    backgroundColor: c.gray900, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  toastText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center' },
  });
}
