import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, SquarePen } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ChatTabs from '../components/chat/ChatTabs';
import ConversationRow from '../components/chat/ConversationRow';
import { COLORS } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { useChatInbox } from '../hooks/useChatInbox';
import { supabase } from '../lib/supabase';
import type { InboxConversation, InboxTab } from '../types/chat';

// Each screen declares its own param shape so we don't need to touch
// the global RootStack until the app wires these routes up. Typed as
// the narrowest surface we actually use.
type ChatListParamList = {
  ChatList: undefined;
  ChatThread: {
    conversationId: string;
    otherUserId: string;
    otherDisplayName: string;
    otherAvatarUrl?: string | null;
  };
  ChatCompose: { prefilledUserId?: string } | undefined;
};

type Props = {
  navigation: NativeStackNavigationProp<ChatListParamList, 'ChatList'>;
};

function bucket(c: InboxConversation, meId: string): InboxTab {
  if (c.is_connection) return 'primary';
  if (c.initiated_by !== meId && !c.i_have_replied) return 'requests';
  return 'general';
}

type HeaderProfile = {
  username: string | null;
  full_name: string | null;
};

export default function ChatListScreen({ navigation }: Props): JSX.Element {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { conversations, loading, refresh } = useChatInbox();

  const [activeTab, setActiveTab] = useState<InboxTab>('primary');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [headerProfile, setHeaderProfile] = useState<HeaderProfile | null>(null);

  // Pull the viewer's own username for the header. Not in the auth
  // object, so one extra query on mount. Cached implicitly for the
  // life of the screen.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('piktag_profiles')
          .select('username, full_name')
          .eq('id', user.id)
          .single();
        if (cancelled) return;
        if (!error && data) {
          setHeaderProfile({
            username: (data as HeaderProfile).username ?? null,
            full_name: (data as HeaderProfile).full_name ?? null,
          });
        }
      } catch {
        // Non-fatal — header falls back to placeholder below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const buckets = useMemo(() => {
    const primary: InboxConversation[] = [];
    const requests: InboxConversation[] = [];
    const general: InboxConversation[] = [];
    const meId = user?.id;
    if (!meId) return { primary, requests, general };
    for (const c of conversations) {
      const b = bucket(c, meId);
      if (b === 'primary') primary.push(c);
      else if (b === 'requests') requests.push(c);
      else general.push(c);
    }
    return { primary, requests, general };
  }, [conversations, user?.id]);

  const counts = useMemo(
    () => ({
      primary: buckets.primary.length,
      requests: buckets.requests.length,
      general: buckets.general.length,
    }),
    [buckets],
  );

  const visibleList = useMemo(() => {
    if (activeTab === 'primary') return buckets.primary;
    if (activeTab === 'requests') return buckets.requests;
    return buckets.general;
  }, [activeTab, buckets]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleRowPress = useCallback(
    (c: InboxConversation) => {
      navigation.navigate('ChatThread', {
        conversationId: c.id,
        otherUserId: c.other_user_id,
        otherDisplayName: c.other_full_name ?? c.other_username ?? '',
        otherAvatarUrl: c.other_avatar_url,
      });
    },
    [navigation],
  );

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  const handleCompose = useCallback(() => {
    navigation.navigate('ChatCompose');
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxConversation>) => (
      <ConversationRow conversation={item} onPress={handleRowPress} />
    ),
    [handleRowPress],
  );

  const keyExtractor = useCallback((item: InboxConversation) => item.id, []);

  const headerTitle = useMemo(() => {
    if (headerProfile?.username) return `@${headerProfile.username}`;
    if (headerProfile?.full_name) return headerProfile.full_name;
    return t('chat.inbox');
  }, [headerProfile, t]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={COLORS.piktag500}
      />
    ),
    [refreshing, handleRefresh],
  );

  const emptyState = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('chat.emptyInbox')}</Text>
      </View>
    ),
    [t],
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

        <Pressable style={styles.headerTitleWrap} onPress={handleBack}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
        </Pressable>

        <TouchableOpacity
          onPress={handleCompose}
          activeOpacity={0.6}
          style={styles.headerIconBtn}
          accessibilityRole="button"
          accessibilityLabel={t('chat.compose')}
        >
          <SquarePen size={22} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ChatTabs active={activeTab} onChange={setActiveTab} counts={counts} />

      <FlatList
        data={visibleList}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        refreshControl={refreshControl}
        contentContainerStyle={
          visibleList.length === 0 ? styles.listContentEmpty : styles.listContent
        }
        ListEmptyComponent={!loading ? emptyState : null}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
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
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  listContent: {
    paddingBottom: 40,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
  },
});
