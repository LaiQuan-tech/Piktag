import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Pencil, Trash2, X, Hash, EyeOff, Eye } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import PlatformIcon from '../components/PlatformIcon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Biolink, Tag, UserTag } from '../types';

const PRESET_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'line', label: 'Line' },
  { key: 'website', label: '個人網站' },
  { key: 'custom', label: '自訂連結' },
];

const PLATFORM_PLACEHOLDERS: Record<string, string> = {
  instagram: 'https://instagram.com/你的帳號',
  facebook: 'https://facebook.com/你的帳號',
  linkedin: 'https://linkedin.com/in/你的帳號',
  line: 'https://line.me/ti/p/你的ID',
  website: 'https://你的網站.com',
  custom: 'https://',
};

type EditProfileScreenProps = {
  navigation: any;
};

type FormData = {
  full_name: string;
  username: string;
  bio: string;
  phone: string;
  email: string;
};

type BiolinkFormData = {
  platform: string;
  url: string;
  label: string;
};

// ── Memoized tag sub-components ─────────────────────────────────────────────

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
        styles.tag_myTagChip,
        (userTag as any).is_private && styles.tag_myTagChipPrivate,
      ]}
    >
      {(userTag as any).is_private && (
        <EyeOff size={12} color={COLORS.gray500} />
      )}
      <Text style={styles.tag_myTagChipText}>{displayName}</Text>
      <TouchableOpacity
        onPress={handlePress}
        style={styles.tag_chipRemoveBtn}
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
        styles.tag_popularTagChip,
        isAdded && styles.tag_popularTagChipAdded,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={isAdded || isDisabled}
    >
      <Text
        style={[
          styles.tag_popularTagChipText,
          isAdded && styles.tag_popularTagChipTextAdded,
        ]}
      >
        {displayName}
      </Text>
    </TouchableOpacity>
  );
});

// ── Main screen ──────────────────────────────────────────────────────────────

export default function EditProfileScreen({ navigation }: EditProfileScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id;

  const [form, setForm] = useState<FormData>({
    full_name: '',
    username: '',
    bio: '',
    phone: '',
    email: '',
  });
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Biolink modal state
  const [biolinkModalVisible, setBiolinkModalVisible] = useState(false);
  const [editingBiolink, setEditingBiolink] = useState<Biolink | null>(null);
  const [biolinkForm, setBiolinkForm] = useState<BiolinkFormData>({
    platform: '',
    url: '',
    label: '',
  });
  const [savingBiolink, setSavingBiolink] = useState(false);

  // Platform picker state
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');

  // Tags state
  const [userTags, setUserTags] = useState<(UserTag & { tag?: Tag })[]>([]);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [isTagPrivate, setIsTagPrivate] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) {
      Alert.alert(t('common.error'), t('editProfile.alertLoadError'));
      return;
    }
    if (data) {
      setForm({
        full_name: data.full_name || '',
        username: data.username || '',
        bio: data.bio || '',
        phone: data.phone || '',
        email: user?.email || '',
      });
      setAvatarUrl(data.avatar_url);
    }
  }, [userId, user?.email]);

  const fetchBiolinks = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    if (!error && data) {
      setBiolinks(data as Biolink[]);
    }
  }, [userId]);

  const fetchUserTags = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from('piktag_user_tags')
        .select('*, tag:piktag_tags(*)')
        .eq('user_id', userId)
        .order('position');

      if (error) {
        console.warn('[EditProfileScreen] fetchUserTags error:', error.message);
      }
      if (!error && data) {
        setUserTags(data);
      }
    } catch (err) {
      console.warn('[EditProfileScreen] fetchUserTags exception:', err);
    }
  }, [userId]);

  const fetchPopularTags = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('piktag_tags')
        .select('*')
        .order('usage_count', { ascending: false })
        .limit(12);

      if (error) {
        console.warn('[EditProfileScreen] fetchPopularTags error:', error.message);
      }
      if (!error && data) {
        setPopularTags(data);
      }
    } catch (err) {
      console.warn('[EditProfileScreen] fetchPopularTags exception:', err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      await Promise.all([
        fetchProfile(),
        fetchBiolinks(),
        fetchUserTags(),
        fetchPopularTags(),
      ]);
      if (isMounted) setLoading(false);
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [fetchProfile, fetchBiolinks, fetchUserTags, fetchPopularTags]);

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('piktag_profiles')
        .update({
          full_name: form.full_name.trim() || null,
          username: form.username.trim() || null,
          bio: form.bio.trim() || null,
          phone: form.phone.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        Alert.alert(t('common.error'), t('editProfile.alertSaveError'));
        return;
      }
      Alert.alert(t('editProfile.alertSuccessTitle'), t('editProfile.alertSuccessMessage'));
      navigation.goBack();
    } catch {
      Alert.alert(t('common.error'), t('editProfile.alertSaveError'));
    } finally {
      setSaving(false);
    }
  };

  // --- Biolink CRUD ---

  const openAddBiolinkModal = () => {
    setEditingBiolink(null);
    setBiolinkForm({ platform: '', url: '', label: '' });
    setBiolinkModalVisible(true);
  };

  const openEditBiolinkModal = (biolink: Biolink) => {
    setEditingBiolink(biolink);
    setBiolinkForm({
      platform: biolink.platform,
      url: biolink.url,
      label: biolink.label || '',
    });
    setBiolinkModalVisible(true);
  };

  const closeBiolinkModal = () => {
    setBiolinkModalVisible(false);
    setEditingBiolink(null);
    setBiolinkForm({ platform: '', url: '', label: '' });
  };

  const getIconUrl = (url: string): string | null => {
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch {
      return null;
    }
  };

  const handleSaveBiolink = async () => {
    if (!userId) return;
    if (!biolinkForm.platform.trim() || !biolinkForm.url.trim()) {
      Alert.alert(t('editProfile.alertHintTitle'), t('editProfile.alertFillRequired'));
      return;
    }

    const iconUrl = getIconUrl(biolinkForm.url.trim());

    setSavingBiolink(true);
    try {
      if (editingBiolink) {
        const { error } = await supabase
          .from('piktag_biolinks')
          .update({
            platform: biolinkForm.platform.trim(),
            url: biolinkForm.url.trim(),
            label: biolinkForm.label.trim() || null,
            icon_url: iconUrl,
          })
          .eq('id', editingBiolink.id);

        if (error) {
          Alert.alert(t('common.error'), t('editProfile.alertUpdateLinkError'));
          return;
        }
      } else {
        const nextPosition = biolinks.length;
        const { error } = await supabase
          .from('piktag_biolinks')
          .insert({
            user_id: userId,
            platform: biolinkForm.platform.trim(),
            url: biolinkForm.url.trim(),
            label: biolinkForm.label.trim() || null,
            icon_url: iconUrl,
            position: nextPosition,
            is_active: true,
          });

        if (error) {
          Alert.alert(t('common.error'), t('editProfile.alertAddLinkError'));
          return;
        }
      }

      closeBiolinkModal();
      await fetchBiolinks();
    } catch {
      Alert.alert(t('common.error'), t('editProfile.alertOperationError'));
    } finally {
      setSavingBiolink(false);
    }
  };

  const handleDeleteBiolink = (biolink: Biolink) => {
    Alert.alert(
      t('editProfile.alertDeleteLinkTitle'),
      t('editProfile.alertDeleteLinkMessage', { name: biolink.label || biolink.platform }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('piktag_biolinks')
              .delete()
              .eq('id', biolink.id);

            if (error) {
              Alert.alert(t('common.error'), t('editProfile.alertDeleteLinkError'));
              return;
            }
            // Refetch to update positions
            await fetchBiolinks();
          },
        },
      ]
    );
  };

  // --- Tag CRUD (immediate save, not tied to form save) ---

  const userTagNames = useMemo(
    () =>
      userTags.map((ut) => {
        const name = ut.tag?.name ?? '';
        return name.startsWith('#') ? name : `#${name}`;
      }),
    [userTags],
  );

  const getTagDisplayName = useCallback(
    (userTag: UserTag & { tag?: Tag }) => {
      const name = userTag.tag?.name ?? '';
      return name.startsWith('#') ? name : `#${name}`;
    },
    [],
  );

  const handleAddTag = useCallback(async () => {
    if (!userId) return;
    const trimmed = tagInput.trim();
    if (!trimmed) return;

    // Normalize: remove leading # for DB storage, keep for display comparison
    const rawName = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    const displayName = `#${rawName}`;

    if (userTagNames.includes(displayName)) {
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
        console.warn('[EditProfileScreen] handleAddTag findError:', findError.message);
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
          console.warn('[EditProfileScreen] handleAddTag createError:', createError?.message);
          Alert.alert(t('common.error'), t('manageTags.alertAddError'));
          setAddingTag(false);
          return;
        }
        tagId = newTag.id;
      }

      // 3. Calculate next position
      const nextPosition = userTags.length;

      // 4. Link tag to user
      const { error: linkError } = await supabase
        .from('piktag_user_tags')
        .insert({
          user_id: userId,
          tag_id: tagId,
          position: nextPosition,
          is_private: isTagPrivate,
        });

      if (linkError) {
        console.warn('[EditProfileScreen] handleAddTag linkError:', linkError.message);
        Alert.alert(t('common.error'), t('manageTags.alertAddError'));
        setAddingTag(false);
        return;
      }

      // 5. Increment usage_count via RPC, fallback to direct update
      await supabase
        .from('piktag_tags')
        .update({ usage_count: 1 })
        .eq('id', tagId);

      await supabase.rpc('increment_tag_usage', { tag_id: tagId }).catch((err) => {
        console.warn('[EditProfileScreen] increment_tag_usage RPC fallback:', err);
      });

      // Reload tags
      setTagInput('');
      setIsTagPrivate(false);
      await Promise.all([fetchUserTags(), fetchPopularTags()]);
    } catch (err) {
      console.warn('[EditProfileScreen] handleAddTag exception:', err);
      Alert.alert(t('common.error'), t('manageTags.alertAddError'));
    } finally {
      setAddingTag(false);
    }
  }, [userId, tagInput, userTagNames, userTags.length, isTagPrivate, t, fetchUserTags, fetchPopularTags]);

  const handleRemoveTag = useCallback(
    async (userTag: UserTag & { tag?: Tag }) => {
      if (!userId) return;
      setRemovingTagId(userTag.id);

      try {
        // 1. Delete from piktag_user_tags
        const { error: deleteError } = await supabase
          .from('piktag_user_tags')
          .delete()
          .eq('id', userTag.id);

        if (deleteError) {
          console.warn('[EditProfileScreen] handleRemoveTag deleteError:', deleteError.message);
          Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
          setRemovingTagId(null);
          return;
        }

        // 2. Decrement usage_count on piktag_tags
        if (userTag.tag_id) {
          await supabase
            .rpc('decrement_tag_usage', { tag_id: userTag.tag_id })
            .catch(async (err) => {
              console.warn('[EditProfileScreen] decrement_tag_usage RPC fallback:', err);
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
                console.warn('[EditProfileScreen] decrement fallback exception:', fallbackErr);
              }
            });
        }

        // Reload tags
        await Promise.all([fetchUserTags(), fetchPopularTags()]);
      } catch (err) {
        console.warn('[EditProfileScreen] handleRemoveTag exception:', err);
        Alert.alert(t('common.error'), t('manageTags.alertRemoveError'));
      } finally {
        setRemovingTagId(null);
      }
    },
    [userId, t, fetchUserTags, fetchPopularTags],
  );

  const handleAddPopularTag = useCallback(
    async (tag: Tag) => {
      if (!userId) return;
      const displayName = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
      if (userTagNames.includes(displayName)) return;

      setAddingTag(true);
      try {
        const nextPosition = userTags.length;

        const { error: linkError } = await supabase
          .from('piktag_user_tags')
          .insert({
            user_id: userId,
            tag_id: tag.id,
            position: nextPosition,
          });

        if (linkError) {
          console.warn('[EditProfileScreen] handleAddPopularTag linkError:', linkError.message);
          Alert.alert(t('common.error'), t('manageTags.alertAddError'));
          setAddingTag(false);
          return;
        }

        // Increment usage_count
        await supabase
          .rpc('increment_tag_usage', { tag_id: tag.id })
          .catch(async (err) => {
            console.warn('[EditProfileScreen] increment_tag_usage RPC fallback:', err);
            try {
              await supabase
                .from('piktag_tags')
                .update({ usage_count: (tag.usage_count || 0) + 1 })
                .eq('id', tag.id);
            } catch (fallbackErr) {
              console.warn('[EditProfileScreen] increment fallback exception:', fallbackErr);
            }
          });

        await Promise.all([fetchUserTags(), fetchPopularTags()]);
      } catch (err) {
        console.warn('[EditProfileScreen] handleAddPopularTag exception:', err);
        Alert.alert(t('common.error'), t('manageTags.alertAddError'));
      } finally {
        setAddingTag(false);
      }
    },
    [userId, userTagNames, userTags.length, t, fetchUserTags, fetchPopularTags],
  );

  const toggleTagPrivacy = useCallback(() => {
    setIsTagPrivate((prev) => !prev);
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('editProfile.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('editProfile.headerTitle')}</Text>
        <TouchableOpacity
          onPress={handleSave}
          activeOpacity={0.6}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.piktag600} />
          ) : (
            <Text style={styles.headerSaveText}>{t('editProfile.headerSave')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <Image
              source={
                avatarUrl
                  ? { uri: avatarUrl }
                  : { uri: 'https://picsum.photos/seed/profile/200/200' }
              }
              style={styles.avatar}
            />
            <TouchableOpacity style={styles.changeAvatarBtn} activeOpacity={0.7}>
              <Text style={styles.changeAvatarText}>{t('editProfile.changeAvatar')}</Text>
            </TouchableOpacity>
          </View>

          {/* Form Fields */}
          <View style={styles.formSection}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('editProfile.nameLabel')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.full_name}
                onChangeText={(v) => updateField('full_name', v)}
                placeholder={t('editProfile.namePlaceholder')}
                placeholderTextColor={COLORS.gray400}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('editProfile.usernameLabel')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.username}
                onChangeText={(v) => updateField('username', v)}
                placeholder={t('editProfile.usernamePlaceholder')}
                placeholderTextColor={COLORS.gray400}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('editProfile.bioLabel')}</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                value={form.bio}
                onChangeText={(v) => updateField('bio', v)}
                placeholder={t('editProfile.bioPlaceholder')}
                placeholderTextColor={COLORS.gray400}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('editProfile.phoneLabel')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.phone}
                onChangeText={(v) => updateField('phone', v)}
                placeholder={t('editProfile.phonePlaceholder')}
                placeholderTextColor={COLORS.gray400}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('editProfile.emailLabel')}</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputDisabled]}
                value={form.email}
                placeholder={t('editProfile.emailPlaceholder')}
                placeholderTextColor={COLORS.gray400}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={false}
              />
            </View>
          </View>

          {/* Biolinks Section */}
          <View style={styles.biolinksSection}>
            <Text style={styles.sectionTitle}>{t('editProfile.socialLinksTitle')}</Text>
            {biolinks.length === 0 && (
              <Text style={styles.emptyText}>{t('editProfile.noSocialLinks')}</Text>
            )}
            {biolinks.map((link) => (
              <View key={link.id} style={styles.biolinkItem}>
                {(link as any).icon_url ? (
                  <Image source={{ uri: (link as any).icon_url }} style={styles.biolinkIcon} />
                ) : null}
                <View style={styles.biolinkInfo}>
                  <Text style={styles.biolinkTitle}>
                    {link.label || link.platform}
                  </Text>
                  <Text style={styles.biolinkUrl} numberOfLines={1}>
                    {link.url}
                  </Text>
                </View>
                <View style={styles.biolinkActions}>
                  <TouchableOpacity
                    style={styles.biolinkActionBtn}
                    activeOpacity={0.6}
                    onPress={() => openEditBiolinkModal(link)}
                  >
                    <Pencil size={18} color={COLORS.gray500} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.biolinkActionBtn}
                    onPress={() => handleDeleteBiolink(link)}
                    activeOpacity={0.6}
                  >
                    <Trash2 size={18} color={COLORS.red500} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {/* Platform picker flow */}
            {!showPlatformPicker && !selectedPlatform && (
              <TouchableOpacity onPress={() => setShowPlatformPicker(true)} style={styles.addLinkBtn}>
                <Plus size={18} color={COLORS.piktag500} />
                <Text style={styles.addLinkBtnText}>新增連結</Text>
              </TouchableOpacity>
            )}

            {showPlatformPicker && !selectedPlatform && (
              <View style={styles.platformPicker}>
                <Text style={styles.pickerTitle}>選擇平台</Text>
                {PRESET_PLATFORMS.map((p) => (
                  <TouchableOpacity
                    key={p.key}
                    style={styles.platformOption}
                    onPress={() => {
                      setSelectedPlatform(p.key);
                      setShowPlatformPicker(false);
                      setNewLinkUrl(p.key !== 'custom' ? '' : '');
                      setNewLinkLabel(p.key === 'custom' ? '' : p.label);
                    }}
                  >
                    <PlatformIcon platform={p.key} size={28} />
                    <Text style={styles.platformOptionText}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => setShowPlatformPicker(false)}>
                  <Text style={styles.cancelText}>取消</Text>
                </TouchableOpacity>
              </View>
            )}

            {selectedPlatform && (
              <View style={styles.newLinkForm}>
                <View style={styles.newLinkHeader}>
                  <PlatformIcon platform={selectedPlatform} size={24} />
                  <Text style={styles.newLinkPlatformName}>
                    {PRESET_PLATFORMS.find(p => p.key === selectedPlatform)?.label}
                  </Text>
                </View>
                {selectedPlatform === 'custom' && (
                  <TextInput
                    style={styles.input}
                    placeholder="連結名稱"
                    value={newLinkLabel}
                    onChangeText={setNewLinkLabel}
                  />
                )}
                <TextInput
                  style={styles.input}
                  placeholder={PLATFORM_PLACEHOLDERS[selectedPlatform] || 'https://'}
                  value={newLinkUrl}
                  onChangeText={setNewLinkUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <View style={styles.newLinkActions}>
                  <TouchableOpacity onPress={() => { setSelectedPlatform(null); setNewLinkUrl(''); setNewLinkLabel(''); }} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={async () => {
                      if (!newLinkUrl.trim() || !userId) return;
                      const label = selectedPlatform === 'custom' ? newLinkLabel : PRESET_PLATFORMS.find(p => p.key === selectedPlatform)?.label ?? '';
                      const { data, error } = await supabase.from('piktag_biolinks').insert({
                        user_id: userId,
                        platform: selectedPlatform,
                        label,
                        url: newLinkUrl.trim(),
                        is_active: true,
                        position: biolinks.length,
                      }).select().single();
                      if (!error && data) {
                        setBiolinks(prev => [...prev, data]);
                        setSelectedPlatform(null);
                        setNewLinkUrl('');
                        setNewLinkLabel('');
                      }
                    }}
                  >
                    <Text style={styles.saveBtnText}>新增</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Tags Section */}
          <View style={styles.tag_divider} />

          {/* My Tags */}
          <View style={styles.tag_section}>
            <Text style={styles.sectionTitle}>{t('manageTags.myTagsTitle')}</Text>
            {userTags.length === 0 ? (
              <Text style={styles.emptyText}>{t('manageTags.noTagsYet')}</Text>
            ) : (
              <View style={styles.tag_chipsContainer}>
                {userTags.map((userTag) => (
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

          {/* Add Tag Input */}
          <View style={styles.tag_section}>
            <Text style={styles.sectionTitle}>{t('manageTags.addTagTitle')}</Text>
            <View style={styles.tag_inputRow}>
              <Hash size={20} color={COLORS.gray400} style={styles.tag_inputIcon} />
              <TextInput
                style={styles.tag_textInput}
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
              style={styles.tag_privacyToggle}
              activeOpacity={0.7}
              onPress={toggleTagPrivacy}
            >
              {isTagPrivate ? (
                <EyeOff size={18} color={COLORS.piktag600} />
              ) : (
                <Eye size={18} color={COLORS.gray400} />
              )}
              <Text style={[styles.tag_privacyText, isTagPrivate && styles.tag_privacyTextActive]}>
                {isTagPrivate ? t('manageTags.privacyPrivate') : t('manageTags.privacyPublic')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tag_addButton, addingTag && styles.tag_addButtonDisabled]}
              onPress={handleAddTag}
              activeOpacity={0.8}
              disabled={addingTag}
            >
              {addingTag ? (
                <ActivityIndicator size={18} color={COLORS.gray900} />
              ) : (
                <Text style={styles.tag_addButtonText}>{t('manageTags.addButton')}</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Popular Tags */}
          <View style={styles.tag_divider} />

          <View style={styles.tag_section}>
            <Text style={styles.sectionTitle}>{t('manageTags.popularTagsTitle')}</Text>
            <View style={styles.tag_chipsContainer}>
              {popularTags.map((tag) => {
                const displayName = tag.name.startsWith('#')
                  ? tag.name
                  : `#${tag.name}`;
                const isAdded = userTagNames.includes(displayName);
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
                <Text style={styles.emptyText}>{t('manageTags.noPopularTags')}</Text>
              )}
            </View>
          </View>

          {/* Save Button */}
          <View style={styles.saveSection}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              activeOpacity={0.8}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={COLORS.gray900} />
              ) : (
                <Text style={styles.saveButtonText}>{t('editProfile.saveChanges')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Biolink Add/Edit Modal */}
      <Modal
        visible={biolinkModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeBiolinkModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingBiolink ? t('editProfile.modalTitleEdit') : t('editProfile.modalTitleAdd')}
              </Text>
              <TouchableOpacity onPress={closeBiolinkModal} activeOpacity={0.6}>
                <X size={24} color={COLORS.gray900} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.platformLabel')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={biolinkForm.platform}
                  onChangeText={(v) =>
                    setBiolinkForm((prev) => ({ ...prev, platform: v }))
                  }
                  placeholder={t('editProfile.platformPlaceholder')}
                  placeholderTextColor={COLORS.gray400}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.urlLabel')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={biolinkForm.url}
                  onChangeText={(v) =>
                    setBiolinkForm((prev) => ({ ...prev, url: v }))
                  }
                  placeholder={t('editProfile.urlPlaceholder')}
                  placeholderTextColor={COLORS.gray400}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.displayNameLabel')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={biolinkForm.label}
                  onChangeText={(v) =>
                    setBiolinkForm((prev) => ({ ...prev, label: v }))
                  }
                  placeholder={t('editProfile.displayNamePlaceholder')}
                  placeholderTextColor={COLORS.gray400}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.modalSaveBtn,
                savingBiolink && styles.saveButtonDisabled,
              ]}
              onPress={handleSaveBiolink}
              activeOpacity={0.8}
              disabled={savingBiolink}
            >
              {savingBiolink ? (
                <ActivityIndicator size="small" color={COLORS.gray900} />
              ) : (
                <Text style={styles.modalSaveBtnText}>
                  {editingBiolink ? t('editProfile.modalButtonUpdate') : t('editProfile.modalButtonAdd')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  flex: {
    flex: 1,
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
  headerBackBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  headerSaveText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSection: {
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 8,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: COLORS.gray100,
    backgroundColor: COLORS.gray100,
  },
  changeAvatarBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  changeAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  formSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 16,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
    marginLeft: 4,
  },
  fieldInput: {
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
  },
  fieldInputMultiline: {
    minHeight: 100,
    paddingTop: 14,
  },
  fieldInputDisabled: {
    opacity: 0.6,
  },
  biolinksSection: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    marginBottom: 8,
  },
  biolinkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  biolinkIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginRight: 10,
    backgroundColor: COLORS.gray100,
  },
  biolinkInfo: {
    flex: 1,
    marginRight: 12,
  },
  biolinkTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  biolinkUrl: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  biolinkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  biolinkActionBtn: {
    padding: 6,
  },
  addBiolinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    gap: 8,
  },
  addBiolinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  saveSection: {
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  saveButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  modalBody: {
    gap: 16,
  },
  modalSaveBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  modalSaveBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  // Tag styles (prefixed with tag_ to avoid conflicts)
  tag_section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  tag_divider: {
    height: 1,
    backgroundColor: COLORS.gray100,
    marginHorizontal: 20,
    marginTop: 24,
  },
  tag_chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tag_myTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    gap: 6,
  },
  tag_myTagChipPrivate: {
    backgroundColor: COLORS.gray100,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderStyle: 'dashed',
  },
  tag_myTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.piktag600,
  },
  tag_chipRemoveBtn: {
    padding: 2,
  },
  tag_inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
  },
  tag_inputIcon: {
    marginRight: 10,
  },
  tag_textInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.gray900,
    padding: 0,
  },
  tag_privacyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 4,
  },
  tag_privacyText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  tag_privacyTextActive: {
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  tag_addButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  tag_addButtonDisabled: {
    opacity: 0.7,
  },
  tag_addButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  tag_popularTagChip: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  tag_popularTagChipAdded: {
    backgroundColor: COLORS.piktag500,
    borderColor: COLORS.piktag500,
  },
  tag_popularTagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  tag_popularTagChipTextAdded: {
    color: COLORS.gray900,
  },
  addLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  addLinkBtnText: {
    color: COLORS.piktag500,
    fontSize: 15,
    fontWeight: '500',
  },
  platformPicker: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  pickerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  platformOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  platformOptionText: {
    fontSize: 15,
    color: COLORS.gray900,
    fontWeight: '500',
  },
  newLinkForm: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  newLinkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  newLinkPlatformName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  newLinkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelText: {
    color: COLORS.gray500,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 8,
  },
  saveBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  saveBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
  },
});
