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
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Dimensions,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import BrandSpinner from '../loaders/BrandSpinner';
import { Image } from 'expo-image';
import { Plus, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import InitialsAvatar from '../InitialsAvatar';
import OverlappingAvatars from '../OverlappingAvatars';
import { COLORS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import type { AskFeedItem, MyActiveAsk } from '../../types/ask';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const MAX_BODY = 150;

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
  onPressUser: (userId: string) => void;
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
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
  const { user } = useAuth();
  const [createVisible, setCreateVisible] = useState(false);
  const [hiddenAuthorIds, setHiddenAuthorIds] = useState<Set<string>>(new Set());

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
          t('report.success') || 'Reported',
          t('report.confirmDescription') || 'Thanks — our team will review.',
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
        { key: 'spam', label: t('report.reasonSpam') || 'Spam' },
        { key: 'harassment', label: t('report.reasonHarassment') || 'Harassment' },
        { key: 'inappropriate', label: t('report.reasonInappropriate') || 'Inappropriate' },
        { key: 'other', label: t('report.reasonOther') || 'Other' },
      ];
      const cancelLabel = t('common.cancel') || 'Cancel';
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: t('report.confirmTitle') || 'Report',
            options: [...reasons.map((r) => r.label), cancelLabel],
            cancelButtonIndex: reasons.length,
          },
          (idx) => {
            if (idx >= 0 && idx < reasons.length) void submitAskReport(ask, reasons[idx].key);
          },
        );
      } else {
        Alert.alert(t('report.confirmTitle') || 'Report', t('report.confirmDescription') || '', [
          ...reasons.map((r) => ({ text: r.label, onPress: () => void submitAskReport(ask, r.key) })),
          { text: cancelLabel, style: 'cancel' as const },
        ]);
      }
    },
    [submitAskReport, t],
  );

  const handleAskLongPress = useCallback(
    (ask: AskFeedItem) => {
      const reportLabel = t('report.reportAsk') || 'Report Ask';
      const hideLabel = t('report.hideFromUser') || 'Hide from this user';
      const cancelLabel = t('common.cancel') || 'Cancel';
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

  // Hide the whole feed when there's nothing to show — neither the
  // viewer's own active ask nor any friend asks. Avoids a lonely
  // "+ 新增 Ask" CTA hanging on a friends page that has no social
  // signal to surround it. The CTA is still reachable from
  // ProfileScreen and the bubble prompt elsewhere.
  if (!myAsk && visibleAsks.length === 0) {
    return (
      <AskCreateModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        existingAsk={myAsk}
        onCreated={onRefresh}
      />
    );
  }

  return (
    <>
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          snapToInterval={SNAP_INTERVAL}
          decelerationRate="fast"
          snapToAlignment="start"
        >
          {/* My Ask card */}
          {/* My-Ask card.  Always-leftmost.  Two states:
              - Has active ask → same shape as friend cards (body + tags
                + time-left), with rotating gradient ring; tap opens the
                view/delete modal.
              - No active ask → dashed border card with "+ 新增 Ask" CTA;
                tap opens the create modal. */}
          <TouchableOpacity
            style={[styles.askCard, !myAsk && styles.askCardEmpty]}
            activeOpacity={0.85}
            onPress={() => setCreateVisible(true)}
          >
            <View style={styles.askCardHeader}>
              {myAsk ? (
                <RotatingGradientRing
                  colors={['#c44dff', '#8c52ff', '#5e2ce6', '#c44dff']}
                  size={44}
                >
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.askCardAvatar} cachePolicy="memory-disk" />
                  ) : (
                    <InitialsAvatar name={myName} size={36} />
                  )}
                </RotatingGradientRing>
              ) : (
                <View style={styles.askCardEmptyRing}>
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.askCardAvatar} cachePolicy="memory-disk" />
                  ) : (
                    <InitialsAvatar name={myName} size={36} />
                  )}
                  <View style={styles.askCardPlusBadge}>
                    <Plus size={10} color="#fff" strokeWidth={3} />
                  </View>
                </View>
              )}
              <View style={styles.askCardNameStack}>
                <Text style={styles.askCardName} numberOfLines={1}>
                  {myAsk ? t('ask.yourAsk') : t('ask.newAsk')}
                </Text>
              </View>
            </View>

            {myAsk ? (
              <Text style={styles.askCardBody} numberOfLines={3}>
                {myAsk.title || myAsk.body}
              </Text>
            ) : (
              <Text style={[styles.askCardBody, styles.askCardBodyEmpty]} numberOfLines={3}>
                {t('ask.bubblePromptMine') || '+ 新增 Ask'}
              </Text>
            )}

            {myAsk && myAsk.tag_names.length > 0 ? (
              <View style={styles.askCardTagsRow}>
                {myAsk.tag_names.slice(0, 4).map((tn) => (
                  <View key={tn} style={styles.askCardTagChip}>
                    <Text style={styles.askCardTagText} numberOfLines={1}>#{tn}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 24h countdown footer removed from the card itself —
                Asks are short-lived enough that timing is implicit
                ("if it's here, it's still active"), and the visual
                weight of "剩 13h" + chevron crowded the card body.
                The countdown remains visible in the AskCreateModal's
                view-mode meta line, where the user is actually
                deciding whether to delete or wait it out. */}
          </TouchableOpacity>

          {/* Friend Asks — paired into 2-row stacked slides, Apple
              Music "Recently played"-style. Each slide takes 78% of
              the viewport width so the next slide always peeks ~20%
              on the right. The peek IS the scroll affordance — no
              chevron / dots needed. Tap a row to land on the author's
              detail page; long-press to surface report / hide. */}
          {askPairs.map((pair, pairIdx) => (
            <View key={`pair-${pairIdx}`} style={styles.askPairSlide}>
              {pair.map((ask) => {
                const name = ask.author_full_name || ask.author_username || '?';
                const viewed = viewedAskIds.has(ask.ask_id);
                const avatar = ask.author_avatar_url ? (
                  <Image source={{ uri: ask.author_avatar_url }} style={styles.askRowAvatar} cachePolicy="memory-disk" />
                ) : (
                  <InitialsAvatar name={name} size={36} />
                );
                return (
                  <TouchableOpacity
                    key={ask.ask_id}
                    style={[styles.askRow, viewed && styles.askRowViewed]}
                    activeOpacity={0.85}
                    onPress={() => {
                      markAskViewed(ask.ask_id);
                      onPressUser(ask.author_id);
                    }}
                    onLongPress={() => handleAskLongPress(ask)}
                    delayLongPress={350}
                  >
                    {/* LEFT: ringed circular avatar (same gradient
                        rules as before — degree-1 = piktag, degree-2 =
                        blue, viewed = subtle ring). 44dp footprint
                        keeps the ring visible without dominating the
                        row. */}
                    {viewed ? (
                      <View style={styles.askRowViewedRing}>{avatar}</View>
                    ) : (
                      <RotatingGradientRing
                        size={44}
                        colors={
                          ask.degree === 1
                            ? ['#ff5757', '#c44dff', '#8c52ff', '#ff5757']
                            : ['#60a5fa', '#818cf8', '#60a5fa']
                        }
                      >
                        {avatar}
                      </RotatingGradientRing>
                    )}

                    {/* RIGHT: name (single line bold) + body (2 lines)
                        + tag chips (max 2 + overflow indicator). flex:1
                        so it claims all remaining width within the
                        slide; min-width:0 so long usernames truncate
                        instead of pushing the avatar. */}
                    <View style={styles.askRowText}>
                      <Text style={[styles.askRowName, viewed && styles.askCardNameViewed]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[styles.askRowBody, viewed && styles.askCardBodyViewed]} numberOfLines={2}>
                        {ask.title || ask.body}
                      </Text>
                      {ask.ask_tag_names.length > 0 ? (
                        <View style={styles.askRowTagsLine}>
                          {ask.ask_tag_names.slice(0, 2).map((tn) => (
                            <View key={tn} style={[styles.askCardTagChip, viewed && styles.askCardTagChipViewed]}>
                              <Text style={[styles.askCardTagText, viewed && styles.askCardTagTextViewed]} numberOfLines={1}>
                                #{tn}
                              </Text>
                            </View>
                          ))}
                          {ask.ask_tag_names.length > 2 ? (
                            <Text style={styles.askRowTagOverflow}>
                              +{ask.ask_tag_names.length - 2}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {/* Reserve the second row's vertical space when the pair
                  is odd-tail (last pair has only 1 ask). Keeps slides
                  visually aligned across the carousel — no jiggle on
                  snap. */}
              {pair.length === 1 ? <View style={styles.askRowPlaceholder} /> : null}
            </View>
          ))}
        </ScrollView>
      </View>

      <AskCreateModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        existingAsk={myAsk}
        onCreated={onRefresh}
      />
    </>
  );
}

// ── Create/Edit Ask Modal ──

type AskCreateModalProps = {
  visible: boolean;
  onClose: () => void;
  existingAsk: MyActiveAsk | null;
  onCreated: () => void;
};

// Normalize a free-form tag input: strip leading #, trim, drop spaces, cap length.
// Returns null for inputs that should be rejected (empty, too long after trim).
const MAX_TAG_LEN = 30;
function normalizeTagName(raw: string): string | null {
  const cleaned = raw.replace(/^#+/, '').trim();
  if (!cleaned) return null;
  if (cleaned.length > MAX_TAG_LEN) return null;
  return cleaned;
}

// Find-or-create a tag in piktag_tags by name. Mirrors the pattern used in
// ManageTagsScreen.findOrCreateTag — handles the select-then-insert race
// where two clients create the same tag concurrently (Postgres 23505).
async function findOrCreateTagByName(name: string): Promise<string | null> {
  let { data: tag } = await supabase
    .from('piktag_tags').select('id').eq('name', name).maybeSingle();
  if (!tag) {
    const { data: newTag, error: insertErr } = await supabase
      .from('piktag_tags').insert({ name }).select('id').single();
    if (newTag) {
      tag = newTag;
    } else if (insertErr && (insertErr as any).code === '23505') {
      const { data: raced } = await supabase
        .from('piktag_tags').select('id').eq('name', name).maybeSingle();
      tag = raced ?? null;
    }
  }
  return (tag as any)?.id ?? null;
}

export function AskCreateModal({ visible, onClose, existingAsk, onCreated }: AskCreateModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  const [body, setBody] = useState('');
  // Source of truth is the tag NAME, not its DB id — AI may suggest new names
  // that don't exist in piktag_tags yet, and users can also add custom names.
  // We only resolve to ids on submit (via findOrCreateTagByName).
  const [aiNames, setAiNames] = useState<string[]>([]);
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

  useEffect(() => {
    if (visible) {
      setBody(existingAsk?.body || '');
      setAiNames([]);
      setCustomNames([]);
      setSelectedNames(new Set());
      setCustomInput('');
      setAiLoading(false);
      setAiTriedAndEmpty(false);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, existingAsk, slideAnim]);

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
  // function. The user explicitly fires inference via the "✨ AI 生成
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

  const toggleTag = useCallback((name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

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

      // 7 days. Original 24h was too aggressive — friends who weren't
      // online the same day never saw the post. 7 days matches the
      // "weekly check-in" cadence of the typical user without making
      // the feed feel stale.
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
      const { data: askData, error } = await supabase
        .from('piktag_asks')
        .insert({ author_id: user.id, body: body.trim(), expires_at: expiresAt })
        .select('id')
        .single();

      if (error || !askData) throw error || new Error('Insert failed');

      const tagRows = validTagIds.map((tag_id) => ({ ask_id: askData.id, tag_id }));
      await supabase.from('piktag_ask_tags').insert(tagRows);

      // AI title generation (async, non-blocking)
      supabase.functions.invoke('generate-ask-title', {
        body: JSON.stringify({ body: body.trim(), tags: namesToResolve }),
      }).then(({ data }) => {
        if (data?.title) {
          supabase.from('piktag_asks').update({ title: data.title }).eq('id', askData.id);
        }
      }).catch(() => {});

      onCreated();
      onClose();
    } catch (err) {
      console.warn('Ask create failed:', err);
    } finally {
      setSaving(false);
    }
  }, [user, body, selectedNames, existingAsk, onCreated, onClose]);

  const handleDelete = useCallback(async () => {
    if (!existingAsk) return;
    // Confirm before deleting — a tap on this CTA is the only way to
    // tear down an ask, and it's irreversible from the UI.
    Alert.alert(
      t('ask.deleteAsk') || 'Delete this ask?',
      t('ask.deleteAskConfirm') || 'Are you sure you want to delete this ask?',
      [
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('common.delete') || 'Delete',
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
                  t('common.error') || 'Error',
                  error.message || (t('ask.deleteFailed') || 'Could not delete ask. Try again.'),
                );
                return;
              }
              onCreated();
              onClose();
            } catch (err) {
              Alert.alert(
                t('common.error') || 'Error',
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
            <>
              <Text style={modalStyles.title}>{t('ask.yourAskTitle') || '你目前的 Ask'}</Text>

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
            </>
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
              <Text style={modalStyles.title}>{t('ask.createTitle')}</Text>

              {/* Body input */}
              <TextInput
                style={modalStyles.input}
                value={body}
                onChangeText={handleBodyChange}
                placeholder={t('ask.bodyPlaceholder')}
                placeholderTextColor={COLORS.gray400}
                multiline
                maxLength={MAX_BODY}
                autoFocus
              />
              <Text style={modalStyles.charCount}>{body.length}/{MAX_BODY}</Text>

              {/* Manual AI trigger — the only path that fires suggest-tags.
                  Auto-debounce was removed because typing-driven inference
                  was both invisible (users never saw it land) and wasteful
                  (re-fired on every pause through a half-written prompt).
                  Button label flips to "重新生成" once we already have
                  suggestions so users know they can re-roll. */}
              <TouchableOpacity
                style={[
                  modalStyles.aiTriggerBtn,
                  (body.trim().length < 5 || aiLoading) && modalStyles.aiTriggerBtnDisabled,
                ]}
                onPress={() => suggestTagsForBody(body)}
                disabled={body.trim().length < 5 || aiLoading}
                activeOpacity={0.7}
              >
                {aiLoading ? (
                  <>
                    <BrandSpinner size={16} />
                    <Text style={modalStyles.aiTriggerText}>{t('ask.generating')}</Text>
                  </>
                ) : (
                  <Text style={modalStyles.aiTriggerText}>
                    ✨ {aiNames.length > 0
                      ? (t('ask.regenerateAiTags') || '重新生成')
                      : (t('ask.generateAiTags') || 'AI 生成標籤')}
                  </Text>
                )}
              </TouchableOpacity>

              {/* AI + custom tag chips. Same scroll strip; the user doesn't
                  need to know which name came from where. */}
              {aiNames.length > 0 || customNames.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={modalStyles.tagScroll}
                >
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
                </ScrollView>
              ) : null}

              {/* AI returned no usable suggestions (or the edge function
                  failed). Surface a soft hint so the user knows the tap
                  registered — vs. the previous behavior where the
                  spinner just disappeared with nothing visible
                  changing, which read as "the feature is broken". */}
              {aiTriedAndEmpty && customNames.length === 0 ? (
                <Text style={modalStyles.aiNoResultHint}>
                  {t('ask.aiNoSuggestions') || 'AI 沒有想到合適的標籤，再試一次或自己輸入'}
                </Text>
              ) : null}

              {/* Custom tag input */}
              <View style={modalStyles.customRow}>
                <TextInput
                  style={modalStyles.customInput}
                  value={customInput}
                  onChangeText={setCustomInput}
                  placeholder={t('ask.customTagPlaceholder')}
                  placeholderTextColor={COLORS.gray400}
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

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray200,
    paddingVertical: 12,
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
    backgroundColor: COLORS.white,
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
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.gray100,
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
    backgroundColor: COLORS.white,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.gray100,
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
    borderColor: COLORS.gray300,
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
    color: COLORS.gray900,
  },
  askRowBody: {
    fontSize: 13,
    lineHeight: 17,
    color: COLORS.gray700,
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
    color: COLORS.gray500,
    fontWeight: '500',
    marginLeft: 2,
  },
  askRowPlaceholder: {
    minHeight: 76,
    paddingVertical: 4,
  },
  askCardEmpty: {
    backgroundColor: COLORS.gray50,
    borderStyle: 'dashed',
    borderColor: COLORS.gray300,
    shadowOpacity: 0,
    elevation: 0,
  },
  askCardViewed: {
    backgroundColor: COLORS.gray50,
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
    borderColor: COLORS.gray300,
    borderStyle: 'dashed',
    backgroundColor: COLORS.gray50,
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
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  // Viewed-state ring on a friend card — same 44dp footprint as the
  // gradient ring so the layout doesn't jump when an ask flips from
  // unviewed → viewed.
  askCardViewedRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
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
    color: COLORS.gray900,
  },
  askCardNameViewed: {
    color: COLORS.gray600,
  },
  askCardHandle: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 1,
  },
  askCardBody: {
    fontSize: 14,
    color: COLORS.gray800,
    lineHeight: 19,
  },
  askCardBodyViewed: {
    color: COLORS.gray500,
  },
  askCardBodyEmpty: {
    color: COLORS.gray500,
    fontStyle: 'italic',
  },
  askCardTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  askCardTagChip: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 100,
  },
  askCardTagChipViewed: {
    backgroundColor: COLORS.gray100,
  },
  askCardTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  askCardTagTextViewed: {
    color: COLORS.gray500,
  },
  // (askCardFooter / askCardTime / askCardTimeViewed removed alongside
  // the 24h countdown — body + tag chips now anchor the card bottom
  // via card flex layout, no explicit footer needed.)
});

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  handleBar: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.gray200, alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.gray900, marginBottom: 16 },
  input: {
    borderWidth: 1.5, borderColor: COLORS.gray200, borderRadius: 12,
    padding: 14, fontSize: 15, color: COLORS.gray900,
    minHeight: 80, textAlignVertical: 'top', lineHeight: 22,
  },
  charCount: { fontSize: 12, color: COLORS.gray400, textAlign: 'right', marginTop: 4, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: COLORS.gray700, marginBottom: 8 },
  tagScroll: { marginBottom: 16, flexGrow: 0 },
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  aiLoadingText: { fontSize: 13, color: COLORS.gray500 },
  aiHint: { fontSize: 13, color: COLORS.gray400, marginBottom: 16 },
  // Soft-grey hint shown immediately after an AI invocation that
  // returned zero suggestions (or failed). Same visual register as
  // aiHint so users read it as "FYI, here's what happened" rather
  // than "ERROR".
  aiNoResultHint: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 4,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  tagChip: {
    backgroundColor: COLORS.gray100, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
  },
  tagChipSelected: { backgroundColor: COLORS.piktag500 },
  tagChipText: { fontSize: 13, fontWeight: '500', color: COLORS.gray700 },
  tagChipTextSelected: { color: '#fff' },
  customRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
  },
  customInput: {
    flex: 1,
    borderWidth: 1.5, borderColor: COLORS.gray200, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: COLORS.gray900,
  },
  // Square-rounded 40×40 — borderRadius 12 matches the unified Plus
  // submit-button shape (AddTagScreen / ManageTagsScreen /
  // ActivityReviewScreen / HiddenTagEditor). Square-rounded reads as
  // a button; circle reads as a status pip.
  customAddBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
  },
  customAddBtnDisabled: { opacity: 0.4 },
  // Manual AI trigger — soft pill above the chip strip. Inline-row so the
  // spinner sits next to the label when loading.
  aiTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.piktag50,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  aiTriggerBtnDisabled: { opacity: 0.5 },
  aiTriggerText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // View-mode (existing ask) styles
  viewBodyWrap: {
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  viewBody: {
    fontSize: 15,
    color: COLORS.gray900,
    lineHeight: 22,
  },
  viewMeta: {
    fontSize: 12,
    color: COLORS.gray500,
    marginBottom: 16,
  },
  // Full-width single-button variants — used when the modal is in either
  // pure create (post only) or pure view (delete only) mode.
  submitBtnFull: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.piktag500,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  deleteBtnFull: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.gray200,
  },
  deleteBtnFullText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray700,
  },
});
