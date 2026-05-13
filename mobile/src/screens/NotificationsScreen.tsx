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
import { routeFromNotification } from '../lib/notificationRouter';
import { useAuth } from '../hooks/useAuth';
import { useChatUnread } from '../hooks/useChatUnread';
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
        (n) =>
          n.type === 'follow' ||
          n.type === 'friend' ||
          n.type === 'tag_added' ||
          n.type === 'recommendation' ||
          n.type === 'tag_trending' ||
          n.type === 'ask_posted' ||
          n.type === 'invite_accepted' ||
          // P3: Vibe Shift — a friend in one of your Vibes added
          // a new tag to their profile. Belongs in the social
          // tab alongside follow/friend/tag_added (all of which
          // are "someone you know did a thing").
          n.type === 'vibe_shift' ||
          // Magic moment #1: a tag you just added is shared by
          // friends in your network. Social discovery, not a
          // reminder — same tab as the rest.
          n.type === 'tag_convergence'
      );
    case 'reminders':
      return notifications.filter(
        (n) =>
          n.type === 'biolink_click' ||
          n.type === 'reminder' ||
          n.type === 'birthday' ||
          n.type === 'anniversary' ||
          // P0 daily-return mechanic: "X 年前的今天 / X 個月前的今天"
          // Vibe anniversary. Slots into the reminders tab next to
          // birthday / anniversary — same kind of "time-driven
          // memory" tone.
          n.type === 'on_this_day'
      );
    default:
      return notifications;
  }
}

// Render notification username + body from `type` and `data` instead of
// trusting the DB-stored body. The triggers were written at different
// times with hardcoded language strings (`notify_friend` → English,
// `notify_follow` → English, `notify_ask_posted` → Chinese, …) which
// surfaces as a mixed-language feed once the user's app locale doesn't
// match whatever the trigger author chose. Localizing client-side via
// the `notifications.types.{type}` keys gives every row the user's
// current locale, regardless of what was persisted at insert time.
//
// For unknown types or missing keys we fall back to the DB body so
// future trigger types (or legacy rows we haven't categorised) still
// render something readable instead of a raw i18n key.
function getNotificationDisplay(
  item: Notification,
  t: (key: string, options?: any) => string
): { username: string; body: string } {
  const data = (item.data || {}) as Record<string, any>;
  const dataUsername =
    (typeof data.username === 'string' && data.username) || '';

  const type = item.type;

  // `ask_body` may be longer than 60 chars in the data payload. The DB
  // truncates for the stored body but data.ask_body is the full string,
  // so trim it client-side to keep the row to one line.
  const truncatedAskBody = (() => {
    const raw = (typeof data.ask_body === 'string' && data.ask_body) || '';
    return raw.length <= 60 ? raw : raw.slice(0, 59) + '…';
  })();

  // {{count}} for recommendation rows means "mutual tag count", which
  // the trigger persists as `mutual_tag_count`. Coerce both keys so the
  // {{count}} placeholder doesn't render as 0 for legacy data shapes.
  const countParam =
    typeof data.count === 'number'
      ? data.count
      : typeof data.mutual_tag_count === 'number'
        ? data.mutual_tag_count
        : 0;

  const i18nKey = `notifications.types.${type}.body`;
  const i18nBody = t(i18nKey, {
    username: dataUsername,
    tag_name: data.tag_name ?? '',
    count: countParam,
    platform: data.platform ?? '',
    years: data.years ?? 0,
    ask_body: truncatedAskBody,
    // `points` placeholder retired — invite_accepted body no longer
    // references {{points}} after the Tribe-size pivot. Leaving the
    // variable in if any historic notification rows still expect it
    // in their template will just render an empty string instead of
    // a missing-key error.
    defaultValue: '',
  });
  const i18nFound =
    !!i18nBody && !i18nBody.startsWith('notifications.types.');

  // Modern notifications: data.username is populated by all current
  // triggers (notify_follow / notify_friend / notify_tag_added /
  // notify_ask_posted / …). When we have both a localized body string
  // and a real username in data, render in the user's locale.
  if (i18nFound && dataUsername) {
    return { username: dataUsername, body: i18nBody };
  }

  // Legacy notifications: pre-trigger rows often baked the actor name
  // into the body itself (e.g. body='Armand 開始追蹤你', title='新的追蹤者'),
  // and data.username was either absent or empty. Discarding the body
  // and only showing data.username (or worse, falling back to the
  // 'system label' title) loses the actor's name. Render the raw DB
  // body verbatim and skip the username prefix so we don't double-up.
  return { username: '', body: item.body || '' };
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
  const { username, body } = getNotificationDisplay(item, t);

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

  const TAB_LABELS: Record<NotificationTab, string> = useMemo(
    () => ({
      social: t('notifications.tabSocial', { defaultValue: '社交' }),
      reminders: t('notifications.tabReminders', { defaultValue: '提醒' }),
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
          t('report.success', { defaultValue: 'Reported' }),
          t('report.confirmDescription', { defaultValue: 'Thanks — our team will review.' }),
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
            if (idx >= 0 && idx < reasons.length) void submitNotifReport(notif, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(t('report.confirmTitle', { defaultValue: 'Report' }), t('report.confirmDescription', { defaultValue: '' }), [
          ...reasons.map((r) => ({ text: r.label, onPress: () => void submitNotifReport(notif, r.key) })),
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [submitNotifReport, t],
  );

  const handleNotificationLongPress = useCallback(
    (notif: Notification) => {
      const reportLabel = t('report.reportNotification', { defaultValue: 'Report this notification' });
      const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });
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

  // Tap a notification → mark as read + delegate routing to the shared
  // notificationRouter helper. The same helper runs from App.tsx for
  // OS-level push taps, so behaviour stays in lockstep.
  const handleNotificationPress = useCallback(
    async (item: Notification) => {
      handleMarkAsRead(item.id);
      if (!navigation) return;
      await routeFromNotification(navigation, item, user?.id);
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
    // accentPop — the unread dot is a primary "notification dot"
    // surface, exactly the case the design system reserves the
    // high-saturation accent for.
    backgroundColor: COLORS.accentPop,
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
