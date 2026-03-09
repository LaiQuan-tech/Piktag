import React, { useState, useEffect, useCallback } from 'react';
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
import { ArrowLeft, Plus, Pencil, Trash2, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Biolink } from '../types';

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

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchProfile(), fetchBiolinks()]);
      if (isMounted) setLoading(false);
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [fetchProfile, fetchBiolinks]);

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
            <TouchableOpacity
              style={styles.addBiolinkBtn}
              onPress={openAddBiolinkModal}
              activeOpacity={0.7}
            >
              <Plus size={20} color={COLORS.piktag600} />
              <Text style={styles.addBiolinkText}>{t('editProfile.addLink')}</Text>
            </TouchableOpacity>
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
});
