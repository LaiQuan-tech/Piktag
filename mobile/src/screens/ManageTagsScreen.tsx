import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, Hash, Sparkles, ArrowLeftRight, AlertTriangle, Plus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { logApiUsage } from '../lib/apiUsage';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
// DraggableChips uses react-native-reanimated which crashes on web
const DraggableChips = Platform.OS !== 'web' ? require('../components/DraggableChips').default : null;
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Tag, UserTag } from '../types';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
// Tag pinning ("標籤置頂") removed — reserved as a future paid
// feature. is_pinned column on piktag_user_tags stays in the schema
// for forward compatibility.


type ManageTagsScreenProps = { navigation: NativeStackNavigationProp<any> };

export default function ManageTagsScreen({ navigation }: ManageTagsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
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
  const [aiError, setAiError] = useState<string | null>(null);

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
      .select('id, name, usage_count, semantic_type')
      .order('usage_count', { ascending: false })
      .limit(12);
    // Cast at the Supabase boundary — `.select(...)` narrows to a
    // structural type (`{ id: any; name: any; ... }[]`) that doesn't
    // extend `Tag` even though the runtime shape matches. The cast
    // here is the canonical "trust the SQL projection" pattern;
    // promoting to `Tag[]` is safe because every column in the select
    // is also on Tag.
    if (!error && data) setPopularTags(data as Tag[]);
  }, []);

  const loadAiSuggestions = useCallback(async () => {
    if (!user) { setAiError('no user'); return; }
    setAiError(null);
    try {
      setAiLoading(true);

      const cacheKey = `piktag_ai_tags_${user.id}`;
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { suggestions, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < 24 * 60 * 60 * 1000 && suggestions?.length > 0) {
            setAiSuggestions(suggestions);
            return;
          }
        } catch {}
      }

      // Run profile + existing-tags fetches in parallel — both feed the
      // AI prompt and are independent.
      const [profileResp, existingTagsResp] = await Promise.all([
        supabase
          .from('piktag_profiles')
          .select('bio, full_name, location')
          .eq('id', user.id)
          .single(),
        supabase
          .from('piktag_user_tags')
          .select('tag:piktag_tags!tag_id(name)')
          .eq('user_id', user.id)
          .eq('is_private', false)
          .limit(10),
      ]);
      const profile = profileResp.data;
      const profileError = profileResp.error;
      if (profileError) {
        setAiError('無法載入個人資料：' + profileError.message);
        return;
      }

      const bioText = profile?.bio || '';
      const nameText = profile?.full_name || '';
      const locationText = profile?.location || '';

      const existingTags = existingTagsResp.data;
      const tagNames = (existingTags || []).map((et: any) => et.tag?.name).filter(Boolean).join(', ');

      const context = [bioText, nameText, locationText, tagNames].filter(Boolean).join('\n');
      if (!context.trim()) {
        setAiSuggestions([]);
        setAiError('請先填寫個人簡介、姓名或新增幾個標籤，AI 才能給你建議');
        return;
      }

      const userLang = context.match(/[\u4e00-\u9fff]/) ? '繁體中文' :
        context.match(/[\u3040-\u30ff]/) ? '日本語' :
        context.match(/[\uac00-\ud7af]/) ? '한국어' :
        context.match(/[\u0e00-\u0e7f]/) ? 'ภาษาไทย' : 'the same language as the content';

      logApiUsage('gemini_generate', { via: 'edge-fn' });
      const { data, error } = await supabase.functions.invoke<{
        suggestions?: string[];
        error?: string;
        detail?: string;
      }>('suggest-tags', {
        body: { bio: bioText, name: nameText, location: locationText, existingTags: tagNames, lang: userLang },
      });

      if (error) {
        console.warn('[ManageTagsScreen] Edge Function error:', error.message);
        setAiError(t('manageTags.aiErrorGeneric', { defaultValue: 'AI 推薦暫時無法使用，稍後再試' }));
        return;
      }
      if (!data || !Array.isArray(data.suggestions) || data.suggestions.length === 0) {
        console.warn('[ManageTagsScreen] AI suggestions empty:', data?.error, data?.detail);
        setAiError(t('manageTags.aiErrorGeneric', { defaultValue: 'AI 推薦暫時無法使用，稍後再試' }));
        return;
      }

      setAiSuggestions(data.suggestions);
      AsyncStorage.setItem(cacheKey, JSON.stringify({ suggestions: data.suggestions, timestamp: Date.now() }));
    } catch (err: any) {
      console.warn('[ManageTagsScreen] loadAiSuggestions:', err);
      setAiError(t('manageTags.aiErrorGeneric', { defaultValue: 'AI 推薦暫時無法使用，稍後再試' }));
    } finally {
      setAiLoading(false);
    }
  }, [user, t]);

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

  // ── Helpers ──────────────────────────────────────────────────────────

  const findOrCreateTag = useCallback(async (name: string): Promise<string | null> => {
    let { data: tag } = await supabase
      .from('piktag_tags').select('id').eq('name', name).maybeSingle();
    if (!tag) {
      // Guard against the select-then-insert race: if another client just
      // created this tag, the insert hits the unique index (Postgres error
      // 23505). Re-select to grab the winner's id.
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
    return tag?.id ?? null;
  }, []);

  const linkTagToUser = useCallback(async (tagId: string): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase
      .from('piktag_user_tags')
      .insert({ user_id: user.id, tag_id: tagId, position: myTags.length });
    if (error) return false;
    await supabase.rpc('increment_tag_usage', { tag_id: tagId });
    return true;
  }, [user, myTags.length]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleRemoveTag = useCallback(async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    setMyTags(prev => prev.filter(t => t.id !== userTag.id));
    try {
      await supabase.from('piktag_user_tags').delete().eq('id', userTag.id);
      if (userTag.tag_id) await supabase.rpc('decrement_tag_usage', { tag_id: userTag.tag_id });
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
      await supabase.rpc('increment_tag_usage', { tag_id: tag.id });
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

  /** Chip remove */
  const handleChipRemove = useCallback((chipItem: { id: string }) => {
    const ut = myTags.find(t => t.id === chipItem.id);
    if (ut) handleRemoveTag(ut);
  }, [myTags, handleRemoveTag]);

  /** Convert myTags to DraggableChips format */
  const chipItems = useMemo(() => myTags.map(ut => ({
    id: ut.id,
    label: (ut.tag?.name ?? '').startsWith('#') ? ut.tag!.name : `#${ut.tag?.name ?? ''}`,
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t('manageTags.headerTitle')}</Text>
        <Pressable style={styles.doneBtn} onPress={handleGoBack}>
          <Text style={styles.doneBtnText}>{t('common.done', { defaultValue: '完成' })}</Text>
        </Pressable>
      </View>

      {loading ? (
        <PageLoader />
      ) : (
        // KAV moved OUT to wrap both the ScrollView and the bottom input
        // bar. Previous structure wrapped only the bar with KAV, which
        // (with behavior='padding') just made the bar's own KAV taller
        // — the bar itself stayed glued to the bottom of the parent
        // flex layout and slid off-screen under the keyboard. With KAV
        // around the entire screen body, padding eats from the
        // ScrollView's space and the bar floats up cleanly above the
        // keyboard. keyboardVerticalOffset accounts for the absolute
        // header (~56dp) so the bar lands just above the keyboard.
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}
        >
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
              {/* Pin count badge removed — pinning is reserved for a
                  future paid feature. */}
            </View>

            {/* Hint — pin gesture removed with the feature. */}
            {myTags.length > 1 && Platform.OS !== 'web' && (
              <Text style={styles.sortHint}>{t('manageTags.nativeHintNoPin', { defaultValue: '長按拖曳排序' })}</Text>
            )}

            {/* My tags — native: draggable chips / web: tap-to-swap */}
            {Platform.OS !== 'web' ? (
              <DraggableChips
                items={chipItems}
                onReorder={handleChipReorder}
                onRemove={handleChipRemove}
                onDragStateChange={setIsDragging}
              />
            ) : (
              <>
                {selectedTagId && (
                  <View style={styles.swapHintBar}>
                    <ArrowLeftRight size={14} color={COLORS.piktag600} />
                    <Text style={styles.swapHintText}>{t('manageTags.dragSelectTarget', { defaultValue: '點選要交換位置的標籤' })}</Text>
                    <Pressable onPress={() => setSelectedTagId(null)}>
                      <Text style={styles.swapCancel}>{t('common.cancel', { defaultValue: '取消' })}</Text>
                    </Pressable>
                  </View>
                )}
                <View style={styles.chipsWrap}>
                  {myTags.map((ut) => {
                    const isSelected = ut.id === selectedTagId;
                    const name = ut.tag?.name ?? '';
                    const dn = name.startsWith('#') ? name : `#${name}`;
                    return (
                      <Pressable
                        key={ut.id}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => handleTagTap(ut)}
                      >
                        <Text style={styles.chipText}>{dn}</Text>
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
                      <Text style={styles.aiChipText}>#{s}</Text>
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
                <BrandSpinner size={16} style={{ marginTop: 8 }} />
              </View>
            )}
            {!aiLoading && aiError && filteredAiSuggestions.length === 0 && myTags.length < MAX_TAGS && (
              <View style={styles.aiSection}>
                <View style={styles.aiHeader}>
                  <Sparkles size={16} color={COLORS.piktag600} />
                  <Text style={styles.aiTitle}>{t('manageTags.aiSuggestionsTitle')}</Text>
                </View>
                <Text style={styles.aiErrorText}>{aiError}</Text>
                <Pressable
                  style={styles.aiRetryBtn}
                  onPress={() => {
                    // Clear cache so retry actually hits the API
                    if (user) AsyncStorage.removeItem(`piktag_ai_tags_${user.id}`);
                    loadAiSuggestions();
                  }}
                >
                  <Text style={styles.aiRetryText}>{t('common.retry')}</Text>
                </Pressable>
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
                        <Text style={styles.popularChipText}>{dn}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Fixed bottom input — now a sibling of ScrollView under the
              outer KAV. The KAV's padding (iOS) / height (Android)
              behavior pushes BOTH children up together, so the bar
              floats just above the keyboard while the ScrollView
              shrinks above. */}
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
              {/* Plus-icon submit — same affordance as AddTagScreen's
                  custom-tag input and AskStoryRow's create-ask badge.
                  Replaces the prior "新增" / "Add" text label so the
                  button width is locale-independent — long
                  translations ("Aggiungi", "Tambah", "Hinzufügen")
                  no longer push the input row out of shape. */}
              <Pressable
                style={styles.addBtn}
                onPress={handleAddTag}
                disabled={!tagInput.trim() || addingTag || myTags.length >= MAX_TAGS}
                accessibilityRole="button"
                accessibilityLabel={t('manageTags.addButton')}
              >
                {addingTag ? <BrandSpinner size={20} /> : <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  doneBtnText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
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

  // Web chips — already-added tags. Match the FriendDetail
  // pickModalTagSelected pattern for visual parity with the friend
  // tag picker: piktag50 fill + 1.5dp piktag500 border + bold
  // piktag600 text. (The `chipSelected` row below is a transient
  // "you've tapped this and we're waiting for the swap target" web-
  // only state — gets a slightly heavier border but the same fill.)
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.piktag50, borderRadius: 20,
    paddingVertical: 8, paddingLeft: 14, paddingRight: 6,
    borderWidth: 1.5, borderColor: COLORS.piktag500,
  },
  chipSelected: { borderColor: COLORS.piktag600, borderWidth: 2 },
  chipText: { fontSize: 14, fontWeight: '700', color: COLORS.piktag600 },
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
  // AI suggestion chip — UNSELECTED state. Mirrors FriendDetail
  // pickModalTag (gray100 fill, transparent border slot reserved at
  // 1.5dp so dimensions don't jump on press, gray700 text). On tap
  // the chip is added to "我的標籤" above where it picks up the
  // selected (purple) treatment — same gray-→-purple visual story
  // as the friend tag picker.
  aiChip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: COLORS.gray100, borderWidth: 1.5, borderColor: 'transparent',
  },
  aiChipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray700 },
  aiErrorText: { fontSize: 12, color: COLORS.gray500, marginTop: 4, lineHeight: 16 },
  aiRetryBtn: {
    marginTop: 10, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16,
    backgroundColor: COLORS.piktag50, borderWidth: 1, borderColor: COLORS.piktag500,
  },
  aiRetryText: { fontSize: 13, fontWeight: '600', color: COLORS.piktag600 },

  // Popular — same UNSELECTED treatment as aiChip. Both are "tap to
  // add" surfaces, both should read identically at rest.
  popularSection: { paddingHorizontal: 20, paddingTop: 24 },
  popularTitle: { fontSize: 15, fontWeight: '700', color: COLORS.gray900, marginBottom: 10 },
  popularChip: {
    borderWidth: 1.5, borderColor: 'transparent', borderRadius: 20,
    paddingVertical: 8, paddingHorizontal: 14, backgroundColor: COLORS.gray100,
  },
  popularChipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray700 },

  // Bottom input
  inputBar: { borderTopWidth: 1, borderTopColor: COLORS.gray100, paddingHorizontal: 16, paddingTop: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.gray100,
    borderRadius: 24, paddingLeft: 14, paddingRight: 4, height: 48, gap: 8,
  },
  textInput: { flex: 1, fontSize: 16, color: COLORS.gray900, padding: 0 },
  charCount: { fontSize: 12, color: COLORS.gray400 },
  // Square-rounded 40×40 submit button — borderRadius 12 (not 20=full
  // circle) matches AddTagScreen's reference custom-tag + button. The
  // square-rounded shape reads more clearly as "tap to submit" than a
  // circle, which can register as a status pip. Sits inside the
  // 48px-tall inputRow (paddingRight: 4 leaves 4px each side).
  addBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // addBtnDisabled removed — button stays full piktag500 even when
  // input is empty / cap hit. The `disabled` prop on the Pressable
  // continues to block taps. Matches EditProfileScreen.tag_addBtn and
  // HiddenTagEditor.addBtn so the + reads the same across the app.
});
