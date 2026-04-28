import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
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
import ErrorState from '../components/ErrorState';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { useChatThread } from '../hooks/useChatThread';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import { supabase } from '../lib/supabase';
import type { ThreadMessage } from '../types/chat';

// Local param shape: keeps this screen decoupled from the global root
// stack until the app wires chat routes up.
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
  if (sameLocalDay(d, now)) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
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
    reload,
    markRead,
    error,
  } = useChatThread(conversationId);

  const [otherProfile, setOtherProfile] = useState<OtherProfile | null>(null);
  const lastMarkedLenRef = useRef<number>(-1);

  // Fetch freshest profile so the header isn't stuck with stale params.
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
        if (!selErr && data) setOtherProfile(data as OtherProfile);
      } catch {
        // Non-fatal; header falls back to route params.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otherUserId]);

  // Mark read on mount and whenever a new row is appended.
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

  // Apple Guideline 1.2: long-press a bubble to report or block.
  const submitReport = useCallback(
    async (messageId: string, reason: string) => {
      if (!user) return;
      try {
        await supabase.from('piktag_reports').insert({
          reporter_id: user.id,
          reported_id: otherUserId,
          reason,
          context: { kind: 'chat_message', message_id: messageId, conversation_id: conversationId },
        } as any);
        Alert.alert(
          t('report.success') || 'Reported',
          t('report.confirmDescription') || 'Thanks — our team will review.',
        );
      } catch (err) {
        console.warn('report message failed:', err);
      }
    },
    [user, otherUserId, conversationId, t],
  );

  const blockOtherUser = useCallback(async () => {
    if (!user) return;
    try {
      await supabase
        .from('piktag_blocks')
        .upsert(
          { blocker_id: user.id, blocked_id: otherUserId },
          { onConflict: 'blocker_id,blocked_id' },
        );
      Alert.alert(
        t('userDetail.blockedTitle') || 'Blocked',
        t('userDetail.blockedMessage') || 'You will no longer see this user.',
      );
      if (navigation.canGoBack()) navigation.goBack();
    } catch (err) {
      console.warn('block user failed:', err);
    }
  }, [user, otherUserId, navigation, t]);

  const promptReportReason = useCallback(
    (messageId: string) => {
      const reasons: Array<{ key: string; label: string }> = [
        { key: 'spam', label: t('report.reasonSpam') || 'Spam' },
        { key: 'harassment', label: t('report.reasonHarassment') || 'Harassment' },
        { key: 'inappropriate', label: t('report.reasonInappropriate') || 'Inappropriate' },
        { key: 'other', label: t('report.reasonOther') || 'Other' },
      ];
      const cancelLabel = t('common.cancel') || 'Cancel';
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: t('report.confirmTitle') || 'Report',
            options: [...reasons.map((r) => r.label), cancelLabel],
            cancelButtonIndex: reasons.length,
          },
          (idx) => {
            if (idx >= 0 && idx < reasons.length) void submitReport(messageId, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(
          t('report.confirmTitle') || 'Report',
          t('report.confirmDescription') || '',
          [
            ...reasons.map((r) => ({
              text: r.label,
              onPress: () => void submitReport(messageId, r.key),
            })),
            { text: cancelLabel, style: 'cancel' as const },
          ],
        );
      }
    },
    [submitReport, t],
  );

  const handleBubbleLongPress = useCallback(
    (message: ThreadMessage) => {
      if (!user || message.sender_id === user.id) return;
      const reportLabel = t('report.reportMessage') || 'Report message';
      const blockLabel = t('userDetail.blockUser') || 'Block user';
      const cancelLabel = t('common.cancel') || 'Cancel';
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [reportLabel, blockLabel, cancelLabel],
            destructiveButtonIndex: 1,
            cancelButtonIndex: 2,
          },
          (idx) => {
            if (idx === 0) promptReportReason(message.id);
            else if (idx === 1) void blockOtherUser();
          },
        );
      } else {
        Alert.alert('', '', [
          { text: reportLabel, onPress: () => promptReportReason(message.id) },
          { text: blockLabel, style: 'destructive', onPress: () => void blockOtherUser() },
          { text: cancelLabel, style: 'cancel' },
        ]);
      }
    },
    [user, promptReportReason, blockOtherUser, t],
  );

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

  // In the inverted array, index i is visually above (chronologically
  // earlier than) index i-1 and below (later than) index i+1. The
  // avatar sits on the first bubble of a sender's group — the oldest
  // bubble in a run — which in inverted display is the one whose older
  // neighbor (i+1) is absent or from a different sender. Day separators
  // visually precede the first message of a new day; in the inverted
  // array we render them alongside the oldest-of-day bubble.
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<ThreadMessage>) => {
      if (!user) return null;
      const isMine = item.sender_id === user.id;
      const older = messages[index + 1];
      const showAvatar = !isMine && (!older || older.sender_id !== item.sender_id);
      const currDate = new Date(item.created_at);
      const showDaySeparator =
        !older || !sameLocalDay(currDate, new Date(older.created_at));

      const bubble = (
        <Pressable
          onLongPress={() => handleBubbleLongPress(item)}
          delayLongPress={350}
          accessibilityHint={
            !isMine ? t('report.reportMessage') || 'Long press to report' : undefined
          }
        >
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
        </Pressable>
      );

      if (!showDaySeparator) return bubble;

      // Inverted render order: bubble first (visually below), separator
      // after (visually above the day's messages).
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
    [messages, user, avatarName, avatarUrl, retry, handleBubbleLongPress, t],
  );

  const keyExtractor = useCallback((item: ThreadMessage) => item.id, []);

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

  // Heuristic "blocked" detection — RLS surfaces blocks via policy names.
  const isBlocked = useMemo(
    () => (error ? /block/i.test(error) : false),
    [error],
  );

  // Auto-retry the page fetch when the network comes back if we
  // previously errored and don't already have messages cached. Realtime
  // re-subscription handles the happy case (we recovered with messages
  // already painted); this branch covers the cold-start-while-offline
  // failure mode.
  useNetInfoReconnect(useCallback(() => {
    if (error && !isBlocked && messages.length === 0) {
      void reload();
    }
  }, [error, isBlocked, messages.length, reload]));

  // In an inverted list, the "footer" renders at the TOP — visually
  // above the oldest loaded message — which is the right slot for the
  // "loading older" spinner.
  const listFooter = useMemo(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMoreWrap}>
        <ActivityIndicator size="small" color={COLORS.gray400} />
      </View>
    );
  }, [loadingMore]);

  const emptyState = useMemo(
    () => {
      // A non-block error with no messages = fetch failed cold. Surface
      // the retry CTA. Block errors are handled separately via the
      // composer being disabled (see Composer's `disabled` prop above).
      if (error && !isBlocked) {
        return (
          <View style={styles.emptyWrap}>
            <ErrorState onRetry={() => void reload()} />
          </View>
        );
      }
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t('chat.emptyInbox')}</Text>
        </View>
      );
    },
    [error, isBlocked, reload, t],
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
  container: { flex: 1, backgroundColor: COLORS.white },
  flex: { flex: 1 },
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
  listContent: { paddingVertical: 12 },
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
  emptyText: { fontSize: 15, color: COLORS.gray500, textAlign: 'center' },
  loadingMoreWrap: { paddingVertical: 12, alignItems: 'center' },
  daySeparator: { alignItems: 'center', paddingVertical: 8 },
  daySeparatorText: { fontSize: 12, color: COLORS.gray400, fontWeight: '500' },
});
