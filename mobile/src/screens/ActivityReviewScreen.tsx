import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Image, TextInput, Pressable, StyleSheet, StatusBar,
  Dimensions, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import { X, Check, Tag, MapPin, Calendar, Plus } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
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
  publicTags: string[];   // friend's own public tags (pickable)
  hiddenTags: string[];   // private connection tags
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

export default function ActivityReviewScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const sessionId = route.params?.sessionId;

  const [connections, setConnections] = useState<ReviewConnection[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pickedTags, setPickedTags] = useState<Map<string, Set<string>>>(new Map()); // connId → picked tag names
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
          .eq('is_reviewed', false)
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
        }
        // Otherwise: show ALL unreviewed connections regardless of age
        // (fixes bug where count on main screen would not match detail list)

        const { data } = await query.limit(50);
        if (data) {
          const connIds = data.map((c: any) => c.id);
          const userIds = data.map((c: any) => c.connected_user_id);

          // Run hidden-tags + public-tags fetches in parallel — both
          // depend on `data` but are independent of each other, so the
          // previous sequential await chain wasted ~1 RTT every render.
          const [tagDataResult, publicTagDataResult] = await Promise.all([
            supabase
              .from('piktag_connection_tags')
              .select('connection_id, tag:piktag_tags!tag_id(name)')
              .in('connection_id', connIds)
              .eq('is_private', true),
            supabase
              .from('piktag_user_tags')
              .select('user_id, tag:piktag_tags!tag_id(name)')
              .in('user_id', userIds)
              .eq('is_private', false),
          ]);
          const tagData = tagDataResult.data;
          const publicTagData = publicTagDataResult.data;

          // Hidden tags per connection
          const hiddenTagMap = new Map<string, string[]>();
          if (tagData) {
            for (const ct of tagData) {
              const name = (ct as any).tag?.name;
              if (!name) continue;
              const arr = hiddenTagMap.get(ct.connection_id) || [];
              arr.push(name);
              hiddenTagMap.set(ct.connection_id, arr);
            }
          }

          const publicTagMap = new Map<string, string[]>();
          if (publicTagData) {
            for (const ut of publicTagData) {
              const name = (ut as any).tag?.name;
              if (!name) continue;
              const arr = publicTagMap.get(ut.user_id) || [];
              arr.push(name);
              publicTagMap.set(ut.user_id, arr);
            }
          }

          setConnections(data.map((c: any) => ({
            id: c.id,
            connected_user_id: c.connected_user_id,
            nickname: c.nickname,
            met_at: c.met_at,
            met_location: c.met_location,
            profile: c.connected_user,
            publicTags: publicTagMap.get(c.connected_user_id) || [],
            hiddenTags: hiddenTagMap.get(c.id) || [],
          })));
        }
      } catch (err) {
        console.warn('[ActivityReview] fetch error:', err);
      }
      setLoading(false);
    })();
  }, [user, sessionId]);

  // Toggle pick a public tag
  const handleTogglePick = useCallback(async (tagName: string) => {
    const curr = currentIndex < connections.length ? connections[currentIndex] : null;
    if (!curr) return;
    const connId = curr.id;

    // Determine toggle direction BEFORE updating state
    const wasAlreadyPicked = pickedTags.get(connId)?.has(tagName) || false;
    const isNowPicked = !wasAlreadyPicked;

    setPickedTags(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(connId) || []);
      if (wasAlreadyPicked) {
        set.delete(tagName);
      } else {
        set.add(tagName);
      }
      next.set(connId, set);
      return next;
    });

    // Save to DB: find tag id → upsert/delete connection_tag
    let { data: tag } = await supabase.from('piktag_tags').select('id').eq('name', tagName).maybeSingle();
    if (tag) {
      if (isNowPicked) {
        // Get current max position for this connection
        const { data: existing } = await supabase.from('piktag_connection_tags')
          .select('position').eq('connection_id', connId).order('position', { ascending: false }).limit(1);
        const nextPos = (existing?.[0]?.position ?? -1) + 1;
        await supabase.from('piktag_connection_tags').upsert(
          { connection_id: connId, tag_id: tag.id, is_private: false, position: nextPos },
          { onConflict: 'connection_id,tag_id' }
        );
      } else {
        try {
          await supabase.from('piktag_connection_tags').delete()
            .eq('connection_id', connId).eq('tag_id', tag.id).eq('is_private', false);
        } catch {}
      }
    }
  }, [currentIndex, connections, pickedTags]);

  // Add hidden tag to current connection — optimistic UI first, DB in background
  const handleAddTag = useCallback(() => {
    if (!tagInput.trim() || currentIndex >= connections.length) return;
    const conn = connections[currentIndex];
    const rawTag = tagInput.trim().replace(/^#/, '');
    if (!rawTag) return;

    // Optimistic: show on card immediately
    setAddedTags(prev => {
      const next = new Map(prev);
      const arr = [...(next.get(conn.id) || []), rawTag];
      next.set(conn.id, arr);
      return next;
    });
    setTotalTagsAdded(prev => prev + 1);
    setTagInput('');

    // DB sync in background
    (async () => {
      let { data: tag } = await supabase.from('piktag_tags').select('id').eq('name', rawTag).maybeSingle();
      if (!tag) {
        // Race-safe insert: if another client created the same tag between
        // our select and insert, recover via the unique-violation path
        // instead of silently dropping this activity review.
        const { data: newTag, error: insertErr } = await supabase
          .from('piktag_tags').insert({ name: rawTag }).select('id').single();
        if (newTag) {
          tag = newTag;
        } else if (insertErr && (insertErr as any).code === '23505') {
          const { data: raced } = await supabase
            .from('piktag_tags').select('id').eq('name', rawTag).maybeSingle();
          tag = raced ?? null;
        }
      }
      if (tag) {
        await supabase.from('piktag_connection_tags').insert({
          connection_id: conn.id, tag_id: tag.id, is_private: true,
        });
      }
    })();
  }, [tagInput, currentIndex, connections]);

  // Go to next card
  const goNext = useCallback((markReviewed = true) => {
    // Mark current connection as reviewed in DB
    if (markReviewed && currentIndex < connections.length) {
      const connId = connections[currentIndex].id;
      supabase.from('piktag_connections').update({ is_reviewed: true }).eq('id', connId).then(() => {});
    }
    translateX.value = withTiming(0, { duration: 200 });
    rotate.value = withTiming(0, { duration: 200 });
    cardOpacity.value = withTiming(1, { duration: 200 });
    setCurrentIndex(prev => prev + 1);
    setTagInput('');
  }, [currentIndex, connections]);

  // Swipe away animation then next
  const swipeAway = useCallback((direction: 'left' | 'right') => {
    const target = direction === 'left' ? -SCREEN_WIDTH * 1.5 : SCREEN_WIDTH * 1.5;
    translateX.value = withTiming(target, { duration: 300 });
    cardOpacity.value = withTiming(0, { duration: 300 });
    setTimeout(() => {
      runOnJS(goNext)(true);
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
  const currentPickedSet = current ? (pickedTags.get(current.id) || new Set()) : new Set();
  const isComplete = currentIndex >= connections.length && !loading;

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <PageLoader />
      </View>
    );
  }

  if (connections.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t('activityReview.noNewFriends') || '沒有需要整理的新朋友'}</Text>
          <Pressable onPress={() => navigation.goBack()}>
            <LinearGradient
              colors={['#ff5757', '#c44dff', '#8c52ff']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.doneBtn}
            >
              <Text style={styles.doneBtnText}>{t('common.done') || '完成'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  }

  // Complete summary
  if (isComplete) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
        <View style={styles.summaryContainer}>
          <Check size={64} color={COLORS.piktag500} />
          <Text style={styles.summaryTitle}>{t('activityReview.summaryTitle') || '整理完成'}</Text>
          <Text style={styles.summaryText}>
            {t('activityReview.summaryText', { people: connections.length, tags: totalTagsAdded }) ||
              `已整理 ${connections.length} 位朋友，加了 ${totalTagsAdded} 個標籤`}
          </Text>
          <Pressable onPress={() => navigation.goBack()}>
            <LinearGradient
              colors={['#ff5757', '#c44dff', '#8c52ff']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.doneBtn}
            >
              <Text style={styles.doneBtnText}>{t('common.done') || '完成'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  }

  const profile = current!.profile;
  const name = current!.nickname || profile?.full_name || profile?.username || '?';
  const avatarUri = profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=374151&size=200`;

  return (
    // KeyboardAvoidingView so the bottom input bar pushes up above the
    // on-screen keyboard when the user taps "加隱藏標籤..." — otherwise
    // the keyboard completely covers the input field and the bottom
    // "完成" action button. iOS uses padding (smoother, native feel);
    // Android uses height (needed because soft keyboard resizes layout).
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />

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
        <Pressable onPress={() => goNext(true)} style={styles.skipBtn}>
          <Text style={styles.skipText}>{t('activityReview.done') || '完成'}</Text>
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

            {/* Public tags — tap to pick */}
            {current!.publicTags.length > 0 && (
              <View style={styles.tagChips}>
                {current!.publicTags.map((tag) => {
                  const isPicked = currentPickedSet.has(tag);
                  return (
                    <Pressable
                      key={`pub-${tag}`}
                      style={[styles.tagChip, isPicked && styles.tagChipPicked]}
                      onPress={() => handleTogglePick(tag)}
                    >
                      <Text style={[styles.tagChipText, isPicked && styles.tagChipTextPicked]}>#{tag}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Hidden tags already added */}
            {(current!.hiddenTags.length > 0 || currentAddedTags.length > 0) && (
              <View style={[styles.tagChips, { marginTop: 6 }]}>
                {[...current!.hiddenTags, ...currentAddedTags].map((tag, i) => (
                  <View key={`hid-${tag}-${i}`} style={styles.hiddenTagChip}>
                    <Text style={styles.hiddenTagChipText}>#{tag}</Text>
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
            placeholder={t('activityReview.hiddenTagPlaceholder') || '加隱藏標籤...'}
            placeholderTextColor={COLORS.gray400}
            value={tagInput}
            onChangeText={setTagInput}
            returnKeyType="done"
            onSubmitEditing={handleAddTag}
          />
          {/* Plus-icon submit — same affordance as AddTagScreen,
              ManageTagsScreen, AskStoryRow, RingedAvatar. Replaces the
              prior "新增" / "Add" text label so the input row width
              stays stable across all 15 locales (long forms like
              "Aggiungi" / "Hinzufügen" used to push the input out
              of shape on this 44px-tall pill). */}
          <Pressable
            style={styles.addBtn}
            onPress={handleAddTag}
            accessibilityRole="button"
            accessibilityLabel={t('common.add') || '新增'}
          >
            <Plus size={18} color="#FFFFFF" strokeWidth={2.5} />
          </Pressable>
        </View>
        <View style={styles.actionRow}>
          <Pressable style={styles.nextActionBtn} onPress={() => swipeAway('right')}>
            <Check size={20} color={COLORS.white} />
            <Text style={styles.nextActionText}>{t('activityReview.done') || '完成'}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  skipText: { fontSize: 15, fontWeight: '600', color: COLORS.piktag600 },
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
  tagChip: { backgroundColor: COLORS.gray100, borderRadius: 9999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1.5, borderColor: 'transparent' },
  tagChipPicked: { backgroundColor: COLORS.piktag50, borderColor: COLORS.piktag500 },
  tagChipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray600 },
  tagChipTextPicked: { color: COLORS.piktag600, fontWeight: '700' },
  hiddenTagChip: { backgroundColor: COLORS.gray50, borderRadius: 9999, paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.gray200, borderStyle: 'dashed' as any },
  hiddenTagChipText: { fontSize: 12, color: COLORS.gray400, fontStyle: 'italic' as any },
  // Input
  inputBar: { paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.gray100 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray100, borderRadius: 20, paddingLeft: 14, paddingRight: 4, height: 44, gap: 8 },
  textInput: { flex: 1, fontSize: 15, color: COLORS.gray900, padding: 0 },
  // Square-rounded 36×36 submit button — borderRadius 10 (not 18=full
  // circle) matches AddTagScreen's reference + button. Square-rounded
  // shape reads more clearly as "tap to submit" than a circle. Sits
  // inside the 44px-tall inputRow (paddingRight: 4 leaves 4px each
  // side).
  addBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 10,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  skipActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.piktag500, backgroundColor: COLORS.piktag50 },
  skipActionText: { fontSize: 15, fontWeight: '600', color: COLORS.piktag600 },
  nextActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: COLORS.piktag500 },
  nextActionText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  // Empty + Summary
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: COLORS.gray500 },
  summaryContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  summaryTitle: { fontSize: 24, fontWeight: '700', color: COLORS.gray900 },
  summaryText: { fontSize: 16, color: COLORS.gray600 },
  doneBtn: { backgroundColor: COLORS.piktag500, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  doneBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
