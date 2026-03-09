import React, { useState, useEffect } from 'react';
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
import { X, Hash, EyeOff, Eye } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import type { Tag, UserTag } from '../types';

type ManageTagsScreenProps = {
  navigation: any;
};

export default function ManageTagsScreen({ navigation }: ManageTagsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [tagInput, setTagInput] = useState('');
  const [myTags, setMyTags] = useState<(UserTag & { tag?: Tag })[]>([]);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTag, setAddingTag] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    if (user) {
      loadMyTags();
      loadPopularTags();
    }
  }, [user]);

  const loadMyTags = async () => {
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
    } catch {} finally {
      setLoading(false);
    }
  };

  const loadPopularTags = async () => {
    try {
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(12);

      if (!error && data) {
        setPopularTags(data);
      }
    } catch {}
  };

  const myTagNames = myTags.map((t) => {
    const name = t.tag?.name ?? '';
    return name.startsWith('#') ? name : `#${name}`;
  });

  const handleAddTag = async () => {
    if (!user) return;
    const trimmed = tagInput.trim();
    if (!trimmed) return;

    // Normalize: remove leading # for DB storage, keep for display comparison
    const rawName = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    const displayName = `#${rawName}`;

    if (myTagNames.includes(displayName)) {
      Alert.alert('\u6a19\u7c64\u5df2\u5b58\u5728', '\u6b64\u6a19\u7c64\u5df2\u5728\u4f60\u7684\u5217\u8868\u4e2d\u3002');
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
          Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u65b0\u589e\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
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
        });

      if (linkError) {
        Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u65b0\u589e\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
        setAddingTag(false);
        return;
      }

      // 5. Increment usage_count
      await supabase
        .from('piktag_tags')
        .update({ usage_count: (existingTag ? 1 : 1) })
        .eq('id', tagId);

      // Use RPC if available, otherwise do a raw increment
      await supabase.rpc('increment_tag_usage', { tag_id: tagId }).catch(() => {
        // Fallback: just ignore if RPC doesn't exist, the update above is a basic fallback
      });

      // Reload tags
      setTagInput('');
      setIsPrivate(false);
      await loadMyTags();
      loadPopularTags();
    } catch {
      Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u65b0\u589e\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
    } finally {
      setAddingTag(false);
    }
  };

  const handleRemoveTag = async (userTag: UserTag & { tag?: Tag }) => {
    if (!user) return;
    setRemovingTagId(userTag.id);

    try {
      // 1. Delete from piktag_user_tags
      const { error: deleteError } = await supabase
        .from('piktag_user_tags')
        .delete()
        .eq('id', userTag.id);

      if (deleteError) {
        Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u79fb\u9664\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
        setRemovingTagId(null);
        return;
      }

      // 2. Decrement usage_count on piktag_tags
      if (userTag.tag_id) {
        await supabase.rpc('decrement_tag_usage', { tag_id: userTag.tag_id }).catch(async () => {
          // Fallback: manually decrement
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
        });
      }

      // Reload tags
      await loadMyTags();
      loadPopularTags();
    } catch {
      Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u79fb\u9664\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
    } finally {
      setRemovingTagId(null);
    }
  };

  const handleAddPopularTag = async (tag: Tag) => {
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
        Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u65b0\u589e\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
        setAddingTag(false);
        return;
      }

      // Increment usage_count
      await supabase.rpc('increment_tag_usage', { tag_id: tag.id }).catch(async () => {
        // Fallback
        await supabase
          .from('piktag_tags')
          .update({ usage_count: (tag.usage_count || 0) + 1 })
          .eq('id', tag.id);
      });

      await loadMyTags();
      loadPopularTags();
    } catch {
      Alert.alert('\u932f\u8aa4', '\u7121\u6cd5\u65b0\u589e\u6a19\u7c64\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002');
    } finally {
      setAddingTag(false);
    }
  };

  const getTagDisplayName = (userTag: UserTag & { tag?: Tag }) => {
    const name = userTag.tag?.name ?? '';
    return name.startsWith('#') ? name : `#${name}`;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>
          {'\u6a19\u7c64\u7ba1\u7406'}
        </Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={'\u95dc\u9589'}
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
              {'\u6211\u7684\u6a19\u7c64'}
            </Text>
            {myTags.length === 0 ? (
              <Text style={styles.emptyText}>
                {'\u9084\u6c92\u6709\u6a19\u7c64\uff0c\u65b0\u589e\u4e00\u500b\u5427\uff01'}
              </Text>
            ) : (
              <View style={styles.chipsContainer}>
                {myTags.map((userTag) => (
                  <View key={userTag.id} style={[styles.myTagChip, (userTag as any).is_private && styles.myTagChipPrivate]}>
                    {(userTag as any).is_private && (
                      <EyeOff size={12} color={COLORS.gray500} />
                    )}
                    <Text style={styles.myTagChipText}>
                      {getTagDisplayName(userTag)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveTag(userTag)}
                      style={styles.chipRemoveBtn}
                      activeOpacity={0.6}
                      disabled={removingTagId === userTag.id}
                    >
                      {removingTagId === userTag.id ? (
                        <ActivityIndicator size={14} color={COLORS.piktag600} />
                      ) : (
                        <X size={14} color={COLORS.piktag600} />
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Add Tag Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {'\u65b0\u589e\u6a19\u7c64'}
            </Text>
            <View style={styles.inputRow}>
              <Hash size={20} color={COLORS.gray400} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                placeholder={'\u8f38\u5165\u65b0\u6a19\u7c64...'}
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
              onPress={() => setIsPrivate(!isPrivate)}
            >
              {isPrivate ? (
                <EyeOff size={18} color={COLORS.piktag600} />
              ) : (
                <Eye size={18} color={COLORS.gray400} />
              )}
              <Text style={[styles.privacyText, isPrivate && styles.privacyTextActive]}>
                {isPrivate ? '僅自己可見' : '公開標籤'}
              </Text>
            </TouchableOpacity>
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
                  {'\u65b0\u589e'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Popular Tags Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {'\u71b1\u9580\u6a19\u7c64\u63a8\u85a6'}
            </Text>
            <View style={styles.chipsContainer}>
              {popularTags.map((tag) => {
                const displayName = tag.name.startsWith('#')
                  ? tag.name
                  : `#${tag.name}`;
                const isAdded = myTagNames.includes(displayName);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    style={[
                      styles.popularTagChip,
                      isAdded && styles.popularTagChipAdded,
                    ]}
                    onPress={() => handleAddPopularTag(tag)}
                    activeOpacity={0.7}
                    disabled={isAdded || addingTag}
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
              })}
              {popularTags.length === 0 && (
                <Text style={styles.emptyText}>
                  {'\u66ab\u7121\u71b1\u9580\u6a19\u7c64'}
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
});
