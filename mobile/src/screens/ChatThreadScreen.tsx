import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import Composer from '../components/chat/Composer';
import MessageBubble from '../components/chat/MessageBubble';
import InitialsAvatar from '../components/InitialsAvatar';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { useChatThread } from '../hooks/useChatThread';
import { supabase } from '../lib/supabase';
import type { ThreadMessage } from '../types/chat';

// Local param shape: keeps this screen decoupled from the global RootStack
// until the app wires chat routes up.
type ChatThreadParamList = {
  ChatThread: {
    conversationId: string;
    otherUserId: string;
    otherDisplayName: string;
    otherAvatarUrl?: string | null;
  };
  UserDetail: { userId: string };
};

type Props = {
  navigation: NativeStackNavigationProp<ChatThreadParamList, 'ChatThread'>;
  route: RouteProp<ChatThreadParamList, 'ChatThread'>;
};

type OtherProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

// The list is inverted (newest at visual bottom). After mapping, item[0]
// is the newest and item[n-1] is the oldest. A "day separator" appears
// ABOVE (chronologically before) the first message of a new day, which
// in the inverted array means when the next item (one step toward the
// oldest) is on a different local day, or is absent (end of list).
function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDaySeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameLocalDay(d, now)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString();
}

export default function ChatThreadScreen({ navigation, route }: Props): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    conversationId,
    otherUserId,
    otherDisplayName: initialDisplayName,
    otherAvatarUrl: initialAvatarUrl,
  } = route.params;

  const {
    messages,
    loading,
    loadingMore,
    loadMore,
    sendMessage,
    retry,
    markRead,
    error,
  } = useChatThread(conversationId);

  const [otherProfile, setOtherProfile] = useState<OtherProfile | null>(null);

  // Track the last messages.length we called markRead for so we don't
  // spam the RPC on every re-render that doesn't actually add a row.
  const lastMarkedLenRef = useRef<number>(-1);

  // Fetch the freshest profile info once so the header isn't stuck with
  // stale route params (e.g. if the other user renamed themselves).
  useEffect(() => {
    let cancelled = false;
    if (!otherUserId) return;
    (async () => {
      try {
        const { data, error: selErr } = await supabase
          .from('piktag_profiles')
          .select('id, username, full_name, avatar_url')
          .eq('id', otherUserId)
          .single();
        if (cancelled) return;
        if (!selErr && data) {
          setOtherProfile(data as OtherProfile);
        }
      } catch {
        // Non-fatal — header falls back to the route params below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otherUserId]);

  // Mark the conversation read on mount and whenever a new message is
  // appended to the thread (messages.length grew).
  useEffect(() => {
    if (loading) return;
    if (messages.length === lastMarkedLenRef.current) return;
    lastMarkedLenRef.current = messages.length;
    void markRead();
  }, [messages.length, loading, markRead]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleHeaderPress = useCallback(() => {
    navigation.navigate('UserDetail', { userId: otherUserId });
  }, [navigation, otherUserId]);

  const displayName = useMemo(() => {
    if (otherProfile?.full_name) return otherProfile.full_name;
    if (otherProfile?.username) return `@${otherProfile.username}`;
    if (initialDisplayName) return initialDisplayName;
    return '';
  }, [otherProfile, initialDisplayName]);

  const avatarName = useMemo(
    () => displayName || otherUserId,
    [displayName, otherUserId],
  );

  const avatarUrl = otherProfile?.avatar_url ?? initialAvatarUrl ?? null;

  // Bubble-grouping: in the inverted array, item at index i is visually
  // ABOVE item at index i-1 (which is newer) and visually BELOW item at
  // index i+1 (which is older). The avatar should sit on the FIRST
  // bubble of a sender's group — chronologically the oldest bubble in a
  // run. In inverted display that means: show the avatar when the NEXT
  // item (i+1, older) is absent or has a different sender.
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ThreadMessage>) => {
      if (!user) return null;
      const isMine = item.sender_id === user.id;

      const olderNeighbor = messages[index + 1];
      const showAvatar =
        !isMine && (!olderNeighbor || olderNeighbor.sender_id !== item.sender_id);

      // Day separator: appears chronologically BEFORE the first message
      // of a new day. In inverted array, that's when the older neighbor
      // doesn't exist (this is the oldest loaded message) or is on a
      // different day.
      const currDate = new Date(item.created_at);
      const showDaySeparator =
        !olderNeighbor ||
        !sameLocalDay(currDate, new Date(olderNeighbor.created_at));

      const bubble = (
        <MessageBubble
          message={item}
          isMine={isMine}
          showAvatar={showAvatar}
          avatarName={avatarName}
          avatarUrl={avatarUrl}
          onRetry={
            isMine && item.status === 'failed' && item.client_nonce
              ? () => void retry(item.client_nonce as string)
              : undefined
          }
        />
      );

      if (!showDaySeparator) return bubble;

      // In an inverted list, the day separator needs to visually appear
      // ABOVE the group of messages for that day. Rendering order is
      // bottom-up in inverted mode, so we render the bubble FIRST (it
      // ends up visually below) and the separator AFTER (visually above).
      return (
        <View>
          {bubble}
          <View style={styles.daySeparator}>
            <Text style={styles.daySeparatorText}>
              {formatDaySeparator(item.created_at)}
            </Text>
          </View>
        </View>
      );
    },
    [messages, user, avatarName, avatarUrl, retry],
  );

  const keyExtractor = useCallback((item: ThreadMessage) => {
    // Optimistic rows start with id "optimistic-<nonce>". Once the
    // realtime echo arrives the row is swapped in-place so the id
    // becomes the server uuid — FlatList sees an identity change and
    // remounts the bubble, which is fine.
    return item.id;
  }, []);

  const handleEndReached = useCallback(() => {
    if (loading || loadingMore) return;
    void loadMore();
  }, [loading, loadingMore, loadMore]);

  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      await sendMessage(text);
    },
    [sendMessage],
  );

  // A conversation is "blocked" if the error string from the hook hints
  // at a block. This is a heuristic — RLS surfaces this via policy name,
  // so we do substring matching rather than structured errors.
  const isBlocked = useMemo(() => {
    if (!error) return false;
    return /block/i.test(error);
  }, [error]);

  const listHeader = useMemo(() => {
    // FlatList's "header" renders at the BOTTOM of an inverted list,
    // which is where a sending spinner would normally live.
    return null;
  }, []);

  const listFooter = useMemo(() => {
    // FlatList's "footer" renders at the TOP of an inverted list, i.e.
    // visually ABOVE the oldest message — this is where the "loading
    // older messages" spinner belongs.
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMoreWrap}>
        <ActivityIndicator size="small" color={COLORS.gray400} />
      </View>
    );
  }, [loadingMore]);

  const emptyState = useMemo(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>{t('chat.emptyInbox')}</Text>
      </View>
    ),
    [t],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>

        <Pressable style={styles.headerCenter} onPress={handleHeaderPress}>
          <InitialsAvatar name={avatarName} size={32} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </Pressable>

        {/* Placeholder right-side slot so the title stays centered. */}
        <View style={styles.headerIconBtn} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <FlatList
          style={styles.flex}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          inverted={messages.length > 0}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={loading ? null : emptyState}
          contentContainerStyle={
            messages.length === 0 ? styles.listContentEmpty : styles.listContent
          }
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={10}
          removeClippedSubviews
        />

        <Composer
          onSend={handleSend}
          disabled={isBlocked}
          disabledReason={isBlocked ? t('chat.userBlocked') : undefined}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerIconBtn: {
    padding: 8,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    flexShrink: 1,
  },
  listContent: {
    paddingVertical: 12,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
  },
  loadingMoreWrap: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  daySeparator: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  daySeparatorText: {
    fontSize: 12,
    color: COLORS.gray400,
    fontWeight: '500',
  },
});
