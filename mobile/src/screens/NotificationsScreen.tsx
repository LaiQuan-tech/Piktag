import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  RefreshControl,
  ActionSheetIOS,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, MessageCircle } from 'lucide-react-native';
import { COLORS, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useChatUnread } from '../hooks/useChatUnread';
import { useAskFeed } from '../hooks/useAskFeed';
import AskStoryRow from '../components/ask/AskStoryRow';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import type { Notification } from '../types';
import { SkeletonBox } from '../components/SkeletonLoader';
import RingedAvatar from '../components/RingedAvatar';

const NOTIFICATION_ITEM_HEIGHT = 76;

type NotificationsScreenProps = {
  navigation?: any;
};

type NotificationTab = 'social' | 'reminders';

const TAB_KEYS: NotificationTab[] = ['social', 'reminders'];

function filterNotifications(
  notifications: Notification[],
  tab: NotificationTab
): Notification[] {
  switch (tab) {
    case 'social':
      return notifications.filter(
        (n) => n.type === 'follow' || n.type === 'friend' || n.type === 'tag_added' || n.type === 'recommendation' || n.type === 'tag_trending'
      );
    case 'reminders':
      return notifications.filter(
        (n) => n.type === 'biolink_click' || n.type === 'reminder' || n.type === 'birthday' || n.type === 'anniversary'
      );
    default:
      return notifications;
  }
}

function formatTimeAgo(dateString: string, t: (key: string, options?: any) => string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return t('notifications.timeJustNow');
  if (diffMins < 60) return t('notifications.timeMinutesAgo', { count: diffMins });
  if (diffHours < 24) return t('notifications.timeHoursAgo', { count: diffHours });
  if (diffDays === 1) return t('notifications.timeYesterday');
  if (diffDays < 7) return t('notifications.timeDaysAgo', { count: diffDays });
  if (diffWeeks < 4) return t('notifications.timeWeeksAgo', { count: diffWeeks });
  return date.toLocaleDateString();
}

// --- Memoized notification item component ---
type NotificationItemProps = {
  item: Notification;
  onPress: (item: Notification) => void;
  onLongPress: (item: Notification) => void;
  t: (key: string, options?: any) => string;
};

const NotificationItem = React.memo(function NotificationItem({
  item,
  onPress,
  onLongPress,
  t,
}: NotificationItemProps) {
  const avatarUrl = item.data?.avatar_url || null;
  const username = item.data?.username || item.title || '';
  const body = item.body || '';

  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleLongPress = useCallback(() => {
    onLongPress(item);
  }, [onLongPress, item]);

  return (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !item.is_read && styles.notificationItemUnread,
      ]}
      activeOpacity={0.7}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
    >
      {avatarUrl ? (
        <RingedAvatar
          size={47}
          ringStyle="subtle"
          name={username}
          avatarUrl={avatarUrl}
          style={styles.avatarSpacing}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Bell size={20} color={COLORS.gray400} />
        </View>
      )}
      <View style={styles.notificationContent}>
        <Text style={styles.notificationText}>
          {username ? (
            <>
              <Text style={styles.notificationUsername}>{username}</Text>
              {'  '}
            </>
          ) : null}
          {body}
        </Text>
        <Text style={styles.notificationTime}>
          {formatTimeAgo(item.created_at, t)}
        </Text>
      </View>
      {!item.is_read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
});

// --- Empty state component (stable reference) ---
const EmptyState = React.memo(function EmptyState({
  text,
}: {
  text: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Bell size={48} color={COLORS.gray200} />
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
});

const NotificationsScreenSkeleton = React.memo(function NotificationsScreenSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.white }}>
      {/* Tab row skeleton */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}>
        {[80, 60, 50, 50].map((w, i) => (
          <SkeletonBox key={i} width={w} height={32} borderRadius={16} />
        ))}
      </View>
      {/* 6 notification item skeletons */}
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 }}>
          <SkeletonBox width={44} height={44} borderRadius={22} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox width="80%" height={14} borderRadius={7} />
            <SkeletonBox width="50%" height={12} borderRadius={6} />
          </View>
        </View>
      ))}
    </View>
  );
});

export default function NotificationsScreen({ navigation }: NotificationsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { total: chatUnread } = useChatUnread();
  const { asks: askFeedItems, myAsk: myActiveAsk, refresh: refreshAsks } = useAskFeed();

  // Lightweight self-profile fetch for the AskStoryRow's first card.
  // Mirrors the pattern in ConnectionsScreen — same shape, same query.
  const [myProfile, setMyProfile] = useState<{ full_name: string | null; avatar_url: string | null }>({
    full_name: null,
    avatar_url: null,
  });
  useEffect(() => {
    if (!user) return;
    supabase
      .from('piktag_profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setMyProfile(data);
      });
  }, [user]);

  // UserDetail / FriendDetail live at the root stack, so a flat navigate()
  // from this tab pops the tab stack and lands on the detail screen.
  // We don't have the connection list here to disambiguate friend vs
  // stranger, so always go to UserDetail — it already handles both cases.
  const handleAskPressUser = useCallback(
    (userId: string) => {
      navigation?.navigate('UserDetail', { userId });
    },
    [navigation],
  );

  const TAB_LABELS: Record<NotificationTab, string> = useMemo(
    () => ({
      social: t('notifications.tabSocial') || '社交',
      reminders: t('notifications.tabReminders') || '提醒',
    }),
    [t]
  );
  const [activeTab, setActiveTab] = useState<NotificationTab>('social');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;

    // Show cached data immediately (stale-while-revalidate)
    const cached = getCache<Notification[]>(CACHE_KEYS.NOTIFICATIONS);
    if (cached) {
      setNotifications(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // Always fetch fresh data in the background
    try {
      const { data, error } = await supabase
        .from('piktag_notifications')
        .select('id, user_id, type, title, body, data, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('Failed to fetch notifications:', error.message);
        return;
      }

      if (data) {
        setCache(CACHE_KEYS.NOTIFICATIONS, data);
        setNotifications(data);
      }
    } catch (err) {
      console.warn('Notifications fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'piktag_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications((prev) => [newNotification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = useCallback(async (notifId: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
    );

    const { error } = await supabase
      .from('piktag_notifications')
      .update({ is_read: true })
      .eq('id', notifId);

    if (error) {
      console.warn('Failed to mark as read:', error.message);
      // Revert on failure
      fetchNotifications();
    }
  }, [fetchNotifications]);

  // Apple Guideline 1.2: long-press a notification to report the actor
  // or the notification itself.
  const submitNotifReport = useCallback(
    async (notif: Notification, reason: string) => {
      if (!user) return;
      const reportedId = notif.data?.actor_user_id || notif.data?.user_id || null;
      try {
        await supabase.from('piktag_reports').insert({
          reporter_id: user.id,
          reported_id: reportedId,
          reason,
          context: { kind: 'notification', notification_id: notif.id, type: notif.type },
        } as any);
        Alert.alert(
          t('report.success') || 'Reported',
          t('report.confirmDescription') || 'Thanks — our team will review.',
        );
      } catch (err) {
        console.warn('report notification failed:', err);
      }
    },
    [user, t],
  );

  const promptNotifReportReason = useCallback(
    (notif: Notification) => {
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
            if (idx >= 0 && idx < reasons.length) void submitNotifReport(notif, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(t('report.confirmTitle') || 'Report', t('report.confirmDescription') || '', [
          ...reasons.map((r) => ({ text: r.label, onPress: () => void submitNotifReport(notif, r.key) })),
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [submitNotifReport, t],
  );

  const handleNotificationLongPress = useCallback(
    (notif: Notification) => {
      const reportLabel = t('report.reportNotification') || 'Report this notification';
      const cancelLabel = t('common.cancel') || 'Cancel';
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [reportLabel, cancelLabel],
            destructiveButtonIndex: 0,
            cancelButtonIndex: 1,
          },
          (idx) => {
            if (idx === 0) promptNotifReportReason(notif);
          },
        );
      } else {
        Alert.alert('', '', [
          { text: reportLabel, onPress: () => promptNotifReportReason(notif) },
          { text: cancelLabel, style: 'cancel' },
        ]);
      }
    },
    [promptNotifReportReason, t],
  );

  // useMemo for computed values
  const filteredNotifications = useMemo(
    () => filterNotifications(notifications, activeTab),
    [notifications, activeTab]
  );

  // Tap a notification → mark as read + navigate to the actor's profile.
  // The server-side trigger stores username / actor_user_id in data, so we
  // pass whichever we have to UserDetailScreen's route params.
  // Tap routing notes:
  //   * Different notification types attach the relevant user under different
  //     keys (`actor_user_id`, `connected_user_id`, `clicker_user_id`, …).
  //     We probe the common ones in priority order so reminders, birthdays,
  //     biolink clicks, and recommendations all land somewhere instead of
  //     silently no-opping after mark-as-read.
  //   * `tag_trending` (and any other tag-centric type) carries `tag_id` /
  //     `tag_name` and should open TagDetail, not a profile.
  //   * If the only id we can find is the viewer's own id (some notifications
  //     stuff `data.user_id = me`), we don't navigate — the destination would
  //     be the user's own profile, which is reachable from the tab bar
  //     anyway and feels broken from a notification.
  const handleNotificationPress = useCallback(
    async (item: Notification) => {
      handleMarkAsRead(item.id);
      if (!navigation) return;

      const data = (item.data ?? {}) as Record<string, any>;

      // 1. Tag-centric notifications → TagDetail.
      const tagId: string | undefined = data.tag_id;
      const tagName: string | undefined = data.tag_name;
      if (item.type === 'tag_trending' && (tagId || tagName)) {
        navigation.navigate('TagDetail', { tagId, tagName });
        return;
      }

      // 2. User-centric: probe every key servers might use, drop self-id so
      // we don't navigate to the viewer's own profile. The viewer's id ALSO
      // lives on the row as `notification.user_id` (recipient), but that's
      // never a useful navigation target so we skip it implicitly.
      const userIdCandidates: (string | undefined)[] = [
        data.actor_user_id,
        data.connected_user_id,
        data.friend_user_id,
        data.recommended_user_id,
        data.clicker_user_id,
        data.user_id,
      ];
      const userId = userIdCandidates.find(
        (id): id is string => typeof id === 'string' && id.length > 0 && id !== user?.id,
      );
      const username: string | undefined = data.username;

      if (!userId && !username) return;

      // 3. Friend or stranger? Friend lookup short-circuits to FriendDetail
      // when the viewer has a connection row for this user. Errors fall
      // through to the stranger path so we still navigate somewhere.
      if (userId && user) {
        try {
          const { data: conn } = await supabase
            .from('piktag_connections')
            .select('id')
            .eq('user_id', user.id)
            .eq('connected_user_id', userId)
            .maybeSingle();
          if (conn) {
            navigation.navigate('FriendDetail', { friendId: userId, connectionId: conn.id });
            return;
          }
        } catch {}
      }

      navigation.navigate('UserDetail', { userId, username });
    },
    [handleMarkAsRead, navigation, user]
  );

  // useCallback for renderItem
  const renderNotificationItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationItem
        item={item}
        onPress={handleNotificationPress}
        onLongPress={handleNotificationLongPress}
        t={t}
      />
    ),
    [handleNotificationPress, handleNotificationLongPress, t]
  );

  // useCallback for keyExtractor
  const keyExtractor = useCallback((item: Notification) => item.id, []);

  // Stable ListEmptyComponent reference
  const emptyStateText = t('notifications.emptyState');
  const listEmptyComponent = useMemo(
    () => <EmptyState text={emptyStateText} />,
    [emptyStateText]
  );

  // Stable RefreshControl reference
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={COLORS.piktag500}
      />
    ),
    [refreshing, handleRefresh]
  );

  if (loading && notifications.length === 0) {
    return <NotificationsScreenSkeleton />;
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('notifications.headerTitle')}</Text>
        <TouchableOpacity
          onPress={() => (navigation as any)?.navigate('ChatList')}
          style={styles.headerChatBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('chat.inbox')}
        >
          <MessageCircle size={24} color={COLORS.gray900} strokeWidth={2} />
          {chatUnread > 0 ? (
            <View style={styles.headerChatBadge}>
              <Text style={styles.headerChatBadgeText}>{chatUnread > 99 ? '99+' : String(chatUnread)}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      {/* Ask Feed — same component used on the Connections (Home) screen.
          Sits above the tab switcher so it stays visible regardless of
          which notification tab the user is on. Tapping an avatar opens
          the author's UserDetail screen. */}
      <AskStoryRow
        asks={askFeedItems}
        myAsk={myActiveAsk}
        myAvatarUrl={myProfile.avatar_url}
        myName={myProfile.full_name || '?'}
        onRefresh={refreshAsks}
        onPressUser={handleAskPressUser}
      />

      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        {TAB_KEYS.map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, activeTab === key && styles.tabActive]}
            onPress={() => setActiveTab(key)}
            activeOpacity={0.6}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === key && styles.tabTextActive,
              ]}
            >
              {TAB_LABELS[key]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notification List */}
      <FlatList
        data={filteredNotifications}
        renderItem={renderNotificationItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={listEmptyComponent}
        refreshControl={refreshControl}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        getItemLayout={(_data, index) => ({
          length: NOTIFICATION_ITEM_HEIGHT,
          offset: NOTIFICATION_ITEM_HEIGHT * index,
          index,
        })}
      />
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
  headerChatBtn: {
    padding: 6,
    position: 'relative',
  },
  headerChatBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: COLORS.red500,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerChatBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    marginRight: SPACING.xl,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.piktag500,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray400,
  },
  tabTextActive: {
    color: COLORS.piktag500,
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  notificationItemUnread: {
    backgroundColor: COLORS.piktag50,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
    marginRight: 12,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSpacing: {
    marginRight: 12,
  },
  notificationContent: {
    flex: 1,
  },
  notificationText: {
    fontSize: 14,
    color: COLORS.gray700,
    lineHeight: 20,
  },
  notificationUsername: {
    fontWeight: '700',
    color: COLORS.gray900,
  },
  notificationTime: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent500,
    marginLeft: 8,
    alignSelf: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    paddingHorizontal: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray500,
    marginTop: SPACING.lg,
    textAlign: 'center',
    lineHeight: 22,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
