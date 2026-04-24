import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, SquarePen } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ChatFriendsRow, { type FriendRowItem } from '../components/chat/ChatFriendsRow';
import ChatSearchBar from '../components/chat/ChatSearchBar';
import ChatTabs from '../components/chat/ChatTabs';
import ConversationActionSheet from '../components/chat/ConversationActionSheet';
import ConversationRow from '../components/chat/ConversationRow';
import EmptyInbox from '../components/chat/EmptyInbox';
import StatusModal from '../components/StatusModal';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { useChatFriendStatuses } from '../hooks/useChatFriendStatuses';
import { useChatInbox } from '../hooks/useChatInbox';
import { supabase } from '../lib/supabase';
import type { InboxConversation, InboxTab } from '../types/chat';

// Each screen declares its own param shape so we don't need to touch
// the global RootStack until the app wires these routes up. Typed as
// the narrowest surface we actually use.
type ChatListParamList = {
  ChatList: undefined;
  ChatThread: {
    conversationId: string;
    otherUserId: string;
    otherDisplayName: string;
    otherAvatarUrl?: string | null;
  };
  ChatCompose: { prefilledUserId?: string } | undefined;
};

type Props = {
  navigation: NativeStackNavigationProp<ChatListParamList, 'ChatList'>;
};

// Keep in sync with ConversationRow's fixed layout — see the getItemLayout
// callback below for the derivation. Defined at module scope so the
// callback closure stays stable across renders.
const CONVERSATION_ROW_HEIGHT = 84;

function bucket(c: InboxConversation, meId: string): InboxTab {
  // Manual override wins over computed default. Set via the ⋯ menu →
  // "Move to …" → set_conversation_folder RPC. When NULL (the common
  // case, no user intervention yet), fall through to the derived rule.
  if (c.folder_override) return c.folder_override;
  if (c.is_connection) return 'primary';
  if (c.initiated_by !== meId && !c.i_have_replied) return 'requests';
  return 'general';
}

type HeaderProfile = {
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

export default function ChatListScreen({ navigation }: Props): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { conversations, loading, refresh } = useChatInbox();

  const [activeTab, setActiveTab] = useState<InboxTab>('primary');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [headerProfile, setHeaderProfile] = useState<HeaderProfile | null>(null);
  // Local-only inbox filter. Intentionally operates on the already-loaded
  // `conversations` array — we never hit the network, so typing stays
  // instant even on large inboxes.
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Controls the IG-style "add your note" modal opened from the first
  // card of the ChatFriendsRow. The modal owns its own save flow and
  // returns the new text via onStatusUpdated.
  const [statusModalVisible, setStatusModalVisible] = useState(false);

  // --- Move conversation between folders (⋯ menu) state ---
  //
  // `moveSheetFor` is the conversation the user just tapped the ⋯ icon
  // on; `null` = sheet closed. We keep a local optimistic map
  // (conv id → folder_override) so a just-moved row appears in the
  // destination tab the moment the sheet closes, even before the RPC
  // round-trips and the realtime UPDATE refires fetch_inbox.
  const [moveSheetFor, setMoveSheetFor] = useState<InboxConversation | null>(
    null,
  );
  const [optimisticFolders, setOptimisticFolders] = useState<
    Record<string, InboxTab | null>
  >({});

  // Pull the viewer's own username for the header. Not in the auth
  // object, so one extra query on mount. Cached implicitly for the
  // life of the screen.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('piktag_profiles')
          .select('username, full_name, avatar_url')
          .eq('id', user.id)
          .single();
        if (cancelled) return;
        if (!error && data) {
          setHeaderProfile({
            username: (data as HeaderProfile).username ?? null,
            full_name: (data as HeaderProfile).full_name ?? null,
            avatar_url: (data as HeaderProfile).avatar_url ?? null,
          });
        }
      } catch {
        // Non-fatal — header falls back to placeholder below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Merge the server-side folder_override with any in-flight
  // optimistic override (a move the user just triggered but the RPC
  // hasn't acked yet). The optimistic map is cleared when fetchInbox
  // returns a fresh payload that already has the new override set, so
  // this merge layer is naturally self-pruning.
  const conversationsWithOverride = useMemo<InboxConversation[]>(() => {
    return conversations.map((c) => {
      const override = optimisticFolders[c.id];
      if (override === undefined) return c;
      return { ...c, folder_override: override };
    });
  }, [conversations, optimisticFolders]);

  // Apply the search filter first so every downstream view (bucket
  // counts, tab lists, empty-state detection) agrees on the same
  // trimmed dataset. Case-insensitive substring match across username,
  // full_name and last message preview — what a user is most likely to
  // remember about a chat.
  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return conversationsWithOverride;
    return conversationsWithOverride.filter((c) => {
      const u = c.other_username?.toLowerCase() ?? '';
      const n = c.other_full_name?.toLowerCase() ?? '';
      const p = c.last_message_preview?.toLowerCase() ?? '';
      return u.includes(q) || n.includes(q) || p.includes(q);
    });
  }, [conversationsWithOverride, searchQuery]);

  const buckets = useMemo(() => {
    const primary: InboxConversation[] = [];
    const requests: InboxConversation[] = [];
    const general: InboxConversation[] = [];
    const meId = user?.id;
    if (!meId) return { primary, requests, general };
    for (const c of filteredConversations) {
      const b = bucket(c, meId);
      if (b === 'primary') primary.push(c);
      else if (b === 'requests') requests.push(c);
      else general.push(c);
    }
    return { primary, requests, general };
  }, [filteredConversations, user?.id]);

  const counts = useMemo(
    () => ({
      primary: buckets.primary.length,
      requests: buckets.requests.length,
      general: buckets.general.length,
    }),
    [buckets],
  );

  const visibleList = useMemo(() => {
    if (activeTab === 'primary') return buckets.primary;
    if (activeTab === 'requests') return buckets.requests;
    return buckets.general;
  }, [activeTab, buckets]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleRowPress = useCallback(
    (c: InboxConversation) => {
      navigation.navigate('ChatThread', {
        conversationId: c.id,
        otherUserId: c.other_user_id,
        otherDisplayName: c.other_full_name ?? c.other_username ?? '',
        otherAvatarUrl: c.other_avatar_url,
      });
    },
    [navigation],
  );

  // Opens the bottom-sheet move menu for this conversation. No side
  // effects beyond UI — the actual move happens when the user picks
  // a destination inside the sheet.
  const handleMorePress = useCallback((c: InboxConversation) => {
    setMoveSheetFor(c);
  }, []);

  // Executes the move: optimistically flips the local folder_override
  // so the row visually jumps to the destination tab immediately, then
  // fires the RPC. On RPC failure we revert the optimistic state and
  // show an alert so the user isn't left staring at a row that "moved"
  // but really didn't.
  const handleMove = useCallback(
    async (target: InboxTab) => {
      const conv = moveSheetFor;
      if (!conv) return;
      setMoveSheetFor(null);

      // 1. Optimistic local update.
      setOptimisticFolders((prev) => ({ ...prev, [conv.id]: target }));

      // 2. Persist to DB.
      const { error } = await supabase.rpc('set_conversation_folder', {
        p_conv_id: conv.id,
        p_folder: target,
      });

      if (error) {
        // 3a. Revert optimistic state on failure so the UI reflects
        //     reality. Realtime will eventually refresh anyway but we
        //     don't want the user to see a false success.
        setOptimisticFolders((prev) => {
          const next = { ...prev };
          delete next[conv.id];
          return next;
        });
        Alert.alert(t('chat.moveFailed'));
      }
      // 3b. On success we intentionally leave the optimistic entry in
      //     place — it'll be superseded (or reconciled identical) the
      //     next time fetchInbox returns a payload where the server
      //     already reports folder_override === target. See the effect
      //     below that prunes matched optimistic entries.
    },
    [moveSheetFor, t],
  );

  // Prune any optimistic folder override whose server-side value now
  // matches. Without this, the local map would grow forever.
  useEffect(() => {
    setOptimisticFolders((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const c of conversations) {
        if (c.id in next && next[c.id] === c.folder_override) {
          delete next[c.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [conversations]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleCompose = useCallback(() => {
    navigation.navigate('ChatCompose');
  }, [navigation]);

  // Empty-state CTA: pop back to the SearchMain (discover) screen so the
  // user can find someone to chat with. We only wire this up when the
  // inbox is empty as a whole (not for empty requests/general/search
  // subsets) — see the `emptyState` useMemo below.
  const handleGoDiscover = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxConversation>) => (
      <ConversationRow
        conversation={item}
        onPress={handleRowPress}
        onMorePress={handleMorePress}
      />
    ),
    [handleRowPress, handleMorePress],
  );

  const keyExtractor = useCallback((item: InboxConversation) => item.id, []);

  // Fixed row height: 10+10 paddingVertical + 56 avatar + 2*2 borderWidth
  // + 2*2 padding on avatarWrap = 84. Hard-coding this lets FlatList
  // skip the onLayout measurement pass for each row, which was the main
  // contributor to the avatar flicker users saw while typing in search.
  const getItemLayout = useCallback(
    (_: ArrayLike<InboxConversation> | null | undefined, index: number) => ({
      length: CONVERSATION_ROW_HEIGHT,
      offset: CONVERSATION_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  const headerTitle = useMemo(() => {
    if (headerProfile?.username) return `@${headerProfile.username}`;
    if (headerProfile?.full_name) return headerProfile.full_name;
    return t('chat.inbox');
  }, [headerProfile, t]);

  // --- IG-style friends row (NOTES) ---
  //
  // Top-of-inbox horizontal row of people you've chatted with, each
  // with their 24h piktag_user_status as a bubble above the avatar.
  // The first card is always "you" — tapping it opens StatusModal so
  // the viewer can post / edit their own note.
  //
  // Source of friends: conversations list (people you've actually
  // chatted with). This keeps the row contextually relevant to the
  // chat screen without adding a follows-join network call.

  // Deduplicate: a user can in theory show up in both requests and
  // general sections, but for the row we want one card per human.
  const friendsRowList = useMemo<FriendRowItem[]>(() => {
    const seen = new Set<string>();
    const out: FriendRowItem[] = [];
    for (const c of conversations) {
      if (seen.has(c.other_user_id)) continue;
      seen.add(c.other_user_id);
      out.push({
        userId: c.other_user_id,
        name: c.other_full_name || c.other_username || '?',
        avatarUrl: c.other_avatar_url ?? null,
        noteText: null, // filled in by useChatFriendStatuses below
      });
      // Cap at 20 — past that scrolling gets unwieldy and the point of
      // the row (quick access to frequent people) stops holding.
      if (out.length >= 20) break;
    }
    return out;
  }, [conversations]);

  const friendUserIds = useMemo(
    () => friendsRowList.map((f) => f.userId),
    [friendsRowList],
  );

  const { myNote, otherNotes } = useChatFriendStatuses(
    user?.id ?? null,
    friendUserIds,
  );

  // Merge the fetched notes into the friend row items. Kept separate
  // from friendsRowList so the row doesn't re-flow every time
  // otherNotes updates — only the bubble text changes, not item order.
  const friendsWithNotes = useMemo<FriendRowItem[]>(
    () =>
      friendsRowList.map((f) => ({
        ...f,
        noteText: otherNotes.get(f.userId) ?? null,
      })),
    [friendsRowList, otherNotes],
  );

  const handlePressMyNote = useCallback(() => {
    setStatusModalVisible(true);
  }, []);

  const handlePressFriendNote = useCallback(
    async (userId: string) => {
      // Reuse the existing chat-open flow: resolve or create a 1:1
      // conversation with this user, then navigate into the thread.
      // Matches what happens when you tap a ConversationRow below.
      const conv = conversations.find((c) => c.other_user_id === userId);
      if (conv) {
        navigation.navigate('ChatThread', {
          conversationId: conv.id,
          otherUserId: conv.other_user_id,
          otherDisplayName: conv.other_full_name ?? conv.other_username ?? '',
          otherAvatarUrl: conv.other_avatar_url,
        });
      }
    },
    [conversations, navigation],
  );

  // Local "my note" override so the bubble updates instantly when the
  // viewer saves from StatusModal, instead of waiting for the hook to
  // re-query. Null means "fall back to whatever the hook says."
  const [localMyNote, setLocalMyNote] = useState<string | null | undefined>(
    undefined,
  );
  const displayedMyNote = localMyNote === undefined ? myNote : localMyNote;

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={COLORS.piktag500}
      />
    ),
    [refreshing, handleRefresh],
  );

  // Decide which empty-state copy + CTA to show based on whether this
  // is a search miss, an empty non-primary bucket (no CTA — user can't
  // conjure message requests), or a brand-new empty inbox (CTA to go
  // find people).
  const emptyState = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length > 0) {
      return (
        <EmptyInbox
          heading={t('chat.emptySearchHeading', { query: trimmedQuery })}
          showCta={false}
        />
      );
    }
    if (activeTab === 'requests') {
      return (
        <EmptyInbox heading={t('chat.emptyRequestsHeading')} showCta={false} />
      );
    }
    if (activeTab === 'general') {
      return (
        <EmptyInbox heading={t('chat.emptyGeneralHeading')} showCta={false} />
      );
    }
    return <EmptyInbox showCta onCtaPress={handleGoDiscover} />;
  }, [activeTab, handleGoDiscover, searchQuery, t]);

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

        <Pressable style={styles.headerTitleWrap} onPress={handleBack}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
        </Pressable>

        <TouchableOpacity
          onPress={handleCompose}
          activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('chat.compose')}
        >
          <SquarePen size={22} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ChatSearchBar value={searchQuery} onChangeText={setSearchQuery} />

      <ChatFriendsRow
        myName={headerProfile?.full_name || headerProfile?.username || '?'}
        myAvatarUrl={headerProfile?.avatar_url ?? null}
        myNoteText={displayedMyNote ?? null}
        onPressMyNote={handlePressMyNote}
        friends={friendsWithNotes}
        onPressFriend={handlePressFriendNote}
      />

      <ChatTabs active={activeTab} onChange={setActiveTab} counts={counts} />

      <FlatList
        data={visibleList}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        refreshControl={refreshControl}
        contentContainerStyle={
          visibleList.length === 0 ? styles.listContentEmpty : styles.listContent
        }
        ListEmptyComponent={!loading ? emptyState : null}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
      />

      <StatusModal
        visible={statusModalVisible}
        initialText={displayedMyNote ?? null}
        onClose={() => setStatusModalVisible(false)}
        // Echo the saved text into local state so the bubble on the
        // viewer's own card updates immediately — useChatFriendStatuses
        // will re-fetch in the background but the user expects instant
        // feedback after tapping Save.
        onStatusUpdated={(text) => setLocalMyNote(text)}
      />

      {/* Bottom-sheet menu opened by tapping the ⋯ icon on a
          conversation row. Options shown depend on which bucket the
          conversation is currently in — see ConversationActionSheet
          for the rule table. */}
      {moveSheetFor ? (
        <ConversationActionSheet
          visible={true}
          currentBucket={
            user?.id ? bucket(moveSheetFor, user.id) : 'general'
          }
          onMove={handleMove}
          onClose={() => setMoveSheetFor(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
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
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  listContent: {
    paddingBottom: 40,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});
