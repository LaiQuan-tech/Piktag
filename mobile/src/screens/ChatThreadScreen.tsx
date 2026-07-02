import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import Composer from '../components/chat/Composer';
import IcebreakerSuggestions from '../components/chat/IcebreakerSuggestions';
import MessageBubble from '../components/chat/MessageBubble';
import { generateIcebreakers } from '../lib/icebreaker';
import RingedAvatar from '../components/RingedAvatar';
import ErrorState from '../components/ErrorState';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
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
    // Optional on purpose: the cold-start push path (App.tsx `chat`
    // branch) only carries conversationId — the screen self-heals the
    // other participant from piktag_conversations when these are
    // absent (see the resolve effect). In-app callers (ChatList /
    // UserDetail / FriendDetail) still pass all three for an instant
    // header.
    otherUserId?: string;
    otherDisplayName?: string;
    otherAvatarUrl?: string | null;
  };
  UserDetail: { userId: string };
  FriendDetail: { connectionId: string; friendId: string };
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

export default function ChatThreadScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const {
    conversationId,
    otherUserId: routeOtherUserId,
    otherDisplayName: initialDisplayName,
    otherAvatarUrl: initialAvatarUrl,
  } = route.params;

  // The other participant's id. Starts from the route param; when the
  // route arrived without it (cold-start push tap → App.tsx navigates
  // with only conversationId), the resolve effect below derives it from
  // the conversation row. Everything downstream (header profile fetch,
  // icebreakers, report/block, header tap) keys off this state, so the
  // whole screen self-heals once it lands. This path used to CRASH the
  // app: avatarName ended up undefined → InitialsAvatar.getColorFromName
  // read .length of undefined → render throw → ErrorBoundary (the
  // 發生錯誤 screen a tester hit on smoke-test step 6, 2026-07-02).
  const [otherUserId, setOtherUserId] = useState<string | undefined>(routeOtherUserId);

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

  // Self-heal a missing otherUserId (cold-start push tap): the
  // conversation row names both participants — the other one is
  // whichever isn't me. Once set, the profile-fetch effect below fills
  // the header name/avatar exactly as if the route had carried them.
  useEffect(() => {
    if (otherUserId || !user?.id || !conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('piktag_conversations')
          .select('participant_a, participant_b')
          .eq('id', conversationId)
          .maybeSingle();
        if (cancelled || !data) return;
        const other =
          data.participant_a === user.id ? data.participant_b : data.participant_a;
        if (other && other !== user.id) setOtherUserId(other);
      } catch {
        // Non-fatal: the thread itself renders fine from conversationId
        // alone; only the header/profile affordances stay in fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otherUserId, user?.id, conversationId]);

  // Optional askId on the route — when ChatThread is opened from an
  // Ask match flow (Phase 1, post-launch), this anchors the icebreaker
  // generation. Today (Phase 2 first) the route doesn't pass it and
  // the icebreaker prompt simply uses the shared tag / met context
  // path instead.
  const routeAskId = (route.params as any)?.askId as string | undefined;

  // ── Icebreaker suggestions (North-Star activation engine) ──────
  // Fires once per mount when we determine the conversation is
  // either brand new (zero messages loaded) or dormant (>90 days
  // since last message). We never re-fire on send / receive — the
  // suggestions are a one-shot opener, not an always-on assistant.
  const [icebreakers, setIcebreakers] = useState<string[]>([]);
  const [icebreakerLoading, setIcebreakerLoading] = useState(false);
  const [icebreakerDismissed, setIcebreakerDismissed] = useState(false);
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const icebreakerTriggeredRef = useRef(false);

  useEffect(() => {
    if (icebreakerTriggeredRef.current) return;
    if (loading) return;
    if (!otherUserId) return;

    // Trigger conditions:
    //   - empty conversation (truly new), OR
    //   - dormant: most recent message > 90 days ago
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastMsgAge = lastMsg?.created_at
      ? (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    const isEmpty = messages.length === 0;
    const isDormant = lastMsgAge >= 90;

    if (!(isEmpty || isDormant)) return;

    icebreakerTriggeredRef.current = true;
    setIcebreakerLoading(true);
    void (async () => {
      const out = await generateIcebreakers({
        recipientId: otherUserId,
        askId: routeAskId ?? null,
      });
      setIcebreakers(out);
      setIcebreakerLoading(false);
    })();
  }, [loading, messages, otherUserId, routeAskId]);

  // Tap an icebreaker chip → drops the text into the Composer for
  // the user to review + edit + send. We never send automatically;
  // the human must press send. Bumping nonce on every pick so the
  // Composer's adoption effect re-fires even if the user picks the
  // same chip twice in a row.
  const handlePickIcebreaker = useCallback((text: string) => {
    setComposerPrefill({ text, nonce: Date.now() });
  }, []);
  const handleDismissIcebreakers = useCallback(() => {
    setIcebreakerDismissed(true);
  }, []);

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

  const handleHeaderPress = useCallback(async () => {
    // Chats only exist between connected users, so by definition the
    // tapped header should land in FriendDetail (which renders the
    // searcher's manual/private tags). Look up the connection_id on
    // demand — no need to cache, this is a once-per-tap event.
    // Defensive fall-through to UserDetail covers any edge case
    // where the connection was severed mid-session.
    if (!otherUserId) return; // still resolving (cold-start push) — ignore the tap
    if (user) {
      const { data: conn } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('connected_user_id', otherUserId)
        .maybeSingle();
      if (conn?.id) {
        navigation.navigate('FriendDetail', {
          connectionId: conn.id,
          friendId: otherUserId,
        });
        return;
      }
    }
    navigation.navigate('UserDetail', { userId: otherUserId });
  }, [navigation, otherUserId, user]);

  // Apple Guideline 1.2: long-press a bubble to report or block.
  const submitReport = useCallback(
    async (messageId: string, reason: string) => {
      if (!user || !otherUserId) return;
      try {
        await supabase.from('piktag_reports').insert({
          reporter_id: user.id,
          reported_id: otherUserId,
          reason,
          context: { kind: 'chat_message', message_id: messageId, conversation_id: conversationId },
        } as any);
        Alert.alert(
          t('report.success', { defaultValue: 'Reported' }),
          t('report.confirmDescription', { defaultValue: 'Thanks — our team will review.' }),
        );
      } catch (err) {
        console.warn('report message failed:', err);
      }
    },
    [user, otherUserId, conversationId, t],
  );

  const blockOtherUser = useCallback(async () => {
    if (!user || !otherUserId) return;
    // Route through block_user RPC so the cascade matches what
    // FriendDetail / UserDetail use:
    //   * upsert piktag_blocks
    //   * delete bilateral piktag_follows
    //   * delete bilateral piktag_close_friends
    //   * delete the blocker's prior notifications produced by
    //     the blocked user
    // The earlier direct upsert into piktag_blocks left all those
    // tables intact, so the blocked party still saw the user in
    // feeds / could still appear as a close friend, defeating the
    // privacy contract of "block".
    const { error } = await supabase.rpc('block_user', { p_blocked_id: otherUserId });
    if (error) {
      console.warn('block user failed:', error);
      Alert.alert(t('common.error'), t('common.unknownError'));
      return;
    }
    Alert.alert(
      t('userDetail.blockedTitle', { defaultValue: 'Blocked' }),
      t('userDetail.blockedMessage', { defaultValue: 'You will no longer see this user.' }),
    );
    if (navigation.canGoBack()) navigation.goBack();
  }, [user, otherUserId, navigation, t]);

  const promptReportReason = useCallback(
    (messageId: string) => {
      const reasons: Array<{ key: string; label: string }> = [
        { key: 'spam', label: t('report.reasonSpam', { defaultValue: 'Spam' }) },
        { key: 'harassment', label: t('report.reasonHarassment', { defaultValue: 'Harassment' }) },
        { key: 'inappropriate', label: t('report.reasonInappropriate', { defaultValue: 'Inappropriate' }) },
        { key: 'other', label: t('report.reasonOther', { defaultValue: 'Other' }) },
      ];
      const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: t('report.confirmTitle', { defaultValue: 'Report' }),
            options: [...reasons.map((r) => r.label), cancelLabel],
            cancelButtonIndex: reasons.length,
          },
          (idx) => {
            if (idx >= 0 && idx < reasons.length) void submitReport(messageId, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(
          t('report.confirmTitle', { defaultValue: 'Report' }),
          t('report.confirmDescription', { defaultValue: '' }),
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
      const reportLabel = t('report.reportMessage', { defaultValue: 'Report message' });
      const blockLabel = t('userDetail.blockUser', { defaultValue: 'Block user' });
      const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });
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
    // '' (not undefined) when neither is known yet — InitialsAvatar
    // renders its '?' placeholder; the self-heal effect fills the real
    // name a beat later. undefined here once crashed the render tree
    // (getColorFromName read .length of undefined) on cold-start push.
    () => displayName || otherUserId || '',
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
            !isMine ? t('report.reportMessage', { defaultValue: 'Long press to report' }) : undefined
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
    [messages, user, avatarName, avatarUrl, retry, handleBubbleLongPress, t, styles, colors],
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
        <BrandSpinner size={20} />
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
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={24} color={colors.gray900} />
        </TouchableOpacity>

        <Pressable style={styles.headerCenter} onPress={handleHeaderPress}>
          <RingedAvatar
            name={avatarName}
            avatarUrl={avatarUrl}
            size={36}
            ringStyle="subtle"
          />
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

        {!icebreakerDismissed && !isBlocked && (icebreakerLoading || icebreakers.length > 0) ? (
          <IcebreakerSuggestions
            suggestions={icebreakers}
            loading={icebreakerLoading}
            onPick={handlePickIcebreaker}
            onDismiss={handleDismissIcebreakers}
          />
        ) : null}
        <Composer
          onSend={handleSend}
          disabled={isBlocked}
          disabledReason={isBlocked ? t('chat.userBlocked') : undefined}
          prefill={composerPrefill}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
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
    color: c.gray900,
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
  emptyText: { fontSize: 15, color: c.gray500, textAlign: 'center' },
  loadingMoreWrap: { paddingVertical: 12, alignItems: 'center' },
  daySeparator: { alignItems: 'center', paddingVertical: 8 },
  daySeparatorText: { fontSize: 12, color: c.gray400, fontWeight: '500' },
  });
}
