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
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Pencil, Trash2, X, Hash, EyeOff, Eye, Camera, GripVertical } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { requestMediaLibraryPermissionsAsync, launchImageLibraryAsync } from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import PlatformIcon from '../components/PlatformIcon';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Biolink, Tag, UserTag } from '../types';

// Platform labels that need i18n are resolved inside the component
const PRESET_PLATFORM_KEYS = ['phone', 'email', 'instagram', 'facebook', 'linkedin', 'line', 'website', 'custom'];

const PLATFORM_LABELS_STATIC: Record<string, string> = {
  phone: 'Phone',
  email: 'Email',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  line: 'Line',
};

// Fixed prefix shown as grey label; user only types the account/path part
const PLATFORM_PREFIXES: Record<string, string> = {
  phone: 'tel:',
  email: 'mailto:',
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  linkedin: 'https://linkedin.com/in/',
  line: 'https://line.me/ti/p/~',
  website: 'https://',
  custom: '',
};

const PLATFORM_PLACEHOLDER_KEYS: Record<string, string> = {
  phone: 'editProfile.phonePlaceholder',
  email: 'editProfile.emailPlaceholder',
  instagram: 'editProfile.accountName',
  facebook: 'editProfile.accountName',
  linkedin: 'editProfile.accountName',
  line: 'editProfile.lineId',
  website: 'editProfile.yourWebsite',
  custom: 'https://...',
};

type EditProfileScreenProps = {
  navigation: any;
};

type FormData = {
  full_name: string;
  username: string;
  headline: string;
  bio: string;
};

type BiolinkFormData = {
  platform: string;
  url: string;
  label: string;
  display_mode: 'icon' | 'card' | 'both';
  visibility: 'public' | 'friends' | 'close_friends' | 'private';
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
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id;

  const [form, setForm] = useState<FormData>({
    full_name: '',
    username: '',
    headline: '',
    bio: '',
  });
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Biolink modal state
  const [biolinkModalVisible, setBiolinkModalVisible] = useState(false);
  const [editingBiolink, setEditingBiolink] = useState<Biolink | null>(null);
  const [biolinkForm, setBiolinkForm] = useState<BiolinkFormData>({
    platform: '',
    url: '',
    label: '',
    display_mode: 'card',
    visibility: 'public',
  });
  const [savingBiolink, setSavingBiolink] = useState(false);

  // Platform picker state
  const [showPlatformPicker, setShowPlatformPicker] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [newLinkAccount, setNewLinkAccount] = useState('');
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
        headline: data.headline || '',
        bio: data.bio || '',
      });
      setAvatarUrl(data.avatar_url);
    }
  }, [userId, user?.email]);

  const handleChangeAvatar = useCallback(async () => {
    if (!userId) return;

    const { status } = await requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('需要相簿權限', '請在設定中允許存取相簿');
      return;
    }

    const result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${userId}/avatar.${ext}`;

    try {
      setUploadingAvatar(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('未登入');

      const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: `avatar.${ext}`,
        type: mimeType,
      } as any);

      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/avatars/${filePath}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: supabaseAnonKey,
            'x-upsert': 'true',
          },
          body: formData,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.message || '上傳失敗');
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from('piktag_profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
    } catch (err: any) {
      Alert.alert('上傳失敗', err.message || '請稍後再試');
    } finally {
      setUploadingAvatar(false);
    }
  }, [userId]);

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

  // Refresh tags when returning from ManageTagsScreen
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchUserTags();
    });
    return unsubscribe;
  }, [navigation, fetchUserTags]);

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
          headline: form.headline.trim() || null,
          bio: form.bio.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        Alert.alert(t('common.error'), t('editProfile.alertSaveError'));
        return;
      }
      Alert.alert(t('editProfile.alertSuccessTitle'), t('editProfile.alertSuccessMessage'));
      navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections");
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
      display_mode: biolink.display_mode || 'card',
      visibility: biolink.visibility || 'public',
    });
    setBiolinkModalVisible(true);
  };

  const closeBiolinkModal = () => {
    setBiolinkModalVisible(false);
    setEditingBiolink(null);
    setBiolinkForm({ platform: '', url: '', label: '', display_mode: 'card', visibility: 'public' });
  };

  const handleOpenLink = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
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
            display_mode: biolinkForm.display_mode,
            visibility: biolinkForm.visibility,
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
            display_mode: biolinkForm.display_mode,
            visibility: biolinkForm.visibility,
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

  const handleDragEnd = async ({ data }: { data: Biolink[] }) => {
    setBiolinks(data);
    // Update positions in DB
    try {
      await Promise.all(
        data.map((link, i) =>
          supabase.from('piktag_biolinks').update({ position: i }).eq('id', link.id)
        )
      );
    } catch {}
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

      try { await supabase.rpc('increment_tag_usage', { tag_id: tagId }); } catch(err) {
        console.warn("[EditProfileScreen] increment_tag_usage fallback:", err);
      }

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
          try {
            await supabase.rpc('decrement_tag_usage', { tag_id: userTag.tag_id });
          } catch {
            try {
              const { data: tagData } = await supabase
                .from('piktag_tags')
                .select('usage_count')
                .eq('id', userTag.tag_id)
                .single();
              if (tagData && tagData.usage_count > 0) {
                await supabase.from('piktag_tags').update({ usage_count: tagData.usage_count - 1 }).eq('id', userTag.tag_id);
              }
            } catch {}
          }
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
        try {
          await supabase.rpc('increment_tag_usage', { tag_id: tag.id });
        } catch {
          try {
            await supabase.from('piktag_tags').update({ usage_count: (tag.usage_count || 0) + 1 }).eq('id', tag.id);
          } catch {}
        }

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
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
          accessibilityLabel="返回"
          accessibilityRole="button"
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('editProfile.headerTitle')}</Text>
        <TouchableOpacity
          onPress={handleSave}
          activeOpacity={0.6}
          disabled={saving}
          accessibilityLabel="儲存"
          accessibilityRole="button"
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
          style={[styles.scrollView, { backgroundColor: colors.background }]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity onPress={handleChangeAvatar} activeOpacity={0.8} disabled={uploadingAvatar} accessibilityLabel="更換大頭貼" accessibilityRole="button">
              <Image
                source={
                  avatarUrl
                    ? { uri: avatarUrl }
                    : { uri: 'https://picsum.photos/seed/profile/200/200' }
                }
                style={styles.avatar}
              />
              <View style={styles.cameraBadge}>
                {uploadingAvatar
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Camera size={16} color={COLORS.white} />
                }
              </View>
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
              <Text style={styles.fieldLabel}>{t('editProfile.headlineLabel') || '職稱 / 身份'}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.headline}
                onChangeText={(v) => updateField('headline', v)}
                placeholder={t('editProfile.headlinePlaceholder') || '例：PM @ Google、自由接案設計師'}
                placeholderTextColor={COLORS.gray400}
                maxLength={50}
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
                numberOfLines={2}
                textAlignVertical="top"
                maxLength={80}
              />
            </View>

          </View>

          {/* Tags Section — navigate to ManageTagsScreen */}
          <View style={styles.tag_divider} />

          <View style={styles.tag_section}>
            <Text style={styles.sectionTitle}>{t('manageTags.myTagsTitle')}</Text>
            {userTags.length > 0 && (
              <View style={styles.tag_chipsContainer}>
                {userTags.map((userTag) => (
                  <View key={userTag.id} style={styles.tag_previewChip}>
                    <Text style={styles.tag_previewChipText}>
                      {getTagDisplayName(userTag)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.tag_manageButton}
              onPress={() => navigation.navigate('ManageTags')}
              activeOpacity={0.7}
            >
              <Text style={styles.tag_manageButtonText}>{t('manageTags.headerTitle')}</Text>
            </TouchableOpacity>
          </View>

          {/* Biolinks Section */}
          <View style={styles.biolinksSection}>
            <Text style={styles.sectionTitle}>{t('editProfile.socialLinksTitle')}</Text>
            {biolinks.length === 0 && (
              <Text style={styles.emptyText}>{t('editProfile.noSocialLinks')}</Text>
            )}
            <DraggableFlatList
              data={biolinks}
              keyExtractor={(item) => item.id}
              onDragEnd={handleDragEnd}
              scrollEnabled={false}
              renderItem={({ item: link, drag, isActive }: RenderItemParams<Biolink>) => (
                <ScaleDecorator>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleOpenLink(link.url)}
                    onLongPress={drag}
                    disabled={isActive}
                    style={[styles.biolinkItem, isActive && { backgroundColor: COLORS.gray50, borderRadius: 12 }]}
                  >
                    <TouchableOpacity onPressIn={drag} style={styles.biolinkDragHandle}>
                      <GripVertical size={20} color={COLORS.gray400} />
                    </TouchableOpacity>
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
                  </TouchableOpacity>
                </ScaleDecorator>
              )}
            />
            {/* Platform picker flow */}
            {!showPlatformPicker && !selectedPlatform && (
              <TouchableOpacity onPress={() => setShowPlatformPicker(true)} style={styles.addLinkBtn}>
                <Plus size={18} color={COLORS.piktag500} />
                <Text style={styles.addLinkBtnText}>{t('editProfile.addLink')}</Text>
              </TouchableOpacity>
            )}

            {showPlatformPicker && !selectedPlatform && (
              <View style={styles.platformPicker}>
                <Text style={styles.pickerTitle}>{t('editProfile.selectPlatform')}</Text>
                {PRESET_PLATFORM_KEYS.map((key) => {
                  const label = PLATFORM_LABELS_STATIC[key] || t(`editProfile.${key === 'website' ? 'personalWebsite' : 'customLink'}`);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.platformOption}
                      onPress={() => {
                        setSelectedPlatform(key);
                        setShowPlatformPicker(false);
                        setNewLinkAccount('');
                        setNewLinkLabel(key === 'custom' ? '' : label);
                      }}
                    >
                      <PlatformIcon platform={key} size={28} />
                      <Text style={styles.platformOptionText}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity onPress={() => setShowPlatformPicker(false)}>
                  <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {selectedPlatform && (
              <View style={styles.newLinkForm}>
                <View style={styles.newLinkHeader}>
                  <PlatformIcon platform={selectedPlatform} size={24} />
                  <Text style={styles.newLinkPlatformName}>
                    {PLATFORM_LABELS_STATIC[selectedPlatform] || t(`editProfile.${selectedPlatform === 'website' ? 'personalWebsite' : 'customLink'}`)}
                  </Text>
                </View>
                {selectedPlatform === 'custom' && (
                  <TextInput
                    style={styles.input}
                    placeholder={t('editProfile.linkName')}
                    value={newLinkLabel}
                    onChangeText={setNewLinkLabel}
                  />
                )}
                {/* Prefix + account input row */}
                <View style={styles.prefixInputRow}>
                  {PLATFORM_PREFIXES[selectedPlatform] ? (
                    <Text style={styles.prefixText} numberOfLines={1}>
                      {PLATFORM_PREFIXES[selectedPlatform]}
                    </Text>
                  ) : null}
                  <TextInput
                    style={styles.accountInput}
                    placeholder={PLATFORM_PLACEHOLDER_KEYS[selectedPlatform]?.startsWith('editProfile.') ? t(PLATFORM_PLACEHOLDER_KEYS[selectedPlatform]) : (PLATFORM_PLACEHOLDER_KEYS[selectedPlatform] || '')}
                    value={newLinkAccount}
                    onChangeText={setNewLinkAccount}
                    autoCapitalize="none"
                    keyboardType="url"
                    autoFocus
                  />
                </View>
                <View style={styles.newLinkActions}>
                  <TouchableOpacity onPress={() => { setSelectedPlatform(null); setNewLinkAccount(''); setNewLinkLabel(''); }} style={styles.cancelBtn}>
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={async () => {
                      if (!newLinkAccount.trim() || !userId) return;
                      const prefix = PLATFORM_PREFIXES[selectedPlatform] ?? '';
                      const fullUrl = selectedPlatform === 'custom'
                        ? newLinkAccount.trim()
                        : `${prefix}${newLinkAccount.trim()}`;
                      const label = selectedPlatform === 'custom' ? newLinkLabel : (PLATFORM_LABELS_STATIC[selectedPlatform] || t(`editProfile.${selectedPlatform === 'website' ? 'personalWebsite' : 'customLink'}`));
                      const { data, error } = await supabase.from('piktag_biolinks').insert({
                        user_id: userId,
                        platform: selectedPlatform,
                        label,
                        url: fullUrl,
                        is_active: true,
                        position: biolinks.length,
                      }).select().single();
                      if (!error && data) {
                        setBiolinks(prev => [...prev, data]);
                        setSelectedPlatform(null);
                        setNewLinkAccount('');
                        setNewLinkLabel('');
                      }
                    }}
                  >
                    <Text style={styles.saveBtnText}>{t('common.add') || '新增'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Save Button */}
          <View style={styles.saveSection}>
            <TouchableOpacity
              onPress={handleSave}
              activeOpacity={0.8}
              disabled={saving}
            >
              <LinearGradient
                colors={['#ff5757', '#c44dff', '#8c52ff']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>{t('editProfile.saveChanges')}</Text>
                )}
              </LinearGradient>
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
              {/* Display Mode Toggle */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.displayModeLabel') || '顯示方式'}</Text>
                <View style={styles.displayModeRow}>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'icon' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'icon' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'icon' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeIcon') || '圖示並排'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'card' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'card' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'card' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeCard') || '清單卡片'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'both' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'both' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'both' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeBoth') || '全部顯示'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Visibility Picker */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.visibilityLabel') || '誰能看到'}</Text>
                <View style={styles.visibilityRow}>
                  {([
                    { key: 'public', label: t('editProfile.visibilityPublic') || '公開' },
                    { key: 'friends', label: t('editProfile.visibilityFriends') || '朋友' },
                    { key: 'close_friends', label: t('editProfile.visibilityCloseFriends') || '摯友' },
                    { key: 'private', label: t('editProfile.visibilityPrivate') || '自己' },
                  ] as const).map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.visibilityBtn, biolinkForm.visibility === opt.key && styles.visibilityBtnActive]}
                      onPress={() => setBiolinkForm(prev => ({ ...prev, visibility: opt.key }))}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.visibilityBtnText, biolinkForm.visibility === opt.key && styles.visibilityBtnTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
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
    minHeight: 64,
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
  biolinkDragHandle: {
    paddingRight: 10,
    paddingVertical: 8,
    justifyContent: 'center',
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
    color: '#FFFFFF',
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
  displayModeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  displayModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.piktag200,
    alignItems: 'center',
  },
  displayModeBtnActive: {
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
  },
  displayModeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  displayModeBtnTextActive: {
    color: COLORS.piktag600,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: 6,
  },
  visibilityBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.piktag200,
    alignItems: 'center',
  },
  visibilityBtnActive: {
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
  },
  visibilityBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  visibilityBtnTextActive: {
    color: COLORS.piktag600,
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
    color: '#FFFFFF',
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
  tag_previewChip: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  tag_previewChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.piktag600,
  },
  tag_moreText: {
    fontSize: 13,
    color: COLORS.gray400,
    alignSelf: 'center',
  },
  tag_manageButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  tag_manageButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
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
    color: '#FFFFFF',
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
    color: COLORS.white,
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
  prefixInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray200 ?? '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  prefixText: {
    fontSize: 14,
    color: COLORS.gray400 ?? '#9CA3AF',
    flexShrink: 0,
  },
  accountInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900,
    padding: 0,
  },
  newLinkForm: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    gap: 12,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelText: {
    color: COLORS.piktag600,
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
