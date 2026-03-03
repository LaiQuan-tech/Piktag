import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Search, MessageCircle } from 'lucide-react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { PiktagProfile, Message } from '../types';

type ChatListScreenProps = {
  navigation: any;
};

type ChatPreview = {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  lastMessageAt: string | null; // raw ISO timestamp for sorting
  time: string;
  unread: boolean;
  unreadCount: number;
};

function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return '剛剛';
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;
  if (diffHours < 24) return `${diffHours} 小時前`;
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;

  const month = (date.getMonth() + 1).toString();
  const day = date.getDate().toString();
  return `${month}/${day}`;
}

export default function ChatListScreen({ navigation }: ChatListScreenProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChats = useCallback(async () => {
    if (!user) return;

    try {
      // 1. Get conversation IDs for the current user
      const { data: participations, error: partError } = await supabase
        .from('piktag_conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (partError || !participations || participations.length === 0) {
        setChats([]);
        setLoading(false);
        return;
      }

      const conversationIds = participations.map((p) => p.conversation_id);

      // 2. For each conversation, get the other participant's profile, last message, and unread count
      const chatPreviews: ChatPreview[] = [];

      for (const convId of conversationIds) {
        // Get the other participant
        const { data: otherParticipants } = await supabase
          .from('piktag_conversation_participants')
          .select('user_id, user:piktag_profiles!user_id(*)')
          .eq('conversation_id', convId)
          .neq('user_id', user.id)
          .limit(1);

        const otherUser = otherParticipants?.[0]?.user as PiktagProfile | undefined;

        // Get the last message
        const { data: lastMessages } = await supabase
          .from('piktag_messages')
          .select('*')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(1);

        const lastMessage = lastMessages?.[0] as Message | undefined;

        // Get unread count (messages not sent by me that are unread)
        const { count: unreadCount } = await supabase
          .from('piktag_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', convId)
          .eq('is_read', false)
          .neq('sender_id', user.id);

        const displayName = otherUser?.full_name || otherUser?.username || '使用者';
        const displayAvatar = otherUser?.avatar_url || 'https://picsum.photos/seed/default/100/100';

        chatPreviews.push({
          id: convId,
          name: displayName,
          avatar: displayAvatar,
          lastMessage: lastMessage?.content || '',
          lastMessageAt: lastMessage?.created_at || null,
          time: lastMessage ? formatRelativeTime(lastMessage.created_at) : '',
          unread: (unreadCount ?? 0) > 0,
          unreadCount: unreadCount ?? 0,
        });
      }

      // Sort by last message time (most recent first) - conversations without messages go last
      chatPreviews.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });

      setChats(chatPreviews);
    } catch (error) {
      console.error('Error fetching chats:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  // Realtime subscription for new/updated messages to refresh the list
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat-list-messages')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'piktag_messages',
        },
        () => {
          // Refresh the chat list when any message changes
          fetchChats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchChats]);

  // Refresh when the screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchChats();
    });
    return unsubscribe;
  }, [navigation, fetchChats]);

  const filteredChats = chats.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    chat.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderChatItem = ({ item }: { item: ChatPreview }) => (
    <TouchableOpacity
      style={styles.chatItem}
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('ChatDetail', {
          conversationId: item.id,
          name: item.name,
          avatar: item.avatar,
        })
      }
    >
      <View style={styles.avatarContainer}>
        <Image source={{ uri: item.avatar }} style={styles.avatar} />
        {item.unread && <View style={styles.unreadDot} />}
      </View>
      <View style={styles.chatContent}>
        <View style={styles.chatTopRow}>
          <Text
            style={[styles.chatName, item.unread && styles.chatNameUnread]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text style={styles.chatTime}>{item.time}</Text>
        </View>
        <Text
          style={[styles.chatLastMessage, item.unread && styles.chatLastMessageUnread]}
          numberOfLines={1}
        >
          {item.lastMessage}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <MessageCircle size={64} color={COLORS.gray200} />
        <Text style={styles.emptyStateText}>還沒有對話</Text>
        <Text style={styles.emptyStateSubtext}>開始和朋友聊天吧</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>聊天</Text>
        <TouchableOpacity style={styles.composeButton} activeOpacity={0.6}>
          <Plus size={24} color={COLORS.piktag500} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchContainer}>
          <Search size={18} color={COLORS.gray400} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜尋對話"
            placeholderTextColor={COLORS.gray400}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Loading State */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        /* Chat List */
        <FlatList
          data={filteredChats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={renderEmptyState}
        />
      )}
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  composeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrapper: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    height: 44,
  },
  searchIcon: {
    marginRight: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.gray900,
    padding: 0,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.gray100,
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.piktag500,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  chatContent: {
    flex: 1,
  },
  chatTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray900,
    flex: 1,
    marginRight: SPACING.sm,
  },
  chatNameUnread: {
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  chatLastMessage: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
  chatLastMessageUnread: {
    color: COLORS.gray700,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.gray500,
    marginTop: SPACING.lg,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.gray400,
    marginTop: SPACING.sm,
  },
});
