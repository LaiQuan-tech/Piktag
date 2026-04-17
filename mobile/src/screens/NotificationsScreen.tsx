import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react-native';
import { COLORS, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { getCache, setCache, CACHE_KEYS } from '../lib/dataCache';
import type { Notification } from '../types';
import { SkeletonBox } from '../components/SkeletonLoader';

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
        (n) => n.type === 'biolink_click' || n.type === 'reminder' || n.type === 'birthday' || n.type === 'anniversary' || n.type === 'contract_expiry'
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
  t: (key: string, options?: any) => string;
};

const NotificationItem = React.memo(function NotificationItem({
  item,
  onPress,
  t,
}: NotificationItemProps) {
  const avatarUrl = item.data?.avatar_url || null;
  const username = item.data?.username || item.title || '';
  const body = item.body || '';

  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  return (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !item.is_read && styles.notificationItemUnread,
      ]}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
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

  const handleMarkAllAsRead = useCallback(async () => {
    if (!user) return;

    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    const { error } = await supabase
      .from('piktag_notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false);

    if (error) {
      console.warn('Failed to mark all as read:', error.message);
      fetchNotifications();
    }
  }, [user, notifications, fetchNotifications]);

  // useMemo for computed values
  const filteredNotifications = useMemo(
    () => filterNotifications(notifications, activeTab),
    [notifications, activeTab]
  );

  const hasUnread = useMemo(
    () => notifications.some((n) => !n.is_read),
    [notifications]
  );

  // Tap a notification → mark as read + navigate to the actor's profile.
  // The server-side trigger stores username / actor_user_id in data, so we
  // pass whichever we have to UserDetailScreen's route params.
  const handleNotificationPress = useCallback(
    (item: Notification) => {
      handleMarkAsRead(item.id);
      const userId = item.data?.actor_user_id || item.data?.user_id;
      const username = item.data?.username;
      if (!navigation || (!userId && !username)) return;
      navigation.navigate('UserDetail', { userId, username });
    },
    [handleMarkAsRead, navigation]
  );

  // useCallback for renderItem
  const renderNotificationItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationItem item={item} onPress={handleNotificationPress} t={t} />
    ),
    [handleNotificationPress, t]
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
        {hasUnread && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={handleMarkAllAsRead}
            activeOpacity={0.6}
          >
            <CheckCheck size={20} color={COLORS.piktag500} />
          </TouchableOpacity>
        )}
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
  markAllButton: {
    padding: 8,
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
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.gray500,
    marginTop: SPACING.lg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
