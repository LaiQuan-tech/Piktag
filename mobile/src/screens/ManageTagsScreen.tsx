import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X, Hash, EyeOff, Eye } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import type { Tag, UserTag } from '../types';

// ── Memoized sub-components ────────────────────────────────────────────────

type MyTagChipProps = {
  userTag: UserTag & { tag?: Tag };
  displayName: string;
  isRemoving: boolean;
  onRemove: (userTag: UserTag & { tag?: Tag }) => void;
};

const MyTagChip = React.memo(function MyTagChip({
  userTag,
  displayName,
  isRemoving,
  onRemove,
}: MyTagChipProps) {
  const handlePress = useCallback(() => {
    onRemove(userTag);
  }, [onRemove, userTag]);

  return (
    <View
      style={[
        styles.myTagChip,
        (userTag as any).is_private && styles.myTagChipPrivate,
      ]}
    >
      {(userTag as any).is_private && (
        <EyeOff size={12} color={COLORS.gray500} />
      )}
      <Text style={styles.myTagChipText}>{displayName}</Text>
      <TouchableOpacity
        onPress={handlePress}
        style={styles.chipRemoveBtn}
        activeOpacity={0.6}
        disabled={isRemoving}
      >
        {isRemoving ? (
          <ActivityIndicator size={14} color={COLORS.piktag600} />
        ) : (
          <X size={14} color={COLORS.piktag600} />
        )}
      </TouchableOpacity>
    </View>
  );
});

type PopularTagChipProps = {
  tag: Tag;
  isAdded: boolean;
  isDisabled: boolean;
  onPress: (tag: Tag) => void;
};

const PopularTagChip = React.memo(function PopularTagChip({
  tag,
  isAdded,
  isDisabled,
  onPress,
}: PopularTagChipProps) {
  const displayName = useMemo(
    () => (tag.name.startsWith('#') ? tag.name : `#${tag.name}`),
    [tag.name],
  );

  const handlePress = useCallback(() => {
    onPress(tag);
  }, [onPress, tag]);

  return (
    <TouchableOpacity
      style={[
        styles.popularTagChip,
        isAdded && styles.popularTagChipAdded,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={isAdded || isDisabled}
    >
      <Text
        style={[
          styles.popularTagChipText,
          isAdded && styles.popularTagChipTextAdded,
        ]}
      >
        {displayName}
      </Text>
    </TouchableOpacity>
  );
});

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

  // ── Data loading (useCallback + Promise.all) ───────────────────────────

  const loadMyTags = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('piktag_user_tags')
        .select('*, tag:piktag_tags(*)')
        .eq('user_id', user.id)
        .order('position');

      if (error) {
        console.warn('[ManageTagsScreen] loadMyTags error:', error.message);
      }
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

      if (error) {
        console.warn('[ManageTagsScreen] loadPopularTags error:', error.message);
      }
      if (!error && data) {
        setPopularTags(data);
      }
    } catch (err) {
      console.warn('[ManageTagsScreen] loadPopularTags exception:', err);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadMyTags(), loadPopularTags()]);
      } catch (err) {
        console.warn('[ManageTagsScreen] initial load error:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loadMyTags, loadPopularTags]);

  // ── Computed values (useMemo) ──────────────────────────────────────────

  const myTagNames = useMemo(
    () =>
      myTags.map((t) => {
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

  // ── Handlers (useCallback) ────────────────────────────────────────────

  const handleAddTag = useCallback(async () => {
    if (!user) return;
    const trimmed = tagInput.trim();
    if (!trimmed) return;

    // Normalize: remove leading # for DB storage, keep for display comparison
    const rawName = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    const displayName = `#${rawName}`;

    if (myTagNames.includes(displayName)) {
      Alert.alert(t('manageTags.alertTagExists'), t('manageTags.alertTagExistsMessage'));
      return;
    }

    setAddingTag(true);
    try {
      // 1. Check if tag exists
      let tagId: string;
      const { data: existingTag, error: findError } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', rawName)
        .single();

      if (findError) {
        console.warn('[ManageTagsScreen] handleAddTag findError:', findError.message);
      }

      if (existingTag && !findError) {
        tagId = existingTag.id;
      } else {
        // 2. Create new tag
        const { data: newTag, error: createError } = await supabase
          .from('piktag_tags')
          .insert({ name: rawName })
          .select('id')
          .single();

        if (createError || !newTag) {
          console.warn('[ManageTagsScreen] handleAddTag createError:', createError?.message);
          Alert.alert(t('common.error'), t('manageTags.alertAddError'));
          setAddingTag(false);
          return;
        }
        tagId = newTag.id;
      }

      // 3. Calculate next position
      const nextPosition = myTags.length;

      // 4. Link tag to user
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
        console.warn('[ManageTagsScreen] handleAddTag linkError:', linkError.message);
        Alert.alert(t('common.error'), t('manageTags.alertAddError'));
        setAddingTag(false);
        return;
      }

      // 5. Increment usage_count
      await supabase
        .from('piktag_tags')
        .update({ usage_count: (existingTag ? 1 : 1) })
        .eq('id', tagId);

      // Use RPC if available, otherwise do a raw increment
      await supabase.rpc('increment_tag_usage', { tag_id: tagId }).catch((err) => {
        // Fallback: just ignore if RPC doesn't exist, the update above is a basic fallback
        console.warn('[ManageTagsScreen] increment_tag_usage RPC fallback:', err);
      });

      // Reload tags
      setTagInput('');
      setIsPrivate(false);
      setSelectedSemanticType(null);
      await Promise.all([loadMyTags(), loadPopularTags()]);
    } catch (err) {
      console.warn('[ManageTagsScreen] handleAddTag exception:', err);
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [user, tagInput, myTagNames, myTags.length, isPrivate, selectedSemanticType, t, loadMyTags, loadPopularTags]);

  const handleRemoveTag = useCallback(
    async (userTag: UserTag & { tag?: Tag }) => {
      if (!user) return;
      setRemovingTagId(userTag.id);

      try {
        // 1. Delete from piktag_user_tags
        const { error: deleteError } = await supabase
          .from('piktag_user_tags')
          .delete()
          .eq('id', userTag.id);

        if (deleteError) {
          console.warn('[ManageTagsScreen] handleRemoveTag deleteError:', deleteError.message);
          Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
          setRemovingTagId(null);
          return;
        }

        // 2. Decrement usage_count on piktag_tags
        if (userTag.tag_id) {
          await supabase
            .rpc('decrement_tag_usage', { tag_id: userTag.tag_id })
            .catch(async (err) => {
              console.warn('[ManageTagsScreen] decrement_tag_usage RPC fallback:', err);
              // Fallback: manually decrement
              try {
                const { data: tagData } = await supabase
                  .from('piktag_tags')
                  .select('usage_count')
                  .eq('id', userTag.tag_id)
                  .single();

                if (tagData && tagData.usage_count > 0) {
                  await supabase
                    .from('piktag_tags')
                    .update({ usage_count: tagData.usage_count - 1 })
                    .eq('id', userTag.tag_id);
                }
              } catch (fallbackErr) {
                console.warn('[ManageTagsScreen] decrement fallback exception:', fallbackErr);
              }
            });
        }

        // Reload tags
        await Promise.all([loadMyTags(), loadPopularTags()]);
      } catch (err) {
        console.warn('[ManageTagsScreen] handleRemoveTag exception:', err);
        Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
      } finally {
        setRemovingTagId(null);
      }
    },
    [user, t, loadMyTags, loadPopularTags],
  );

  const handleAddPopularTag = useCallback(
    async (tag: Tag) => {
      if (!user) return;
      const displayName = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
      if (myTagNames.includes(displayName)) return;

      setAddingTag(true);
      try {
        const nextPosition = myTags.length;

        const { error: linkError } = await supabase
          .from('piktag_user_tags')
          .insert({
            user_id: user.id,
            tag_id: tag.id,
            position: nextPosition,
          });

        if (linkError) {
          console.warn('[ManageTagsScreen] handleAddPopularTag linkError:', linkError.message);
          Alert.alert(t('common.error'), t('manageTags.alertAddError'));
          setAddingTag(false);
          return;
        }

        // Increment usage_count
        await supabase
          .rpc('increment_tag_usage', { tag_id: tag.id })
          .catch(async (err) => {
            console.warn('[ManageTagsScreen] increment_tag_usage RPC fallback:', err);
            // Fallback
            try {
              await supabase
                .from('piktag_tags')
                .update({ usage_count: (tag.usage_count || 0) + 1 })
                .eq('id', tag.id);
            } catch (fallbackErr) {
              console.warn('[ManageTagsScreen] increment fallback exception:', fallbackErr);
            }
          });

        await Promise.all([loadMyTags(), loadPopularTags()]);
      } catch (err) {
        console.warn('[ManageTagsScreen] handleAddPopularTag exception:', err);
        Alert.alert(t('common.error'), t('manageTags.alertAddError'));
      } finally {
        setAddingTag(false);
      }
    },
    [user, myTagNames, myTags.length, t, loadMyTags, loadPopularTags],
  );

  // ── Stable event handler references ───────────────────────────────────

  const handleGoBack = useCallback(() => {
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections");
  }, [navigation]);

  const togglePrivacy = useCallback(() => {
    setIsPrivate((prev) => !prev);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>
          {t('manageTags.headerTitle')}
        </Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={handleGoBack}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('manageTags.closeAccessibilityLabel')}
        >
          <X size={24} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* My Tags Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('manageTags.myTagsTitle')}
            </Text>
            {myTags.length === 0 ? (
              <Text style={styles.emptyText}>
                {t('manageTags.noTagsYet')}
              </Text>
            ) : (
              <View style={styles.chipsContainer}>
                {myTags.map((userTag) => (
                  <MyTagChip
                    key={userTag.id}
                    userTag={userTag}
                    displayName={getTagDisplayName(userTag)}
                    isRemoving={removingTagId === userTag.id}
                    onRemove={handleRemoveTag}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Add Tag Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('manageTags.addTagTitle')}
            </Text>
            <View style={styles.inputRow}>
              <Hash size={20} color={COLORS.gray400} style={styles.inputIcon} />
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
            </View>
            <TouchableOpacity
              style={styles.privacyToggle}
              activeOpacity={0.7}
              onPress={togglePrivacy}
            >
              {isPrivate ? (
                <EyeOff size={18} color={COLORS.piktag600} />
              ) : (
                <Eye size={18} color={COLORS.gray400} />
              )}
              <Text style={[styles.privacyText, isPrivate && styles.privacyTextActive]}>
                {isPrivate ? t('manageTags.privacyPrivate') : t('manageTags.privacyPublic')}
              </Text>
            </TouchableOpacity>
            {/* Semantic Type Selector */}
            <View style={styles.semanticTypeRow}>
              <Text style={styles.semanticTypeLabel}>{t('semanticType.selectType')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.semanticTypeChips}>
                {(['identity', 'skill', 'interest', 'social', 'meta'] as const).map((st) => (
                  <TouchableOpacity
                    key={st}
                    style={[styles.semanticTypeChip, selectedSemanticType === st && styles.semanticTypeChipActive]}
                    onPress={() => setSelectedSemanticType(selectedSemanticType === st ? null : st)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.semanticTypeChipText, selectedSemanticType === st && styles.semanticTypeChipTextActive]}>
                      {t(`semanticType.${st}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <TouchableOpacity
              style={[styles.addButton, addingTag && styles.addButtonDisabled]}
              onPress={handleAddTag}
              activeOpacity={0.8}
              disabled={addingTag}
            >
              {addingTag ? (
                <ActivityIndicator size={18} color={COLORS.gray900} />
              ) : (
                <Text style={styles.addButtonText}>
                  {t('manageTags.addButton')}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Popular Tags Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('manageTags.popularTagsTitle')}
            </Text>
            <View style={styles.chipsContainer}>
              {popularTags.map((tag) => {
                const displayName = tag.name.startsWith('#')
                  ? tag.name
                  : `#${tag.name}`;
                const isAdded = myTagNames.includes(displayName);
                return (
                  <PopularTagChip
                    key={tag.id}
                    tag={tag}
                    isAdded={isAdded}
                    isDisabled={addingTag}
                    onPress={handleAddPopularTag}
                  />
                );
              })}
              {popularTags.length === 0 && (
                <Text style={styles.emptyText}>
                  {t('manageTags.noPopularTags')}
                </Text>
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

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
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  closeBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 14,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  myTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    gap: 6,
  },
  myTagChipPrivate: {
    backgroundColor: COLORS.gray100,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderStyle: 'dashed',
  },
  myTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.piktag600,
  },
  chipRemoveBtn: {
    padding: 2,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.gray100,
    marginHorizontal: 20,
    marginTop: 24,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.gray900,
    padding: 0,
  },
  privacyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 4,
  },
  privacyText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  privacyTextActive: {
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  addButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  addButtonDisabled: {
    opacity: 0.7,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  popularTagChip: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  popularTagChipAdded: {
    backgroundColor: COLORS.piktag500,
    borderColor: COLORS.piktag500,
  },
  popularTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  popularTagChipTextAdded: {
    color: COLORS.gray900,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingVertical: 8,
  },

  // Semantic Type Selector
  semanticTypeRow: {
    marginTop: 8,
  },
  semanticTypeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
    marginBottom: 8,
  },
  semanticTypeChips: {
    gap: 8,
    flexDirection: 'row',
  },
  semanticTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  semanticTypeChipActive: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  semanticTypeChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray600,
  },
  semanticTypeChipTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
});
