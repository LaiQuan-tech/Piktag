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
const MAX_BODY = 150;

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
};

function RotatingGradientRing({ colors, children }: RotatingGradientRingProps) {
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

  return (
    <View style={styles.ring}>
      {/* Rotating gradient layer sits behind the inner avatar circle.
          overflow: hidden + the parent's borderRadius clips the rotating
          rectangle to a perfect circle on Android (iOS does it natively). */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          styles.ringRotator,
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
      <View style={styles.ringInner}>{children}</View>
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

  return (
    <>
      <View style={styles.container}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* My Ask card */}
          <TouchableOpacity style={styles.storyItem} activeOpacity={0.7} onPress={() => setCreateVisible(true)}>
            {myAsk ? (
              <RotatingGradientRing colors={['#c44dff', '#8c52ff', '#5e2ce6', '#c44dff']}>
                {myAvatarUrl ? (
                  <Image source={{ uri: myAvatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
                ) : (
                  <InitialsAvatar name={myName} size={52} />
                )}
              </RotatingGradientRing>
            ) : (
              <View style={[styles.ring, styles.ringCreate]}>
                <View style={styles.ringInner}>
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
                  ) : (
                    <InitialsAvatar name={myName} size={52} />
                  )}
                </View>
                <View style={styles.plusBadge}>
                  <Plus size={12} color="#fff" strokeWidth={3} />
                </View>
              </View>
            )}
            <Text style={styles.storyName} numberOfLines={1}>
              {myAsk ? t('ask.yourAsk') : t('ask.newAsk')}
            </Text>
          </TouchableOpacity>

          {/* Friend Asks */}
          {visibleAsks.map((ask) => {
            const name = ask.author_full_name || ask.author_username || '?';
            const h = hoursLeft(ask.expires_at);
            const viewed = viewedAskIds.has(ask.ask_id);
            const avatar = ask.author_avatar_url ? (
              <Image source={{ uri: ask.author_avatar_url }} style={styles.avatar} cachePolicy="memory-disk" />
            ) : (
              <InitialsAvatar name={name} size={52} />
            );
            return (
              <TouchableOpacity
                key={ask.ask_id}
                style={styles.storyItem}
                activeOpacity={0.7}
                onPress={() => {
                  markAskViewed(ask.ask_id);
                  onPressUser(ask.author_id);
                }}
                onLongPress={() => handleAskLongPress(ask)}
                delayLongPress={350}
              >
                {viewed ? (
                  // IG "viewed" treatment — thin grey border, no gradient,
                  // no rotation. Stays in the row (sorted to the back) so
                  // the viewer can revisit if they need to.
                  <View style={[styles.ring, styles.ringViewed]}>
                    <View style={styles.ringInner}>{avatar}</View>
                  </View>
                ) : (
                  <RotatingGradientRing
                    colors={
                      ask.degree === 1
                        ? ['#ff5757', '#c44dff', '#8c52ff', '#ff5757']
                        : ['#60a5fa', '#818cf8', '#60a5fa']
                    }
                  >
                    {avatar}
                  </RotatingGradientRing>
                )}
                <Text style={[styles.storyName, viewed && styles.storyNameViewed]} numberOfLines={1}>{name}</Text>
                <Text style={[styles.storyLabel, viewed && styles.storyLabelViewed]} numberOfLines={1}>
                  {ask.title || ask.body.slice(0, 20)}
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
  const [saving, setSaving] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      setBody(existingAsk?.body || '');
      setAiNames([]);
      setCustomNames([]);
      setSelectedNames(new Set());
      setCustomInput('');
      setAiLoading(false);
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
    } else {
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start();
    }
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
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
      return;
    }
    setAiLoading(true);
    try {
      const { data } = await supabase.functions.invoke('suggest-tags', {
        body: JSON.stringify({ bio: trimmed, lang: 'the same language as the content' }),
      });
      const raw: string[] = data?.suggestions || [];
      const normalized = Array.from(
        new Set(
          raw
            .map((n) => normalizeTagName(n))
            .filter((n): n is string => !!n),
        ),
      ).slice(0, AI_SUGGESTION_CAP);
      setAiNames(normalized);
      // Default-select all AI suggestions, preserving any custom selections.
      setSelectedNames((prev) => {
        const next = new Set(prev);
        for (const name of normalized) next.add(name);
        return next;
      });
    } catch (err) {
      console.warn('AI tag suggest failed:', err);
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Debounce: trigger AI suggest 800ms after user stops typing (min 5 chars)
  const handleBodyChange = useCallback((text: string) => {
    setBody(text.slice(0, MAX_BODY));
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (text.trim().length >= 5) {
      suggestTimer.current = setTimeout(() => suggestTagsForBody(text), 800);
    } else {
      setAiNames([]);
    }
  }, [suggestTagsForBody]);

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

      const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
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
            <>
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

              {/* Manual AI trigger. The auto-debounce still fires 800ms after
                  the user stops typing, but in practice the trigger felt
                  invisible — users would type continuously and never see
                  suggestions. An explicit button makes the cause-and-effect
                  obvious and lets them re-roll if the first batch missed. */}
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
                    ✨ {t('ask.generateAiTags') || 'AI 生成標籤'}
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
                onPress={handleSubmit}
                disabled={saving || !body.trim() || selectedNames.size === 0}
                activeOpacity={0.8}
              >
                {saving ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={modalStyles.submitBtnText}>{t('ask.postAsk')}</Text>
                )}
              </TouchableOpacity>
            </>
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
    paddingHorizontal: 12,
    gap: 14,
  },
  storyItem: {
    alignItems: 'center',
    width: 72,
  },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
    // Clip the rotating gradient square's corners to the circle on
    // Android — iOS already does this automatically when borderRadius
    // is set, but Android needs the explicit overflow.
    overflow: 'hidden',
  },
  // Inner rotating layer. Inherits the ring's border-radius via
  // absoluteFill + the parent's overflow:hidden so the rotation looks
  // perfectly circular.
  ringRotator: {
    borderRadius: 32,
  },
  ringCreate: {
    borderWidth: 2,
    borderColor: COLORS.gray300,
    borderStyle: 'dashed',
    backgroundColor: COLORS.gray50,
  },
  // Viewed (IG-style) ring — thin grey outline, no gradient, no spin.
  // The ringInner still sits centered with the same 3px gap, mirroring
  // the active ring's geometry so the avatar doesn't shift on tap.
  ringViewed: {
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
  },
  ringInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  storyName: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.gray800,
    marginTop: 4,
    textAlign: 'center',
    width: 72,
  },
  storyNameViewed: {
    fontWeight: '500',
    color: COLORS.gray500,
  },
  storyLabel: {
    fontSize: 10,
    color: COLORS.gray500,
    textAlign: 'center',
    width: 72,
    marginTop: 1,
  },
  storyLabelViewed: {
    color: COLORS.gray400,
  },
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
  customAddBtn: {
    width: 40, height: 40, borderRadius: 20,
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
