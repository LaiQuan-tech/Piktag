import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Send } from 'lucide-react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Message } from '../types';

type ChatDetailScreenProps = {
  navigation?: any;
  route?: any;
};

type ChatMessage = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  isMe: boolean;
};

function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export default function ChatDetailScreen({ navigation, route }: ChatDetailScreenProps) {
  const { conversationId, name, avatar } = route?.params ?? {
    conversationId: '',
    name: '使用者',
    avatar: 'https://picsum.photos/seed/user/100/100',
  };
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Convert a DB message row to our ChatMessage type
  const toDisplayMessage = useCallback(
    (msg: Message): ChatMessage => ({
      id: msg.id,
      content: msg.content,
      sender_id: msg.sender_id,
      created_at: msg.created_at,
      isMe: msg.sender_id === user?.id,
    }),
    [user]
  );

  // Fetch messages for this conversation
  const fetchMessages = useCallback(async () => {
    if (!conversationId || !user) return;

    try {
      const { data, error } = await supabase
        .from('piktag_messages')
        .select('*, sender:piktag_profiles!sender_id(*)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        return;
      }

      if (data) {
        setMessages(data.map((msg: Message) => toDisplayMessage(msg)));
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  }, [conversationId, user, toDisplayMessage]);

  // Mark unread messages as read
  const markMessagesAsRead = useCallback(async () => {
    if (!conversationId || !user) return;

    try {
      await supabase
        .from('piktag_messages')
        .update({ is_read: true })
        .eq('conversation_id', conversationId)
        .neq('sender_id', user.id)
        .eq('is_read', false);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }, [conversationId, user]);

  // Load messages on mount
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Mark messages as read when entering the screen
  useEffect(() => {
    markMessagesAsRead();
  }, [markMessagesAsRead]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!conversationId || !user) return;

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'piktag_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          const displayMsg = toDisplayMessage(newMsg);

          setMessages((prev) => {
            // Avoid duplicates (in case we already added it optimistically)
            if (prev.some((m) => m.id === displayMsg.id)) return prev;
            return [...prev, displayMsg];
          });

          // Mark as read if it's from the other person
          if (newMsg.sender_id !== user.id) {
            supabase
              .from('piktag_messages')
              .update({ is_read: true })
              .eq('id', newMsg.id)
              .then();
          }

          // Auto-scroll to bottom
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user, toDisplayMessage]);

  const handleSend = async () => {
    if (!inputText.trim() || !user || !conversationId) return;

    const messageContent = inputText.trim();
    setInputText('');

    // Optimistic UI: add message immediately
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      content: messageContent,
      sender_id: user.id,
      created_at: new Date().toISOString(),
      isMe: true,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // Scroll to bottom
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);

    try {
      const { data, error } = await supabase
        .from('piktag_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          content: messageContent,
          type: 'text',
          is_read: false,
        })
        .select()
        .single();

      if (error) {
        console.error('Error sending message:', error);
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        return;
      }

      // Replace the optimistic message with the real one
      if (data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? toDisplayMessage(data as Message) : m))
        );
      }

      // Update conversation's updated_at
      await supabase
        .from('piktag_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.isMe;
    const prevMessage = index > 0 ? messages[index - 1] : null;
    const showTimestamp =
      !prevMessage ||
      prevMessage.isMe !== item.isMe ||
      new Date(item.created_at).getTime() - new Date(prevMessage.created_at).getTime() > 300000;

    return (
      <View style={styles.messageContainer}>
        {showTimestamp && (
          <Text style={styles.messageTimestamp}>
            {formatMessageTime(item.created_at)}
          </Text>
        )}
        <View
          style={[
            styles.messageBubbleRow,
            isMe ? styles.messageBubbleRowRight : styles.messageBubbleRowLeft,
          ]}
        >
          {!isMe && (
            <Image source={{ uri: avatar }} style={styles.messageAvatar} />
          )}
          <View
            style={[
              styles.messageBubble,
              isMe ? styles.messageBubbleSent : styles.messageBubbleReceived,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                isMe ? styles.messageTextSent : styles.messageTextReceived,
              ]}
            >
              {item.content}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
        >
          <ChevronLeft size={28} color={COLORS.gray900} />
        </TouchableOpacity>
        <Image source={{ uri: avatar }} style={styles.headerAvatar} />
        <Text style={styles.headerName} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Loading State */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.piktag500} />
          </View>
        ) : (
          /* Messages */
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListEmptyComponent={
              <View style={styles.emptyMessages}>
                <Text style={styles.emptyMessagesText}>還沒有訊息，開始聊天吧！</Text>
              </View>
            }
          />
        )}

        {/* Input Area */}
        <View style={styles.inputArea}>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="輸入訊息..."
              placeholderTextColor={COLORS.gray400}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
            />
          </View>
          {inputText.trim().length > 0 && (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSend}
              activeOpacity={0.7}
            >
              <Send size={20} color={COLORS.white} />
            </TouchableOpacity>
          )}
        </View>
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  backButton: {
    padding: SPACING.xs,
    marginRight: SPACING.sm,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.gray100,
    marginRight: SPACING.sm,
  },
  headerName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray900,
    flex: 1,
  },
  headerSpacer: {
    width: 36,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: SPACING.lg,
    paddingBottom: SPACING.sm,
    flexGrow: 1,
  },
  messageContainer: {
    marginBottom: SPACING.sm,
  },
  messageTimestamp: {
    fontSize: 11,
    color: COLORS.gray400,
    textAlign: 'center',
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  messageBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 2,
  },
  messageBubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  messageBubbleRowRight: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.gray100,
    marginRight: SPACING.sm,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.xxl,
  },
  messageBubbleSent: {
    backgroundColor: COLORS.piktag500,
    borderBottomRightRadius: 6,
  },
  messageBubbleReceived: {
    backgroundColor: COLORS.gray100,
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageTextSent: {
    color: COLORS.white,
  },
  messageTextReceived: {
    color: COLORS.gray900,
  },
  emptyMessages: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
  },
  emptyMessagesText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
    backgroundColor: COLORS.white,
    gap: SPACING.sm,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: COLORS.gray100,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: Platform.OS === 'ios' ? SPACING.md : SPACING.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  textInput: {
    fontSize: 15,
    color: COLORS.gray900,
    maxHeight: 100,
    padding: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
