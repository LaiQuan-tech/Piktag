import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Image, TextInput, Pressable, StyleSheet, StatusBar,
  ActivityIndicator, Dimensions, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import { X, Check, Tag, MapPin, Calendar } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import type { PiktagProfile } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

type ReviewConnection = {
  id: string;
  connected_user_id: string;
  nickname: string | null;
  met_at: string;
  met_location: string;
  profile: PiktagProfile | null;
  existingTags: string[];
};

type Props = { navigation: any; route: any };

export default function ActivityReviewScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const sessionId = route.params?.sessionId;
  const recentMinutes = route.params?.recentMinutes || 60;

  const [connections, setConnections] = useState<ReviewConnection[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState('');
  const [addedTags, setAddedTags] = useState<Map<string, string[]>>(new Map());
  const [totalTagsAdded, setTotalTagsAdded] = useState(0);
  const [sessionInfo, setSessionInfo] = useState<{ date: string; location: string } | null>(null);

  // Swipe animation
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const cardOpacity = useSharedValue(1);

  // Fetch connections
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        let query = supabase
          .from('piktag_connections')
          .select('id, connected_user_id, nickname, met_at, met_location, connected_user:piktag_profiles!connected_user_id(id, username, full_name, avatar_url, bio, is_verified)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (sessionId) {
          query = query.eq('scan_session_id', sessionId);
          // Also fetch session info
          const { data: session } = await supabase
            .from('piktag_scan_sessions')
            .select('event_date, event_location')
            .eq('id', sessionId)
            .single();
          if (session) setSessionInfo({ date: session.event_date, location: session.event_location });
        } else {
          // Recent connections (last N minutes)
          const since = new Date(Date.now() - recentMinutes * 60 * 1000).toISOString();
          query = query.gte('created_at', since);
        }

        const { data } = await query.limit(50);
        if (data) {
          // Fetch existing tags for each connection
          const connIds = data.map((c: any) => c.id);
          const { data: tagData } = await supabase
            .from('piktag_connection_tags')
            .select('connection_id, tag:piktag_tags!tag_id(name)')
            .in('connection_id', connIds)
            .eq('is_private', true);

          const tagMap = new Map<string, string[]>();
          if (tagData) {
            for (const ct of tagData) {
              const name = (ct as any).tag?.name;
              if (!name) continue;
              const arr = tagMap.get(ct.connection_id) || [];
              arr.push(name);
              tagMap.set(ct.connection_id, arr);
            }
          }

          setConnections(data.map((c: any) => ({
            id: c.id,
            connected_user_id: c.connected_user_id,
            nickname: c.nickname,
            met_at: c.met_at,
            met_location: c.met_location,
            profile: c.connected_user,
            existingTags: tagMap.get(c.id) || [],
          })));
        }
      } catch (err) {
        console.warn('[ActivityReview] fetch error:', err);
      }
      setLoading(false);
    })();
  }, [user, sessionId, recentMinutes]);

  // Add tag to current connection
  const handleAddTag = useCallback(async () => {
    if (!tagInput.trim() || currentIndex >= connections.length) return;
    const conn = connections[currentIndex];
    const rawTag = tagInput.trim().replace(/^#/, '');

    // Find or create tag
    let { data: tag } = await supabase.from('piktag_tags').select('id').eq('name', rawTag).maybeSingle();
    if (!tag) {
      const { data: newTag } = await supabase.from('piktag_tags').insert({ name: rawTag }).select('id').single();
      tag = newTag;
    }
    if (tag) {
      await supabase.from('piktag_connection_tags').insert({
        connection_id: conn.id, tag_id: tag.id, is_private: true,
      }).catch(() => {});

      // Track locally
      setAddedTags(prev => {
        const next = new Map(prev);
        const arr = next.get(conn.id) || [];
        arr.push(rawTag);
        next.set(conn.id, arr);
        return next;
      });
      setTotalTagsAdded(prev => prev + 1);
    }
    setTagInput('');
  }, [tagInput, currentIndex, connections]);

  // Go to next card
  const goNext = useCallback(() => {
    translateX.value = withTiming(0, { duration: 200 });
    rotate.value = withTiming(0, { duration: 200 });
    cardOpacity.value = withTiming(1, { duration: 200 });
    setCurrentIndex(prev => prev + 1);
    setTagInput('');
  }, []);

  // Swipe away animation then next
  const swipeAway = useCallback((direction: 'left' | 'right') => {
    const target = direction === 'left' ? -SCREEN_WIDTH * 1.5 : SCREEN_WIDTH * 1.5;
    translateX.value = withTiming(target, { duration: 300 });
    cardOpacity.value = withTiming(0, { duration: 300 });
    setTimeout(() => {
      runOnJS(goNext)();
    }, 320);
  }, [goNext]);

  // Pan gesture for swipe
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
      rotate.value = e.translationX / SCREEN_WIDTH * 15; // max 15 degrees
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        runOnJS(swipeAway)(e.translationX > 0 ? 'right' : 'left');
      } else {
        translateX.value = withSpring(0);
        rotate.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: cardOpacity.value,
  }));

  // Current connection
  const current = currentIndex < connections.length ? connections[currentIndex] : null;
  const currentAddedTags = current ? (addedTags.get(current.id) || []) : [];
  const allTags = current ? [...current.existingTags, ...currentAddedTags] : [];
  const isComplete = currentIndex >= connections.length && !loading;

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={COLORS.piktag500} style={{ flex: 1 }} />
      </View>
    );
  }

  if (connections.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t('activityReview.noNewFriends') || '沒有需要整理的新朋友'}</Text>
          <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneBtnText}>{t('common.done') || '完成'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Complete summary
  if (isComplete) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.summaryContainer}>
          <Check size={64} color={COLORS.piktag500} />
          <Text style={styles.summaryTitle}>{t('activityReview.summaryTitle') || '整理完成'}</Text>
          <Text style={styles.summaryText}>
            {t('activityReview.summaryText', { people: connections.length, tags: totalTagsAdded }) ||
              `已整理 ${connections.length} 位朋友，加了 ${totalTagsAdded} 個標籤`}
          </Text>
          <Pressable style={styles.doneBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.doneBtnText}>{t('common.done') || '完成'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const profile = current!.profile;
  const name = current!.nickname || profile?.full_name || profile?.username || '?';
  const avatarUri = profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=374151&size=200`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <X size={24} color={COLORS.gray900} />
        </Pressable>
        <View style={styles.headerCenter}>
          {sessionInfo && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {sessionInfo.location || sessionInfo.date}
            </Text>
          )}
          <Text style={styles.headerCount}>{currentIndex + 1} / {connections.length}</Text>
        </View>
        <Pressable onPress={goNext} style={styles.skipBtn}>
          <Text style={styles.skipText}>{t('activityReview.skip') || '跳過'}</Text>
        </Pressable>
      </View>

      {/* Card */}
      <View style={styles.cardContainer}>
        <GestureDetector gesture={panGesture}>
          <Animated.View style={[styles.card, cardStyle]}>
            <Image source={{ uri: avatarUri }} style={styles.cardAvatar} />
            <Text style={styles.cardName}>{name}</Text>
            {profile?.username && <Text style={styles.cardUsername}>@{profile.username}</Text>}
            {profile?.bio && <Text style={styles.cardBio} numberOfLines={2}>{profile.bio}</Text>}

            {/* Met info */}
            <View style={styles.metRow}>
              {current!.met_location ? (
                <View style={styles.metItem}>
                  <MapPin size={14} color={COLORS.gray400} />
                  <Text style={styles.metText}>{current!.met_location}</Text>
                </View>
              ) : null}
            </View>

            {/* Tags */}
            {allTags.length > 0 && (
              <View style={styles.tagChips}>
                {allTags.map((tag, i) => (
                  <View key={`${tag}-${i}`} style={styles.tagChip}>
                    <Text style={styles.tagChipText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      {/* Tag input */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inputRow}>
          <Tag size={18} color={COLORS.gray400} />
          <TextInput
            style={styles.textInput}
            placeholder={t('activityReview.addTagPlaceholder') || '加隱藏標籤...'}
            placeholderTextColor={COLORS.gray400}
            value={tagInput}
            onChangeText={setTagInput}
            returnKeyType="done"
            onSubmitEditing={handleAddTag}
          />
          <Pressable style={styles.addBtn} onPress={handleAddTag}>
            <Text style={styles.addBtnText}>{t('common.add') || '新增'}</Text>
          </Pressable>
        </View>
        <Text style={styles.swipeHint}>{t('activityReview.swipeHint') || '← 左滑跳過 · 右滑下一位 →'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  closeBtn: { padding: 4 },
  headerCenter: { alignItems: 'center' },
  headerSubtitle: { fontSize: 13, color: COLORS.gray500 },
  headerCount: { fontSize: 15, fontWeight: '700', color: COLORS.gray900 },
  skipBtn: { padding: 4 },
  skipText: { fontSize: 15, fontWeight: '600', color: COLORS.gray500 },
  // Card
  cardContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  card: {
    width: '100%', backgroundColor: COLORS.white, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.gray100,
    padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  cardAvatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.gray100, marginBottom: 16 },
  cardName: { fontSize: 22, fontWeight: '700', color: COLORS.gray900, marginBottom: 4 },
  cardUsername: { fontSize: 15, color: COLORS.gray500, marginBottom: 8 },
  cardBio: { fontSize: 14, color: COLORS.gray600, textAlign: 'center', lineHeight: 20, marginBottom: 12, paddingHorizontal: 10 },
  metRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  metItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metText: { fontSize: 13, color: COLORS.gray500 },
  tagChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  tagChip: { backgroundColor: COLORS.piktag50, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.piktag400 },
  tagChipText: { fontSize: 13, fontWeight: '500', color: COLORS.piktag600 },
  // Input
  inputBar: { paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.gray100 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray100, borderRadius: 20, paddingLeft: 14, paddingRight: 4, height: 44, gap: 8 },
  textInput: { flex: 1, fontSize: 15, color: COLORS.gray900, padding: 0 },
  addBtn: { backgroundColor: COLORS.piktag500, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.white },
  swipeHint: { fontSize: 12, color: COLORS.gray400, textAlign: 'center', marginTop: 8 },
  // Empty + Summary
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.gray500 },
  summaryContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  summaryTitle: { fontSize: 24, fontWeight: '700', color: COLORS.gray900 },
  summaryText: { fontSize: 16, color: COLORS.gray600 },
  doneBtn: { backgroundColor: COLORS.piktag500, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  doneBtnText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
});
