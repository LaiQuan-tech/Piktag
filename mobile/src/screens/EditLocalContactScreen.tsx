// EditLocalContactScreen.tsx
//
// Manual single-contact entry — the "single-player CRM" surface.
// Before there's enough member density for matching/serendipity to
// pay off, a lone user can still get value: jot down people you
// meet (A is NOT a PikTag member yet), tag them, note where you
// met. The row lives in piktag_local_contacts (owner-private, RLS
// FOR ALL owner). When A later registers, the existing
// AFTER-INSERT trigger on piktag_profiles promotes the row into a
// real connection automatically (link, not merge — A never sees
// the owner's private note/tags). So this screen only has to do
// the create/edit/delete; the join is already solved server-side.
//
// Route params:
//   • none            → create mode
//   • { contactId }   → edit mode (loads from the useLocalContacts
//                        cache; falls back gracefully if missing)

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, X, Trash2 } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import BrandSpinner from '../components/loaders/BrandSpinner';

type Props = { navigation: any; route: any };

export default function EditLocalContactScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const contactId: string | undefined = route.params?.contactId;
  const { contacts, add, update, remove } = useLocalContacts();

  const existing = useMemo(
    () => (contactId ? contacts.find((c) => c.id === contactId) ?? null : null),
    [contactId, contacts],
  );
  const isEdit = !!contactId;

  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone_normalized ?? '');
  const [email, setEmail] = useState(existing?.email_lower ?? '');
  const [metLocation, setMetLocation] = useState(existing?.met_location ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const addTag = useCallback(() => {
    const raw = tagInput.trim().replace(/^#/, '');
    if (!raw) return;
    setTags((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
    setTagInput('');
  }, [tagInput]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(
        t('localContact.nameRequiredTitle', { defaultValue: '需要一個名字' }),
        t('localContact.nameRequiredMsg', { defaultValue: '至少幫這個人取個名字，方便你之後想起來。' }),
      );
      return;
    }
    setSaving(true);
    try {
      if (isEdit && contactId) {
        const ok = await update(contactId, {
          name: trimmed,
          // useLocalContacts.normalizePhone runs on add(); on update
          // we store what the user typed (still consistent — the
          // promotion trigger normalizes both sides the same way).
          phone_normalized: phone.trim() || null,
          email_lower: email.trim().toLowerCase() || null,
          met_location: metLocation.trim() || null,
          note: note.trim() || null,
          tags,
        });
        if (!ok) throw new Error('update failed');
      } else {
        const created = await add({
          name: trimmed,
          phone: phone.trim() || null,
          email: email.trim() || null,
          met_location: metLocation.trim() || null,
          note: note.trim() || null,
          tags,
        });
        if (!created) throw new Error('add failed');
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('localContact.saveError', { defaultValue: '存不起來，請稍後再試。' }),
      );
    } finally {
      setSaving(false);
    }
  }, [name, phone, email, metLocation, note, tags, isEdit, contactId, add, update, navigation, t]);

  const handleDelete = useCallback(() => {
    if (!contactId) return;
    Alert.alert(
      t('localContact.deleteTitle', { defaultValue: '刪除這個聯絡人？' }),
      t('localContact.deleteMsg', { defaultValue: '只會從你的清單移除，不影響其他人。' }),
      [
        { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: '刪除' }),
          style: 'destructive',
          onPress: async () => {
            const ok = await remove(contactId);
            if (ok) navigation.goBack();
          },
        },
      ],
    );
  }, [contactId, remove, navigation, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: '返回' })}
        >
          <ArrowLeft size={24} color={COLORS.gray900} strokeWidth={2.2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isEdit
            ? t('localContact.editTitle', { defaultValue: '編輯聯絡人' })
            : t('localContact.addTitle', { defaultValue: '新增聯絡人' })}
        </Text>
        {isEdit ? (
          <TouchableOpacity
            onPress={handleDelete}
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.delete', { defaultValue: '刪除' })}
          >
            <Trash2 size={20} color={COLORS.gray500} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>
            {t('localContact.intro', {
              defaultValue: '先把人記下來 —— 對方還不用是 PikTag 會員。等他加入，這筆會自動接上，你的標籤和備註都會跟著過去。',
            })}
          </Text>

          <Text style={styles.label}>
            {t('localContact.fieldName', { defaultValue: '名字' })}
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('localContact.namePlaceholder', { defaultValue: '例：在龍洞潛水認識的阿哲' })}
            placeholderTextColor={COLORS.gray400}
            maxLength={60}
            autoFocus={!isEdit}
          />

          <Text style={styles.label}>
            {t('localContact.fieldPhone', { defaultValue: '電話（選填，幫助對方加入後自動接上）' })}
          </Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder={t('localContact.phonePlaceholder', { defaultValue: '+886 912 345 678' })}
            placeholderTextColor={COLORS.gray400}
            keyboardType="phone-pad"
            autoCapitalize="none"
            maxLength={24}
          />

          <Text style={styles.label}>
            {t('localContact.fieldEmail', { defaultValue: 'Email（選填）' })}
          </Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t('localContact.emailPlaceholder', { defaultValue: 'name@example.com' })}
            placeholderTextColor={COLORS.gray400}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={120}
          />

          <Text style={styles.label}>
            {t('localContact.fieldMetWhere', { defaultValue: '在哪認識（選填）' })}
          </Text>
          <TextInput
            style={styles.input}
            value={metLocation}
            onChangeText={setMetLocation}
            placeholder={t('localContact.metWherePlaceholder', { defaultValue: '例：大學同學會、龍洞潛水' })}
            placeholderTextColor={COLORS.gray400}
            maxLength={80}
          />

          <Text style={styles.label}>
            {t('localContact.fieldNote', { defaultValue: '備註（只有你看得到）' })}
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={note}
            onChangeText={setNote}
            placeholder={t('localContact.notePlaceholder', { defaultValue: '幫你記住這個人的一句話' })}
            placeholderTextColor={COLORS.gray400}
            multiline
            maxLength={200}
            textAlignVertical="top"
          />

          <Text style={styles.label}>
            {t('localContact.fieldTags', { defaultValue: '標籤（只有你看得到）' })}
          </Text>
          {tags.length > 0 && (
            <View style={styles.tagWrap}>
              {tags.map((tg) => (
                <View key={tg} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>#{tg}</Text>
                  <TouchableOpacity
                    onPress={() => setTags((p) => p.filter((x) => x !== tg))}
                    hitSlop={6}
                  >
                    <X size={12} color={COLORS.piktag600} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <View style={styles.tagInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder={t('localContact.tagPlaceholder', { defaultValue: '輸入標籤…' })}
              placeholderTextColor={COLORS.gray400}
              returnKeyType="done"
              onSubmitEditing={addTag}
              maxLength={20}
            />
            <TouchableOpacity
              style={[styles.tagAddBtn, !tagInput.trim() && styles.tagAddBtnDisabled]}
              onPress={addTag}
              disabled={!tagInput.trim()}
              activeOpacity={0.7}
            >
              <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (saving || !name.trim()) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !name.trim()}
            activeOpacity={0.85}
          >
            {saving ? (
              <BrandSpinner size={20} />
            ) : (
              <Text style={styles.saveBtnText}>
                {t('localContact.save', { defaultValue: '儲存' })}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: COLORS.gray900 },
  scroll: { padding: 20, paddingBottom: 48 },
  intro: { fontSize: 13, color: COLORS.gray500, lineHeight: 19, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.gray700, marginBottom: 6, marginTop: 14 },
  input: {
    fontSize: 15,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 2,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  tagChipText: { fontSize: 13, fontWeight: '600', color: COLORS.piktag600 },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tagAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAddBtnDisabled: { opacity: 0.4 },
  saveBtn: {
    marginTop: 28,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: COLORS.gray200 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
