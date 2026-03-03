import React, { useState, useEffect, useCallback } from 'react';
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
import { Bell, CheckCheck } from 'lucide-react-native';
import { COLORS, SPACING } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Notification } from '../types';

type NotificationsScreenProps = {
  navigation?: any;
};

type NotificationTab = 'all' | 'follow' | 'tag' | 'crm';

const TABS: { key: NotificationTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'follow', label: '追蹤' },
  { key: 'tag', label: '標籤' },
  { key: 'crm', label: 'CRM' },
];

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

function formatTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  if (diffHours < 24) return `${diffHours} 小時前`;
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffWeeks < 4) return `${diffWeeks} 週前`;
  return date.toLocaleDateString('zh-TW');
}

export default function NotificationsScreen({ navigation }: NotificationsScreenProps) {
  const { user } = useAuth();
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

  const handleMarkAsRead = async (notifId: string) => {
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
  };

  const handleMarkAllAsRead = async () => {
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
  };

  const filteredNotifications = filterNotifications(notifications, activeTab);
  const hasUnread = notifications.some((n) => !n.is_read);

  const renderNotificationItem = ({ item }: { item: Notification }) => {
    const avatarUrl = item.data?.avatar_url || null;
    const username = item.data?.username || item.title || '';
    const body = item.body || '';

    return (
      <TouchableOpacity
        style={[
          styles.notificationItem,
          !item.is_read && styles.notificationItemUnread,
        ]}
        activeOpacity={0.7}
        onPress={() => handleMarkAsRead(item.id)}
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
            {formatTimeAgo(item.created_at)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Bell size={64} color={COLORS.gray200} />
      <Text style={styles.emptyStateText}>目前沒有通知</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>通知</Text>
        </View>
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
        <Text style={styles.headerTitle}>通知</Text>
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
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.6}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Notification List */}
      <FlatList
        data={filteredNotifications}
        renderItem={renderNotificationItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.piktag500}
          />
        }
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
