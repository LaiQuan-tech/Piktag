// EditLocalContactScreen.tsx
//
// Manual single-contact entry — the "single-player CRM" surface.
// Before there's enough member density for matching/serendipity to
// pay off, a lone user can still get value: jot down people you
// meet (A is NOT a PikTag member yet) and tag them. The fields
// mirror the member profile (name · 職稱 · phone · email · birthday)
// so the data fuses cleanly when A registers. The row lives in
// piktag_local_contacts (owner-private, RLS FOR ALL owner). When A
// later registers, the existing AFTER-INSERT trigger on
// piktag_profiles promotes the row into a real connection
// automatically (link, not merge — A never sees the owner's private
// #tags). So this screen only has to do the create/edit/delete;
// the join is already solved server-side.
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, X, Trash2, ScanLine, Sparkles, RefreshCw } from 'lucide-react-native';
import {
  requestCameraPermissionsAsync,
  launchCameraAsync,
} from 'expo-image-picker';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import { supabase } from '../lib/supabase';
import { logApiUsage } from '../lib/apiUsage';
import { toBirthdayDate } from '../lib/birthday';
import BrandSpinner from '../components/loaders/BrandSpinner';

type Props = { navigation: any; route: any };

// Subset of the scan-business-card edge function's response that's
// relevant to a private local contact. The function returns more
// (website/instagram/…) but a local contact has no biolinks. The
// scanned job title / company map to the member-aligned 職稱
// (headline) field; bio_draft has no contact field of its own so it
// only feeds the AI tag context (not silently stored anywhere).
type CardData = {
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  bio_draft: string | null;
  phone: string | null;
  email: string | null;
};

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
  // The local-contact fields are aligned 1:1 with a member's profile
  // identity fields: name / 職稱(headline) / phone / email / birthday
  // (+ the private #tags layer, PikTag's core mechanic). There is NO
  // freeform "備註/note" field — a member profile has no such field,
  // so neither does a contact. The scan-only "where you met" was
  // removed for the same reason (it's auto-captured from QR context
  // for real connections, never hand-typed). birthday is a first-class
  // member field (drives reminders); it lives in the local-contact
  // model already and the promote trigger maps it 1:1.
  // Storage is YYYY-MM-DD (date-castable — promote copies this text
  // into piktag_connections.birthday, a DATE column). For the input
  // we show the friendly year-less MM-DD when the year is the 2000
  // sentinel, else the full YYYY-MM-DD. Re-saves correctly either
  // way (toBirthdayDate re-expands). Junk falls through raw.
  const birthdayForInput = (stored: string | null | undefined): string => {
    const iso = toBirthdayDate(stored);
    if (!iso) return (stored ?? '').trim();
    const [yyyy, mm, dd] = iso.split('-');
    return yyyy === '2000' ? `${mm}-${dd}` : iso;
  };
  const [birthday, setBirthday] = useState(birthdayForInput(existing?.birthday));
  // Autofocus the name field ONLY on the manual-entry path (empty
  // form, user wants to type now). After a card scan we DON'T focus
  // — the user is reviewing prefilled data and a popped keyboard
  // would cover it; in edit mode there's existing data to read.
  const [manualFocus, setManualFocus] = useState(false);
  // 職稱 (headline) — its own structured column mirroring
  // piktag_profiles.headline, so the local-contact format maps 1:1 to
  // the member format on fusion. Falls back to the legacy `note`
  // column for rows created before the headline column existed (so
  // their text still shows for editing; nothing is lost).
  const [headline, setHeadline] = useState(
    existing?.headline ?? existing?.note ?? '',
  );
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  // Card-scan + AI-tag accelerators. Nothing here writes to the DB —
  // the scan only PRE-FILLS the editable form (the screen itself is
  // the confirmation surface), and AI tags only populate suggestion
  // chips the user opts into. handleSave is still the only writer.
  const [scanning, setScanning] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiTried, setAiTried] = useState(false);
  // Two-step flow so scan ≠ manual aren't crammed together:
  //   'choose' → scan-card hero + "or type it" (create only)
  //   'form'   → the editable fields (after scan/manual, or edit)
  // Editing an existing contact skips straight to the form.
  const [step, setStep] = useState<'choose' | 'form'>(isEdit ? 'form' : 'choose');

  const addTag = useCallback(() => {
    const raw = tagInput.trim().replace(/^#/, '');
    if (!raw) return;
    setTags((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
    setTagInput('');
  }, [tagInput]);

  const addSuggestedTag = useCallback((raw: string) => {
    const v = raw.trim().replace(/^#/, '');
    if (!v) return;
    setTags((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setAiSuggestions((prev) => prev.filter((s) => s !== raw));
  }, []);

  // AI tag suggestions from whatever context we have (name + 職稱,
  // plus an optional extra blob — e.g. a scanned card's bio_draft,
  // which has no stored field but is still useful tag fuel). Same
  // edge function ('suggest-tags') the profile editor uses, so the
  // model + prompt are identical.
  const fetchAiTags = useCallback(async (extra?: string) => {
    const ctx = [name, headline, extra].filter(Boolean).join('\n').trim();
    if (!ctx) return;
    setAiLoading(true);
    setAiTried(true);
    try {
      const userLang = ctx.match(/[一-鿿]/) ? '繁體中文' :
        ctx.match(/[぀-ヿ]/) ? '日本語' :
        ctx.match(/[가-힯]/) ? '한국어' :
        ctx.match(/[฀-๿]/) ? 'ภาษาไทย' : 'the same language as the content';
      logApiUsage('gemini_generate', { via: 'edge-fn' });
      const { data, error } = await supabase.functions.invoke<{
        suggestions?: string[];
      }>('suggest-tags', {
        body: {
          bio: [headline, extra].filter(Boolean).join('\n'),
          name: name,
          location: '',
          existingTags: tags.join(', '),
          lang: userLang,
        },
      });
      if (error) {
        console.warn('[LocalContact] suggest-tags failed:', error.message);
        setAiSuggestions([]);
        return;
      }
      const raw = Array.isArray(data?.suggestions) ? data!.suggestions : [];
      const cleaned = Array.from(
        new Set(
          raw
            .map((n) => (typeof n === 'string' ? n.replace(/^#/, '').trim() : ''))
            .filter(Boolean)
            .filter((n) => !tags.includes(n)),
        ),
      ).slice(0, 10);
      setAiSuggestions(cleaned);
    } catch (err) {
      console.warn('[LocalContact] suggest-tags threw:', err);
      setAiSuggestions([]);
    } finally {
      setAiLoading(false);
    }
  }, [name, headline, tags]);

  // Open the CAMERA to photograph a physical business card (not the
  // photo library — "掃描名片" means point-and-shoot at the real
  // card). → scan-business-card vision extract → pre-fill the form.
  // Non-destructive: only fills fields the user hasn't typed into yet
  // (so re-scanning never wipes manual edits). Job title + company →
  // the member-aligned 職稱 field; bio_draft has no field of its own
  // so it's passed through as AI-tag context only. After a good scan
  // we auto-kick AI tag suggestions since there's context.
  const handleScanCard = useCallback(async () => {
    // Scanning is a "review prefilled data" path — never autofocus
    // the name field (would pop the keyboard over the results).
    setManualFocus(false);
    try {
      const { status } = await requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('camera.title', { defaultValue: '相機存取' }),
          t('camera.permissionMessage', {
            defaultValue: 'PikTag 需要相機權限以拍攝名片',
          }),
        );
        return;
      }
      const result = await launchCameraAsync({
        mediaTypes: ['images'],
        // 0.5 (was 0.7): a full-res camera photo is multi-MB; smaller
        // JPEG = faster upload + faster vision call, still well above
        // what OCR needs for a business card.
        quality: 0.5,
        base64: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!ALLOWED.includes(mimeType) || !asset.base64) {
        Alert.alert(
          t('common.error', { defaultValue: '錯誤' }),
          t('editProfile.invalidImageType', { defaultValue: '不支援的圖片格式' }),
        );
        return;
      }

      setScanning(true);
      // supabase.functions.invoke has no timeout and RN fetch never
      // times out: a stalled Gemini fallback chain would otherwise
      // hang this screen forever (only Back escapes — the reported
      // bug). Cap it so the user is never trapped; on timeout we fall
      // into catch and surface the normal "scan failed, retry or type
      // it" path.
      const SCAN_TIMEOUT_MS = 30000;
      const { data, error } = await Promise.race([
        supabase.functions.invoke('scan-business-card', {
          body: { image: asset.base64, mimeType },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SCAN_TIMEOUT')), SCAN_TIMEOUT_MS),
        ),
      ]);
      if (error) {
        console.warn('[LocalContact] scan-business-card failed:', error);
        Alert.alert(
          t('auth.onboarding.cardScanFailedTitle', { defaultValue: '掃描失敗' }),
          t('auth.onboarding.cardScanFailedMessage', {
            defaultValue: '名片沒有讀取成功，再試一次或手動填寫。',
          }),
        );
        return;
      }
      const card = ((data as any)?.data ?? null) as CardData | null;
      const anyField =
        card && Object.values(card).some((v) => typeof v === 'string' && v.trim());
      if (!card || !anyField) {
        Alert.alert(
          t('auth.onboarding.cardScanEmptyTitle', { defaultValue: '沒讀到資料' }),
          t('auth.onboarding.cardScanEmptyMessage', {
            defaultValue: '這張名片看不太清楚 — 換一張清楚的照片，或直接手動填。',
          }),
        );
        return;
      }

      const cardName = (card.full_name ?? '').trim();
      const cardPhone = (card.phone ?? '').trim();
      const cardEmail = (card.email ?? '').trim();
      if (cardName) setName((cur) => (cur.trim() ? cur : cardName));
      if (cardPhone) setPhone((cur) => (cur.trim() ? cur : cardPhone));
      if (cardEmail) setEmail((cur) => (cur.trim() ? cur : cardEmail));

      // Job title + company → the member-aligned 職稱 field (same
      // shape as a member's profile headline, e.g. "PM @ Google").
      const cardHeadline = [card.job_title, card.company]
        .filter((s) => s && s.trim())
        .join(' @ ')
        .trim();
      if (cardHeadline) setHeadline((cur) => (cur.trim() ? cur : cardHeadline));

      // Good scan → into the form (prefilled) for review/edit.
      setStep('form');
      // Context exists now — surface AI tags proactively. bio_draft
      // has no contact field, so pass it through here as extra tag
      // fuel rather than discarding the signal.
      const bioDraft = (card.bio_draft ?? '').trim();
      setTimeout(() => { fetchAiTags(bioDraft || undefined); }, 0);
    } catch (err: any) {
      const isTimeout = err?.message === 'SCAN_TIMEOUT';
      Alert.alert(
        isTimeout
          ? t('auth.onboarding.cardScanFailedTitle', { defaultValue: '掃描失敗' })
          : t('common.error', { defaultValue: '錯誤' }),
        isTimeout
          ? t('auth.onboarding.cardScanFailedMessage', {
              defaultValue: '名片沒有讀取成功，再試一次或手動填寫。',
            })
          : err?.message || t('common.unknownError', { defaultValue: '發生錯誤' }),
      );
    } finally {
      setScanning(false);
    }
  }, [t, fetchAiTags]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(
        t('localContact.nameRequiredTitle', { defaultValue: '需要一個名字' }),
        t('localContact.nameRequiredMsg', { defaultValue: '至少幫這個人取個名字，方便你之後想起來。' }),
      );
      return;
    }

    // Birthday → YYYY-MM-DD (year-less → 2000-MM-DD). MUST be
    // date-castable: the promote trigger copies this text straight
    // into piktag_connections.birthday (a DATE column), and the
    // live pg_cron fn EXTRACT()s month/day. Shared normalizer =
    // same format as every other path.
    const birthdayNorm = toBirthdayDate(birthday);
    if (birthday.trim() !== '' && !birthdayNorm) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('friendDetail.alertInvalidDate', {
          defaultValue: '請輸入正確的日期格式（MM-DD）',
        }),
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
          birthday: birthdayNorm,
          headline: headline.trim() || null,
          tags,
        });
        if (!ok) throw new Error('update failed');
      } else {
        const created = await add({
          name: trimmed,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birthday: birthdayNorm,
          headline: headline.trim() || null,
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
  }, [name, phone, email, birthday, headline, tags, isEdit, contactId, add, update, navigation, t]);

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

  // From the form (create flow) back returns to the chooser so a
  // user who picked "type it" but wants to scan isn't trapped.
  // From the chooser, or when editing, back leaves the screen.
  const handleBack = useCallback(() => {
    if (!isEdit && step === 'form') {
      setStep('choose');
      return;
    }
    navigation.goBack();
  }, [isEdit, step, navigation]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.white} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
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
          {step === 'choose' ? (
            <View style={styles.chooser}>
              <Text style={styles.intro}>
                {t('localContact.intro', {
                  defaultValue: '先把人記下來 —— 對方還不用是 PikTag 會員。等他加入，這筆會自動接上，你的標籤都會跟著過去。',
                })}
              </Text>

              {/* Scan is the hero path — the whole point is "less
                  typing". One photo → vision extract → prefilled
                  form for review (same model as first profile setup). */}
              <TouchableOpacity
                style={styles.scanCard}
                onPress={handleScanCard}
                disabled={scanning}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('localContact.scanCardCta', { defaultValue: '掃描名片自動帶入' })}
              >
                {scanning ? (
                  // The card bg is piktag500 (purple); BrandSpinner is
                  // the purple brand gradient → invisible here. Use a
                  // white ActivityIndicator + an explicit label so the
                  // user gets clear "your photo is being read" feedback
                  // instead of a blank purple block.
                  <View style={styles.scanCardLoading}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.scanCardTitle}>
                      {t('localContact.scanningCard', { defaultValue: '辨識名片中…' })}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.scanCardIcon}>
                      <ScanLine size={26} color="#FFFFFF" strokeWidth={2} />
                    </View>
                    <Text style={styles.scanCardTitle}>
                      {t('localContact.scanCardCta', { defaultValue: '掃描名片自動帶入' })}
                    </Text>
                    <Text style={styles.scanCardSub}>
                      {t('localContact.scanCardHint', {
                        defaultValue: '拍一張名片，自動帶入姓名與聯絡方式 —— 再修改或加標籤就好。',
                      })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.manualBtn}
                onPress={() => { setManualFocus(true); setStep('form'); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('localContact.manualEntry', { defaultValue: '手動輸入' })}
              >
                <Text style={styles.manualBtnText}>
                  {t('localContact.manualEntry', { defaultValue: '或手動輸入' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Slim re-scan accelerator — scan stays reachable from
                  the form (re-fill / scan-after-manual) without the
                  old big block that made scan vs manual feel mixed. */}
              <TouchableOpacity
                style={styles.scanInline}
                onPress={handleScanCard}
                disabled={scanning}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('localContact.scanCardCta', { defaultValue: '掃描名片自動帶入' })}
              >
                {scanning ? (
                  <>
                    <ActivityIndicator size="small" color={COLORS.piktag600} />
                    <Text style={styles.scanInlineText}>
                      {t('localContact.scanningCard', { defaultValue: '辨識名片中…' })}
                    </Text>
                  </>
                ) : (
                  <>
                    <ScanLine size={16} color={COLORS.piktag600} strokeWidth={2.2} />
                    <Text style={styles.scanInlineText}>
                      {t('localContact.scanCardCta', { defaultValue: '掃描名片自動帶入' })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

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
            autoFocus={manualFocus}
          />

          {/* 職稱 — same field (and i18n keys) as the member profile
              editor, so a contact's data lines up 1:1 with a member's
              once they register. Replaces the old freeform note. */}
          <Text style={styles.label}>
            {t('editProfile.headlineLabel', { defaultValue: '職稱' })}
          </Text>
          <TextInput
            style={styles.input}
            value={headline}
            onChangeText={setHeadline}
            placeholder={t('editProfile.headlinePlaceholder', {
              defaultValue: '例：PM @ 科技公司、自由接案設計師',
            })}
            placeholderTextColor={COLORS.gray400}
            maxLength={80}
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
            {t('localContact.fieldBirthday', { defaultValue: '生日（選填）' })}
          </Text>
          <TextInput
            style={styles.input}
            value={birthday}
            onChangeText={setBirthday}
            placeholder={t('localContact.birthdayPlaceholder', { defaultValue: 'MM-DD 或 YYYY-MM-DD' })}
            placeholderTextColor={COLORS.gray400}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            maxLength={10}
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

          {/* AI tag suggestions — opt-in, context = name + 職稱 (+ a
              scanned card's bio_draft when present). Auto-kicks after
              a successful card scan; also tappable anytime. Tapping a
              chip adds the tag. */}
          {aiLoading ? (
            <View style={styles.aiLoadingRow}>
              <BrandSpinner size={16} />
              <Text style={styles.aiHint}>
                {t('localContact.aiThinking', { defaultValue: 'AI 想標籤中…' })}
              </Text>
            </View>
          ) : aiSuggestions.length > 0 ? (
            <View style={styles.aiBlock}>
              <View style={styles.aiHeaderRow}>
                <Text style={styles.aiTitle}>
                  {t('localContact.aiSuggestTitle', { defaultValue: 'AI 建議（點一下加入）' })}
                </Text>
                <TouchableOpacity
                  onPress={() => fetchAiTags()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('localContact.aiRegenerate', { defaultValue: '重新產生' })}
                >
                  <RefreshCw size={15} color={COLORS.gray500} />
                </TouchableOpacity>
              </View>
              <View style={styles.tagWrap}>
                {aiSuggestions.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.aiChip}
                    onPress={() => addSuggestedTag(s)}
                    activeOpacity={0.7}
                  >
                    <Plus size={12} color={COLORS.piktag600} strokeWidth={2.5} />
                    <Text style={styles.aiChipText}>#{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.aiBtn}
                onPress={() => fetchAiTags()}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('localContact.aiSuggestCta', { defaultValue: 'AI 建議標籤' })}
              >
                <Sparkles size={16} color={COLORS.piktag600} />
                <Text style={styles.aiBtnText}>
                  {t('localContact.aiSuggestCta', { defaultValue: 'AI 建議標籤' })}
                </Text>
              </TouchableOpacity>
              {aiTried && (
                <Text style={styles.aiHint}>
                  {t('localContact.aiEmpty', { defaultValue: 'AI 沒想到合適的，手動加上就好。' })}
                </Text>
              )}
            </>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, (saving || !name.trim()) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || !name.trim()}
            activeOpacity={0.85}
          >
            {saving ? (
              // saveBtn bg is piktag500 (purple) — same reason as the
              // scan card: a white ActivityIndicator stays visible.
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>
                {t('localContact.save', { defaultValue: '儲存' })}
              </Text>
            )}
          </TouchableOpacity>
            </>
          )}
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
  // ── Chooser step (scan = hero, manual = quiet secondary) ──
  chooser: { paddingTop: 12 },
  scanCard: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    minHeight: 168,
    justifyContent: 'center',
  },
  scanCardLoading: { alignItems: 'center', gap: 12 },
  scanCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  scanCardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
    textAlign: 'center',
  },
  scanCardSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 19,
  },
  manualBtn: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 18,
  },
  manualBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.gray500 },
  // ── Slim re-scan accelerator inside the form step ──
  scanInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9999,
    backgroundColor: COLORS.piktag50,
    marginBottom: 4,
  },
  scanInlineText: { fontSize: 13, fontWeight: '600', color: COLORS.piktag600 },
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: COLORS.piktag50,
    marginTop: 12,
  },
  aiBtnText: { fontSize: 13, fontWeight: '600', color: COLORS.piktag600 },
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  aiHint: { fontSize: 12, color: COLORS.gray500, marginTop: 8, lineHeight: 17 },
  aiBlock: { marginTop: 14 },
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aiTitle: { fontSize: 13, fontWeight: '600', color: COLORS.gray700 },
  aiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: 9999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  aiChipText: { fontSize: 13, fontWeight: '600', color: COLORS.piktag600 },
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
