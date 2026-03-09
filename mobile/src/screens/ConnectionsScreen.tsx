import React, { useState, useCallback } from 'react';
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
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import * as Location from 'expo-location';
import type { Connection, ConnectionTag } from '../types';

type ConnectionWithTags = Connection & {
  tags: string[];
};

type SortOption = 'newest' | 'oldest' | 'alpha' | 'updated' | 'nearby';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'newest', label: '從新到舊' },
  { key: 'oldest', label: '從舊到新' },
  { key: 'alpha', label: '依字母排序' },
  { key: 'updated', label: '最近更新' },
  { key: 'nearby', label: '依目前地點排列' },
];

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

type ConnectionsScreenProps = {
  navigation: any;
};

export default function ConnectionsScreen({ navigation }: ConnectionsScreenProps) {
  const { user } = useAuth();
  const [connections, setConnections] = useState<ConnectionWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // Daily recommendation
  const [recommendation, setRecommendation] = useState<any>(null);
  const [recDismissed, setRecDismissed] = useState(false);

  // On this day
  const [onThisDay, setOnThisDay] = useState<any[]>([]);
  const [onThisDayDismissed, setOnThisDayDismissed] = useState(false);

  // CRM reminders
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

  const fetchConnections = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);

      const { data: connectionsData, error: connectionsError } = await supabase
        .from('piktag_connections')
        .select('*, connected_user:piktag_profiles!connected_user_id(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (connectionsError) {
        console.error('Error fetching connections:', connectionsError);
        setConnections([]);
        return;
      }

      if (!connectionsData || connectionsData.length === 0) {
        setConnections([]);
        return;
      }

      const connectionIds = connectionsData.map((c: Connection) => c.id);
      const { data: tagsData, error: tagsError } = await supabase
        .from('piktag_connection_tags')
        .select('*, tag:piktag_tags!tag_id(*)')
        .in('connection_id', connectionIds);

      if (tagsError) {
        console.error('Error fetching connection tags:', tagsError);
      }

      const tagsByConnection: Record<string, string[]> = {};
      if (tagsData) {
        for (const ct of tagsData as ConnectionTag[]) {
          if (!tagsByConnection[ct.connection_id]) {
            tagsByConnection[ct.connection_id] = [];
          }
          if (ct.tag?.name) {
            tagsByConnection[ct.connection_id].push(`#${ct.tag.name}`);
          }
        }
      }

      const merged: ConnectionWithTags[] = connectionsData.map((conn: Connection) => ({
        ...conn,
        tags: tagsByConnection[conn.id] || [],
      }));

      setConnections(merged);
    } catch (err) {
      console.error('Unexpected error fetching connections:', err);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

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

  const fetchOnThisDay = useCallback(async () => {
    if (!user) return;
    try {
      const today = new Date();
      const month = today.getMonth() + 1;
      const day = today.getDate();
      // Query connections whose met_at has same month/day but different year
      const { data } = await supabase
        .from('piktag_connections')
        .select('*, connected_user:piktag_profiles!connected_user_id(*)')
        .eq('user_id', user.id)
        .not('met_at', 'is', null);

      if (data) {
        const matches = data.filter((c: any) => {
          if (!c.met_at) return false;
          const metDate = new Date(c.met_at);
          return metDate.getMonth() + 1 === month &&
                 metDate.getDate() === day &&
                 metDate.getFullYear() !== today.getFullYear();
        });
        setOnThisDay(matches);
      }
    } catch (err) {
      console.warn('Failed to fetch On This Day:', err);
    }
  }, [user]);

  const fetchCrmReminders = useCallback(async () => {
    if (!user) return;
    try {
      const today = new Date();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const mmdd = `${month}-${day}`;

      // Find connections with birthday/anniversary/contract_expiry matching today's MM-DD
      const { data } = await supabase
        .from('piktag_connections')
        .select('*, connected_user:piktag_profiles!connected_user_id(*)')
        .eq('user_id', user.id);

      if (data) {
        const reminders: any[] = [];
        for (const c of data) {
          if (c.birthday && c.birthday.slice(5) === mmdd) {
            reminders.push({ ...c, reminderType: 'birthday', reminderLabel: '生日' });
          }
          if (c.anniversary && c.anniversary.slice(5) === mmdd) {
            reminders.push({ ...c, reminderType: 'anniversary', reminderLabel: '紀念日' });
          }
          if (c.contract_expiry && c.contract_expiry.slice(5) === mmdd) {
            reminders.push({ ...c, reminderType: 'contract_expiry', reminderLabel: '合約到期' });
          }
        }
        setCrmReminders(reminders);
      }
    } catch (err) {
      console.warn('Failed to fetch CRM reminders:', err);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      fetchConnections();
      fetchRecommendation();
      fetchOnThisDay();
      fetchCrmReminders();
    }, [fetchConnections, fetchRecommendation, fetchOnThisDay, fetchCrmReminders])
  );

  const getSortedConnections = useCallback(() => {
    const sorted = [...connections];
    switch (sortBy) {
      case 'newest':
        sorted.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      case 'oldest':
        sorted.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        break;
      case 'alpha':
        sorted.sort((a, b) => {
          const nameA = (
            a.nickname ||
            a.connected_user?.full_name ||
            a.connected_user?.username ||
            ''
          ).toLowerCase();
          const nameB = (
            b.nickname ||
            b.connected_user?.full_name ||
            b.connected_user?.username ||
            ''
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

  const handleConnectionPress = (item: ConnectionWithTags) => {
    if (selectMode) {
      toggleSelection(item.id);
    } else {
      navigation.navigate('FriendDetail', {
        connectionId: item.id,
        friendId: item.connected_user_id,
      });
    }
  };

  const handleConnectionLongPress = (item: ConnectionWithTags) => {
    if (!selectMode) {
      setSelectMode(true);
      setSelectedIds(new Set([item.id]));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const selectAll = () => {
    setSelectedIds(new Set(connections.map((c) => c.id)));
  };

  const handleBatchTagSubmit = async () => {
    const tagName = batchTagInput.trim().replace(/^#/, '');
    if (!tagName || selectedIds.size === 0) return;

    setBatchTagLoading(true);
    try {
      // Find or create the tag
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

      // Insert connection_tags for all selected connections (skip duplicates)
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
          // Also update own profile with location
          if (user) {
            supabase
              .from('piktag_profiles')
              .update({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
              .eq('id', user.id)
              .then(() => {});
          }
        } else {
          Alert.alert('位置權限', '需要位置權限才能依地點排列');
          return;
        }
      } catch {
        Alert.alert('錯誤', '無法取得目前位置');
        return;
      }
    }
    setSortBy(option);
    setSortModalVisible(false);
  };

  const renderItem = ({ item }: { item: ConnectionWithTags }) => {
    const profile = item.connected_user;
    const displayName = item.nickname || profile?.full_name || profile?.username || 'Unknown';
    const username = profile?.username || '';
    const verified = profile?.is_verified || false;
    const avatarUri = profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f3f4f6&color=6b7280`;
    const isSelected = selectedIds.has(item.id);

    return (
      <TouchableOpacity
        style={[styles.connectionItem, isSelected && styles.connectionItemSelected]}
        activeOpacity={0.7}
        onPress={() => handleConnectionPress(item)}
        onLongPress={() => handleConnectionLongPress(item)}
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
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
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
                <Text key={index} style={styles.tag}>
                  {tag}
                </Text>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {'還沒有人脈，去搜尋認識新朋友吧！'}
        </Text>
      </View>
    );
  };

  const sortedConnections = getSortedConnections();

  const renderOnThisDay = () => {
    if (onThisDay.length === 0 || onThisDayDismissed || selectMode) return null;
    return (
      <View style={styles.onThisDayCard}>
        <View style={styles.recHeader}>
          <View style={styles.recHeaderLeft}>
            <CalendarHeart size={16} color="#a855f7" />
            <Text style={[styles.recHeaderText, { color: '#a855f7' }]}>{'歷史上的今天'}</Text>
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
          const yearsAgo = metYear ? new Date().getFullYear() - metYear : 0;
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
                  {yearsAgo > 0 ? `${yearsAgo} 年前的今天認識` : '今天認識'}
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
            <Text style={[styles.recHeaderText, { color: '#ec4899' }]}>{'今日提醒'}</Text>
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
            <Text style={styles.recHeaderText}>{'今日推薦人脈'}</Text>
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
                {recommendation.shared_tag_count}{'個共同標籤'}
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header: normal or select mode */}
      {selectMode ? (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>
              {'已選取 '}{selectedIds.size}{' 位'}
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
            <Text style={styles.headerTitle}>#{new Date().getFullYear()}年{new Date().getMonth() + 1}月{new Date().getDate()}日</Text>
            <Text style={styles.headerSubtitle}>#台北市大安區</Text>
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            connections.length === 0 && styles.listContentEmpty,
            selectMode && { paddingBottom: 160 },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={() => (
            <>
              {renderCrmReminders()}
              {renderOnThisDay()}
              {renderRecommendation()}
            </>
          )}
          ListEmptyComponent={renderEmpty}
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
              {'批次加標籤 ('}{selectedIds.size}{')'}
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
            <Text style={styles.sortModalTitle}>{'排序方式'}</Text>
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
              {'為 '}{selectedIds.size}{' 位好友加標籤'}
            </Text>
            <TextInput
              style={styles.batchTagInput}
              placeholder="輸入標籤名稱（例如：尾牙）"
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
                {batchTagLoading ? '處理中...' : '確認'}
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
