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
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Notification } from '../types';

type NotificationsScreenProps = {
  navigation?: any;
};

type NotificationTab = 'all' | 'follow' | 'tag' | 'crm';

const TAB_KEYS: NotificationTab[] = ['all', 'follow', 'tag', 'crm'];

function filterNotifications(
  notifications: Notification[],
  tab: NotificationTab
): Notification[] {
  switch (tab) {
    case 'follow':
      return notifications.filter(
        (n) => n.type === 'follow' || n.type === 'friend'
      );
    case 'tag':
      return notifications.filter(
        (n) => n.type === 'tag_added' || n.type === 'recommendation' || n.type === 'tag_trending'
      );
    case 'crm':
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
  return date.toLocaleDateString('zh-TW');
}

// --- Memoized notification item component ---
type NotificationItemProps = {
  item: Notification;
  onMarkAsRead: (id: string) => void;
  t: (key: string, options?: any) => string;
};

const NotificationItem = React.memo(function NotificationItem({
  item,
  onMarkAsRead,
  t,
}: NotificationItemProps) {
  const avatarUrl = item.data?.avatar_url || null;
  const username = item.data?.username || item.title || '';
  const body = item.body || '';

  const handlePress = useCallback(() => {
    onMarkAsRead(item.id);
  }, [onMarkAsRead, item.id]);

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
      <Bell size={64} color={COLORS.gray200} />
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
});

export default function NotificationsScreen({ navigation }: NotificationsScreenProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const TAB_LABELS: Record<NotificationTab, string> = useMemo(
    () => ({
      all: t('notifications.tabAll'),
      follow: t('notifications.tabFollow'),
      tag: t('notifications.tabTag'),
      crm: t('notifications.tabCrm'),
    }),
    [t]
  );
  const [activeTab, setActiveTab] = useState<NotificationTab>('all');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('piktag_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.warn('Failed to fetch notifications:', error.message);
        return;
      }

      setNotifications(data ?? []);
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

  // useCallback for renderItem
  const renderNotificationItem = useCallback(
    ({ item }: { item: Notification }) => (
      <NotificationItem item={item} onMarkAsRead={handleMarkAsRead} t={t} />
    ),
    [handleMarkAsRead, t]
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}># PikTag</Text>
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
