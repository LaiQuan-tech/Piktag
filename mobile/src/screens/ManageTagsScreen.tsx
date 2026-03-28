import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
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
import { X, Hash, EyeOff, Eye, Pin, GripVertical, Sparkles } from 'lucide-react-native';
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import { resolveTag, acceptSuggestion } from '../lib/tagResolver';
import type { Tag, UserTag, TagConcept } from '../types';
import type { SimilarConcept } from '../lib/tagResolver';

// ── Main screen ────────────────────────────────────────────────────────────

type ManageTagsScreenProps = {
  navigation: any;
};

export default function ManageTagsScreen({ navigation }: ManageTagsScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tagInput, setTagInput] = useState('');
  const [myTags, setMyTags] = useState<(UserTag & { tag?: Tag })[]>([]);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTag, setAddingTag] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedSemanticType, setSelectedSemanticType] = useState<string | null>(null);
  const [conceptSuggestions, setConceptSuggestions] = useState<SimilarConcept[]>([]);
  const [conceptMatch, setConceptMatch] = useState<{ tag: Tag; concept: TagConcept } | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────

  const loadMyTags = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('piktag_user_tags')
        .select('*, tag:piktag_tags(*)')
        .eq('user_id', user.id)
        .order('position');

      if (!error && data) {
        setMyTags(data);
      }
    } catch (err) {
      console.warn('[ManageTagsScreen] loadMyTags exception:', err);
    }
  }, [user]);

  const loadPopularTags = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(12);

      if (!error && data) {
        setPopularTags(data);
      }
    } catch (err) {
      console.warn('[ManageTagsScreen] loadPopularTags exception:', err);
    }
  }, []);

  // AI tag suggestions based on user's bio
  const loadAiSuggestions = useCallback(async () => {
    if (!user) return;
    try {
      setAiLoading(true);
      const { data: profile } = await supabase
        .from('piktag_profiles')
        .select('bio, full_name, location')
        .eq('id', user.id)
        .single();

      if (!profile?.bio) {
        setAiSuggestions([]);
        return;
      }

      // Use Gemini to generate tag suggestions from bio
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyB16HJ0z6FVImN04Kom5SJCWeV-_thsfRI`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Based on this person's bio, suggest 5-8 short hashtag keywords (without #). Return ONLY a JSON array of strings, nothing else.\n\nBio: ${profile.bio}\nName: ${profile.full_name || ''}\nLocation: ${profile.location || ''}` }] }],
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
        // Parse JSON array from response
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) {
          const tags = JSON.parse(match[0]) as string[];
          setAiSuggestions(tags.slice(0, 8));
        }
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
      try {
        await Promise.all([loadMyTags(), loadPopularTags(), loadAiSuggestions()]);
      } catch (err) {
        console.warn('[ManageTagsScreen] initial load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loadMyTags, loadPopularTags, loadAiSuggestions]);

  // ── Computed values ────────────────────────────────────────────────────

  const myTagNames = useMemo(
    () => myTags.map((t) => {
      const name = t.tag?.name ?? '';
      return name.startsWith('#') ? name : `#${name}`;
    }),
    [myTags],
  );

  const getTagDisplayName = useCallback(
    (userTag: UserTag & { tag?: Tag }) => {
      const name = userTag.tag?.name ?? '';
      return name.startsWith('#') ? name : `#${name}`;
    },
    [],
  );

  // ── Handlers ───────────────────────────────────────────────────────────

  const linkTagToUser = useCallback(async (tagId: string) => {
    if (!user) return false;
    const nextPosition = myTags.length;
    const { error: linkError } = await supabase
      .from('piktag_user_tags')
      .insert({
        user_id: user.id,
        tag_id: tagId,
        position: nextPosition,
        is_private: isPrivate,
        semantic_type: selectedSemanticType || null,
      });

    if (linkError) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
      return false;
    }

    await supabase.rpc('increment_tag_usage', { tag_id: tagId }).catch(() => {});
    return true;
  }, [user, myTags.length, isPrivate, selectedSemanticType, t]);

  const handleAddTag = useCallback(async () => {
    if (!user) return;
    const trimmed = tagInput.trim();
    if (!trimmed) return;

    const rawName = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    const displayName = `#${rawName}`;

    if (myTagNames.includes(displayName)) {
      Alert.alert(t('manageTags.alertTagExists'), t('manageTags.alertTagExistsMessage'));
      return;
    }

    setAddingTag(true);
    setConceptSuggestions([]);
    setConceptMatch(null);

    try {
      const result = await resolveTag(rawName, user.id);

      if (result.type === 'exact') {
        const mappedName = result.concept.canonical_name;
        if (mappedName !== rawName) {
          Alert.alert(
            t('manageTags.conceptMatchTitle'),
            t('manageTags.conceptMatchMessage', { input: rawName, concept: mappedName }),
          );
        }
        const ok = await linkTagToUser(result.tag.id);
        if (ok) {
          setTagInput('');
          setIsPrivate(false);
          setSelectedSemanticType(null);
          setConceptMatch(null);
          await Promise.all([loadMyTags(), loadPopularTags()]);
        }
      } else if (result.type === 'similar') {
        setConceptSuggestions(result.suggestions);
        setAddingTag(false);
        return;
      } else {
        const ok = await linkTagToUser(result.tag.id);
        if (ok) {
          setTagInput('');
          setIsPrivate(false);
          setSelectedSemanticType(null);
          await Promise.all([loadMyTags(), loadPopularTags()]);
        }
      }
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, tagInput, myTagNames, t, linkTagToUser, loadMyTags, loadPopularTags]);

  const handleAcceptSuggestion = useCallback(async (suggestion: SimilarConcept) => {
    if (!user) return;
    const rawName = tagInput.trim().replace(/^#/, '');
    setAddingTag(true);
    try {
      const result = await acceptSuggestion(rawName, suggestion.concept_id);
      if (!result) { Alert.alert(t('common.error'), t('manageTags.alertAddError')); return; }
      const ok = await linkTagToUser(result.tag.id);
      if (ok) {
        setTagInput('');
        setConceptSuggestions([]);
        await Promise.all([loadMyTags(), loadPopularTags()]);
      }
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, tagInput, t, linkTagToUser, loadMyTags, loadPopularTags]);

  const handleCreateNewAnyway = useCallback(async () => {
    if (!user) return;
    const rawName = tagInput.trim().replace(/^#/, '');
    if (!rawName) return;
    setAddingTag(true);
    setConceptSuggestions([]);
    try {
      const { data: concept, error: cErr } = await supabase
        .from('tag_concepts').insert({ canonical_name: rawName }).select('*').single();
      if (cErr || !concept) { Alert.alert(t('common.error'), t('manageTags.alertAddError')); return; }
      await supabase.from('tag_aliases').insert({ alias: rawName, concept_id: concept.id });
      const { data: tag, error: tErr } = await supabase
        .from('piktag_tags').insert({ name: rawName, concept_id: concept.id }).select('*').single();
      if (tErr || !tag) { Alert.alert(t('common.error'), t('manageTags.alertAddError')); return; }
      const ok = await linkTagToUser(tag.id);
      if (ok) {
        setTagInput('');
        await Promise.all([loadMyTags(), loadPopularTags()]);
      }
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, tagInput, t, linkTagToUser, loadMyTags, loadPopularTags]);

  const MAX_PINNED = 2;

  const handleTogglePin = useCallback(async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    const currentlyPinned = (userTag as any).is_pinned || false;
    if (!currentlyPinned) {
      const pinnedCount = myTags.filter((t) => (t as any).is_pinned).length;
      if (pinnedCount >= MAX_PINNED) {
        Alert.alert(t('manageTags.pinLimitTitle'), t('manageTags.pinLimitMessage', { max: MAX_PINNED }));
        return;
      }
    }
    const { error } = await supabase
      .from('piktag_user_tags')
      .update({ is_pinned: !currentlyPinned })
      .eq('id', userTag.id);
    if (!error) await loadMyTags();
  }, [user, myTags, t, loadMyTags]);

  const handleRemoveTag = useCallback(async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    setRemovingTagId(userTag.id);
    try {
      const { error } = await supabase.from('piktag_user_tags').delete().eq('id', userTag.id);
      if (error) {
        Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
        return;
      }
      if (userTag.tag_id) {
        await supabase.rpc('decrement_tag_usage', { tag_id: userTag.tag_id }).catch(() => {});
      }
      await Promise.all([loadMyTags(), loadPopularTags()]);
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
    } finally {
      setRemovingTagId(null);
    }
  }, [user, t, loadMyTags, loadPopularTags]);

  const handleAddPopularTag = useCallback(async (tag: Tag) => {
    if (!user) return;
    const displayName = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
    if (myTagNames.includes(displayName)) return;
    setAddingTag(true);
    try {
      const { error } = await supabase.from('piktag_user_tags').insert({
        user_id: user.id, tag_id: tag.id, position: myTags.length,
      });
      if (error) { Alert.alert(t('common.error'), t('manageTags.alertAddError')); return; }
      await supabase.rpc('increment_tag_usage', { tag_id: tag.id }).catch(() => {});
      await Promise.all([loadMyTags(), loadPopularTags()]);
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, myTagNames, myTags.length, t, loadMyTags, loadPopularTags]);

  const handleAddAiTag = useCallback(async (tagName: string) => {
    const displayName = `#${tagName}`;
    if (myTagNames.includes(displayName)) return;
    setTagInput(tagName);
    // Trigger add via the resolve flow
    setAddingTag(true);
    try {
      const result = await resolveTag(tagName, user?.id);
      if (result.type === 'exact' || result.type === 'new') {
        const tag = result.tag;
        const ok = await linkTagToUser(tag.id);
        if (ok) {
          setTagInput('');
          setAiSuggestions(prev => prev.filter(s => s !== tagName));
          await Promise.all([loadMyTags(), loadPopularTags()]);
        }
      }
    } catch (err) {
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, myTagNames, t, linkTagToUser, loadMyTags, loadPopularTags]);

  // Drag-to-reorder
  const handleDragEnd = useCallback(async ({ data }: { data: (UserTag & { tag?: Tag })[] }) => {
    setMyTags(data);
    // Batch update positions
    const updates = data.map((item, index) => ({
      id: item.id,
      position: index,
    }));
    for (const u of updates) {
      await supabase.from('piktag_user_tags').update({ position: u.position }).eq('id', u.id);
    }
  }, []);

  const handleGoBack = useCallback(() => {
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections");
  }, [navigation]);

  const togglePrivacy = useCallback(() => setIsPrivate((prev) => !prev), []);

  // ── Render drag item ───────────────────────────────────────────────────

  const renderTagItem = useCallback(({ item, drag, isActive }: RenderItemParams<UserTag & { tag?: Tag }>) => {
    const isPinned = (item as any).is_pinned;
    const isPrivateTag = (item as any).is_private;
    const displayName = getTagDisplayName(item);

    return (
      <ScaleDecorator>
        <TouchableOpacity
          activeOpacity={0.7}
          onLongPress={drag}
          disabled={isActive}
          style={[
            styles.tagRow,
            isActive && styles.tagRowActive,
            isPinned && styles.tagRowPinned,
          ]}
        >
          <View style={styles.dragHandle}>
            <GripVertical size={18} color={COLORS.gray400} />
          </View>
          <View style={styles.tagRowContent}>
            {isPinned && <Pin size={13} color={COLORS.piktag600} fill={COLORS.piktag600} />}
            {!isPinned && isPrivateTag && <EyeOff size={13} color={COLORS.gray400} />}
            <Text style={[styles.tagRowName, isPinned && styles.tagRowNamePinned]}>{displayName}</Text>
          </View>
          <View style={styles.tagRowActions}>
            <TouchableOpacity onPress={() => handleTogglePin(item)} style={styles.actionBtn}>
              <Pin size={16} color={isPinned ? COLORS.piktag600 : COLORS.gray400} fill={isPinned ? COLORS.piktag600 : 'none'} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleRemoveTag(item)}
              style={styles.actionBtn}
              disabled={removingTagId === item.id}
            >
              {removingTagId === item.id ? (
                <ActivityIndicator size={14} color={COLORS.red500} />
              ) : (
                <X size={16} color={COLORS.gray400} />
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  }, [getTagDisplayName, handleTogglePin, handleRemoveTag, removingTagId]);

  // ── Render ────────────────────────────────────────────────────────────

  // Filter AI suggestions that are already added
  const filteredAiSuggestions = useMemo(
    () => aiSuggestions.filter(s => !myTagNames.includes(`#${s}`)),
    [aiSuggestions, myTagNames],
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t('manageTags.headerTitle')}</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={handleGoBack} activeOpacity={0.6}>
          <X size={24} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {/* Scrollable content: Tags + AI suggestions */}
          <View style={styles.contentArea}>
            {/* My Tags — draggable list */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('manageTags.myTagsTitle')}</Text>
              <Text style={styles.sectionHint}>{t('manageTags.dragHint')}</Text>
            </View>

            {myTags.length === 0 ? (
              <Text style={styles.emptyText}>{t('manageTags.noTagsYet')}</Text>
            ) : (
              <DraggableFlatList
                data={myTags}
                onDragEnd={handleDragEnd}
                keyExtractor={(item) => item.id}
                renderItem={renderTagItem}
                containerStyle={styles.dragList}
              />
            )}

            {/* AI Suggestions */}
            {filteredAiSuggestions.length > 0 && (
              <View style={styles.aiSection}>
                <View style={styles.aiHeader}>
                  <Sparkles size={16} color={COLORS.piktag600} />
                  <Text style={styles.aiTitle}>{t('manageTags.aiSuggestionsTitle')}</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.aiChipsRow}>
                  {filteredAiSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={styles.aiChip}
                      onPress={() => handleAddAiTag(s)}
                      activeOpacity={0.7}
                      disabled={addingTag}
                    >
                      <Text style={styles.aiChipText}>#{s}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            {aiLoading && (
              <View style={styles.aiSection}>
                <ActivityIndicator size="small" color={COLORS.piktag500} />
              </View>
            )}

            {/* Concept Suggestions (from embedding) */}
            {conceptSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                <Text style={styles.suggestionsTitle}>{t('manageTags.suggestionsTitle')}</Text>
                {conceptSuggestions.map((s) => (
                  <TouchableOpacity
                    key={s.concept_id}
                    style={styles.suggestionChip}
                    onPress={() => handleAcceptSuggestion(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionText}>#{s.canonical_name}</Text>
                    <Text style={styles.suggestionScore}>{Math.round(s.similarity * 100)}%</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.createNewButton} onPress={handleCreateNewAnyway} activeOpacity={0.7}>
                  <Text style={styles.createNewText}>{t('manageTags.createNewAnyway')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Popular Tags */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('manageTags.popularTagsTitle')}</Text>
              <View style={styles.popularChips}>
                {popularTags.map((tag) => {
                  const dn = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
                  const isAdded = myTagNames.includes(dn);
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[styles.popularChip, isAdded && styles.popularChipAdded]}
                      onPress={() => handleAddPopularTag(tag)}
                      activeOpacity={0.7}
                      disabled={isAdded || addingTag}
                    >
                      <Text style={[styles.popularChipText, isAdded && styles.popularChipTextAdded]}>{dn}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Fixed bottom: Input bar */}
          <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
            {/* Privacy + Semantic type row */}
            <View style={styles.inputOptionsRow}>
              <TouchableOpacity style={styles.optionBtn} onPress={togglePrivacy} activeOpacity={0.7}>
                {isPrivate ? <EyeOff size={16} color={COLORS.piktag600} /> : <Eye size={16} color={COLORS.gray400} />}
                <Text style={[styles.optionText, isPrivate && styles.optionTextActive]}>
                  {isPrivate ? t('manageTags.privacyPrivate') : t('manageTags.privacyPublic')}
                </Text>
              </TouchableOpacity>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.semanticChipsRow}>
                {(['identity', 'skill', 'interest', 'social', 'meta'] as const).map((st) => (
                  <TouchableOpacity
                    key={st}
                    style={[styles.semanticMiniChip, selectedSemanticType === st && styles.semanticMiniChipActive]}
                    onPress={() => setSelectedSemanticType(selectedSemanticType === st ? null : st)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.semanticMiniText, selectedSemanticType === st && styles.semanticMiniTextActive]}>
                      {t(`semanticType.${st}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            {/* Input row */}
            <View style={styles.inputRow}>
              <Hash size={18} color={COLORS.gray400} />
              <TextInput
                style={styles.textInput}
                placeholder={t('manageTags.tagInputPlaceholder')}
                placeholderTextColor={COLORS.gray400}
                value={tagInput}
                onChangeText={setTagInput}
                returnKeyType="done"
                onSubmitEditing={handleAddTag}
                editable={!addingTag}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!tagInput.trim() || addingTag) && styles.sendBtnDisabled]}
                onPress={handleAddTag}
                disabled={!tagInput.trim() || addingTag}
                activeOpacity={0.7}
              >
                {addingTag ? (
                  <ActivityIndicator size={16} color={COLORS.white} />
                ) : (
                  <Text style={styles.sendBtnText}>{t('manageTags.addButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </GestureHandlerRootView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  closeBtn: {
    padding: 4,
  },
  keyboardView: {
    flex: 1,
  },
  contentArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Section
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: COLORS.gray400,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  // Draggable tag row
  dragList: {
    paddingHorizontal: 12,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginHorizontal: 8,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: COLORS.white,
  },
  tagRowActive: {
    backgroundColor: COLORS.gray50,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tagRowPinned: {
    backgroundColor: '#FFFBEB',
  },
  dragHandle: {
    paddingRight: 8,
  },
  tagRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagRowName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray900,
  },
  tagRowNamePinned: {
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  tagRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    padding: 6,
  },

  // AI Suggestions
  aiSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  aiTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  aiChipsRow: {
    gap: 8,
    paddingRight: 20,
  },
  aiChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200 || COLORS.piktag100 || '#F5E6B8',
  },
  aiChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.piktag600,
  },

  // Concept Suggestions
  suggestionsContainer: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
    marginBottom: 12,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  suggestionText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  suggestionScore: {
    fontSize: 13,
    color: COLORS.gray400,
  },
  createNewButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  createNewText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
    textDecorationLine: 'underline',
  },

  // Popular Tags
  popularChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    paddingBottom: 20,
  },
  popularChip: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  popularChipAdded: {
    backgroundColor: COLORS.piktag500,
    borderColor: COLORS.piktag500,
  },
  popularChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  popularChipTextAdded: {
    color: COLORS.gray900,
  },

  // Fixed bottom input bar
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
    backgroundColor: COLORS.white,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  inputOptionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: COLORS.gray50,
  },
  optionText: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  optionTextActive: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  semanticChipsRow: {
    gap: 6,
    flexDirection: 'row',
  },
  semanticMiniChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.gray50,
  },
  semanticMiniChipActive: {
    backgroundColor: COLORS.piktag50,
  },
  semanticMiniText: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  semanticMiniTextActive: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 24,
    paddingLeft: 14,
    paddingRight: 4,
    height: 48,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.gray900,
    padding: 0,
  },
  sendBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.gray900,
  },
});
