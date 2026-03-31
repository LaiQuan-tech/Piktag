import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, Hash, Pin, Sparkles, ArrowLeftRight, AlertTriangle } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import DraggableChips from '../components/DraggableChips';
import type { Tag, UserTag } from '../types';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const MAX_PINNED = 2;
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';


type ManageTagsScreenProps = { navigation: any };

export default function ManageTagsScreen({ navigation }: ManageTagsScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tagInput, setTagInput] = useState('');
  const [myTags, setMyTags] = useState<(UserTag & { tag?: Tag })[]>([]);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTag, setAddingTag] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null); // web only
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────

  const loadMyTags = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', user.id)
      .order('position');
    if (!error && data) setMyTags(data);
  }, [user]);

  const loadPopularTags = useCallback(async () => {
    const { data, error } = await supabase
      .from('piktag_tags')
      .select('*')
      .order('usage_count', { ascending: false })
      .limit(12);
    if (!error && data) setPopularTags(data);
  }, []);

  const loadAiSuggestions = useCallback(async () => {
    if (!user || !GEMINI_API_KEY) return;
    try {
      setAiLoading(true);
      const { data: profile } = await supabase
        .from('piktag_profiles')
        .select('bio, full_name, location')
        .eq('id', user.id)
        .single();
      if (!profile?.bio) { setAiSuggestions([]); return; }

      const userLang = profile.bio.match(/[\u4e00-\u9fff]/) ? '繁體中文' :
        profile.bio.match(/[\u3040-\u30ff]/) ? '日本語' :
        profile.bio.match(/[\uac00-\ud7af]/) ? '한국어' :
        profile.bio.match(/[\u0e00-\u0e7f]/) ? 'ภาษาไทย' : 'the same language as the bio';

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Based on this person's bio, suggest 5-8 short hashtag keywords (without #). Keywords MUST be in ${userLang}. Only use English for internationally recognized terms (e.g. PM, IoT, AI). Return ONLY a JSON array of strings, nothing else.\n\nBio: ${profile.bio}\nName: ${profile.full_name || ''}\nLocation: ${profile.location || ''}` }] }],
          }),
        }
      );
      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) setAiSuggestions((JSON.parse(match[0]) as string[]).slice(0, 8));
      }
    } catch (err) {
      console.warn('[ManageTagsScreen] loadAiSuggestions:', err);
    } finally {
      setAiLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Load tags + popular first (fast), show page immediately
      await Promise.all([loadMyTags(), loadPopularTags()]);
      if (!cancelled) setLoading(false);
      // AI suggestions load in background (slow, has its own aiLoading state)
      loadAiSuggestions();
    })();
    return () => { cancelled = true; };
  }, [user, loadMyTags, loadPopularTags, loadAiSuggestions]);

  // ── Computed ───────────────────────────────────────────────────────────

  const myTagNames = useMemo(
    () => myTags.map((ut) => {
      const name = ut.tag?.name ?? '';
      return name.startsWith('#') ? name : `#${name}`;
    }),
    [myTags],
  );

  const filteredAiSuggestions = useMemo(
    () => aiSuggestions.filter(s => !myTagNames.includes(`#${s}`)),
    [aiSuggestions, myTagNames],
  );

  const pinnedCount = useMemo(() => myTags.filter((t) => (t as any).is_pinned).length, [myTags]);

  // ── Helpers ──────────────────────────────────────────────────────────

  const findOrCreateTag = useCallback(async (name: string): Promise<string | null> => {
    let { data: tag } = await supabase
      .from('piktag_tags').select('id').eq('name', name).maybeSingle();
    if (!tag) {
      const { data: newTag } = await supabase
        .from('piktag_tags').insert({ name }).select('id').single();
      tag = newTag;
    }
    return tag?.id ?? null;
  }, []);

  const linkTagToUser = useCallback(async (tagId: string): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase
      .from('piktag_user_tags')
      .insert({ user_id: user.id, tag_id: tagId, position: myTags.length });
    if (error) return false;
    await supabase.rpc('increment_tag_usage', { tag_id: tagId }).catch(() => {});
    return true;
  }, [user, myTags.length]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleRemoveTag = useCallback(async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    setMyTags(prev => prev.filter(t => t.id !== userTag.id));
    try {
      await supabase.from('piktag_user_tags').delete().eq('id', userTag.id);
      if (userTag.tag_id) await supabase.rpc('decrement_tag_usage', { tag_id: userTag.tag_id }).catch(() => {});
    } catch { /* ignore */ }
    await loadMyTags();
  }, [user, loadMyTags]);

  const handleAddTag = useCallback(async () => {
    if (!user) return;
    const rawName = tagInput.trim().replace(/^#/, '');
    if (!rawName || myTags.length >= MAX_TAGS) return;
    if (myTagNames.includes(`#${rawName}`)) return;
    setMyTags(prev => [...prev, { id: `temp-${Date.now()}`, user_id: user.id, tag_id: '', tag: { id: '', name: rawName } } as any]);
    setTagInput('');
    try {
      const tagId = await findOrCreateTag(rawName);
      if (tagId) await linkTagToUser(tagId);
    } catch { /* ignore */ }
    await loadMyTags();
  }, [user, tagInput, myTags.length, myTagNames, findOrCreateTag, linkTagToUser, loadMyTags]);

  const handleAddPopularTag = useCallback(async (tag: Tag) => {
    if (!user || myTags.length >= MAX_TAGS) return;
    setMyTags(prev => [...prev, { id: `temp-${Date.now()}`, user_id: user.id, tag_id: tag.id, tag } as any]);
    try {
      await supabase.from('piktag_user_tags')
        .insert({ user_id: user.id, tag_id: tag.id, position: myTags.length });
      await supabase.rpc('increment_tag_usage', { tag_id: tag.id }).catch(() => {});
    } catch { /* ignore */ }
    await loadMyTags();
  }, [user, myTags.length, loadMyTags]);

  const handleAddAiTag = useCallback(async (tagName: string) => {
    if (!user || myTagNames.includes(`#${tagName}`) || myTags.length >= MAX_TAGS) return;
    setMyTags(prev => [...prev, { id: `temp-${Date.now()}`, user_id: user.id, tag_id: '', tag: { id: '', name: tagName } } as any]);
    setAiSuggestions(prev => prev.filter(s => s !== tagName));
    try {
      const tagId = await findOrCreateTag(tagName);
      if (tagId) await linkTagToUser(tagId);
    } catch { /* ignore */ }
    await loadMyTags();
  }, [user, myTagNames, myTags.length, findOrCreateTag, linkTagToUser, loadMyTags]);

  const handleTogglePin = useCallback(async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    const isPinned = (userTag as any).is_pinned || false;
    if (!isPinned && pinnedCount >= MAX_PINNED) return;
    const newPinned = !isPinned;
    // Optimistic: toggle pin + move to front (pin) or keep position (unpin)
    let newOrder: typeof myTags;
    setMyTags(prev => {
      const updated = prev.map(t => t.id === userTag.id ? { ...t, is_pinned: newPinned } as any : t);
      if (newPinned) {
        const tag = updated.find(t => t.id === userTag.id)!;
        const rest = updated.filter(t => t.id !== userTag.id);
        newOrder = [tag, ...rest];
      } else {
        newOrder = updated;
      }
      return newOrder;
    });
    // DB: update pin flag + positions (fire and forget)
    supabase.from('piktag_user_tags').update({ is_pinned: newPinned }).eq('id', userTag.id).then(() => {
      const order = newPinned
        ? [userTag, ...myTags.filter(t => t.id !== userTag.id)]
        : myTags;
      Promise.all(order.map((tag, i) =>
        supabase.from('piktag_user_tags').update({ position: i }).eq('id', tag.id)
      ));
    });
  }, [user, pinnedCount, myTags]);

  /** Chip reorder — save positions to DB */
  const handleChipReorder = useCallback(async (newItems: { id: string; label: string; isPinned?: boolean }[]) => {
    // Map back to myTags order
    const idOrder = newItems.map(i => i.id);
    const reordered = idOrder.map(id => myTags.find(t => t.id === id)).filter(Boolean) as typeof myTags;
    setMyTags(reordered);
    try {
      await Promise.all(reordered.map((tag, i) =>
        supabase.from('piktag_user_tags').update({ position: i }).eq('id', tag.id)
      ));
    } catch { await loadMyTags(); }
  }, [myTags, loadMyTags]);

  /** Chip double-tap → toggle pin */
  const handleChipDoubleTap = useCallback((chipItem: { id: string }) => {
    const ut = myTags.find(t => t.id === chipItem.id);
    if (ut) handleTogglePin(ut);
  }, [myTags, handleTogglePin]);

  /** Chip remove */
  const handleChipRemove = useCallback((chipItem: { id: string }) => {
    const ut = myTags.find(t => t.id === chipItem.id);
    if (ut) handleRemoveTag(ut);
  }, [myTags, handleRemoveTag]);

  /** Convert myTags to DraggableChips format */
  const chipItems = useMemo(() => myTags.map(ut => ({
    id: ut.id,
    label: (ut.tag?.name ?? '').startsWith('#') ? ut.tag!.name : `#${ut.tag?.name ?? ''}`,
    isPinned: (ut as any).is_pinned || false,
  })), [myTags]);

  /** Web: tap-to-swap */
  const handleTagTap = useCallback(async (tappedTag: UserTag & { tag?: Tag }) => {
    if (!selectedTagId) { setSelectedTagId(tappedTag.id); return; }
    if (selectedTagId === tappedTag.id) { setSelectedTagId(null); return; }
    const fromIdx = myTags.findIndex(t => t.id === selectedTagId);
    const toIdx = myTags.findIndex(t => t.id === tappedTag.id);
    if (fromIdx === -1 || toIdx === -1) { setSelectedTagId(null); return; }
    const updated = [...myTags];
    [updated[fromIdx], updated[toIdx]] = [updated[toIdx], updated[fromIdx]];
    setMyTags(updated);
    setSelectedTagId(null);
    try {
      await Promise.all(updated.map((tag, i) =>
        supabase.from('piktag_user_tags').update({ position: i }).eq('id', tag.id)
      ));
    } catch { await loadMyTags(); }
  }, [selectedTagId, myTags, loadMyTags]);

  const handleGoBack = useCallback(() => {
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections");
  }, [navigation]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t('manageTags.headerTitle')}</Text>
        <Pressable style={styles.doneBtn} onPress={handleGoBack}>
          <Text style={styles.doneBtnText}>{t('common.done') || '完成'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <View style={styles.flex1}>
          <ScrollView
            style={styles.flex1}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            scrollEnabled={!isDragging}
          >
            {/* Section header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('manageTags.publicTagsTitle')}</Text>
              <Text style={styles.sectionSubtitle}>{t('manageTags.publicTagsSubtitle')}</Text>
            </View>

            {/* Tag count + pin count */}
            <View style={styles.tagCountRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.tagCountText, myTags.length >= MAX_TAGS && { color: '#EF4444', fontWeight: '600' }]}>
                  {t('manageTags.tagCount', { count: myTags.length, max: MAX_TAGS })}
                </Text>
                {myTags.length >= MAX_TAGS && <AlertTriangle size={13} color="#EF4444" />}
              </View>
              {myTags.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Pin size={12} color={COLORS.gray400} />
                  <Text style={styles.tagCountText}>{pinnedCount}/{MAX_PINNED}</Text>
                </View>
              )}
            </View>

            {/* Hint */}
            {myTags.length > 1 && Platform.OS !== 'web' && (
              <Text style={styles.sortHint}>{t('manageTags.nativeHint') || '長按拖曳排序 · 雙擊置頂'}</Text>
            )}

            {/* My tags — native: draggable chips / web: tap-to-swap */}
            {Platform.OS !== 'web' ? (
              <DraggableChips
                items={chipItems}
                onReorder={handleChipReorder}
                onRemove={handleChipRemove}
                onDoubleTap={handleChipDoubleTap}
                onDragStateChange={setIsDragging}
              />
            ) : (
              <>
                {selectedTagId && (
                  <View style={styles.swapHintBar}>
                    <ArrowLeftRight size={14} color={COLORS.piktag600} />
                    <Text style={styles.swapHintText}>{t('manageTags.dragSelectTarget') || '點選要交換位置的標籤'}</Text>
                    <Pressable onPress={() => setSelectedTagId(null)}>
                      <Text style={styles.swapCancel}>{t('common.cancel') || '取消'}</Text>
                    </Pressable>
                  </View>
                )}
                <View style={styles.chipsWrap}>
                  {myTags.map((ut) => {
                    const isPinned = (ut as any).is_pinned;
                    const isSelected = ut.id === selectedTagId;
                    const name = ut.tag?.name ?? '';
                    const dn = name.startsWith('#') ? name : `#${name}`;
                    return (
                      <Pressable
                        key={ut.id}
                        style={[styles.chip, isPinned && styles.chipPinned, isSelected && styles.chipSelected]}
                        onPress={() => handleTagTap(ut)}
                        onLongPress={() => handleTogglePin(ut)}
                      >
                        {isPinned && <Pin size={11} color={COLORS.piktag600} fill={COLORS.piktag600} />}
                        <Text style={[styles.chipText, isPinned && styles.chipTextPinned]}>{dn}</Text>
                        <Pressable onPress={() => handleRemoveTag(ut)} style={styles.chipX}>
                          <X size={14} color={COLORS.gray400} />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                  {myTags.length === 0 && (
                    <Text style={styles.emptyText}>{t('manageTags.noTagsYet')}</Text>
                  )}
                </View>
              </>
            )}

            {/* AI Suggestions */}
            {filteredAiSuggestions.length > 0 && myTags.length < MAX_TAGS && (
              <View style={styles.aiSection}>
                <View style={styles.aiHeader}>
                  <Sparkles size={16} color={COLORS.piktag600} />
                  <Text style={styles.aiTitle}>{t('manageTags.aiSuggestionsTitle')}</Text>
                </View>
                <View style={styles.chipsWrap}>
                  {filteredAiSuggestions.map((s) => (
                    <Pressable key={s} style={styles.aiChip} onPress={() => handleAddAiTag(s)}>
                      <Text style={styles.aiChipText}>+ #{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            {aiLoading && (
              <View style={styles.aiSection}>
                <View style={styles.aiHeader}>
                  <Sparkles size={16} color={COLORS.piktag600} />
                  <Text style={styles.aiTitle}>{t('manageTags.aiSuggestionsTitle')}</Text>
                </View>
                <ActivityIndicator size="small" color={COLORS.piktag500} style={{ marginTop: 8 }} />
              </View>
            )}

            {/* Popular Tags */}
            {myTags.length < MAX_TAGS && (
              <View style={styles.popularSection}>
                <Text style={styles.popularTitle}>{t('manageTags.popularTagsTitle')}</Text>
                <View style={styles.chipsWrap}>
                  {popularTags.filter(tag => {
                    const dn = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
                    return !myTagNames.includes(dn);
                  }).map((tag) => {
                    const dn = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
                    return (
                      <Pressable key={tag.id} style={styles.popularChip} onPress={() => handleAddPopularTag(tag)}>
                        <Text style={styles.popularChipText}>+ {dn}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Fixed bottom input */}
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
              <View style={styles.inputRow}>
                <Hash size={18} color={COLORS.gray400} />
                <TextInput
                  style={styles.textInput}
                  placeholder={t('manageTags.tagInputPlaceholder')}
                  placeholderTextColor={COLORS.gray400}
                  value={tagInput}
                  onChangeText={(v) => v.length <= MAX_TAG_LENGTH && setTagInput(v)}
                  returnKeyType="done"
                  onSubmitEditing={handleAddTag}
                  editable={!addingTag}
                  maxLength={MAX_TAG_LENGTH}
                />
                <Text style={styles.charCount}>{tagInput.length}/{MAX_TAG_LENGTH}</Text>
                <Pressable
                  style={[styles.addBtn, (!tagInput.trim() || addingTag || myTags.length >= MAX_TAGS) && styles.addBtnDisabled]}
                  onPress={handleAddTag}
                >
                  {addingTag ? <ActivityIndicator size={14} color={COLORS.white} /> : <Text style={styles.addBtnText}>{t('manageTags.addButton')}</Text>}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray100,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: COLORS.gray900 },
  doneBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: COLORS.piktag500 },
  doneBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.white },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: 20 },

  sectionHeader: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: COLORS.gray900 },
  sectionSubtitle: { fontSize: 13, color: COLORS.gray500, marginTop: 2 },

  tagCountRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10,
  },
  tagCountText: { fontSize: 13, color: COLORS.gray500 },
  sortHint: { fontSize: 12, color: COLORS.gray400, paddingHorizontal: 20, marginBottom: 6 },

  // Web chips
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.gray100, borderRadius: 20,
    paddingVertical: 8, paddingLeft: 14, paddingRight: 6,
    borderWidth: 2, borderColor: 'transparent',
  },
  chipPinned: { backgroundColor: '#FFFBEB', borderColor: COLORS.piktag400 },
  chipSelected: { borderColor: COLORS.piktag500, backgroundColor: COLORS.piktag50 },
  chipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray900 },
  chipTextPinned: { fontWeight: '700', color: COLORS.piktag600 },
  chipX: { padding: 4 },
  emptyText: { fontSize: 14, color: COLORS.gray400, paddingHorizontal: 20, paddingVertical: 8 },

  // Swap hint (web)
  swapHintBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 20, marginBottom: 8, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: COLORS.piktag50, borderRadius: 10, borderWidth: 1, borderColor: COLORS.piktag500,
  },
  swapHintText: { flex: 1, fontSize: 13, color: COLORS.piktag600 },
  swapCancel: { fontSize: 13, fontWeight: '600', color: COLORS.gray500 },

  // AI
  aiSection: { paddingHorizontal: 20, paddingTop: 24 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  aiTitle: { fontSize: 15, fontWeight: '600', color: COLORS.piktag600 },
  aiChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: COLORS.piktag50, borderWidth: 1, borderColor: COLORS.piktag500,
  },
  aiChipText: { fontSize: 14, fontWeight: '500', color: COLORS.piktag600 },

  // Popular
  popularSection: { paddingHorizontal: 20, paddingTop: 24 },
  popularTitle: { fontSize: 15, fontWeight: '700', color: COLORS.gray900, marginBottom: 10 },
  popularChip: { borderWidth: 1, borderColor: COLORS.piktag500, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: COLORS.piktag50 },
  popularChipText: { fontSize: 14, fontWeight: '500', color: COLORS.piktag600 },

  // Bottom input
  inputBar: { borderTopWidth: 1, borderTopColor: COLORS.gray100, paddingHorizontal: 16, paddingTop: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray100,
    borderRadius: 24, paddingLeft: 14, paddingRight: 4, height: 48, gap: 8,
  },
  textInput: { flex: 1, fontSize: 16, color: COLORS.gray900, padding: 0 },
  charCount: { fontSize: 12, color: COLORS.gray400 },
  addBtn: { backgroundColor: COLORS.piktag500, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
