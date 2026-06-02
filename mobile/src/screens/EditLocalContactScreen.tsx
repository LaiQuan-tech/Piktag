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

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { ArrowLeft, Plus, Trash2 } from 'lucide-react-native';
import { requestMediaLibraryPermissionsAsync, launchImageLibraryAsync } from 'expo-image-picker';
import ProfileIdentityHeader from '../components/ProfileIdentityHeader';
import SectionTitle from '../components/SectionTitle';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { toBirthdayDate } from '../lib/birthday';
import { normalizeTagName } from '../lib/normalizeTag';
import BrandSpinner from '../components/loaders/BrandSpinner';
import LogoLoader from '../components/loaders/LogoLoader';
import TagChip from '../components/TagChip';
// useAuthProfile import dropped — the share-button component owns
// its own viewer-profile lookup now.
import LocalContactShareButton from '../components/LocalContactShareButton';
import { scanCard } from '../lib/scanCard';

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
  // Edge fn started returning address on 2026-05-23. Optional in
  // case the edge fn hasn't been redeployed yet → the prefill code
  // is null-safe so this is forward-compatible either way.
  address?: string | null;
  // `website` was always in the edge fn's extraction schema but
  // had no column to land in until 20260526000000_local_contact_website.
  // Now used.
  website?: string | null;
};

export default function EditLocalContactScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const contactId: string | undefined = route.params?.contactId;
  const { contacts, add, update, remove, loading } = useLocalContacts();
  // Need own username + name for the "send my contact" share flow.
  // (myProfile removed — LocalContactShareButton owns the viewer
  // profile lookup internally now.)

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
  // 地址 — mailing/office address. Edge fn returns it from a card
  // scan; tappable in the read view to open the system Maps app.
  const [address, setAddress] = useState(existing?.address ?? '');
  // 網址 — company website, personal portfolio, Calendly, whatever
  // the card prints. Edge fn extracts it; tappable in the read view
  // as a linkCard that opens the URL via Linking.openURL.
  const [website, setWebsite] = useState(existing?.website ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  // `scanning` is set true for the full duration of the
  // scan-business-card upstream call (~7s in prod). Drives a full-
  // screen overlay (BrandSpinner + "正在識別名片…") so the user isn't
  // staring at an empty form while waiting — the original UX bug:
  // form is empty until the scan returns, looks broken.
  const [scanning, setScanning] = useState(false);

  // Card-scan + AI-tag accelerators. Nothing here writes to the DB —
  // the scan only PRE-FILLS the editable form (the screen itself is
  // the confirmation surface), and AI tags only populate suggestion
  // chips the user opts into. handleSave is still the only writer.
  // (scanning / aiLoading / aiSuggestions / aiTried state removed —
  // the inline "掃描名片自動帶入" accelerator and the AI 建議標籤
  // section are gone per founder rule: re-scan on the edit form is a
  // logic error, and AI built on manually-typed fields wastes compute
  // while the pill button visually duplicates a tag.)
  // No chooser screen. The form is always the base; in create mode
  // the camera auto-opens once on top of it (effect after runScan).
  // The big purple scan banner was removed — fewer taps, less clutter.
  const cameraAutoRef = useRef(false);
  // Latest-runScan ref so `openCamera` can stay a stable callback
  // without a circular dep (openCamera ← runScan ← openCamera).
  const runScanRef = useRef<((uri: string, mime: string) => void) | null>(null);

  // ── Avatar (大頭照) state + create-mode stable id ────────────────
  // For an existing contact we use its real id as the storage
  // filename. For NEW contacts there's no id yet, so we mint a
  // stable per-screen-instance temp id on first render and use it
  // as the filename; on save the public URL is written to the new
  // row. (Abandoning the form leaves an orphan file — rare; cheap
  // to clean later.)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const newContactTempIdRef = useRef<string | null>(null);
  if (!isEdit && !newContactTempIdRef.current) {
    newContactTempIdRef.current = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Edit-mode hydration ──────────────────────────────────────────
  // useLocalContacts fetches async, and THIS screen mounts its own
  // hook instance — so on first render `contacts` is [] and `existing`
  // is null. The useState initializers above ran ONCE with that null,
  // so without this the edit form stays blank forever even after the
  // contact loads — and saving would overwrite the real row with
  // blanks (data loss). Hydrate the fields once when `existing`
  // resolves; the guard preserves any edits the user makes after.
  const [hydrated, setHydrated] = useState(!contactId); // create = nothing to hydrate
  const fetchStartedRef = useRef(false);
  useEffect(() => {
    if (loading) fetchStartedRef.current = true;
  }, [loading]);
  useEffect(() => {
    if (contactId && existing && !hydrated) {
      setName(existing.name ?? '');
      setPhone(existing.phone_normalized ?? '');
      setEmail(existing.email_lower ?? '');
      setBirthday(birthdayForInput(existing.birthday));
      setHeadline(existing.headline ?? existing.note ?? '');
      setAddress(existing.address ?? '');
      setWebsite(existing.website ?? '');
      setTags(existing.tags ?? []);
      setAvatarUrl(existing.avatar_url ?? null);
      setHydrated(true);
    }
  }, [contactId, existing, hydrated]);

  // Pick a photo from the library and upload to the `avatars`
  // bucket. Mirrors EditProfile's pattern (same MIME + size limits,
  // same x-upsert, same cache-buster query) but writes to a
  // contact-specific filename `contact-{id}.{ext}` inside the
  // member's own UID folder — the avatars_auth_insert RLS policy
  // (20260428n) requires the path starts with auth.uid()/, which
  // this satisfies. No new migration needed.
  const pickAndUploadAvatar = useCallback(async () => {
    const { status } = await requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('editProfile.needLibraryPermissionTitle', { defaultValue: '需要相簿權限' }),
        t('editProfile.needLibraryPermissionMsg', { defaultValue: '請在設定中允許存取相簿' }),
      );
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

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX = 2 * 1024 * 1024;
    if (!asset.mimeType || !ALLOWED.includes(asset.mimeType)) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('editProfile.invalidImageType', { defaultValue: '不支援的圖片格式' }),
      );
      return;
    }
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('editProfile.imageTooLarge', { defaultValue: '檔案太大（最大 2MB）' }),
      );
      return;
    }

    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[asset.mimeType];

    try {
      setUploadingAvatar(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const userId = sessionData?.session?.user?.id;
      if (!accessToken || !userId) throw new Error(t('editProfile.notSignedIn'));

      const idForFile = contactId ?? newContactTempIdRef.current!;
      const filePath = `${userId}/contact-${idForFile}.${ext}`;

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: `contact-${idForFile}.${ext}`,
        type: asset.mimeType,
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
        },
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error((err as any).message || '上傳失敗');
      }

      // Cache-buster so React Native Image reloads the new file
      // (Supabase public URLs are immutable per path; ?t=… forces
      // a fresh fetch since the URL string differs from the prior).
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}?t=${Date.now()}`;
      setAvatarUrl(publicUrl);

      // Persist immediately for existing contacts so the change
      // survives even if the user abandons before tapping 儲存.
      // For new contacts the URL is staged in state and written
      // alongside the rest of the fields in handleSave's add().
      if (isEdit && contactId) {
        await update(contactId, { avatar_url: publicUrl });
      }
    } catch (err: any) {
      Alert.alert(
        t('localContact.avatarUploadFailTitle', { defaultValue: '上傳失敗' }),
        err?.message || t('common.unknownError', { defaultValue: '請稍後再試' }),
      );
    } finally {
      setUploadingAvatar(false);
    }
  }, [contactId, isEdit, update, t]);

  const addTag = useCallback(() => {
    // Canonical normalizer — same as every other tag-entry surface, so
    // the string stored on the contact matches the piktag_tags row that
    // ensureTagsRegistered() registers (concept linking keys on it).
    const raw = normalizeTagName(tagInput);
    if (!raw) return;
    setTags((prev) => (prev.includes(raw) ? prev : [...prev, raw]));
    setTagInput('');
  }, [tagInput]);

  // Open the CAMERA to photograph a physical business card (not the
  // photo library — "掃描名片" means point-and-shoot at the real
  // card). → scan-business-card vision extract → pre-fill the form.
  // Non-destructive: only fills fields the user hasn't typed into yet
  // (so re-scanning never wipes manual edits). Job title + company →
  // the member-aligned 職稱 field; bio_draft has no field of its own
  // so it's passed through as AI-tag context only. After a good scan
  // we auto-kick AI tag suggestions since there's context.
  // The actual scan pipeline, fed a captured photo by CardCameraScreen
  // (via the onCaptured callback param). Kept separate from "open the
  // camera" so the framing-guide capture screen owns the camera/permission
  // and this owns the timeout + prefill.
  // Open (or re-open) the card camera. `cancelAddOnClose`: on the
  // first auto-open the camera's X cancels the whole add (pop the
  // form too); on a re-open after a failed scan, X just closes the
  // camera and leaves the user on the form (manual-entry escape).
  const openCamera = useCallback(
    (cancelAddOnClose: boolean) => {
      navigation.navigate('CardCamera', {
        onCaptured: (uri: string, mime: string) =>
          runScanRef.current?.(uri, mime),
        onManual: () => setManualFocus(true),
        onClose: () => {
          if (cancelAddOnClose && navigation.canGoBack()) navigation.goBack();
        },
      });
    },
    [navigation],
  );

  const runScan = useCallback(async (uri: string, mimeType: string) => {
    // Scanning is a "review prefilled data" path — never autofocus
    // the name field (would pop the keyboard over the results).
    setManualFocus(false);
    // Show the overlay for the FULL duration of the upstream call,
    // even across the various early-return branches inside try{}.
    // The finally{} block ensures it always clears, success or not.
    setScanning(true);
    try {
      // supabase.functions.invoke has no timeout and RN fetch never
      // times out: a stalled Gemini fallback chain would otherwise
      // hang this screen forever (only Back escapes — the reported
      // bug). Cap it so the user is never trapped; on timeout we fall
      // into catch and surface the normal "scan failed, retry or type
      // it" path.
      const SCAN_TIMEOUT_MS = 30000;
      // scanCard runs on-device OCR first (fast) and falls back to the
      // multimodal image call automatically; returns the same
      // { data, error } shape as the raw invoke, so everything below
      // is unchanged. 2026-06-03 speed pass: uri-only input — base64
      // is lazy-encoded inside scanCard only when the fallback fires.
      const { data, error } = await Promise.race([
        scanCard({ uri, mimeType }),
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
          [
            // Single action → back to the card camera. The camera
            // screen already carries the "或手動輸入" escape at its
            // foot, so the choice (re-shoot vs type it) lives there
            // — no need to duplicate it as a second Alert button.
            {
              text: t('localContact.scanRetake', { defaultValue: '重拍' }),
              onPress: () => openCamera(false),
            },
          ],
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
          [
            // Single action → back to the card camera. The camera
            // screen already carries the "或手動輸入" escape at its
            // foot, so the choice (re-shoot vs type it) lives there
            // — no need to duplicate it as a second Alert button.
            {
              text: t('localContact.scanRetake', { defaultValue: '重拍' }),
              onPress: () => openCamera(false),
            },
          ],
        );
        return;
      }

      const cardName = (card.full_name ?? '').trim();
      const cardPhone = (card.phone ?? '').trim();
      const cardEmail = (card.email ?? '').trim();
      const cardAddress = (card.address ?? '').trim();
      const cardWebsite = (card.website ?? '').trim();
      const bioDraft = (card.bio_draft ?? '').trim();
      const cardHeadline = [card.job_title, card.company]
        .filter((s) => s && s.trim())
        .join(' @ ')
        .trim();

      // Default path: prefill the form for review/edit.
      const applyPrefill = () => {
        if (cardName) setName((cur) => (cur.trim() ? cur : cardName));
        if (cardPhone) setPhone((cur) => (cur.trim() ? cur : cardPhone));
        if (cardEmail) setEmail((cur) => (cur.trim() ? cur : cardEmail));
        if (cardAddress) setAddress((cur) => (cur.trim() ? cur : cardAddress));
        if (cardWebsite) setWebsite((cur) => (cur.trim() ? cur : cardWebsite));
        // Job title + company → the member-aligned 職稱 field.
        if (cardHeadline) setHeadline((cur) => (cur.trim() ? cur : cardHeadline));
        // (bio_draft → AI-tag fuel path removed with the AI section.)
      };

      // Is the scanned person ALREADY a PikTag member? Match the
      // scanned phone/email against profiles via the SAME canonical
      // RPC ContactSync uses. If so, filing a private local contact is
      // the wrong outcome (it would never auto-link — the promote
      // trigger only fires on NEW registration) — offer to connect to
      // the real member instead. FAIL-OPEN: any lookup error must not
      // block the scan; just fall through to the normal prefill.
      let member:
        | { matched_user_id: string; full_name: string | null; username: string | null }
        | null = null;
      if (cardPhone || cardEmail) {
        try {
          const { data: matches, error: matchErr } = await supabase.rpc(
            'match_contacts_against_profiles',
            {
              p_phones: cardPhone ? [cardPhone] : [],
              p_emails: cardEmail ? [cardEmail] : [],
            },
          );
          if (!matchErr && Array.isArray(matches) && matches.length > 0) {
            member = matches[0] as any;
          }
        } catch (e) {
          console.warn('[LocalContact] member match failed:', e);
        }
      }

      if (member?.matched_user_id) {
        const who =
          (member.full_name && member.full_name.trim()) ||
          (member.username ? `@${member.username}` : cardName) ||
          t('localContact.alreadyMemberFallbackWho', { defaultValue: '這個人' });
        Alert.alert(
          t('localContact.alreadyMemberTitle', { defaultValue: '這個人已經在 PikTag' }),
          t('localContact.alreadyMemberMsg', {
            name: who,
            defaultValue:
              `${who} 已經是 PikTag 會員 —— 直接連上更好，不用只記成聯絡人。`,
          }),
          [
            {
              text: t('localContact.alreadyMemberFile', { defaultValue: '仍記成聯絡人' }),
              style: 'cancel',
              onPress: applyPrefill,
            },
            {
              text: t('localContact.alreadyMemberConnect', { defaultValue: '查看／加好友' }),
              onPress: () =>
                navigation.replace('UserDetail', { userId: member!.matched_user_id }),
            },
          ],
        );
        return;
      }

      applyPrefill();
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
  }, [t, navigation, openCamera]);

  // Keep the ref pointing at the latest runScan so `openCamera`'s
  // stable onCaptured always calls the current closure.
  runScanRef.current = runScan;

  // (handleScanCard — the inline re-scan accelerator — was removed.
  // The only entry into the scan flow is the create-mode auto-open
  // effect below; once the form is up, the user manually edits, no
  // mid-flow re-scan path.)

  // Create mode: auto-open the camera ONCE, on top of the (empty)
  // form. ref guard = strictly once → no reopen loop. Dismissal:
  //   • capture        → runScan, stay on the form
  //   • "或手動輸入"   → form with the name field focused
  //   • X (close)      → cancel the WHOLE add → back to 好友頁.
  // For X we pop THIS screen too: the camera pops itself first, then
  // onClose runs here (this screen now focused) and goBack pops the
  // form → 好友頁. Mirrors the capture path's goBack-then-callback
  // ordering; the ref guard stops the effect re-firing meanwhile.
  // Edit mode never auto-opens.
  useEffect(() => {
    if (isEdit || cameraAutoRef.current) return;
    cameraAutoRef.current = true;
    // true = X on the camera cancels the whole add (pops the form).
    openCamera(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

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
          address: address.trim() || null,
          website: website.trim() || null,
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
          address: address.trim() || null,
          website: website.trim() || null,
          tags,
          avatar_url: avatarUrl,
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
  }, [name, phone, email, birthday, headline, address, website, tags, avatarUrl, isEdit, contactId, add, update, navigation, t]);

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

  // No chooser anymore — back always leaves the screen.
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Edit mode but the row hasn't hydrated yet — show a spinner (or a
  // clear "gone" message once the fetch settled and it's still
  // missing, e.g. promoted/deleted). This GATES the form so the user
  // can never see — or save over — a blank edit screen.
  if (contactId && !hydrated) {
    const settledMissing = fetchStartedRef.current && !loading && !existing;
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
            <ArrowLeft size={24} color={colors.gray900} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('localContact.editTitle', { defaultValue: '編輯聯絡人' })}
          </Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.gateCenter}>
          {settledMissing ? (
            <Text style={styles.gateMsg}>
              {t('localContact.notFound', {
                defaultValue: '找不到這個聯絡人 —— 可能已接上 PikTag 或被刪除。',
              })}
            </Text>
          ) : (
            <BrandSpinner size={32} />
          )}
        </View>
      </SafeAreaView>
    );
  }

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
          <ArrowLeft size={24} color={colors.gray900} strokeWidth={2.2} />
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
            <Trash2 size={20} color={colors.gray500} />
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
          {(
            <>
              {/* (Re-scan accelerator removed — logic error per
                  founder: if a user wanted to scan, they'd scan; they
                  won't manually fill the form and then re-scan.) */}

          {/* Identity header = shared ProfileIdentityHeader (avatar +
              name). 職稱 moved OUT into its own labeled input below
              per founder rule: edit-form fields must look like proper
              iOS form inputs (label above + bordered input box) so
              users see they're editable; 職稱 styled as a profile
              tagline read as display text, not a field. */}
          <ProfileIdentityHeader
            name={name}
            onChangeName={setName}
            namePlaceholder={t('localContact.namePlaceholder', { defaultValue: '例：在龍洞潛水認識的阿哲' })}
            autoFocusName={manualFocus}
            nameMaxLength={60}
            avatarUrl={avatarUrl}
            onAvatarPress={uploadingAvatar ? undefined : pickAndUploadAvatar}
            avatarBadge="pencil"
          />

          {/* Edit fields — iOS-standard labeled inputs (label +
              gray-bg rounded input box). Tokens mirror EditProfile's
              fieldGroup/fieldLabel/fieldInput so a contact's edit form
              uses the SAME visual language as the member's. Each field
              stands alone (no table-style combined card). The verbose
              "幫助對方加入後自動接上" caption is dropped — it was UI
              noise the user didn't need while editing. */}
          <View style={styles.fieldsGroup}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('editProfile.headlineLabel', { defaultValue: '職稱' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={headline}
                onChangeText={setHeadline}
                placeholder={t('editProfile.headlinePlaceholder', {
                  defaultValue: '例：PM @ 科技公司、自由接案設計師',
                })}
                placeholderTextColor={colors.gray400}
                maxLength={80}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('localContact.linkPhone', { defaultValue: '電話' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={phone}
                onChangeText={setPhone}
                placeholder={t('localContact.phonePlaceholder', { defaultValue: '+886 912 345 678' })}
                placeholderTextColor={colors.gray400}
                keyboardType="phone-pad"
                autoCapitalize="none"
                maxLength={24}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('localContact.linkEmail', { defaultValue: 'Email' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={email}
                onChangeText={setEmail}
                placeholder={t('localContact.emailPlaceholder', { defaultValue: 'name@example.com' })}
                placeholderTextColor={colors.gray400}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={120}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('localContact.fieldAddress', { defaultValue: '地址' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={address}
                onChangeText={setAddress}
                placeholder={t('localContact.addressPlaceholder', { defaultValue: '例：台北市信義區市府路 1 號' })}
                placeholderTextColor={colors.gray400}
                autoCapitalize="none"
                maxLength={200}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('localContact.fieldWebsite', { defaultValue: '網址' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={website}
                onChangeText={setWebsite}
                placeholder={t('localContact.websitePlaceholder', { defaultValue: '例：example.com' })}
                placeholderTextColor={colors.gray400}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={500}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('friendDetail.reminderBirthday', { defaultValue: '生日' })}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={birthday}
                onChangeText={setBirthday}
                placeholder={t('localContact.birthdayPlaceholder', { defaultValue: 'MM-DD 或 YYYY-MM-DD' })}
                placeholderTextColor={colors.gray400}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                maxLength={10}
              />
            </View>
          </View>

          <SectionTitle variant="detail" style={{ marginTop: 24, marginBottom: 10, paddingHorizontal: 0 }}>
            {t('localContact.fieldTags', { defaultValue: '標籤（只有你看得到）' })}
          </SectionTitle>
          {tags.length > 0 && (
            <View style={styles.tagWrap}>
              {tags.map((tg) => (
                <TagChip
                  key={tg}
                  label={tg}
                  onRemove={() => setTags((p) => p.filter((x) => x !== tg))}
                />
              ))}
            </View>
          )}
          <View style={styles.tagInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder={t('localContact.tagPlaceholder', { defaultValue: '輸入標籤…' })}
              placeholderTextColor={colors.gray400}
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

          {/* (AI 建議標籤 section removed — there's no scanned-card
              fuel in the edit form, and AI based on manually-typed
              fields just spends compute while the pill button reads
              as a tag. Tags here are manual-only.) */}

          {/* "Send my PikTag handle to this contact" — extracted to
              the shared LocalContactShareButton component 2026-06-03
              after the founder asked for the same CTA on the read
              view (LocalContactDetailScreen). Component renders null
              when the recipient has no reachable channel or the viewer
              hasn't completed their profile — no caller-side guard.
              marginTop:28 keeps the gap from the Save button above
              that the inline JSX had. */}
          <LocalContactShareButton
            recipientEmail={email}
            recipientPhone={phone}
            recipientName={name}
            eventOrCompanyHint={headline || null}
            style={{ marginTop: 28 }}
          />

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
      {/* Scan overlay — covers the form for the full ~7s
          scan-business-card upstream call so the user isn't
          looking at an empty form (looks broken). Renders last so
          it sits on top of the ScrollView and the keyboard avoider.
          position:absolute + flex:1 inside fills the SafeAreaView's
          bounds; pointerEvents="auto" on the wrapper blocks taps on
          the form underneath while a scan is in flight. */}
      {scanning && (
        <View style={styles.scanOverlay} pointerEvents="auto">
          <View style={styles.scanOverlayCard}>
            <LogoLoader size={64} />
            <Text style={styles.scanOverlayTitle}>
              {t('localContact.scanningTitle', { defaultValue: '正在識別名片…' })}
            </Text>
            {/* 2026-06-03 speed pass: stripped the shimmer mock-field
                rows AND the "通常需要 3–7 秒" hint. They were
                perceived-progress filler from when scan took ~7s.
                Path A + base64 lazy-encode brought the happy path
                well under that — promising "this might take 7s"
                while it actually finishes in ~1-2s undersells the
                speed. Brand logo + status text is enough now. */}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  gateCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  gateMsg: { fontSize: 14, color: c.gray500, textAlign: 'center', lineHeight: 21 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: c.gray900 },
  scroll: { padding: 20, paddingBottom: 48 },
  // (sectionTitle moved into shared SectionTitle component, task #38.
  // The marginTop:24 + marginBottom:10 override lives at the call
  // site to keep this screen's tighter rhythm — this screen has a
  // form-like layout where the section caption sits very close to
  // its content below.)
  // (infoCard / infoRow / infoInput / infoDivider removed — the
  // "Excel table" lumped layout is gone; each field is now its own
  // labeled iOS form input below.)
  // ── iOS-standard labeled input fields. Tokens mirror EditProfile's
  // fieldGroup/fieldLabel/fieldInput so the contact edit form uses
  // the SAME visual language as the member's profile editor (founder
  // rule: don't reinvent, match the canonical editor design).
  fieldsGroup: { gap: 16, marginTop: 16 },
  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray700,
    marginLeft: 4,
  },
  fieldInput: {
    backgroundColor: c.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.gray900,
  },
  // Still used by the tag-add input row only.
  input: {
    fontSize: 15,
    color: c.gray900,
    backgroundColor: c.gray50,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 2,
  },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  // added-tag chip → shared <TagChip/> (one design contract)
  tagInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tagAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAddBtnDisabled: { opacity: 0.4 },
  // (scanInline / scanInlineText / aiBtn / aiBtnText / aiLoadingRow /
  // aiHint / aiBlock / aiHeaderRow / aiTitle / aiChip / aiChipPressed
  // / aiChipText styles removed with the scan-accelerator + AI
  // section — per founder, neither belongs on the edit form.)
  saveBtn: {
    // marginTop dropped to 14 (was 28) because the share button now
    // sits above it with its own marginTop — total spacing tunes
    // to the same rhythm when the share row is hidden.
    marginTop: 14,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: c.piktag500,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: c.gray200 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  // (shareBtn / shareBtnText moved into LocalContactShareButton —
  // single source of truth for the "寄我的聯絡資料給他" CTA across
  // both the edit + read views. task #38 follow-up.)
  // Scan overlay — full-screen dim layer with a centered white
  // card carrying the LogoLoader + status text. position:absolute +
  // edge-anchored covers the whole SafeAreaView (form + scroll +
  // keyboard area). rgba(0,0,0,0.5) dim is dark enough that the
  // form fades back but the user can still see what page they're
  // on, so when the scan completes and the overlay dismisses, the
  // form reveal feels continuous (not a jarring navigation).
  scanOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  scanOverlayCard: {
    backgroundColor: c.white,
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 36,
    alignItems: 'center',
    minWidth: 240,
    // Subtle elevation — the card needs to read as "lifted above
    // the form" without competing with the LogoLoader animation
    // for attention.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  scanOverlayTitle: {
    marginTop: 20,
    fontSize: 16,
    fontWeight: '700',
    color: c.gray900,
    textAlign: 'center',
  },
  // (scanOverlaySubtitle + scanShimmerPreview removed 2026-06-03
  // alongside the "3–7秒" hint — see overlay render comment.)
  });
}
