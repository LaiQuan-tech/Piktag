// LocalContactsScreen.tsx
//
// Phase 3 of the cold-start UX overhaul. Single-page CRM surface for
// piktag_local_contacts — people the user has tagged but who haven't
// registered PikTag yet. Day-1 value prop: import or manually add
// people from your address book, tag them, watch them auto-promote
// to real friends when they later sign up.
//
// Sections:
//   * Header  — back, title, + add button (right)
//   * List    — local_contacts rows; tap opens edit modal
//   * Empty   — "import from contacts" + "manual add" CTAs
//   * Modals  — manual add / edit with name + phone + email + tags
//
// Tag editing reuses the same gray-unselected / purple-selected chip
// pattern as FriendDetail's pickModal so the design contract is
// consistent across the app.

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  StatusBar,
  Modal,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Plus,
  X,
  ChevronRight,
  Send,
  Trash2,
  UserPlus,
  Hash,
  Lock,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useLocalContacts, type LocalContact, normalizePhone } from '../hooks/useLocalContacts';
import InitialsAvatar from '../components/InitialsAvatar';
import BrandSpinner from '../components/loaders/BrandSpinner';
import type { Tag } from '../types';

type LocalContactsScreenProps = { navigation: any };

const MAX_TAGS_PER_CONTACT = 8;

export default function LocalContactsScreen({ navigation }: LocalContactsScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { contacts, loading, refresh, add, update, remove } = useLocalContacts();

  // Add / edit modal state. `editing` null = add new; otherwise the
  // row being edited.
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<LocalContact | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Pull popular tags from the same source EditProfile uses, for
  // quick tagging without typing.
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('piktag_tags')
        .select('id, name, usage_count, semantic_type')
        .order('usage_count', { ascending: false })
        .limit(15);
      if (data) setPopularTags(data as Tag[]);
    })();
  }, []);

  const openAdd = useCallback(() => {
    setEditing(null);
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormTags([]);
    setTagInput('');
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((contact: LocalContact) => {
    setEditing(contact);
    setFormName(contact.name);
    setFormPhone(contact.phone_normalized ?? '');
    setFormEmail(contact.email_lower ?? '');
    setFormTags(contact.tags ?? []);
    setTagInput('');
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditing(null);
  }, []);

  const toggleTag = useCallback((name: string) => {
    const trimmed = name.trim().replace(/^#/, '');
    if (!trimmed) return;
    setFormTags((prev) => {
      if (prev.includes(trimmed)) return prev.filter((t) => t !== trimmed);
      if (prev.length >= MAX_TAGS_PER_CONTACT) return prev;
      return [...prev, trimmed];
    });
  }, []);

  const addCustomTag = useCallback(() => {
    const trimmed = tagInput.trim().replace(/^#/, '');
    if (!trimmed) return;
    if (formTags.includes(trimmed)) {
      setTagInput('');
      return;
    }
    if (formTags.length >= MAX_TAGS_PER_CONTACT) return;
    setFormTags((prev) => [...prev, trimmed]);
    setTagInput('');
  }, [tagInput, formTags]);

  const handleSave = useCallback(async () => {
    if (!formName.trim()) {
      Alert.alert(
        t('localContacts.alertNameRequired') || '需要名字',
        t('localContacts.alertNameRequiredMsg') || '至少要為這位聯絡人取個名字',
      );
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const ok = await update(editing.id, {
          name: formName.trim(),
          phone_normalized: normalizePhone(formPhone),
          email_lower: formEmail ? formEmail.trim().toLowerCase() : null,
          tags: formTags,
        });
        if (!ok) {
          Alert.alert(t('common.error'), t('localContacts.alertSaveFailed') || '存檔失敗，請再試一次');
          return;
        }
      } else {
        const created = await add({
          name: formName.trim(),
          phone: formPhone || null,
          email: formEmail || null,
          tags: formTags,
        });
        if (!created) {
          Alert.alert(t('common.error'), t('localContacts.alertSaveFailed') || '存檔失敗，請再試一次');
          return;
        }
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  }, [editing, formName, formPhone, formEmail, formTags, add, update, t, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!editing) return;
    Alert.alert(
      t('localContacts.alertDeleteTitle') || '刪除聯絡人？',
      t('localContacts.alertDeleteMsg') || '這位聯絡人連同你貼的標籤都會從你的清單移除。',
      [
        { text: t('common.cancel') || '取消', style: 'cancel' },
        {
          text: t('common.delete') || '刪除',
          style: 'destructive',
          onPress: async () => {
            const ok = await remove(editing.id);
            if (ok) closeModal();
          },
        },
      ],
    );
  }, [editing, remove, t, closeModal]);

  // Compose an invite share message. CRITICAL: tags are NEVER included
  // in the share text — the user might have written sensitive private
  // notes ("前女友", "欠錢", "黑名單") that promote into hidden_tags
  // (is_private=true) and stay owner-only on the server. If we
  // interpolated those into the SMS body the user could accidentally
  // send their private CRM notes to the contact and the trust contract
  // is dead. The DB-side promotion still works — when the recipient
  // signs up the trigger silently transfers tags as hidden tags. The
  // share message is just a generic invite.
  const handleInvite = useCallback(
    async (contact: LocalContact) => {
      const message = t('localContacts.inviteMessage', {
        defaultValue: `嗨！我在用 PikTag — 一起來交換標籤吧：\nhttps://pikt.ag/download`,
      });
      try {
        await Share.share({ message });
      } catch {
        /* user cancelled */
      }
    },
    [t],
  );

  const renderItem = useCallback(
    ({ item }: { item: LocalContact }) => (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => openEdit(item)}
      >
        <View style={styles.avatarWrap}>
          <InitialsAvatar name={item.name} size={44} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.tags.length > 0 ? (
            <View style={styles.rowTagsLine}>
              {item.tags.slice(0, 3).map((tag) => (
                <View key={tag} style={styles.rowTagChip}>
                  <Text style={styles.rowTagText}>#{tag}</Text>
                </View>
              ))}
              {item.tags.length > 3 ? (
                <Text style={styles.rowTagOverflow}>+{item.tags.length - 3}</Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.rowSubtle}>
              {item.phone_normalized || item.email_lower || t('localContacts.noTagsYet') || '還沒貼標籤'}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.inviteBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            handleInvite(item);
          }}
          hitSlop={8}
        >
          <Send size={16} color={COLORS.piktag600} />
        </TouchableOpacity>
        <ChevronRight size={16} color={COLORS.gray400} />
      </Pressable>
    ),
    [openEdit, handleInvite, t],
  );

  const keyExtractor = useCallback((item: LocalContact) => item.id, []);

  const showEmpty = !loading && contacts.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} style={styles.headerBtn}>
          <ArrowLeft size={22} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('localContacts.title') || '標籤聯絡人'}
        </Text>
        <TouchableOpacity onPress={openAdd} hitSlop={8} style={styles.headerBtn}>
          <Plus size={22} color={COLORS.piktag600} />
        </TouchableOpacity>
      </View>

      {showEmpty ? (
        <View style={styles.emptyWrap}>
          <UserPlus size={56} color={COLORS.gray300} />
          <Text style={styles.emptyTitle}>
            {t('localContacts.emptyTitle') || '還沒有標籤聯絡人'}
          </Text>
          <View style={styles.emptyDescRow}>
            <Lock size={14} color={COLORS.gray500} />
            <Text style={styles.emptyDesc}>
              {t('localContacts.emptyDesc') ||
                '幫通訊錄裡的人貼上私人標籤（只有你看得到）— 等他們註冊 PikTag，標籤會自動轉成你好友頁裡的隱藏標籤，對方永遠不會看到。'}
            </Text>
          </View>
          <TouchableOpacity style={styles.emptyPrimaryBtn} onPress={openAdd} activeOpacity={0.85}>
            <Plus size={18} color={COLORS.white} />
            <Text style={styles.emptyPrimaryBtnText}>
              {t('localContacts.addManually') || '手動新增聯絡人'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.emptySecondaryBtn}
            onPress={() => navigation.navigate('ContactSync')}
            activeOpacity={0.7}
          >
            <Text style={styles.emptySecondaryBtnText}>
              {t('localContacts.importFromContacts') || '從通訊錄匯入'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={contacts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={refresh}
        />
      )}

      {/* Add / Edit modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeModal}>
            <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editing
                    ? t('localContacts.editTitle') || '編輯聯絡人'
                    : t('localContacts.addTitle') || '新增聯絡人'}
                </Text>
                <TouchableOpacity onPress={closeModal} hitSlop={8}>
                  <X size={22} color={COLORS.gray700} />
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {t('localContacts.fieldName') || '名字'} *
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formName}
                  onChangeText={setFormName}
                  placeholder={t('localContacts.fieldNamePlaceholder') || '李小明'}
                  placeholderTextColor={COLORS.gray400}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {t('localContacts.fieldPhone') || '電話'}
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formPhone}
                  onChangeText={setFormPhone}
                  placeholder="+886 912 345 678"
                  placeholderTextColor={COLORS.gray400}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {t('localContacts.fieldEmail') || 'Email'}
                </Text>
                <TextInput
                  style={styles.fieldInput}
                  value={formEmail}
                  onChangeText={setFormEmail}
                  placeholder="name@example.com"
                  placeholderTextColor={COLORS.gray400}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldHint}>
                  {t('localContacts.identityHint') ||
                    '電話或 Email 至少填一個 — 對方註冊 PikTag 時會用這個自動配對，把你的私人標籤搬進好友頁的隱藏區。'}
                </Text>
              </View>

              {/* Tags — privacy contract: ALL tags entered here are
                  PRIVATE. They live in piktag_local_contacts.tags and on
                  server-side promotion they become piktag_connection_tags
                  with is_private=true (hidden tags), only ever visible to
                  the owner. They are NEVER included in the invite share
                  message. Users may write sensitive private notes here
                  ("前女友", "欠錢", "黑名單") and need the strongest
                  possible visual contract that nobody else will see them. */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {t('localContacts.fieldTags') || '標籤'} ({formTags.length}/{MAX_TAGS_PER_CONTACT})
                </Text>
                <View style={styles.privacyHintRow}>
                  <Lock size={12} color={COLORS.gray500} />
                  <Text style={styles.privacyHintText}>
                    {t('localContacts.tagsPrivacyHint') ||
                      '只有你看得到的私人標籤 — 對方註冊 PikTag 後會出現在你好友頁的「隱藏標籤」區，永遠不會給對方或其他人看到。'}
                  </Text>
                </View>
                {formTags.length > 0 && (
                  <View style={styles.tagsRow}>
                    {formTags.map((tag) => (
                      <Pressable
                        key={tag}
                        style={styles.selectedTagChip}
                        onPress={() => toggleTag(tag)}
                      >
                        <Text style={styles.selectedTagText}>#{tag}</Text>
                        <X size={12} color={COLORS.piktag600} />
                      </Pressable>
                    ))}
                  </View>
                )}
                <View style={styles.tagInputRow}>
                  <Hash size={16} color={COLORS.gray400} />
                  <TextInput
                    style={styles.tagInput}
                    value={tagInput}
                    onChangeText={setTagInput}
                    placeholder={t('localContacts.tagInputPlaceholder') || '輸入新標籤'}
                    placeholderTextColor={COLORS.gray400}
                    onSubmitEditing={addCustomTag}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    style={[styles.tagAddBtn, !tagInput.trim() && styles.tagAddBtnDisabled]}
                    onPress={addCustomTag}
                    disabled={!tagInput.trim()}
                  >
                    <Plus size={16} color={COLORS.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
                {popularTags.length > 0 && (
                  <View style={styles.popularWrap}>
                    <Text style={styles.popularLabel}>
                      {t('localContacts.popularTagsLabel') || '熱門標籤（點擊加入）'}
                    </Text>
                    <View style={styles.tagsRow}>
                      {popularTags
                        .filter((tag) => !formTags.includes(tag.name.replace(/^#/, '')))
                        .slice(0, 12)
                        .map((tag) => (
                          <Pressable
                            key={tag.id}
                            style={styles.popularChip}
                            onPress={() => toggleTag(tag.name)}
                          >
                            <Text style={styles.popularChipText}>
                              #{tag.name.replace(/^#/, '')}
                            </Text>
                          </Pressable>
                        ))}
                    </View>
                  </View>
                )}
              </View>

              {/* Actions */}
              <View style={styles.modalActions}>
                {editing && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={handleDelete}
                    activeOpacity={0.7}
                  >
                    <Trash2 size={18} color={COLORS.red500} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, (saving || !formName.trim()) && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={saving || !formName.trim()}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <BrandSpinner size={16} />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {editing
                        ? t('common.save') || '儲存'
                        : t('common.add') || '新增'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerBtn: { padding: 4 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
    marginTop: 12,
  },
  emptyDescRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  emptyDesc: {
    flex: 1,
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'left',
    lineHeight: 19,
  },
  emptyPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: COLORS.piktag500,
    marginTop: 8,
  },
  emptyPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  emptySecondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  emptySecondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  rowPressed: {
    backgroundColor: COLORS.gray50,
  },
  avatarWrap: {
    width: 44,
    height: 44,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  rowSubtle: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  rowTagsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  rowTagChip: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 9999,
    backgroundColor: COLORS.piktag50,
  },
  rowTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  rowTagOverflow: {
    fontSize: 11,
    color: COLORS.gray500,
    fontWeight: '500',
    marginLeft: 2,
  },
  inviteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
  },
  // ── Modal ─────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray700,
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 11,
    color: COLORS.gray500,
    marginTop: 4,
    lineHeight: 16,
  },
  privacyHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 6,
  },
  privacyHintText: {
    flex: 1,
    fontSize: 11,
    color: COLORS.gray500,
    lineHeight: 16,
  },
  fieldInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    color: COLORS.gray900,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9999,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
  },
  selectedTagText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  tagInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: Platform.OS === 'ios' ? 6 : 2,
    color: COLORS.gray900,
  },
  tagAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
  },
  tagAddBtnDisabled: {
    backgroundColor: COLORS.gray300,
  },
  popularWrap: {
    marginTop: 10,
  },
  popularLabel: {
    fontSize: 12,
    color: COLORS.gray500,
    marginBottom: 6,
  },
  popularChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: COLORS.gray100,
  },
  popularChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
  },
  saveBtnDisabled: {
    backgroundColor: COLORS.gray300,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
});
