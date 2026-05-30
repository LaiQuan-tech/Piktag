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
import { COLORS, SPACING, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { routeFromNotification } from '../lib/notificationRouter';
import { refreshBadgeFromServer } from '../lib/pushNotifications';
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

// Three tabs, identical to the Settings category split (Settings'
// notif_social / notif_matches / notif_memories columns). One mental
// model across "where do I see this notification?" and "where do I
// turn it off?" beats two slightly-different taxonomies that ship
// and then drift. Mapping mirrors is_notification_category_enabled()
// in supabase/migrations/20260530000000_notification_category_toggles.sql
// — keep both in sync when adding new types.
type NotificationTab = 'social' | 'matches' | 'memories';

const TAB_KEYS: NotificationTab[] = ['social', 'matches', 'memories'];

function filterNotifications(
  notifications: Notification[],
  tab: NotificationTab
): Notification[] {
  switch (tab) {
    case 'social':
      // Things people directly involving you did: followed,
      // friended, tagged your profile, clicked your biolink,
      // accepted your invite, posted an Ask, tagged something
      // that propagated (vibe_shift), or had their tag trend.
      return notifications.filter(
        (n) =>
          n.type === 'follow' ||
          n.type === 'friend' ||
          n.type === 'tag_added' ||
          n.type === 'biolink_click' ||
          n.type === 'invite_accepted' ||
          n.type === 'vibe_shift' ||
          n.type === 'ask_posted' ||
          n.type === 'tag_trending'
      );
    case 'matches':
      // ★ North-Star tab: AI-driven discovery / re-activation.
      // "People you might know", convergence, bridge, reconnect
      // nudges, weekly combo digest — every magic-moment match.
      return notifications.filter(
        (n) =>
          n.type === 'recommendation' ||
          n.type === 'tag_convergence' ||
          n.type === 'ask_bridge' ||
          n.type === 'reconnect_suggest' ||
          n.type === 'tag_combo'
      );
    case 'memories':
      // Time-based reminders + system prompts that aren't
      // directly social. Includes the legacy 'reminder' type
      // for backward compat with any old rows.
      return notifications.filter(
        (n) =>
          n.type === 'birthday' ||
          n.type === 'anniversary' ||
          n.type === 'on_this_day' ||
          n.type === 'ask_prompt' ||
          n.type === 'endorsement_request' ||
          n.type === 'reminder'
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
  // Fallback chain — most triggers populate `username`, but
  // notify_vibe_shift uses `actor_username` (and `actor_avatar_url`
  // on the avatar). Accept both so historical rows render.
  const dataUsername =
    (typeof data.username === 'string' && data.username) ||
    (typeof data.actor_username === 'string' && data.actor_username) ||
    (typeof data.actor_full_name === 'string' && data.actor_full_name) ||
    '';

  const type = item.type;

  // Magic-moment notifications (on_this_day, reconnect_suggest, tag_combo,
  // tag_convergence, ask_bridge, ask_prompt) are self-directed system
  // insights without an actor user — `data.username` is intentionally
  // absent. The SQL enqueue_*_notifications functions store the rich
  // pre-formatted hook in `title` ("一年前的今天", "Eva 也標了 #咖啡
  // — 你們很久沒聊了"), which is the actual content worth showing.
  // Route these through the title field instead of the username+body
  // template path so the row doesn't render as a blank rectangle.
  const MAGIC_MOMENT_TYPES = new Set([
    'on_this_day',
    'tag_convergence',
    'ask_bridge',
    'ask_prompt',
    'reconnect_suggest',
    'tag_combo',
  ]);
  if (MAGIC_MOMENT_TYPES.has(type) && item.title) {
    return { username: '', body: item.title };
  }

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Fall back to actor_avatar_url for triggers that use the
  // `actor_*` naming convention (notify_vibe_shift, 2026-05-30
  // bug). Most newer triggers use `avatar_url` directly; vibe_shift
  // is the lone exception. Same fallback chain applied to
  // username inside getNotificationDisplay below.
  const avatarUrl =
    item.data?.avatar_url || (item.data as any)?.actor_avatar_url || null;
  const { username, body } = getNotificationDisplay(item, t);

  const handlePress = useCallback(() => {
    onPress(item);
  }, [onPress, item]);

  const handleLongPress = useCallback(() => {
    onLongPress(item);
  }, [onLongPress, item]);

  // endorsement_request rows used to render an inline "認同" button
  // here (commit 915ed55, principle #3). Removed 2026-05-30 — see
  // CLAUDE.md "No rubber-stamp social buttons". Tapping the row now
  // routes to the friend's FriendDetail where the viewer can tap
  // their existing add-tag chip flow if they organically agree.
  // Zero social pressure, zero rubber-stamp signal.

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
          <Bell size={20} color={colors.gray400} />
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
        <View style={styles.notificationFooterRow}>
          <Text style={styles.notificationTime}>
            {formatTimeAgo(item.created_at, t)}
          </Text>
        </View>
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.emptyState}>
      <Bell size={48} color={colors.gray200} />
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
});

const NotificationsScreenSkeleton = React.memo(function NotificationsScreenSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { total: chatUnread } = useChatUnread();

  const TAB_LABELS: Record<NotificationTab, string> = useMemo(
    () => ({
      social: t('notifications.tabSocial', { defaultValue: '社交' }),
      matches: t('notifications.tabMatches', { defaultValue: '配對' }),
      memories: t('notifications.tabMemories', { defaultValue: '回憶' }),
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

    // Always fetch fresh data in the background. is_dismissed=false
    // filter mirrors the partial index in migration 20260530060000 —
    // dismissed rows live forever in the table (analytics / undo
    // hooks later) but never re-enter the active feed.
    try {
      const { data, error } = await supabase
        .from('piktag_notifications')
        .select('id, user_id, type, title, body, data, is_read, created_at')
        .eq('user_id', user.id)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        // 42703 = column not yet migrated on this DB; fall through to
        // the un-filtered query so a freshly-rolled-back environment
        // doesn't break the screen.
        const isMissingColumn =
          (error as any).code === '42703' ||
          /is_dismissed/i.test(error.message);
        if (isMissingColumn) {
          const fallback = await supabase
            .from('piktag_notifications')
            .select('id, user_id, type, title, body, data, is_read, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50);
          if (!fallback.error && fallback.data) {
            setCache(CACHE_KEYS.NOTIFICATIONS, fallback.data);
            setNotifications(fallback.data);
          }
          return;
        }
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

  // Realtime subscription for new notifications. Also keeps the app
  // icon badge fresh — when a new row lands in real-time, recompute
  // unread count and apply.
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
          refreshBadgeFromServer(user.id).catch(() => {});
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
      return;
    }
    // One row got read → recompute badge so the icon catches up.
    if (user) {
      refreshBadgeFromServer(user.id).catch(() => {});
    }
  }, [fetchNotifications, user]);

  // Apple Guideline 1.2: long-press a notification to report the actor
  // or the notification itself.
  const submitNotifReport = useCallback(
    async (notif: Notification, reason: string) => {
      if (!user) return;
      const reportedId = notif.data?.actor_user_id || notif.data?.user_id || null;
      // System / magic-moment notifications have no actor — inserting
      // reported_id: null created junk un-actionable reports (and
      // showed a false "Reported" success even when it failed). Bail
      // with an explanation instead.
      if (!reportedId) {
        Alert.alert(
          t('common.error', { defaultValue: '錯誤' }),
          t('report.noTarget', { defaultValue: '這則通知沒有可檢舉的對象。' }),
        );
        return;
      }
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

  // Row-level dismiss — IG model: "I saw this, hide it" without
  // permanently silencing the underlying recommendation generator.
  // Optimistic — strip the row from state immediately; persist via
  // is_dismissed=true so a refresh doesn't bring it back.
  const handleDismissRow = useCallback(
    async (notifId: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
      if (user) {
        refreshBadgeFromServer(user.id).catch(() => {});
      }
      // Set both flags. is_dismissed hides the row from future
      // fetches; is_read makes sure the badge query (which now
      // filters by is_read=false AND is_dismissed=false) drops
      // this row even on the migration-not-yet-applied fallback
      // path. Defense in depth — same intent, two backstops.
      const { error } = await supabase
        .from('piktag_notifications')
        .update({ is_dismissed: true, is_read: true })
        .eq('id', notifId);
      if (error) {
        const isMissingColumn =
          (error as any).code === '42703' || /is_dismissed/i.test(error.message);
        if (!isMissingColumn) {
          console.warn('[Notifications] dismiss failed:', error.message);
        }
      }
    },
    [user],
  );

  // Person-level dismiss — "don't suggest [name] again". Writes to
  // piktag_match_dismissals (filters future Recommended-side
  // surfaces for 60 days) AND drops this row from view. Only
  // exposed for recommendation / reconnect_suggest where the
  // notification has a single clear target person (ask_bridge has
  // multiple bridges, tag_convergence/tag_combo/ask_prompt have no
  // person — those types skip this menu item entirely).
  const handleDontSuggestPerson = useCallback(
    async (notif: Notification, targetId: string, surface: string) => {
      // Drop the row first for snappy UX.
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      if (user) refreshBadgeFromServer(user.id).catch(() => {});

      // Best-effort dual write. Either failure mode degrades to the
      // other: if match_dismissals fails the row at least stays hidden;
      // if is_dismissed fails the future-suggestion silence still works.
      void supabase
        .from('piktag_match_dismissals')
        .upsert(
          [{ target_id: targetId, surface }],
          { onConflict: 'viewer_id,target_id,surface' },
        )
        .then(({ error }) => {
          if (error) {
            const code = (error as any).code;
            if (code !== '42P01' && code !== 'PGRST205') {
              console.warn('[Notifications] match_dismissal failed:', error.message);
            }
          }
        });
      void supabase
        .from('piktag_notifications')
        .update({ is_dismissed: true, is_read: true })
        .eq('id', notif.id)
        .then(({ error }) => {
          if (error) {
            const code = (error as any).code;
            if (code !== '42703') {
              console.warn('[Notifications] row-dismiss failed:', error.message);
            }
          }
        });
    },
    [user],
  );

  // For person-anchored magic moments only — extract (target_id,
  // surface) from the notification's data JSONB. Returns null when
  // the type isn't a person-anchored suggestion, so the long-press
  // menu can conditionally show / hide the "Don't suggest" option.
  const personTargetForNotification = useCallback(
    (notif: Notification): { id: string; name: string; surface: string } | null => {
      const data = (notif.data ?? {}) as Record<string, any>;
      if (notif.type === 'recommendation' && typeof data.recommended_user_id === 'string') {
        return {
          id: data.recommended_user_id,
          name: data.username || data.full_name || '',
          surface: 'recommendation',
        };
      }
      if (notif.type === 'reconnect_suggest' && typeof data.friend_id === 'string') {
        return {
          id: data.friend_id,
          name: data.friend_full_name || data.friend_username || '',
          surface: 'reconnect_suggest',
        };
      }
      return null;
    },
    [],
  );

  const handleNotificationLongPress = useCallback(
    (notif: Notification) => {
      const hideLabel = t('notifications.hideRow', { defaultValue: 'Hide this notification' });
      const reportLabel = t('report.reportNotification', { defaultValue: 'Report this notification' });
      const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });

      const person = personTargetForNotification(notif);
      const dontSuggestLabel = person
        ? t('notifications.dontSuggestPerson', {
            name: person.name || t('notifications.thisPerson', { defaultValue: 'this person' }),
            defaultValue: "Don't suggest {{name}} again",
          })
        : null;

      // Order: [Hide, (Don't suggest)?, Report, Cancel]
      // Hide first because it's the lightest action and the most
      // common intent. Report last with destructive styling.
      type Item = { label: string; action: () => void; destructive?: boolean };
      const items: Item[] = [
        { label: hideLabel, action: () => void handleDismissRow(notif.id) },
      ];
      if (dontSuggestLabel && person) {
        items.push({
          label: dontSuggestLabel,
          action: () => void handleDontSuggestPerson(notif, person.id, person.surface),
        });
      }
      items.push({
        label: reportLabel,
        action: () => promptNotifReportReason(notif),
        destructive: true,
      });

      const reportIdx = items.findIndex((i) => i.destructive);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...items.map((i) => i.label), cancelLabel],
            destructiveButtonIndex: reportIdx >= 0 ? reportIdx : undefined,
            cancelButtonIndex: items.length,
          },
          (idx) => {
            if (idx >= 0 && idx < items.length) items[idx].action();
          },
        );
      } else {
        Alert.alert('', '', [
          ...items.map((i) => ({ text: i.label, onPress: i.action })),
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [promptNotifReportReason, t, handleDismissRow, handleDontSuggestPerson, personTargetForNotification],
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
        tintColor={colors.piktag500}
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
          <MessageCircle size={24} color={colors.gray900} strokeWidth={2} />
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: c.gray900,
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
    backgroundColor: c.red500,
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
    borderBottomColor: c.gray100,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: SPACING.lg,
    marginRight: SPACING.xl,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: c.piktag500,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '500',
    color: c.gray400,
  },
  tabTextActive: {
    color: c.piktag500,
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
    borderBottomColor: c.gray100,
    backgroundColor: c.white,
  },
  notificationItemUnread: {
    backgroundColor: c.piktag50,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.gray100,
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
    color: c.gray700,
    lineHeight: 20,
  },
  notificationUsername: {
    fontWeight: '700',
    color: c.gray900,
  },
  notificationTime: {
    fontSize: 12,
    color: c.gray400,
    marginTop: 4,
  },
  // Row footer (timestamp). Used to contain an inline "認同" CTA
  // for endorsement_request rows; removed 2026-05-30 (CLAUDE.md
  // "No rubber-stamp social buttons"). Keeping the flex layout so
  // future passive metadata (e.g. "3 friends also tagged this")
  // has a place to land on the right side.
  notificationFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    // accentPop — the unread dot is a primary "notification dot"
    // surface, exactly the case the design system reserves the
    // high-saturation accent for.
    backgroundColor: c.accentPop,
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
    color: c.gray500,
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
}
