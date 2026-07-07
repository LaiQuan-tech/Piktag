import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Dimensions,
  ActionSheetIOS,
  Alert,
  Share,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import BrandSpinner from '../loaders/BrandSpinner';
import { Image } from 'expo-image';
import { Plus, X, RefreshCw } from 'lucide-react-native';
import BoltIcon from '../BoltIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import InitialsAvatar from '../InitialsAvatar';
import OverlappingAvatars from '../OverlappingAvatars';
import { COLORS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import { normalizeTagName as sharedNormalizeTag, ilikeEscape } from '../../lib/normalizeTag';
import { recordAiSuggestions, markAiSuggestionAccepted } from '../../lib/aiTagLogger';
import { recordAskResponse } from '../../lib/searchLearning';
import { useAuth } from '../../hooks/useAuth';
import { useLocalContacts, normalizePhone } from '../../hooks/useLocalContacts';
import type { AskFeedItem, MyActiveAsk } from '../../types/ask';
import { isOfficialDemoAsk, getDemoAskText } from '../../lib/officialDemoAsk';
// AskMatchSheet removed 2026-05-31 — founder direction
// 「ask 發佈時的說明，這頁其實可不要，前一頁也有說明，再來就太多了」.
// The AskCreateModal subtitle already tells the user that matching
// happens; surfacing a second sheet right after publish was redundant
// (and especially jarring when the match list was empty — the user
// just gets a wall of explanation text twice). Match candidates still
// flow via the `ask_match` notification + the 2nd-degree story row,
// so removing this surface doesn't drop the North Star moment, just
// the eager-modal version of it.

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const MAX_BODY = 150;

// Template chips (composer, blank-body only) — six copy-and-edit starter
// asks spanning the categories that got the most "didn't know what to
// ask" feedback: professional referral, hire, gig, service intro, travel.
// i18n keys ask.tpl1..tpl6.
const ASK_TEMPLATE_KEYS = ['ask.tpl1', 'ask.tpl2', 'ask.tpl3', 'ask.tpl4', 'ask.tpl5', 'ask.tpl6'] as const;

// bodyPlaceholder pool — one random pick per composer open (see the
// visible-effect below), replacing the old bodyPromptHints ticker.
// i18n keys ask.ph1..ph3.
const ASK_PLACEHOLDER_KEYS = ['ask.ph1', 'ask.ph2', 'ask.ph3'] as const;

// Apple Music "Recently played"-style carousel sizing. Each slide takes
// ~78% of the screen width so the next slide always peeks ~20% on the
// right edge — that peek IS the scroll affordance, no chevron / dots
// needed. The leading my-Ask card uses the same width so the snap
// rhythm is consistent. Snap interval = slide + gap.
const ROW_GAP = 12;
const SLIDE_WIDTH = Math.round(SCREEN_WIDTH * 0.78);
const SNAP_INTERVAL = SLIDE_WIDTH + ROW_GAP;

type AskStoryRowProps = {
  asks: AskFeedItem[];
  myAsk: MyActiveAsk | null;
  myAvatarUrl: string | null;
  myName: string;
  onRefresh: () => void;
  onPressUser: (userId: string, askId?: string, authorId?: string) => void;
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
}

// Share-outside-PikTag URL contract (ask activation item 5,
// 2026-07-06 founder-approved): the landing page at this path reads
// the ask via the public get_ask_public RPC and lets a non-member
// reply through submit_ask_web_reply — no lang param, no query
// string, just the bare ask id.
function buildAskShareUrl(askId: string): string {
  return `https://pikt.ag/a/${askId}`;
}

const SHARE_BODY_SNIPPET_LEN = 80;

// Minimal relative-time formatter for the web-replies list. Mirrors
// NotificationsScreen's formatTimeAgo shape but there's no shared
// util to import (that one is a private helper in the screen file),
// so this is a small self-contained copy scoped to this component.
function formatReplyTimeAgo(dateString: string, t: (key: string, options?: any) => string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return t('notifications.timeJustNow');
  if (diffMins < 60) return t('notifications.timeMinutesAgo', { count: diffMins });
  if (diffHours < 24) return t('notifications.timeHoursAgo', { count: diffHours });
  if (diffDays === 1) return t('notifications.timeYesterday');
  return t('notifications.timeDaysAgo', { count: diffDays });
}

// ── Rotating gradient avatar ring ─────────────────────────────────────
//
// Mirrors the web profile page's `gradientFlow` effect (see
// landing/api/u/[username].js — 4-stop gradient sliding background-position
// over 6s). React Native has no `background-position` so we get the same
// "color flowing around the ring" feel by rotating the gradient itself
// on a continuous 6-second loop while the avatar inside stays still.
//
// The first and last colors should match so there's no visible seam as
// the rotation passes a full revolution.
type RotatingGradientRingProps = {
  colors: readonly [string, string, ...string[]];
  children: React.ReactNode;
  // Outer ring diameter. Inner white circle shrinks proportionally so
  // the visible gradient stripe stays roughly the same width regardless
  // of size. Defaults to the original 64/56 numbers.
  size?: number;
};

const RING_PADDING = 3;

function RotatingGradientRing({ colors, children, size = 64 }: RotatingGradientRingProps) {
  // `colors` here is the gradient stops prop, NOT theme colors —
  // need separate theme hook for styles access.
  const { colors: themeColors } = useTheme();
  const styles = useMemo(() => makeStyles(themeColors), [themeColors]);
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 6000, // matches web's gradientFlow 6s
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const innerSize = size - RING_PADDING * 2;
  const outerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    padding: RING_PADDING,
  };
  const innerStyle = {
    width: innerSize,
    height: innerSize,
    borderRadius: innerSize / 2,
  };

  return (
    <View style={[styles.ring, outerStyle]}>
      {/* Rotating gradient layer sits behind the inner avatar circle.
          overflow: hidden + the parent's borderRadius clips the rotating
          rectangle to a perfect circle on Android (iOS does it natively). */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { borderRadius: size / 2, overflow: 'hidden' },
          { transform: [{ rotate: spin }] },
        ]}
      >
        <LinearGradient
          colors={colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
      <View style={[styles.ringInner, innerStyle]}>{children}</View>
    </View>
  );
}

export default function AskStoryRow({ asks, myAsk, myAvatarUrl, myName, onRefresh, onPressUser }: AskStoryRowProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [createVisible, setCreateVisible] = useState(false);
  // (matchSheetAskId state dropped — see AskMatchSheet removal note
  // at the import block above.)
  const [hiddenAuthorIds, setHiddenAuthorIds] = useState<Set<string>>(new Set());
  // Friend ask currently open in the view sheet (answer-by-introduction
  // entry point). null = sheet closed.
  const [viewAsk, setViewAsk] = useState<AskFeedItem | null>(null);

  // IG-style "viewed" tracking. Tapping an ask marks it viewed; viewed
  // asks lose their gradient ring and sort to the end of the row, so
  // unviewed ones (the urgent / unaddressed) stay in front. Persisted
  // locally per device so it survives app restarts.
  const VIEWED_ASKS_KEY = 'piktag_viewed_ask_ids';
  const [viewedAskIds, setViewedAskIds] = useState<Set<string>>(new Set());

  // Load viewed IDs once on mount and prune any that no longer
  // correspond to an active ask in the current feed (asks expire after
  // 24h, so the set would otherwise grow forever). The prune happens on
  // every feed change too, see effect below.
  useEffect(() => {
    AsyncStorage.getItem(VIEWED_ASKS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setViewedAskIds(new Set(arr));
        } catch {
          // corrupt cache — drop it silently
        }
      })
      .catch(() => {});
  }, []);

  // Garbage-collect viewed IDs against the current feed. Keeps storage
  // bounded and prevents a stale viewed-state lingering if a server
  // recreates an ask with a new id.
  useEffect(() => {
    if (viewedAskIds.size === 0) return;
    const currentIds = new Set(asks.map((a) => a.ask_id));
    let dropped = false;
    const next = new Set<string>();
    for (const id of viewedAskIds) {
      if (currentIds.has(id)) next.add(id);
      else dropped = true;
    }
    if (dropped) {
      setViewedAskIds(next);
      AsyncStorage.setItem(VIEWED_ASKS_KEY, JSON.stringify([...next])).catch(() => {});
    }
    // We intentionally only re-prune when the feed changes (not when
    // viewedAskIds changes), so omit viewedAskIds from the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asks]);

  const markAskViewed = useCallback((askId: string) => {
    setViewedAskIds((prev) => {
      if (prev.has(askId)) return prev;
      const next = new Set(prev);
      next.add(askId);
      AsyncStorage.setItem(VIEWED_ASKS_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  // Apple Guideline 1.2: long-press an Ask circle to report objectionable
  // content or hide the author from the rail.
  const submitAskReport = useCallback(
    async (ask: AskFeedItem, reason: string) => {
      if (!user) return;
      try {
        await supabase.from('piktag_reports').insert({
          reporter_id: user.id,
          reported_id: ask.author_id,
          reason,
          context: { kind: 'ask', ask_id: ask.ask_id },
        } as any);
        Alert.alert(
          t('report.success', { defaultValue: 'Reported' }),
          t('report.confirmDescription', { defaultValue: 'Thanks — our team will review.' }),
        );
      } catch (err) {
        console.warn('report ask failed:', err);
      }
    },
    [user, t],
  );

  const promptAskReportReason = useCallback(
    (ask: AskFeedItem) => {
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
            if (idx >= 0 && idx < reasons.length) void submitAskReport(ask, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(t('report.confirmTitle', { defaultValue: 'Report' }), t('report.confirmDescription', { defaultValue: '' }), [
          ...reasons.map((r) => ({ text: r.label, onPress: () => void submitAskReport(ask, r.key) })),
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [submitAskReport, t],
  );

  const handleAskLongPress = useCallback(
    (ask: AskFeedItem) => {
      const reportLabel = t('report.reportAsk', { defaultValue: 'Report Ask' });
      const hideLabel = t('report.hideFromUser', { defaultValue: 'Hide from this user' });
      const cancelLabel = t('common.cancel', { defaultValue: 'Cancel' });
      const onHide = () =>
        setHiddenAuthorIds((prev) => {
          const next = new Set(prev);
          next.add(ask.author_id);
          return next;
        });
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [reportLabel, hideLabel, cancelLabel],
            destructiveButtonIndex: 0,
            cancelButtonIndex: 2,
          },
          (idx) => {
            if (idx === 0) promptAskReportReason(ask);
            else if (idx === 1) onHide();
          },
        );
      } else {
        Alert.alert('', '', [
          { text: reportLabel, onPress: () => promptAskReportReason(ask) },
          { text: hideLabel, onPress: onHide },
          { text: cancelLabel, style: 'cancel' },
        ]);
      }
    },
    [promptAskReportReason, t],
  );

  // Hide reported authors, then sort unviewed → viewed. Within each
  // group the original feed order is preserved (server already orders
  // by recency / mutual signal), so unviewed asks stay at the front
  // ranked by the same logic as before — viewed simply slip to the back.
  const visibleAsks = useMemo(() => {
    const filtered = asks.filter((a) => !hiddenAuthorIds.has(a.author_id));
    const unviewed: AskFeedItem[] = [];
    const viewed: AskFeedItem[] = [];
    for (const a of filtered) {
      if (viewedAskIds.has(a.ask_id)) viewed.push(a);
      else unviewed.push(a);
    }
    return [...unviewed, ...viewed];
  }, [asks, hiddenAuthorIds, viewedAskIds]);

  // Group friend asks into pairs for the 2-stacked-rows-per-slide layout.
  // Each pair fills one Apple-Music-style slide. Last pair may be a
  // single-element array when the count is odd; the slide still
  // reserves the second row's vertical space so adjacent slides line
  // up vertically and the carousel doesn't jiggle on snap.
  const askPairs = useMemo(() => {
    const pairs: AskFeedItem[][] = [];
    for (let i = 0; i < visibleAsks.length; i += 2) {
      pairs.push(visibleAsks.slice(i, i + 2));
    }
    return pairs;
  }, [visibleAsks]);

  // Cold-start (P0): even with no signal at all — no own active ask
  // AND no friend asks — DON'T hide the row. Seeding the first demand
  // signal matters most precisely when the network is sparse; burying
  // the only create entry point inside profile-edit throttles the
  // whole serendipity engine (Ask is the demand signal that makes the
  // network valuable). The previous early-return was a deliberate
  // "avoid a lonely CTA" choice — reversed here on purpose. The main
  // render below already degrades gracefully to a single, understated
  // "+ Ask" bubble (dashed ring + "想要什麼？" prompt) when myAsk is
  // null and visibleAsks is empty, so we just fall through to it.

  return (
    <>
      <View style={styles.container}>
        {/* In-context explainer — shown only when the viewer has NO
            active Ask (the "they haven't used this yet" moment).
            Card #3 of the home cold-start ("AI 幫你找對的人") moves
            here: the "+ Ask / 想要什麼？" bubble alone is too terse for
            a first-timer to grasp the value, so a one-line caption
            states it. Hidden once they have an active Ask (the rail
            then speaks for itself) so returning users aren't nagged. */}
        {!myAsk && (
          <Text style={styles.rowIntro}>
            {t('ask.rowIntro', {
              defaultValue: '發個 Ask，AI 從人脈裡（連朋友的朋友）幫你找對的人。',
            })}
          </Text>
        )}
        {/* ── IG-Stories style circle rail ────────────────────────
            The previous "Apple-Music two-row card carousel" took
            ~200pt of vertical space and felt like a sub-screen on
            top of the friends list. Replaced with a single-row
            horizontal rail of circular avatars (each ~68dp ring
            + name + 1-line body preview) — same pattern Gen-Z
            recognizes from IG / Threads / TikTok story rails.
            All the data wiring (visibility tracking, viewed
            state, long-press report-or-hide, tap-to-open-author)
            is unchanged; only the layout shifts. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.circleRail}
        >
          {/* My Ask — always leading. Active: rotating gradient
              ring. Inactive: dashed-purple ring + plus badge. */}
          <TouchableOpacity
            style={styles.circleSlot}
            activeOpacity={0.85}
            onPress={() => setCreateVisible(true)}
          >
            {myAsk ? (
              <RotatingGradientRing
                colors={['#c44dff', '#8c52ff', '#5e2ce6', '#c44dff']}
                size={68}
              >
                {myAvatarUrl ? (
                  <Image source={{ uri: myAvatarUrl }} style={styles.circleAvatarImg} cachePolicy="memory-disk" />
                ) : (
                  <InitialsAvatar name={myName} size={58} />
                )}
              </RotatingGradientRing>
            ) : (
              <View style={styles.circleEmptyRing}>
                {myAvatarUrl ? (
                  <Image source={{ uri: myAvatarUrl }} style={styles.circleAvatarImg} cachePolicy="memory-disk" />
                ) : (
                  <InitialsAvatar name={myName} size={58} />
                )}
                <View style={styles.circlePlusBadge}>
                  <Plus size={12} color="#fff" strokeWidth={3} />
                </View>
              </View>
            )}
            <Text style={styles.circleName} numberOfLines={1}>
              {myAsk
                ? t('ask.yourAsk', { defaultValue: '你' })
                : t('ask.newAsk', { defaultValue: '+ Ask' })}
            </Text>
            {myAsk ? (
              <Text style={styles.circleBody} numberOfLines={1}>
                {myAsk.title || myAsk.body}
              </Text>
            ) : (
              <Text style={[styles.circleBody, styles.circleBodyMuted]} numberOfLines={1}>
                {t('ask.shortPrompt', { defaultValue: '想要什麼？' })}
              </Text>
            )}
          </TouchableOpacity>

          {/* Friend Asks. Each: ring color = degree (red/purple for
              1st, blue for 2nd, gray when viewed). Same tap +
              long-press behavior as before. */}
          {visibleAsks.map((ask) => {
            const name = ask.author_full_name || ask.author_username || '?';
            const viewed = viewedAskIds.has(ask.ask_id);
            const isDemo = isOfficialDemoAsk(ask.author_id);
            const railPreviewText = isDemo
              ? getDemoAskText(t).title || getDemoAskText(t).body
              : ask.title || ask.body;
            const avatar = ask.author_avatar_url ? (
              <Image source={{ uri: ask.author_avatar_url }} style={styles.circleAvatarImg} cachePolicy="memory-disk" />
            ) : (
              <InitialsAvatar name={name} size={58} />
            );
            return (
              <TouchableOpacity
                key={ask.ask_id}
                style={styles.circleSlot}
                activeOpacity={0.85}
                onPress={() => {
                  markAskViewed(ask.ask_id);
                  // Open the in-place view sheet instead of jumping
                  // straight to the profile — the full body finally
                  // becomes readable, and the sheet hosts the
                  // recommend-someone secondary action. The profile
                  // jump (and its 'view' analytics in the parent)
                  // lives on as the sheet's primary CTA.
                  setViewAsk(ask);
                }}
                onLongPress={() => handleAskLongPress(ask)}
                delayLongPress={350}
              >
                {viewed ? (
                  <View style={styles.circleViewedRing}>{avatar}</View>
                ) : (
                  <RotatingGradientRing
                    size={68}
                    colors={
                      ask.degree === 1
                        ? ['#ff5757', '#c44dff', '#8c52ff', '#ff5757']
                        : ['#60a5fa', '#818cf8', '#60a5fa']
                    }
                  >
                    {avatar}
                  </RotatingGradientRing>
                )}
                <Text
                  style={[styles.circleName, viewed && styles.circleNameViewed]}
                  numberOfLines={1}
                >
                  {name}
                </Text>
                <Text
                  style={[styles.circleBody, viewed && styles.circleBodyViewed]}
                  numberOfLines={1}
                >
                  {railPreviewText}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <AskCreateModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        existingAsk={myAsk}
        onCreated={() => {
          // Just refresh the row. The post-publish match sheet was
          // removed 2026-05-31 — see import-block comment.
          onRefresh();
        }}
      />

      <AskViewSheet
        ask={viewAsk}
        onClose={() => setViewAsk(null)}
        onPressProfile={(ask) => {
          // Continue the pre-sheet flow: the parent records the 'view'
          // response and routes FriendDetail vs UserDetail.
          setViewAsk(null);
          onPressUser(ask.author_id, ask.ask_id, ask.author_id);
        }}
      />
    </>
  );
}

// ── Friend-ask view sheet + recommend-someone picker ──
//
// The 76dp rail slots have no room for actions, so this bottom sheet is
// the "story viewer" for a FRIEND's ask: author header, full body, tag
// pills, then two CTAs — the original profile jump as the solid primary
// and "recommend someone" (answer-by-introduction, North-Star referral
// loop) as the outline secondary. Own asks never land here; the my-ask
// slot opens AskCreateModal instead.
//
// The picker lists MEMBER friends only: piktag_connections joined to
// piktag_profiles (same shape as burstTag.ts), minus official accounts
// (hard rule — everyone auto-friends @piktag) and minus the ask author.
// Local card-scanned contacts live outside piktag_connections, so
// non-members can never leak into the recommendable set (privacy rule).

type AskViewSheetProps = {
  ask: AskFeedItem | null;
  onClose: () => void;
  onPressProfile: (ask: AskFeedItem) => void;
};

type RecommendCandidate = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function AskViewSheet({ ask, onClose, onPressProfile }: AskViewSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const modalStyles = useMemo(() => makeModalStyles(colors), [colors]);
  const { user } = useAuth();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState<RecommendCandidate[] | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [filter, setFilter] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Reset per ask so a previously opened picker (and its author-scoped
  // exclusion) never leaks into the next ask.
  useEffect(() => {
    setPickerOpen(false);
    setFriends(null);
    setFilter('');
    setSendingId(null);
  }, [ask?.ask_id]);

  const openPicker = useCallback(async () => {
    if (!user || !ask) return;
    setPickerOpen(true);
    setLoadingFriends(true);
    try {
      const { data, error } = await supabase
        .from('piktag_connections')
        .select(
          'connected_user:piktag_profiles!connected_user_id(id, full_name, username, avatar_url, is_official)',
        )
        .eq('user_id', user.id);
      if (error) throw error;
      const seen = new Set<string>();
      const list: RecommendCandidate[] = [];
      for (const row of (data ?? []) as any[]) {
        const p = row.connected_user;
        if (!p || p.is_official === true) continue;
        if (p.id === ask.author_id || p.id === user.id) continue;
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        list.push({
          id: p.id,
          full_name: p.full_name ?? null,
          username: p.username ?? null,
          avatar_url: p.avatar_url ?? null,
        });
      }
      setFriends(list);
    } catch (e) {
      // Visible failure + fall back to the view state — a silently
      // empty list would read as "you have no friends".
      setPickerOpen(false);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setLoadingFriends(false);
    }
  }, [user, ask, t]);

  const filteredFriends = useMemo(() => {
    if (!friends) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        (f.full_name ?? '').toLowerCase().includes(q) ||
        (f.username ?? '').toLowerCase().includes(q),
    );
  }, [friends, filter]);

  const handleRecommend = useCallback(
    async (friend: RecommendCandidate) => {
      if (!user || !ask || sendingId) return;
      setSendingId(friend.id);
      try {
        // Record FIRST — the UNIQUE(ask_id, responder_id, action) row is
        // the dedupe gate. Message-first would re-message the author on
        // every repeat attempt before we could learn it's a duplicate.
        const result = await recordAskResponse({
          askId: ask.ask_id,
          authorId: ask.author_id,
          action: 'recommend',
          recommendedUserId: friend.id,
        });
        if (result === 'duplicate') {
          setPickerOpen(false);
          Alert.alert(
            t('ask.recommendAlready', {
              defaultValue: 'You already recommended someone for this Ask',
            }),
          );
          return;
        }

        const title = (ask.title ?? '').trim() || ask.body.slice(0, 30);
        const body = t('ask.recommendMsg', {
          defaultValue: 'For your Ask "{{title}}" — I recommend {{name}} (@{{username}}).',
          title,
          name: friend.full_name || friend.username || '',
          username: friend.username ?? '',
        });

        // Same send path as chat everywhere else: the
        // get_or_create_conversation RPC, then a piktag_messages insert
        // with client_nonce (mirrors useChatThread.doInsert /
        // notificationRouter's reconnect_suggest branch).
        const { data: conv, error: convErr } = await supabase.rpc(
          'get_or_create_conversation',
          { other_user_id: ask.author_id },
        );
        if (convErr) throw convErr;
        const conversationId =
          typeof conv === 'string'
            ? conv
            : ((conv as any)?.id ?? (conv as any)?.conversation_id);
        if (!conversationId) throw new Error('get_or_create_conversation returned no id');
        const { error: msgErr } = await supabase.from('piktag_messages').insert({
          conversation_id: conversationId,
          sender_id: user.id,
          body,
          client_nonce: Crypto.randomUUID(),
        });
        if (msgErr) throw msgErr;

        onClose();
        Alert.alert(t('ask.recommendSent', { defaultValue: 'Sent to the asker' }));
      } catch (e) {
        // NEVER silent: the user must know the introduction did not
        // reach the asker.
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setSendingId(null);
      }
    },
    [user, ask, sendingId, t, onClose],
  );

  if (!ask) return null;
  const isOwn = user?.id === ask.author_id;
  const authorName = ask.author_full_name || ask.author_username || '?';
  const isDemo = isOfficialDemoAsk(ask.author_id);
  const demoText = isDemo ? getDemoAskText(t) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <TouchableOpacity style={modalStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[modalStyles.sheet, pickerOpen && modalStyles.pickerSheet]}>
          <View style={modalStyles.handleBar} />
          {!pickerOpen ? (
            <>
              <View style={modalStyles.viewAuthorRow}>
                {ask.author_avatar_url ? (
                  <Image
                    source={{ uri: ask.author_avatar_url }}
                    style={modalStyles.viewAuthorAvatar}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <InitialsAvatar name={authorName} size={40} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={modalStyles.viewAuthorName} numberOfLines={1}>
                    {authorName}
                  </Text>
                  {ask.author_username ? (
                    <Text style={modalStyles.viewAuthorUsername} numberOfLines={1}>
                      @{ask.author_username}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={modalStyles.viewBodyWrap}>
                {demoText ? (
                  <>
                    <Text style={modalStyles.viewTitleText}>{demoText.title}</Text>
                    <Text style={modalStyles.viewBody}>{demoText.body}</Text>
                  </>
                ) : (
                  <>
                    {ask.title ? (
                      <Text style={modalStyles.viewTitleText}>{ask.title}</Text>
                    ) : null}
                    <Text style={modalStyles.viewBody}>{ask.body}</Text>
                  </>
                )}
              </View>

              {ask.ask_tag_names && ask.ask_tag_names.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={modalStyles.tagScroll}
                  contentContainerStyle={modalStyles.tagScrollContent}
                >
                  {ask.ask_tag_names.map((name) => (
                    <View
                      key={`friend-view-${name}`}
                      style={[modalStyles.tagChip, modalStyles.tagChipSelected]}
                    >
                      <Text style={[modalStyles.tagChipText, modalStyles.tagChipTextSelected]}>
                        #{name}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={modalStyles.viewMeta}>
                {isDemo
                  ? t('ask.demoBadge', { defaultValue: 'Demo Ask' })
                  : t('ask.timeLeft', { hours: hoursLeft(ask.expires_at) })}
              </Text>

              {/* Primary (solid tier): the pre-sheet behavior — open the
                  author's profile. */}
              <TouchableOpacity
                style={modalStyles.submitBtnFull}
                onPress={() => onPressProfile(ask)}
                activeOpacity={0.8}
              >
                <Text style={modalStyles.submitBtnText}>
                  {t('connections.viewProfile', { defaultValue: 'View' })}
                </Text>
              </TouchableOpacity>

              {/* Secondary (outline tier): answer-by-introduction. Never
                  shown on the viewer's own ask. */}
              {!isOwn ? (
                <TouchableOpacity
                  style={modalStyles.recommendBtn}
                  onPress={() => void openPicker()}
                  activeOpacity={0.8}
                >
                  <Text style={modalStyles.recommendBtnText}>
                    {t('ask.recommendPerson', { defaultValue: 'Recommend someone' })}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <>
              <Text style={modalStyles.title}>
                {t('ask.recommendPickerTitle', { defaultValue: 'Pick a friend' })}
              </Text>
              <TextInput
                style={modalStyles.pickerFilterInput}
                value={filter}
                onChangeText={setFilter}
                placeholder={t('chat.searchPlaceholder', { defaultValue: 'Search' })}
                placeholderTextColor={colors.gray400}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {loadingFriends ? (
                <View style={modalStyles.pickerLoading}>
                  <BrandSpinner size={24} />
                </View>
              ) : (
                <FlatList
                  data={filteredFriends}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  ListEmptyComponent={
                    <Text style={modalStyles.pickerEmpty}>
                      {t('connections.emptyGuideTitle', { defaultValue: 'No connections yet' })}
                    </Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={modalStyles.pickerRow}
                      onPress={() => void handleRecommend(item)}
                      disabled={sendingId !== null}
                      activeOpacity={0.7}
                    >
                      {item.avatar_url ? (
                        <Image
                          source={{ uri: item.avatar_url }}
                          style={modalStyles.pickerAvatarImg}
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <InitialsAvatar
                          name={item.full_name || item.username || '?'}
                          size={44}
                        />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={modalStyles.pickerRowName} numberOfLines={1}>
                          {item.full_name || item.username || '?'}
                        </Text>
                        {item.username ? (
                          <Text style={modalStyles.pickerRowUsername} numberOfLines={1}>
                            @{item.username}
                          </Text>
                        ) : null}
                      </View>
                      {sendingId === item.id ? <BrandSpinner size={16} /> : null}
                    </TouchableOpacity>
                  )}
                />
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Create/Edit Ask Modal ──

// Row shape from piktag_ask_web_replies (migration 20260706030000).
// RLS restricts SELECT to author_id = auth.uid(), so any row this
// client can fetch already belongs to the viewer's own ask.
type WebReply = {
  id: string;
  ask_id: string;
  author_id: string;
  replier_name: string;
  contact: string;
  message: string;
  created_at: string;
};

type AskCreateModalProps = {
  visible: boolean;
  onClose: () => void;
  existingAsk: MyActiveAsk | null;
  // North-Star Phase 1: pass the new ask_id back so the caller can
  // immediately show the direct-match sheet. Optional for backwards
  // compat with callers that just refresh the feed.
  onCreated: (askId?: string) => void;
  // Optional pre-fill for the CREATE path only (ignored when
  // existingAsk is set → view mode). Lets callers seed the body from
  // context — e.g. SearchScreen passes the failed query so "couldn't
  // find them → post an Ask" arrives already half-written.
  seedBody?: string;
};

// Normalize a free-form tag input: strip leading #, trim, drop spaces, cap length.
// Returns null for inputs that should be rejected (empty, too long after trim).
const MAX_TAG_LEN = 30;
function normalizeTagName(raw: string): string | null {
  // Structural normalization is now the shared util (one identity
  // across AddTag / ManageTags / Ask). The null + length policy
  // stays here — Ask rejects (rather than truncates) over-long tags.
  const cleaned = sharedNormalizeTag(raw);
  if (!cleaned) return null;
  if (cleaned.length > MAX_TAG_LEN) return null;
  return cleaned;
}

// Find-or-create a tag in piktag_tags by name. Mirrors the pattern used in
// ManageTagsScreen.findOrCreateTag — handles the select-then-insert race
// where two clients create the same tag concurrently (Postgres 23505).
async function findOrCreateTagByName(name: string): Promise<string | null> {
  // ilike (case-insensitive): piktag_tags has UNIQUE INDEX on lower(name).
  // eq would miss a row whose stored case differs from `name`, the INSERT
  // below would then 23505 on the lower() index, and the fallback
  // re-select (also case-sensitive in the bug version) would return null
  // → the Ask silently drops this tag. See normalizeTag.ts:ilikeEscape.
  let { data: tag } = await supabase
    .from('piktag_tags').select('id').ilike('name', ilikeEscape(name)).maybeSingle();
  if (!tag) {
    const { data: newTag, error: insertErr } = await supabase
      .from('piktag_tags').insert({ name }).select('id').single();
    if (newTag) {
      tag = newTag;
    } else if (insertErr && (insertErr as any).code === '23505') {
      const { data: raced } = await supabase
        .from('piktag_tags').select('id').ilike('name', ilikeEscape(name)).maybeSingle();
      tag = raced ?? null;
    }
  }
  return (tag as any)?.id ?? null;
}

export function AskCreateModal({ visible, onClose, existingAsk, onCreated, seedBody }: AskCreateModalProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const modalStyles = useMemo(() => makeModalStyles(colors), [colors]);
  const { user } = useAuth();
  const { add: addLocalContact } = useLocalContacts();

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  // ── Share outside PikTag + web-replies (ask activation item 5) ──
  const [webReplies, setWebReplies] = useState<WebReply[]>([]);
  const [savedReplyIds, setSavedReplyIds] = useState<Set<string>>(new Set());
  const [savingReplyId, setSavingReplyId] = useState<string | null>(null);

  // Fetch this ask's outside-PikTag replies whenever the view-own sheet
  // opens for an active ask. RLS already scopes SELECT to author_id =
  // auth.uid(), so no extra filter is needed beyond ask_id.
  useEffect(() => {
    if (!visible || !existingAsk) {
      setWebReplies([]);
      setSavedReplyIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('piktag_ask_web_replies')
        .select('id, ask_id, author_id, replier_name, contact, message, created_at')
        .eq('ask_id', existingAsk.id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (!error && data) setWebReplies(data as WebReply[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, existingAsk]);

  const shareAskOutside = useCallback(
    async (ask: { id: string; body: string; title: string | null }) => {
      const url = buildAskShareUrl(ask.id);
      const summary = (ask.title || ask.body).trim();
      const snippet =
        summary.length <= SHARE_BODY_SNIPPET_LEN
          ? summary
          : summary.slice(0, SHARE_BODY_SNIPPET_LEN - 1) + '…';
      const message = t('ask.shareText', {
        body: snippet,
        url,
        defaultValue: 'I am looking for: {{body}} — know anyone? {{url}}',
      });
      try {
        await Share.share({
          message,
          url: Platform.OS === 'ios' ? url : undefined,
        });
      } catch {
        // user cancelled — no feedback needed
      }
    },
    [t],
  );

  const handleSaveReplyAsContact = useCallback(
    async (reply: WebReply) => {
      if (savingReplyId) return;
      setSavingReplyId(reply.id);
      try {
        const isEmail = reply.contact.includes('@');
        const noteTitle = existingAsk?.title || existingAsk?.body || '';
        const ok = await addLocalContact({
          name: reply.replier_name,
          email: isEmail ? reply.contact : null,
          phone: isEmail ? null : normalizePhone(reply.contact),
          note: t('ask.webReplyNote', {
            title: noteTitle,
            defaultValue: 'Replied to my Ask: {{title}}',
          }),
        });
        if (!ok) {
          throw new Error('save failed');
        }
        setSavedReplyIds((prev) => new Set(prev).add(reply.id));
      } catch (err) {
        console.warn('save ask web reply as contact failed:', err);
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          t('ask.saveContactFailed', { defaultValue: 'Could not save this contact. Try again.' }),
        );
      } finally {
        setSavingReplyId(null);
      }
    },
    [savingReplyId, existingAsk, addLocalContact, t],
  );

  // Spec B — bodyPlaceholder is now one random ph1/ph2/ph3 example picked
  // when the composer opens (see the visible-effect below), not a ticking
  // rotation — a single well-chosen concrete example reads as "here's
  // what to type" more clearly than text that shifts under the user
  // while they're still deciding. Replaces the prior useRotatingPlaceholder
  // + bodyPromptHints ticker for this field.
  const [placeholderKeyIdx, setPlaceholderKeyIdx] = useState(0);
  const bodyPlaceholder = t(ASK_PLACEHOLDER_KEYS[placeholderKeyIdx % ASK_PLACEHOLDER_KEYS.length]);

  const [body, setBody] = useState('');
  // Source of truth is the tag NAME, not its DB id — AI may suggest new names
  // that don't exist in piktag_tags yet, and users can also add custom names.
  // We only resolve to ids on submit (via findOrCreateTagByName).
  const [aiNames, setAiNames] = useState<string[]>([]);
  // tag_name -> piktag_ai_tag_suggestions.id, for accept logging (#5).
  const [aiSuggestionIds, setAiSuggestionIds] = useState<Record<string, string>>({});
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [customInput, setCustomInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  // Did the most recent AI invocation come back with zero usable
  // suggestions? Used to render a visible "no suggestions, retry or
  // type your own" hint instead of the previous silent-empty state
  // (which felt like the button was broken — "AI 有時出現，有時不出現").
  const [aiTriedAndEmpty, setAiTriedAndEmpty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Spec C — reach preview. null = not shown (no tags selected yet, or
  // the RPC failed/timed out — failure is silent per spec, never blocks
  // send). Debounced 400ms off the selected-tag set below.
  const [reachCount, setReachCount] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      // existingAsk wins (view/edit mode); else seed from caller
      // context (e.g. a failed search query); else blank.
      setBody(existingAsk?.body || seedBody || '');
      setAiNames([]);
      setCustomNames([]);
      setSelectedNames(new Set());
      setCustomInput('');
      setAiLoading(false);
      setAiTriedAndEmpty(false);
      setReachCount(null);
      // Re-roll the ph1/ph2/ph3 placeholder pick for this open.
      setPlaceholderKeyIdx(Math.floor(Math.random() * ASK_PLACEHOLDER_KEYS.length));
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, existingAsk, seedBody, slideAnim]);

  // AI auto-suggest tag names when user stops typing. Names are NOT resolved
  // to DB ids here — that happens on submit. This means a brand-new name the
  // AI invents (e.g. "App行銷北美") shows up as a chip and gets created in
  // piktag_tags only if the user keeps it selected and submits.
  // AI cap: 3 suggestions max. The Edge Function may return up to 8 but
  // showing more than 3 chips fights the user's ability to choose — every
  // extra option adds friction without adding signal. Top 3 keeps the
  // surface scannable.
  const AI_SUGGESTION_CAP = 3;

  const suggestTagsForBody = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 5) {
      setAiNames([]);
      setAiTriedAndEmpty(false);
      return;
    }
    setAiLoading(true);
    setAiTriedAndEmpty(false);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-tags', {
        body: JSON.stringify({ bio: trimmed, lang: 'the same language as the content' }),
      });
      if (error) throw error;
      const raw: string[] = data?.suggestions || [];
      const normalized = Array.from(
        new Set(
          raw
            .map((n) => normalizeTagName(n))
            .filter((n): n is string => !!n),
        ),
      ).slice(0, AI_SUGGESTION_CAP);
      setAiNames(normalized);
      // Principle #5: log shown suggestions for calibration (ask_create
      // surface — was previously dark). Fire-and-forget.
      void (async () => {
        const sugIds = await recordAiSuggestions('suggest_tags_rpc', normalized, { surface: 'ask_create' });
        if (sugIds.length === normalized.length) {
          const map: Record<string, string> = {};
          normalized.forEach((name, i) => { map[name] = sugIds[i]; });
          setAiSuggestionIds((prev) => ({ ...prev, ...map }));
        }
      })();
      // Empty-result feedback. The edge function can succeed (200) but
      // return no suggestions — short prompts, ambiguous content, or
      // an LLM hiccup. Without this flag the UI just silently stayed
      // empty after the spinner cleared, which made users describe the
      // feature as "有時出現有時不出現，跟賭博一樣". Setting the flag
      // lets the render layer show an explicit "no suggestions, try
      // again or type your own" hint.
      if (normalized.length === 0) {
        setAiTriedAndEmpty(true);
      } else {
        // Default-select all AI suggestions, preserving any custom
        // selections.
        setSelectedNames((prev) => {
          const next = new Set(prev);
          for (const name of normalized) next.add(name);
          return next;
        });
      }
    } catch (err) {
      // Network / edge-function failure also surfaces as the
      // empty-state hint. We don't differentiate "failed" from "empty"
      // because the user-facing recovery is identical: tap retry or
      // type their own tag. Treating them the same keeps the UI
      // simpler and avoids leaking server-side error noise.
      console.warn('AI tag suggest failed:', err);
      setAiNames([]);
      setAiTriedAndEmpty(true);
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Submit-only AI: typing alone never hits the suggest-tags edge
  // function. The user explicitly fires inference via the "AI 生成
  // 標籤" button below the body input — same pattern as the search bar
  // (one server hit per intent, not per keystroke). This used to debounce
  // 800ms after typing stopped; in practice the trigger felt invisible
  // (users would type continuously and never see the call land), and
  // the auto-fire was burning OpenAI tokens on half-formed prompts.
  const handleBodyChange = useCallback((text: string) => {
    setBody(text.slice(0, MAX_BODY));
    // Typing invalidates the previous "AI returned nothing" state —
    // the user is changing the prompt, so the next AI tap should
    // present as a clean attempt, not as still-empty.
    setAiTriedAndEmpty(false);
  }, []);

  // Spec A — template chip tap. Fills body with the template text
  // (still editable, not locked) and clears the stale AI-empty flag same
  // as manual typing. Chips hide themselves once body is non-empty via
  // the render condition below, so this never re-fires from a stray tap.
  const applyTemplate = useCallback((text: string) => {
    setBody(text.slice(0, MAX_BODY));
    setAiTriedAndEmpty(false);
  }, []);

  const toggleTag = useCallback((name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  // Spec C — reach preview. Debounce 400ms after the selected-tag set
  // settles, then resolve names → existing piktag_tags ids (read-only —
  // unlike findOrCreateTagByName on submit, a brand-new AI/custom name
  // that doesn't exist yet just can't preview a reach number, which is
  // fine: it can't have any matches anyway) and call count_ask_tag_reach.
  // Any failure (network, timeout, RPC error) silently clears the count —
  // per spec this is a soft feedback line, never a blocker or an error.
  useEffect(() => {
    if (!visible || selectedNames.size === 0) {
      setReachCount(null);
      return;
    }
    let cancelled = false;
    const names = [...selectedNames];
    const timer = setTimeout(async () => {
      try {
        const { data: rows } = await supabase
          .from('piktag_tags')
          .select('id, name')
          .in('name', names);
        if (cancelled) return;
        const ids = (rows ?? []).map((r: any) => r.id).filter(Boolean);
        if (ids.length === 0) {
          setReachCount(0);
          return;
        }
        const { data, error } = await supabase.rpc('count_ask_tag_reach', { p_tag_ids: ids });
        if (cancelled) return;
        if (error || typeof data !== 'number') {
          setReachCount(null);
          return;
        }
        setReachCount(data);
      } catch {
        if (!cancelled) setReachCount(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, selectedNames]);

  // Add a custom tag from the input field. Auto-selects it. De-dupes against
  // both AI and other custom names so the same chip doesn't appear twice.
  const addCustomTag = useCallback(() => {
    const name = normalizeTagName(customInput);
    if (!name) {
      setCustomInput('');
      return;
    }
    const exists =
      aiNames.includes(name) ||
      customNames.includes(name);
    if (!exists) {
      setCustomNames((prev) => [...prev, name]);
    }
    setSelectedNames((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
    setCustomInput('');
  }, [customInput, aiNames, customNames]);

  const handleSubmit = useCallback(async () => {
    if (!user || !body.trim() || selectedNames.size === 0) return;
    // The modal switches to view-mode when existingAsk is set, so this
    // path is unreachable in that case — no need for a soft-delete of
    // the previous ask here.
    setSaving(true);
    try {
      // Resolve every selected name to a tag id, creating missing rows on the
      // fly. This is where AI-suggested-but-new and user-typed-custom names
      // get persisted into the global tag pool.
      const namesToResolve = [...selectedNames];
      const ids = await Promise.all(namesToResolve.map((n) => findOrCreateTagByName(n)));
      const validTagIds = ids.filter((id): id is string => !!id);
      if (validTagIds.length === 0) {
        throw new Error('No tag could be resolved');
      }

      // 24 hours — IG Stories cadence. Daily refresh creates urgency
      // ("post by tonight or it's gone tomorrow") and keeps the feed
      // tied to the day's mood. Reverted from the 7-day window we
      // tried briefly; 7d made the rail feel like a dusty bulletin
      // board with weeks-old posts hanging around. 24h matches what
      // most daily-active social apps converged on for a reason.
      const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      const { data: askData, error } = await supabase
        .from('piktag_asks')
        .insert({ author_id: user.id, body: body.trim(), expires_at: expiresAt })
        .select('id')
        .single();

      if (error || !askData) throw error || new Error('Insert failed');

      const tagRows = validTagIds.map((tag_id) => ({ ask_id: askData.id, tag_id }));
      const { error: tagErr } = await supabase.from('piktag_ask_tags').insert(tagRows);
      if (tagErr) {
        // A bodied Ask with zero tags is unreachable via the
        // tag-keyed feeds and pollutes fetch_ask_feed forever.
        // Roll back the orphan instead of leaving it.
        await supabase.from('piktag_asks').delete().eq('id', askData.id);
        throw tagErr;
      }

      // Principle #5: an AI-suggested tag kept selected through submit is
      // an accept (ask uses keep-selected semantics, not tap-to-add).
      for (const n of namesToResolve) {
        const sid = aiSuggestionIds[n];
        if (sid) void markAiSuggestionAccepted(sid);
      }

      // AI title generation (async, non-blocking)
      supabase.functions.invoke('generate-ask-title', {
        body: JSON.stringify({ body: body.trim(), tags: namesToResolve }),
      }).then(({ data }) => {
        if (data?.title) {
          supabase.from('piktag_asks').update({ title: data.title }).eq('id', askData.id);
        }
      }).catch(() => {});

      // Pass the new ask_id so the caller can immediately surface the
      // 1st-degree match sheet (Phase 1). Falls back gracefully when
      // the parent's handler ignores the arg.
      onCreated(askData.id);
      onClose();

      // Ask activation item 5 (founder-approved 2026-07-06): offer the
      // outside-PikTag share right at the moment of publish, when
      // intent is highest — but never force it. A plain "OK" dismiss
      // is the default button; sharing is one extra tap away.
      Alert.alert(
        t('ask.postAsk', { defaultValue: 'Ask posted' }),
        undefined,
        [
          { text: t('common.confirm', { defaultValue: 'OK' }), style: 'cancel' },
          {
            text: t('ask.shareOutside', { defaultValue: 'Share outside PikTag' }),
            onPress: () =>
              void shareAskOutside({ id: askData.id, body: body.trim(), title: null }),
          },
        ],
      );
    } catch (err) {
      console.warn('Ask create failed:', err);
      // Was silently swallowed: spinner stopped, modal stayed open
      // with the typed body, user saw NOTHING and would re-tap
      // (duplicate Asks). Surface it; body is preserved so they can
      // retry. onCreated/onClose run only on the success path above.
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('ask.createFailed', { defaultValue: '貼文沒送出去，請再試一次。' }),
      );
    } finally {
      setSaving(false);
    }
  }, [user, body, selectedNames, existingAsk, onCreated, onClose, t, aiSuggestionIds, shareAskOutside]);

  const handleDelete = useCallback(async () => {
    if (!existingAsk) return;
    // Confirm before deleting — a tap on this CTA is the only way to
    // tear down an ask, and it's irreversible from the UI.
    Alert.alert(
      t('ask.deleteAsk', { defaultValue: 'Delete this ask?' }),
      t('ask.deleteAskConfirm', { defaultValue: 'Are you sure you want to delete this ask?' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              // Hard DELETE rather than soft `is_active=false` UPDATE.
              //   * piktag_ask_tags / piktag_ask_dismissals both reference
              //     ask_id ON DELETE CASCADE, so the join rows clean up
              //     automatically.
              //   * The asks_delete RLS policy is just USING(author_id =
              //     auth.uid()) — no WITH CHECK clause to worry about,
              //     unlike the UPDATE policy which was rejecting our
              //     soft-delete with "new row violates row-level security
              //     policy" depending on auth context.
              //   * Once a user deletes their ask there's no surface that
              //     resurrects it, so audit-trail value of soft-delete
              //     was zero.
              const { error } = await supabase
                .from('piktag_asks')
                .delete()
                .eq('id', existingAsk.id);
              if (error) {
                Alert.alert(
                  t('common.error', { defaultValue: 'Error' }),
                  error.message || (t('ask.deleteFailed', { defaultValue: 'Could not delete ask. Try again.' })),
                );
                return;
              }
              onCreated();
              onClose();
            } catch (err) {
              Alert.alert(
                t('common.error', { defaultValue: 'Error' }),
                err instanceof Error ? err.message : String(err),
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }, [existingAsk, onCreated, onClose, t]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={modalStyles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={modalStyles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[modalStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={modalStyles.handleBar} />

          {existingAsk ? (
            // ── View + delete mode ──
            // The user already has an active ask. Asks are immutable on
            // purpose — to "edit", they delete and re-create. So this
            // surface is read-only: show what their ask currently is,
            // expose the delete CTA, nothing else. Two-step flow >
            // ambiguous "delete + post" double-button row.
            //
            // Wrapped in a ScrollView (added alongside the web-replies
            // list below) — that list is unbounded, so this mode now
            // needs the same scroll-inside-maxHeight-sheet behavior
            // create-mode already had.
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <Text style={modalStyles.title}>{t('ask.yourAskTitle', { defaultValue: '你目前的 Ask' })}</Text>

              <View style={modalStyles.viewBodyWrap}>
                <Text style={modalStyles.viewBody}>
                  {existingAsk.title || existingAsk.body}
                </Text>
              </View>

              {existingAsk.tag_names.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={modalStyles.tagScroll}
                  contentContainerStyle={modalStyles.tagScrollContent}
                >
                  {existingAsk.tag_names.map((name) => (
                    <View
                      key={`view-${name}`}
                      style={[modalStyles.tagChip, modalStyles.tagChipSelected]}
                    >
                      <Text style={[modalStyles.tagChipText, modalStyles.tagChipTextSelected]}>
                        #{name}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={modalStyles.viewMeta}>
                {t('ask.timeLeft', { hours: hoursLeft(existingAsk.expires_at) })}
              </Text>

              {/* Share outside PikTag — outline tier (secondary to
                  delete's… actually delete is destructive-adjacent, so
                  this reads as the row's "real" secondary action). Ask
                  activation item 5: the reply loop only exists if the
                  asker actually sends the link somewhere. */}
              <TouchableOpacity
                style={modalStyles.shareOutsideBtn}
                onPress={() =>
                  void shareAskOutside({
                    id: existingAsk.id,
                    body: existingAsk.body,
                    title: existingAsk.title,
                  })
                }
                activeOpacity={0.8}
              >
                <Text style={modalStyles.shareOutsideBtnText}>
                  {t('ask.shareOutside', { defaultValue: 'Share outside PikTag' })}
                </Text>
              </TouchableOpacity>

              {/* Web replies — non-members who answered via the share
                  page. Whole section hidden when empty (per spec) so a
                  fresh Ask with zero outside replies doesn't show a
                  hollow "Replies from outside" header. */}
              {webReplies.length > 0 ? (
                <View style={modalStyles.webRepliesSection}>
                  <Text style={modalStyles.webRepliesTitle}>
                    {t('ask.webRepliesTitle', { defaultValue: 'Replies from outside' })}
                  </Text>
                  {webReplies.map((reply) => {
                    const saved = savedReplyIds.has(reply.id);
                    const savingThis = savingReplyId === reply.id;
                    return (
                      <View key={reply.id} style={modalStyles.webReplyRow}>
                        <View style={modalStyles.webReplyHeaderRow}>
                          <Text style={modalStyles.webReplyName} numberOfLines={1}>
                            {reply.replier_name}
                          </Text>
                          <Text style={modalStyles.webReplyTime}>
                            {formatReplyTimeAgo(reply.created_at, t)}
                          </Text>
                        </View>
                        <Text style={modalStyles.webReplyMessage}>{reply.message}</Text>
                        <Text style={modalStyles.webReplyContact} numberOfLines={1}>
                          {reply.contact}
                        </Text>
                        <TouchableOpacity
                          style={[
                            modalStyles.saveContactBtn,
                            saved && modalStyles.saveContactBtnSaved,
                          ]}
                          onPress={() => void handleSaveReplyAsContact(reply)}
                          disabled={saved || savingThis}
                          activeOpacity={0.8}
                        >
                          {savingThis ? (
                            <BrandSpinner size={16} />
                          ) : (
                            <Text
                              style={[
                                modalStyles.saveContactBtnText,
                                saved && modalStyles.saveContactBtnTextSaved,
                              ]}
                            >
                              {saved
                                ? t('ask.savedAsContact', { defaultValue: 'Saved' })
                                : t('ask.saveAsContact', { defaultValue: 'Save as contact' })}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <TouchableOpacity
                style={modalStyles.deleteBtnFull}
                onPress={handleDelete}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={modalStyles.deleteBtnFullText}>{t('ask.deleteAsk')}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          ) : (
            // ── Create mode ──
            //
            // Wrapped in a ScrollView with keyboardShouldPersistTaps so
            // the FIRST tap on the submit button below fires onPress
            // even while the body TextInput holds keyboard focus.
            // Without this, iOS multi-line TextInput plus
            // KeyboardAvoidingView swallows the first tap to dismiss
            // the keyboard, requiring a second tap to actually submit
            // — the "按二次才會成功" complaint.
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              {/* Title + sub-line, same structure as the create-Tag
                  screen ("這次是什麼場合？" + its explainer). The
                  sub-line used to live under "AI 為你推薦" where it
                  just repeated itself; here it does its real job —
                  telling the user what to write — and carries the
                  Ask payoff (the right people / a friend of a
                  friend see it), not just the AI mechanic. */}
              <Text style={[modalStyles.title, { marginBottom: 4 }]}>
                {t('ask.createTitle')}
              </Text>
              <Text style={modalStyles.subtitle}>
                {t('ask.createSubtitle', { defaultValue: '一句話就好 — AI 會配上標籤，讓對的人（或朋友的朋友）看到。' })}
              </Text>

              {/* Spec A — template chips. Only while body is empty: an
                  outlined (secondary) row of six copy-and-edit starter
                  asks, so a blank composer isn't the first thing the
                  user has to solve. Tapping fills body (still editable)
                  and the row disappears via the body.trim() check below. */}
              {!body.trim() ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={modalStyles.templateScroll}
                  contentContainerStyle={modalStyles.templateScrollContent}
                >
                  {ASK_TEMPLATE_KEYS.map((key) => {
                    const label = t(key);
                    return (
                      <TouchableOpacity
                        key={key}
                        style={modalStyles.templateChip}
                        onPress={() => applyTemplate(label)}
                        activeOpacity={0.7}
                      >
                        <Text style={modalStyles.templateChipText} numberOfLines={1}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}

              {/* Body input */}
              <TextInput
                style={modalStyles.input}
                value={body}
                onChangeText={handleBodyChange}
                placeholder={bodyPlaceholder}
                placeholderTextColor={colors.gray400}
                multiline
                maxLength={MAX_BODY}
                autoFocus
              />
              <Text style={modalStyles.charCount}>{body.length}/{MAX_BODY}</Text>

              {/* AI suggestion section — matched to the canonical
                  pattern shared by AddTagScreen and EditProfileScreen:
                    [Atom/Spinner + "AI 為你推薦"] [↻ refresh btn]
                    chip wrap
                    empty-state hint
                  Manual trigger preserved (no auto-debounce on body
                  typing) — typing-driven inference was both invisible
                  and wasteful for a multi-revision Ask body, so the
                  refresh button is the SOLE trigger for both first
                  generation and subsequent re-rolls. */}
              <View style={modalStyles.aiSection}>
                <View style={modalStyles.aiHeaderRow}>
                  <View style={modalStyles.aiHeaderLeft}>
                    {aiLoading ? (
                      <BrandSpinner size={16} />
                    ) : (
                      <BoltIcon size={14} color={colors.piktag600} />
                    )}
                    <Text style={modalStyles.aiHeaderTitle}>
                      {aiLoading
                        ? `${t('ask.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}…`
                        : t('ask.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}
                    </Text>
                  </View>
                  {!aiLoading && (
                    <TouchableOpacity
                      style={[
                        modalStyles.aiRefreshBtn,
                        body.trim().length < 5 && modalStyles.aiRefreshBtnDisabled,
                      ]}
                      onPress={() => suggestTagsForBody(body)}
                      disabled={body.trim().length < 5}
                      activeOpacity={0.7}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={
                        aiNames.length > 0
                          ? t('ask.regenerateAiTags', { defaultValue: '重新生成' })
                          : t('ask.generateAiTags', { defaultValue: 'AI 生成標籤' })
                      }
                    >
                      <RefreshCw size={14} color={colors.piktag600} strokeWidth={2.2} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* AI + custom chips — single wrap layout. Tap toggles
                    selection (multi-select). Unlike AddTag/EditProfile
                    where chips disappear after add, Ask uses in-place
                    highlight because the user is composing a set, not
                    drawing from a pool into a separate list. */}
                {aiNames.length > 0 || customNames.length > 0 ? (
                  <View style={modalStyles.tagChipsWrap}>
                    {[...aiNames, ...customNames].map((name) => (
                      <TouchableOpacity
                        key={`tag-${name}`}
                        style={[modalStyles.tagChip, selectedNames.has(name) && modalStyles.tagChipSelected]}
                        onPress={() => toggleTag(name)}
                        activeOpacity={0.7}
                      >
                        <Text style={[modalStyles.tagChipText, selectedNames.has(name) && modalStyles.tagChipTextSelected]}>
                          #{name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : aiTriedAndEmpty ? (
                  // AI ran and found nothing — actionable feedback.
                  <Text style={modalStyles.aiEmptyHint}>
                    {t('ask.aiNoSuggestions', { defaultValue: 'AI 沒有想到合適的標籤，再試一次或自己輸入' })}
                  </Text>
                ) : body.trim().length >= 5 ? (
                  // Enough text written but AI not triggered yet —
                  // tell them to tap ↻ (Ask is manual-trigger, this
                  // is a real instruction, not redundant).
                  <Text style={modalStyles.aiEmptyHint}>
                    {t('ask.aiTapToGenerateHint', { defaultValue: '點右上的 ↻ 讓 AI 推薦標籤' })}
                  </Text>
                ) : body.trim().length > 0 ? (
                  // Started typing but still under the 5-char trigger
                  // threshold (e.g. a 4-char CJK Ask like 想打羽球): the
                  // ↻ is disabled, so say WHY instead of leaving a dead
                  // blank (prevent-or-feedback). Threshold itself unchanged.
                  <Text style={modalStyles.aiEmptyHint}>
                    {t('ask.aiBodyTooShortHint', { defaultValue: 'Describe what you want in a sentence — AI will suggest tags' })}
                  </Text>
                ) : null
                /* Truly empty: nothing here — the title sub-line already
                   explains, so repeating it was the redundancy the user
                   flagged. */}
              </View>

              {/* Spec C — reach preview. Shown only once at least one tag
                  is selected; before that there's nothing to preview.
                  reachCount stays null (line hidden) on RPC failure/timeout
                  — a soft feedback line must never look like an error or
                  block sending. */}
              {selectedNames.size > 0 && reachCount !== null ? (
                reachCount > 0 ? (
                  // Split on the interpolated count so the digit can be
                  // highlighted piktag500 regardless of locale word order
                  // (RTL/CJK phrasings don't all put the number first).
                  (() => {
                    const full = t('ask.reachCount', {
                      n: reachCount,
                      defaultValue: '{{n}} friends have matching tags for this',
                    });
                    const numStr = String(reachCount);
                    const idx = full.indexOf(numStr);
                    if (idx === -1) {
                      return <Text style={modalStyles.reachHint}>{full}</Text>;
                    }
                    return (
                      <Text style={modalStyles.reachHint}>
                        {full.slice(0, idx)}
                        <Text style={modalStyles.reachHintCount}>{numStr}</Text>
                        {full.slice(idx + numStr.length)}
                      </Text>
                    );
                  })()
                ) : (
                  <Text style={modalStyles.reachHint}>
                    {t('ask.reachZero', { defaultValue: 'No matches yet — try a more specific or different tag' })}
                  </Text>
                )
              ) : null}

              {/* Custom tag input */}
              <View style={modalStyles.customRow}>
                <TextInput
                  style={modalStyles.customInput}
                  value={customInput}
                  onChangeText={setCustomInput}
                  placeholder={t('ask.customTagPlaceholder')}
                  placeholderTextColor={colors.gray400}
                  maxLength={MAX_TAG_LEN}
                  returnKeyType="done"
                  onSubmitEditing={addCustomTag}
                  blurOnSubmit={false}
                />
                <TouchableOpacity
                  style={[modalStyles.customAddBtn, !customInput.trim() && modalStyles.customAddBtnDisabled]}
                  onPress={addCustomTag}
                  disabled={!customInput.trim()}
                  activeOpacity={0.7}
                >
                  <Plus size={18} color="#fff" strokeWidth={2.5} />
                </TouchableOpacity>
              </View>

              {/* Selection counter / hint */}
              {selectedNames.size === 0 ? (
                <Text style={modalStyles.aiHint}>{t('ask.minOneTag')}</Text>
              ) : null}

              {/* Single submit button — delete now belongs to view mode
                  above and never appears alongside post. */}
              <TouchableOpacity
                style={[
                  modalStyles.submitBtnFull,
                  (!body.trim() || selectedNames.size === 0) && modalStyles.submitBtnDisabled,
                ]}
                onPress={() => {
                  // Explicitly dismiss the keyboard so the spinner +
                  // network round-trip aren't visually obscured. The
                  // ScrollView wrapper above handles the tap-routing
                  // (keyboardShouldPersistTaps='handled'), so the first
                  // tap reaches us reliably; this just cleans up the
                  // visual after.
                  Keyboard.dismiss();
                  handleSubmit();
                }}
                disabled={saving || !body.trim() || selectedNames.size === 0}
                activeOpacity={0.8}
              >
                {saving ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={modalStyles.submitBtnText}>{t('ask.postAsk')}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Styles ──

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: c.gray200,
    paddingVertical: 12,
  },
  // In-context Ask explainer (shown when the viewer has no active Ask).
  rowIntro: {
    fontSize: 13,
    color: c.gray500,
    lineHeight: 18,
    paddingHorizontal: 16,
    marginBottom: 10,
  },

  // ── IG-Stories circle rail (current render) ────────────────
  // Each slot is a fixed-width column: gradient-ringed avatar at
  // the top, name below it, 1-line body preview at the bottom.
  // Horizontal scroll, no snap (free-flow like IG stories).
  circleRail: {
    paddingHorizontal: 14,
    gap: 14,
  },
  circleSlot: {
    width: 76,
    alignItems: 'center',
  },
  circleAvatarImg: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  // Dashed-purple ring used for the empty "my ask" state — telegraphs
  // "tap to create" without competing with the rotating-gradient look
  // used by active asks.
  circleEmptyRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Solid gray ring for viewed asks — same shape as the rotating
  // gradient slot so the row alignment doesn't jiggle when an ask
  // transitions from unviewed → viewed.
  circleViewedRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    borderColor: c.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circlePlusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  circleName: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
    color: c.gray900,
    maxWidth: 72,
    textAlign: 'center',
  },
  circleNameViewed: {
    color: c.gray500,
    fontWeight: '600',
  },
  // Body preview: smaller + lighter than name. piktag600 so it
  // visually links to the gradient ring above.
  circleBody: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
    color: c.piktag600,
    maxWidth: 72,
    textAlign: 'center',
  },
  circleBodyViewed: {
    color: c.gray400,
    fontWeight: '400',
  },
  circleBodyMuted: {
    color: c.gray400,
    fontStyle: 'italic',
  },

  scroll: {
    // Inter-slide gap matches ROW_GAP, used by SNAP_INTERVAL above —
    // keep them in sync so snap rhythm matches the visible spacing.
    paddingHorizontal: 16,
    gap: ROW_GAP,
  },
  // ── RotatingGradientRing geometry ──
  // ring + ringInner are referenced by the RotatingGradientRing
  // component and overridden inline when a custom size is passed.
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    backgroundColor: c.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  // ── AskCard ── (Apple Music "Recently played"-style carousel)
  // Leading my-Ask card uses SLIDE_WIDTH so it snaps to the same
  // rhythm as the friend-asks pair slides that follow. Width is
  // ~78% of the screen so the next slide always peeks ~20% on the
  // right — that peek IS the scroll affordance, no chevron / dots.
  askCard: {
    width: SLIDE_WIDTH,
    backgroundColor: c.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: c.gray100,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    gap: 10,
  },
  // Pair slide — 2 stacked rows per Apple Music card. Same width as
  // the my-Ask leading card so the snap interval is uniform across
  // the carousel. gap separates the two rows visually without a
  // hairline divider; the rounded corners + border define the
  // "slide" boundary, similar to Music's Recently Played item.
  askPairSlide: {
    width: SLIDE_WIDTH,
    backgroundColor: c.white,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: c.gray100,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    gap: 8,
  },
  // Row inside a pair slide — flex-row, avatar on the left, text
  // stack on the right. minHeight reserves vertical space so an
  // odd-tail single-row pair doesn't collapse to a half-height
  // slide (which would jiggle the carousel on snap).
  askRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
    minHeight: 76,
  },
  askRowViewed: {
    opacity: 0.65,
  },
  askRowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  askRowViewedRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: c.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  askRowName: {
    fontSize: 14,
    fontWeight: '700',
    color: c.gray900,
  },
  askRowBody: {
    fontSize: 13,
    lineHeight: 17,
    color: c.gray700,
  },
  askRowTagsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  askRowTagOverflow: {
    fontSize: 11,
    color: c.gray500,
    fontWeight: '500',
    marginLeft: 2,
  },
  askRowPlaceholder: {
    minHeight: 76,
    paddingVertical: 4,
  },
  askCardEmpty: {
    backgroundColor: c.gray50,
    borderStyle: 'dashed',
    borderColor: c.gray300,
    shadowOpacity: 0,
    elevation: 0,
  },
  askCardViewed: {
    backgroundColor: c.gray50,
    shadowOpacity: 0,
    elevation: 0,
  },
  askCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  askCardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  // Empty-state ring on the my-Ask card — dashed grey circle echoing
  // the old ringCreate look, sized to match the 44dp gradient ring.
  askCardEmptyRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: c.gray300,
    borderStyle: 'dashed',
    backgroundColor: c.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askCardPlusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.white,
  },
  // Viewed-state ring on a friend card — same 44dp footprint as the
  // gradient ring so the layout doesn't jump when an ask flips from
  // unviewed → viewed.
  askCardViewedRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: c.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askCardNameStack: {
    flex: 1,
    minWidth: 0,
  },
  askCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: c.gray900,
  },
  askCardNameViewed: {
    color: c.gray600,
  },
  askCardHandle: {
    fontSize: 12,
    color: c.gray500,
    marginTop: 1,
  },
  askCardBody: {
    fontSize: 14,
    color: c.gray800,
    lineHeight: 19,
  },
  askCardBodyViewed: {
    color: c.gray500,
  },
  askCardBodyEmpty: {
    color: c.gray500,
    fontStyle: 'italic',
  },
  askCardTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  askCardTagChip: {
    backgroundColor: c.piktag50,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 100,
  },
  askCardTagChipViewed: {
    backgroundColor: c.gray100,
  },
  askCardTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.piktag600,
  },
  askCardTagTextViewed: {
    color: c.gray500,
  },
  // (askCardFooter / askCardTime / askCardTimeViewed removed alongside
  // the 24h countdown — body + tag chips now anchor the card bottom
  // via card flex layout, no explicit footer needed.)
  });
}

function makeModalStyles(c: ColorPalette) {
  return StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: c.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.gray200, alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: c.gray900, marginBottom: 16 },
  subtitle: { fontSize: 13, color: c.gray500, lineHeight: 19, marginBottom: 16 },
  // Spec A — template chips row. Outlined/secondary on purpose (per the
  // CTA-tier doctrine, these are "copy me" suggestions, not the primary
  // action) — never filled like the selected tagChip state below.
  templateScroll: { marginBottom: 12, flexGrow: 0 },
  templateScrollContent: { gap: 8 },
  templateChip: {
    borderWidth: 1.5,
    borderColor: c.gray200,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: 260,
  },
  templateChipText: { fontSize: 13, fontWeight: '500', color: c.gray700 },
  input: {
    borderWidth: 1.5, borderColor: c.gray200, borderRadius: 12,
    padding: 14, fontSize: 15, color: c.gray900,
    minHeight: 80, textAlignVertical: 'top', lineHeight: 22,
  },
  charCount: { fontSize: 12, color: c.gray400, textAlign: 'right', marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: c.gray700, marginBottom: 8 },
  // Horizontal scroll used by view-mode (existing-Ask display) to show
  // the Ask's tag pills inline. Distinct from the create-mode wrap
  // (tagChipsWrap) — view mode is a read-only single row, create
  // mode is interactive multi-row.
  tagScroll: { marginBottom: 16, flexGrow: 0 },
  // 8dp between chips in the horizontal scroll — was missing,
  // causing `#眼鏡 #配眼鏡` to render stuck together (founder caught).
  tagScrollContent: { gap: 8 },
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  aiLoadingText: { fontSize: 13, color: c.gray500 },
  aiHint: { fontSize: 13, color: c.gray400, marginBottom: 16 },
  // ─── AI suggestion section — unified visual language with
  //     AddTagScreen.aiHeader* / EditProfileScreen.ai_header*. Keep
  //     these in sync if either of the other two surfaces evolves. ───
  aiSection: { marginBottom: 16 },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aiHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiHeaderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag600,
  },
  aiRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.piktag200,
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiRefreshBtnDisabled: { opacity: 0.4 },
  aiEmptyHint: {
    fontSize: 12,
    color: c.gray500,
    fontStyle: 'italic',
    paddingHorizontal: 4,
  },
  // Chip wrap (replaces the prior horizontal ScrollView). Multi-select
  // toggle pattern — selected chip flips to piktag500 fill.
  tagChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    backgroundColor: c.gray100,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tagChipSelected: {
    backgroundColor: c.piktag500,
    borderColor: c.piktag500,
  },
  tagChipText: { fontSize: 13, fontWeight: '500', color: c.gray700 },
  tagChipTextSelected: { color: '#fff' },
  // Spec C — reach preview line, below the tag chips. Soft feedback only
  // (never rendered as an error state) — piktag500 highlights just the
  // count, the surrounding sentence stays gray500 like other hint text
  // in this sheet (aiEmptyHint, viewMeta).
  reachHint: {
    fontSize: 13,
    color: c.gray500,
    marginTop: -4,
    marginBottom: 16,
  },
  reachHintCount: { color: c.piktag500, fontWeight: '700' },
  customRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
  },
  customInput: {
    flex: 1,
    borderWidth: 1.5, borderColor: c.gray200, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: c.gray900,
  },
  // Square-rounded 40×40 — borderRadius 12 matches the unified Plus
  // submit-button shape (AddTagScreen / ManageTagsScreen /
  // ActivityReviewScreen / HiddenTagEditor). Square-rounded reads as
  // a button; circle reads as a status pip.
  customAddBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.piktag500,
  },
  customAddBtnDisabled: { opacity: 0.4 },
  // (Old aiTriggerBtn / aiTriggerText styles removed — the manual
  // "AI 生成標籤" pill was replaced by the canonical header-row
  // pattern shared with AddTagScreen / EditProfileScreen. See
  // aiSection / aiHeaderRow / aiRefreshBtn above.)
  // View-mode (existing ask) styles
  viewBodyWrap: {
    // In dark mode the sheet itself is c.card (#1c1c1e); a plain
    // gray50 fill (#0a0a0a) just read as a darker hole with no
    // defined edge. A hairline border + backgroundSecondary fill
    // gives the field a clear boundary in BOTH modes (same pattern
    // as the app's text inputs).
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  viewBody: {
    fontSize: 15,
    color: c.gray900,
    lineHeight: 22,
  },
  viewMeta: {
    fontSize: 12,
    color: c.gray500,
    marginBottom: 16,
  },
  // Full-width single-button variants — used when the modal is in either
  // pure create (post only) or pure view (delete only) mode.
  submitBtnFull: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: c.piktag500,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  deleteBtnFull: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: c.gray200,
  },
  deleteBtnFullText: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray700,
  },
  // ── Share outside PikTag + web replies (ask activation item 5) ──
  // Outline tier, same visual weight as deleteBtnFull/recommendBtn —
  // this is a secondary action on the view-own sheet, not the CTA.
  shareOutsideBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: c.gray200,
    marginBottom: 12,
  },
  shareOutsideBtnText: { fontSize: 15, fontWeight: '700', color: c.gray700 },
  webRepliesSection: { marginBottom: 16, gap: 10 },
  webRepliesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  webReplyRow: {
    backgroundColor: c.backgroundSecondary,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  webReplyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  webReplyName: { flex: 1, fontSize: 14, fontWeight: '700', color: c.gray900 },
  webReplyTime: { fontSize: 11, color: c.gray400 },
  webReplyMessage: { fontSize: 14, color: c.gray700, lineHeight: 19 },
  webReplyContact: { fontSize: 12, color: c.gray500 },
  saveContactBtn: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.piktag500,
    minWidth: 92,
    alignItems: 'center',
  },
  saveContactBtnSaved: {
    borderColor: c.gray200,
  },
  saveContactBtnText: { fontSize: 12, fontWeight: '700', color: c.piktag500 },
  saveContactBtnTextSaved: { color: c.gray400 },
  // ── AskViewSheet (friend-ask viewer + recommend picker) ──
  // Picker mode needs a fixed height so the FlatList can scroll inside
  // the sheet; view mode keeps the natural (content-sized) height.
  pickerSheet: { height: SCREEN_HEIGHT * 0.7 },
  viewAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  viewAuthorAvatar: { width: 40, height: 40, borderRadius: 20 },
  viewAuthorName: { fontSize: 15, fontWeight: '700', color: c.gray900 },
  viewAuthorUsername: { fontSize: 12, color: c.gray500, marginTop: 1 },
  viewTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray900,
    marginBottom: 4,
  },
  // Outline tier (CTA doctrine: secondary) — same visual weight as
  // deleteBtnFull so it never competes with the solid primary above it.
  recommendBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: c.gray200,
    marginTop: 10,
  },
  recommendBtnText: { fontSize: 15, fontWeight: '700', color: c.gray700 },
  pickerFilterInput: {
    borderWidth: 1.5,
    borderColor: c.gray200,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: c.gray900,
    marginBottom: 8,
  },
  pickerLoading: { paddingVertical: 24, alignItems: 'center' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  pickerAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  pickerRowName: { fontSize: 15, fontWeight: '600', color: c.gray900 },
  pickerRowUsername: { fontSize: 12, color: c.gray500, marginTop: 1 },
  pickerEmpty: {
    fontSize: 13,
    color: c.gray500,
    textAlign: 'center',
    paddingVertical: 24,
  },
  });
}
