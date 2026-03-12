import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Settings2,
  MapPin,
  CheckCircle2,
  Check,
  X,
  Tag,
  CheckSquare,
  Square,
  Sparkles,
  UserPlus,
  CalendarHeart,
  Gift,
  Heart,
  Clock,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import * as Location from 'expo-location';
import type { Connection, ConnectionTag } from '../types';

type ConnectionWithTags = Connection & {
  tags: string[];
};

type SortOption = 'newest' | 'oldest' | 'alpha' | 'updated' | 'nearby';

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Memoized list item component ---
type ConnectionItemProps = {
  item: ConnectionWithTags;
  isSelected: boolean;
  selectMode: boolean;
  onPress: (item: ConnectionWithTags) => void;
  onLongPress: (item: ConnectionWithTags) => void;
};

const ConnectionItem = React.memo(({ item, isSelected, selectMode, onPress, onLongPress }: ConnectionItemProps) => {
  const profile = item.connected_user;
  const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
  const username = profile?.username || '';
  const verified = profile?.is_verified || false;
  const avatarUri = profile?.avatar_url
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f3f4f6&color=6b7280`;

  return (
    <TouchableOpacity
      style={[styles.connectionItem, isSelected && styles.connectionItemSelected]}
      activeOpacity={0.7}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
    >
      {selectMode && (
        <View style={styles.checkboxContainer}>
          {isSelected ? (
            <CheckSquare size={22} color={COLORS.piktag600} />
          ) : (
            <Square size={22} color={COLORS.gray400} />
          )}
        </View>
      )}
      <Image source={{ uri: avatarUri }} style={styles.avatar} />
      <View style={styles.textSection}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        <View style={styles.usernameRow}>
          <Text style={styles.username}>@{username}</Text>
          {verified && (
            <CheckCircle2
              size={16}
              color={COLORS.blue500}
              fill={COLORS.blue500}
              strokeWidth={0}
              style={styles.verifiedIcon}
            />
          )}
        </View>
        {item.tags.length > 0 && (
          <View style={styles.tagsRow}>
            {item.tags.map((tag, index) => (
              <Text key={index} style={styles.tag}>{tag}</Text>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

type ConnectionsScreenProps = {
  navigation: any;
};

export default function ConnectionsScreen({ navigation }: ConnectionsScreenProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const SORT_OPTIONS = useMemo(() => [
    { key: 'newest' as SortOption, label: t('connections.sortNewest') },
    { key: 'oldest' as SortOption, label: t('connections.sortOldest') },
    { key: 'alpha' as SortOption, label: t('connections.sortAlpha') },
    { key: 'updated' as SortOption, label: t('connections.sortUpdated') },
    { key: 'nearby' as SortOption, label: t('connections.sortNearby') },
  ], [t]);

  const [connections, setConnections] = useState<ConnectionWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // Daily recommendation
  const [recommendation, setRecommendation] = useState<any>(null);
  const [recDismissed, setRecDismissed] = useState(false);

  // On this day (derived from connections data)
  const [onThisDay, setOnThisDay] = useState<any[]>([]);
  const [onThisDayDismissed, setOnThisDayDismissed] = useState(false);

  // CRM reminders (derived from connections data)
  const [crmReminders, setCrmReminders] = useState<any[]>([]);
  const [remindersDismissed, setRemindersDismissed] = useState(false);

  // Batch selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchTagModalVisible, setBatchTagModalVisible] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagLoading, setBatchTagLoading] = useState(false);

  // Location state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // --- Optimized: single nested-select query for connections + tags ---
  const fetchConnections = useCallback(async () => {
    if (!user) return;

    try {
      // Single query: connections + profiles + tags (nested select)
      const { data: connectionsData, error: connectionsError } = await supabase
        .from('piktag_connections')
        .select(`
          *,
          connected_user:piktag_profiles!connected_user_id(*),
          connection_tags:piktag_connection_tags(*, tag:piktag_tags!tag_id(*))
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (connectionsError) {
        console.error('Error fetching connections:', connectionsError);
        setConnections([]);
        setOnThisDay([]);
        setCrmReminders([]);
        return;
      }

      if (!connectionsData || connectionsData.length === 0) {
        setConnections([]);
        setOnThisDay([]);
        setCrmReminders([]);
        return;
      }

      // Merge tags from nested select
      const merged: ConnectionWithTags[] = connectionsData.map((conn: any) => ({
        ...conn,
        tags: (conn.connection_tags || [])
          .map((ct: any) => ct.tag?.name ? `#${ct.tag.name}` : '')
          .filter(Boolean),
      }));
      setConnections(merged);

      // --- Derive "On This Day" from already-fetched data (no extra query) ---
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();

      const onThisDayMatches = connectionsData.filter((c: any) => {
        if (!c.met_at) return false;
        const metDate = new Date(c.met_at);
        return metDate.getMonth() + 1 === month &&
               metDate.getDate() === day &&
               metDate.getFullYear() !== today.getFullYear();
      });
      setOnThisDay(onThisDayMatches);

      // --- Derive CRM reminders from already-fetched data (no extra query) ---
      const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const reminderResults: any[] = [];
      for (const c of connectionsData) {
        if (c.birthday && c.birthday.slice(5) === mmdd) {
          reminderResults.push({ ...c, reminderType: 'birthday', reminderLabel: t('connections.reminderBirthday') });
        }
        if (c.anniversary && c.anniversary.slice(5) === mmdd) {
          reminderResults.push({ ...c, reminderType: 'anniversary', reminderLabel: t('connections.reminderAnniversary') });
        }
        if (c.contract_expiry && c.contract_expiry.slice(5) === mmdd) {
          reminderResults.push({ ...c, reminderType: 'contract_expiry', reminderLabel: t('connections.reminderContractExpiry') });
        }
      }
      setCrmReminders(reminderResults);
    } catch (err) {
      console.error('Unexpected error fetching connections:', err);
      setConnections([]);
      setOnThisDay([]);
      setCrmReminders([]);
    }
  }, [user, t]);

  const fetchRecommendation = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .rpc('get_daily_recommendation', { p_user_id: user.id });
      if (!error && data && data.length > 0) {
        setRecommendation(data[0]);
      } else {
        setRecommendation(null);
      }
    } catch {
      setRecommendation(null);
    }
  }, [user]);

  // --- Optimized: Promise.all for parallel execution, unified loading ---
  useFocusEffect(
    useCallback(() => {
      const loadAll = async () => {
        if (!user) return;
        setLoading(true);
        try {
          await Promise.all([
            fetchConnections(),
            fetchRecommendation(),
          ]);
        } finally {
          setLoading(false);
        }
      };
      loadAll();
    }, [user, fetchConnections, fetchRecommendation])
  );

  // --- Optimized: useMemo for sorted connections ---
  const sortedConnections = useMemo(() => {
    const sorted = [...connections];
    switch (sortBy) {
      case 'newest':
        sorted.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case 'oldest':
        sorted.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
      case 'alpha':
        sorted.sort((a, b) => {
          const nameA = (
            a.nickname || a.connected_user?.full_name || a.connected_user?.username || ''
          ).toLowerCase();
          const nameB = (
            b.nickname || b.connected_user?.full_name || b.connected_user?.username || ''
          ).toLowerCase();
          return nameA.localeCompare(nameB, 'zh-Hant');
        });
        break;
      case 'updated':
        sorted.sort(
          (a, b) =>
            new Date(b.updated_at || b.created_at).getTime() -
            new Date(a.updated_at || a.created_at).getTime()
        );
        break;
      case 'nearby':
        if (userLocation) {
          sorted.sort((a, b) => {
            const aLat = a.connected_user?.latitude;
            const aLng = a.connected_user?.longitude;
            const bLat = b.connected_user?.latitude;
            const bLng = b.connected_user?.longitude;
            const aDist =
              aLat != null && aLng != null
                ? haversineDistance(userLocation.latitude, userLocation.longitude, aLat, aLng)
                : Infinity;
            const bDist =
              bLat != null && bLng != null
                ? haversineDistance(userLocation.latitude, userLocation.longitude, bLat, bLng)
                : Infinity;
            return aDist - bDist;
          });
        }
        break;
    }
    return sorted;
  }, [connections, sortBy, userLocation]);

  // --- Optimized: useCallback for handlers ---
  const handleConnectionPress = useCallback((item: ConnectionWithTags) => {
    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    } else {
      navigation.navigate('FriendDetail', {
        connectionId: item.id,
        friendId: item.connected_user_id,
      });
    }
  }, [selectMode, navigation]);

  const handleConnectionLongPress = useCallback((item: ConnectionWithTags) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(new Set([item.id]));
    }
  }, [selectMode]);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(connections.map((c) => c.id)));
  }, [connections]);

  const handleBatchTagSubmit = async () => {
    const tagName = batchTagInput.trim().replace(/^#/, '');
    if (!tagName || selectedIds.size === 0) return;

    setBatchTagLoading(true);
    try {
      let tagId: string;
      const { data: existingTag } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', tagName)
        .single();

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const { data: newTag, error: createErr } = await supabase
          .from('piktag_tags')
          .insert({ name: tagName, created_by: user!.id })
          .select('id')
          .single();
        if (createErr || !newTag) {
          console.error('Error creating tag:', createErr);
          return;
        }
        tagId = newTag.id;
      }

      const rows = Array.from(selectedIds).map((connectionId) => ({
        connection_id: connectionId,
        tag_id: tagId,
      }));

      const { error: insertErr } = await supabase
        .from('piktag_connection_tags')
        .upsert(rows, { onConflict: 'connection_id,tag_id', ignoreDuplicates: true });

      if (insertErr) {
        console.error('Error batch tagging:', insertErr);
      }

      setBatchTagModalVisible(false);
      setBatchTagInput('');
      exitSelectMode();
      fetchConnections();
    } catch (err) {
      console.error('Batch tag error:', err);
    } finally {
      setBatchTagLoading(false);
    }
  };

  const handleSortSelect = async (option: SortOption) => {
    if (option === 'nearby' && !userLocation) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          if (user) {
            supabase
              .from('piktag_profiles')
              .update({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
              .eq('id', user.id)
              .then(() => {});
          }
        } else {
          Alert.alert(t('connections.alertLocationPermTitle'), t('connections.alertLocationPermMessage'));
          return;
        }
      } catch {
        Alert.alert(t('common.error'), t('connections.alertLocationError'));
        return;
      }
    }
    setSortBy(option);
    setSortModalVisible(false);
  };

  // --- Optimized: useCallback renderItem with memoized ConnectionItem ---
  const renderItem = useCallback(({ item }: { item: ConnectionWithTags }) => (
    <ConnectionItem
      item={item}
      isSelected={selectedIds.has(item.id)}
      selectMode={selectMode}
      onPress={handleConnectionPress}
      onLongPress={handleConnectionLongPress}
    />
  ), [selectedIds, selectMode, handleConnectionPress, handleConnectionLongPress]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{t('connections.emptyText')}</Text>
      </View>
    );
  }, [loading, t]);

  // --- Optimized: stable keyExtractor ---
  const keyExtractor = useCallback((item: ConnectionWithTags) => item.id, []);

  // --- Optimized: stable ListHeaderComponent via useMemo ---
  const listHeader = useMemo(() => {
    const renderOnThisDay = () => {
      if (onThisDay.length === 0 || onThisDayDismissed || selectMode) return null;
      return (
        <View style={styles.onThisDayCard}>
          <View style={styles.recHeader}>
            <View style={styles.recHeaderLeft}>
              <CalendarHeart size={16} color="#a855f7" />
              <Text style={[styles.recHeaderText, { color: '#a855f7' }]}>{t('connections.onThisDayTitle')}</Text>
            </View>
            <TouchableOpacity onPress={() => setOnThisDayDismissed(true)} activeOpacity={0.6}>
              <X size={18} color={COLORS.gray400} />
            </TouchableOpacity>
          </View>
          {onThisDay.map((conn) => {
            const profile = conn.connected_user;
            const name = conn.nickname || profile?.full_name || profile?.username || 'Unknown';
            const avatarUri = profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=6b7280`;
            const metYear = conn.met_at ? new Date(conn.met_at).getFullYear() : '';
            const yearsAgo = metYear ? new Date().getFullYear() - (metYear as number) : 0;
            return (
              <TouchableOpacity
                key={conn.id}
                style={styles.recBody}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('FriendDetail', { connectionId: conn.id, friendId: conn.connected_user_id })}
              >
                <Image source={{ uri: avatarUri }} style={styles.recAvatar} />
                <View style={styles.recInfo}>
                  <Text style={styles.recName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.recUsername}>
                    {yearsAgo > 0 ? t('connections.yearsAgoMet', { yearsAgo }) : t('connections.todayMet')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    };

    const renderCrmReminders = () => {
      if (crmReminders.length === 0 || remindersDismissed || selectMode) return null;
      const getIcon = (type: string) => {
        if (type === 'birthday') return <Gift size={16} color="#ec4899" />;
        if (type === 'anniversary') return <Heart size={16} color="#ef4444" />;
        return <Clock size={16} color="#f97316" />;
      };
      return (
        <View style={styles.reminderCard}>
          <View style={styles.recHeader}>
            <View style={styles.recHeaderLeft}>
              <Gift size={16} color="#ec4899" />
              <Text style={[styles.recHeaderText, { color: '#ec4899' }]}>{t('connections.todayReminderTitle')}</Text>
            </View>
            <TouchableOpacity onPress={() => setRemindersDismissed(true)} activeOpacity={0.6}>
              <X size={18} color={COLORS.gray400} />
            </TouchableOpacity>
          </View>
          {crmReminders.map((conn, idx) => {
            const profile = conn.connected_user;
            const name = conn.nickname || profile?.full_name || profile?.username || 'Unknown';
            const avatarUri = profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=6b7280`;
            return (
              <TouchableOpacity
                key={`${conn.id}-${conn.reminderType}`}
                style={styles.recBody}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('FriendDetail', { connectionId: conn.id, friendId: conn.connected_user_id })}
              >
                <Image source={{ uri: avatarUri }} style={styles.recAvatar} />
                <View style={styles.recInfo}>
                  <Text style={styles.recName} numberOfLines={1}>{name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    {getIcon(conn.reminderType)}
                    <Text style={styles.recUsername}>{conn.reminderLabel}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    };

    const renderRecommendation = () => {
      if (!recommendation || recDismissed || selectMode) return null;
      const avatarUri = recommendation.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(recommendation.full_name || recommendation.username || 'U')}&background=f3f4f6&color=6b7280`;
      return (
        <View style={styles.recCard}>
          <View style={styles.recHeader}>
            <View style={styles.recHeaderLeft}>
              <Sparkles size={16} color={COLORS.piktag600} />
              <Text style={styles.recHeaderText}>{t('connections.dailyRecommendationTitle')}</Text>
            </View>
            <TouchableOpacity onPress={() => setRecDismissed(true)} activeOpacity={0.6}>
              <X size={18} color={COLORS.gray400} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.recBody}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('UserDetail', { userId: recommendation.user_id })}
          >
            <Image source={{ uri: avatarUri }} style={styles.recAvatar} />
            <View style={styles.recInfo}>
              <View style={styles.recNameRow}>
                <Text style={styles.recName} numberOfLines={1}>
                  {recommendation.full_name || recommendation.username}
                </Text>
                {recommendation.is_verified && (
                  <CheckCircle2 size={14} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
                )}
              </View>
              <Text style={styles.recUsername}>@{recommendation.username}</Text>
              {recommendation.shared_tag_count > 0 && (
                <Text style={styles.recTagCount}>
                  {recommendation.shared_tag_count}{t('connections.sharedTagCount')}
                </Text>
              )}
            </View>
            <View style={styles.recAction}>
              <UserPlus size={20} color={COLORS.piktag600} />
            </View>
          </TouchableOpacity>
        </View>
      );
    };

    return (
      <>
        {renderCrmReminders()}
        {renderOnThisDay()}
        {renderRecommendation()}
      </>
    );
  }, [onThisDay, onThisDayDismissed, crmReminders, remindersDismissed, recommendation, recDismissed, selectMode, t, navigation]);

  // --- Optimized: stable contentContainerStyle ---
  const contentContainerStyle = useMemo(() => [
    styles.listContent,
    connections.length === 0 && styles.listContentEmpty,
    selectMode && { paddingBottom: 160 },
  ], [connections.length, selectMode]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header: normal or select mode */}
      {selectMode ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>
              {t('connections.selectedCount', { count: selectedIds.size })}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={selectAll}
            >
              <CheckSquare size={24} color={COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={exitSelectMode}
            >
              <X size={24} color={COLORS.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>#{t('connections.headerDate', { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() })}</Text>
            <Text style={styles.headerSubtitle}>{t('connections.headerSubtitle')}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => setSortModalVisible(true)}
            >
              <Settings2 size={24} color={COLORS.gray600} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              activeOpacity={0.6}
              onPress={() => handleSortSelect('nearby')}
            >
              <MapPin size={24} color={sortBy === 'nearby' ? COLORS.piktag600 : COLORS.gray600} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Sort indicator */}
      {!selectMode && sortBy !== 'newest' && (
        <View style={styles.sortIndicator}>
          <Text style={styles.sortIndicatorText}>
            {SORT_OPTIONS.find((o) => o.key === sortBy)?.label}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <FlatList
          data={sortedConnections}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={renderEmpty}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}

      {/* Batch action bar */}
      {selectMode && selectedIds.size > 0 && (
        <View style={styles.batchBar}>
          <TouchableOpacity
            style={styles.batchBtn}
            activeOpacity={0.7}
            onPress={() => setBatchTagModalVisible(true)}
          >
            <Tag size={20} color={COLORS.white} />
            <Text style={styles.batchBtnText}>
              {t('connections.batchTagButton', { count: selectedIds.size })}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sort Modal */}
      <Modal
        visible={sortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSortModalVisible(false)}
        >
          <View style={styles.sortModal}>
            <Text style={styles.sortModalTitle}>{t('connections.sortModalTitle')}</Text>
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={styles.sortOption}
                activeOpacity={0.7}
                onPress={() => handleSortSelect(option.key)}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === option.key && styles.sortOptionTextActive,
                  ]}
                >
                  {option.label}
                </Text>
                {sortBy === option.key && (
                  <Check size={20} color={COLORS.piktag600} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Batch Tag Modal */}
      <Modal
        visible={batchTagModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBatchTagModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setBatchTagModalVisible(false)}
        >
          <View style={styles.batchTagModal}>
            <Text style={styles.sortModalTitle}>
              {t('connections.batchTagModalTitle', { count: selectedIds.size })}
            </Text>
            <TextInput
              style={styles.batchTagInput}
              placeholder={t('connections.batchTagPlaceholder')}
              placeholderTextColor={COLORS.gray400}
              value={batchTagInput}
              onChangeText={setBatchTagInput}
              autoFocus
            />
            <TouchableOpacity
              style={[
                styles.batchTagSubmitBtn,
                (!batchTagInput.trim() || batchTagLoading) && styles.batchTagSubmitBtnDisabled,
              ]}
              activeOpacity={0.7}
              onPress={handleBatchTagSubmit}
              disabled={!batchTagInput.trim() || batchTagLoading}
            >
              <Text style={styles.batchTagSubmitText}>
                {batchTagLoading ? t('common.processing') : t('common.confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
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
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginTop: 2,
    lineHeight: 20,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 4,
  },
  headerIconBtn: {
    padding: 4,
  },
  sortIndicator: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.piktag50,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.piktag100,
  },
  sortIndicatorText: {
    fontSize: 13,
    color: COLORS.piktag600,
    fontWeight: '600',
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 24,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  connectionItemSelected: {
    backgroundColor: COLORS.piktag50,
  },
  checkboxContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    paddingTop: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  textSection: {
    flex: 1,
    marginLeft: 14,
    paddingTop: 2,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 24,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  username: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    gap: 4,
    columnGap: 12,
    rowGap: 4,
  },
  tag: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
  // On This Day card
  onThisDayCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#f5f3ff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  // CRM Reminder card
  reminderCard: {
    margin: 16,
    marginBottom: 0,
    backgroundColor: '#fdf2f8',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fce7f3',
  },
  // Recommendation card
  recCard: {
    margin: 16,
    backgroundColor: COLORS.piktag50,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.piktag100,
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  recHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  recBody: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.gray100,
  },
  recInfo: {
    flex: 1,
    marginLeft: 12,
  },
  recNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  recUsername: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 1,
  },
  recTagCount: {
    fontSize: 12,
    color: COLORS.piktag600,
    marginTop: 2,
  },
  recAction: {
    padding: 8,
  },
  // Batch bar
  batchBar: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  batchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  batchBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  // Sort Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sortModal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  sortModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  sortOptionText: {
    fontSize: 16,
    color: COLORS.gray700,
  },
  sortOptionTextActive: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  // Batch Tag Modal
  batchTagModal: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  batchTagInput: {
    borderWidth: 2,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
    marginBottom: 16,
  },
  batchTagSubmitBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  batchTagSubmitBtnDisabled: {
    opacity: 0.5,
  },
  batchTagSubmitText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
});
