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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Hash, CheckCircle2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type TagDetailScreenProps = {
  navigation: any;
  route: any;
};

type ConnectionWithProfile = {
  id: string;
  connected_user_id: string;
  nickname: string | null;
  note: string | null;
  met_at: string | null;
  met_location: string | null;
  connected_user: {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
    is_verified: boolean;
  } | null;
};

export default function TagDetailScreen({ navigation, route }: TagDetailScreenProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tagId = route.params?.tagId;
  const tagName = route.params?.tagName;

  const [connections, setConnections] = useState<ConnectionWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [usageCount, setUsageCount] = useState(0);

  const fetchTagConnections = useCallback(async () => {
    if (!user || !tagId) return;

    try {
      setLoading(true);

      // Get connection IDs that have this tag
      const { data: tagData, error: tagError } = await supabase
        .from('piktag_connection_tags')
        .select('connection_id')
        .eq('tag_id', tagId);

      if (tagError || !tagData || tagData.length === 0) {
        setConnections([]);
        setUsageCount(0);
        return;
      }

      const connectionIds = tagData.map((ct: any) => ct.connection_id);

      // Fetch those connections with profile data (only user's own connections)
      const { data: connectionsData, error: connError } = await supabase
        .from('piktag_connections')
        .select('*, connected_user:piktag_profiles!connected_user_id(*)')
        .eq('user_id', user.id)
        .in('id', connectionIds)
        .order('created_at', { ascending: false });

      if (connError) {
        console.error('Error fetching tag connections:', connError);
        setConnections([]);
      } else {
        setConnections(connectionsData || []);
      }
      setUsageCount(tagData.length);
    } catch (err) {
      console.error('Unexpected error:', err);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [user, tagId]);

  useEffect(() => {
    fetchTagConnections();
  }, [fetchTagConnections]);

  const renderItem = useCallback(({ item }: { item: ConnectionWithProfile }) => {
    const profile = item.connected_user;
    const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
    const username = profile?.username || '';
    const verified = profile?.is_verified || false;
    const avatarUri = profile?.avatar_url
      || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f3f4f6&color=6b7280`;

    return (
      <TouchableOpacity
        style={styles.connectionItem}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('FriendDetail', {
          connectionId: item.id,
          friendId: item.connected_user_id,
        })}
      >
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
        <View style={styles.textSection}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            {verified && (
              <CheckCircle2
                size={16}
                color={COLORS.blue500}
                fill={COLORS.blue500}
                strokeWidth={0}
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
          {username ? (
            <Text style={styles.username}>@{username}</Text>
          ) : null}
          {item.met_location ? (
            <Text style={styles.metLocation} numberOfLines={1}>{item.met_location}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  const keyExtractor = useCallback((item: ConnectionWithProfile) => item.id, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.tagBadge}>
            <Hash size={18} color={COLORS.piktag600} strokeWidth={2.5} />
            <Text style={styles.tagTitle}>{tagName || t('tagDetail.unknownTag')}</Text>
          </View>
          <Text style={styles.tagSubtitle}>
            {t('tagDetail.usageCount', { count: usageCount })}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <FlatList
          data={connections}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.listContent,
            connections.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Hash size={48} color={COLORS.gray300} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>{t('tagDetail.emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('tagDetail.emptyText')}</Text>
            </View>
          }
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  tagSubtitle: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  textSection: {
    flex: 1,
    marginLeft: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    lineHeight: 22,
  },
  username: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 1,
  },
  metLocation: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray700,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
});
