// OnboardingScreen.tsx
//
// Minimal-friction first-launch flow. Two screens, one of them
// purely informational (1-card welcome), the other collecting the
// absolute minimum profile data needed to start using the app:
//
//   Step 0 — Welcome card     (no input, single big CTA)
//   Step 1 — Name + avatar    (avatar optional, name auto-prefilled)
//
// After Step 1 the user is dropped DIRECTLY onto the create-event
// surface (AddTagCreate inside the # tab), not on Home or EditProfile.
// Reason: the main feature is creating an event-group QR. Routing
// the user there immediately = main feature in <60s from signup.
//
// What we deliberately DROPPED from the older flow:
//   • 3-card "WelcomeSlides" deck (concept teaching)  → 1 card
//   • bio + birthday + tag-picker step                → defer to EditProfile
//   • phone + Facebook/Instagram/LinkedIn step        → defer to EditProfile
//   • 4-card "QuickStartTour" educational deck        → contextual UX teaches it
//
// All those data fields are still reachable post-onboarding via
// EditProfile and the per-feature empty states — they're just no
// longer in the cold-start funnel. Profile completion nudges are
// expected to live in AddTagScreen's first-QR celebration sheet
// and ProfileScreen banners (separate commits).

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
} from 'react-native';
import BrandSpinner from '../../components/loaders/BrandSpinner';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronRight, Camera, QrCode, ScanLine, X } from 'lucide-react-native';
import { supabase, supabaseUrl, supabaseAnonKey } from '../../lib/supabase';
import { Image } from 'expo-image';
import {
  requestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from 'expo-image-picker';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import { PLATFORM_MAP } from '../../lib/platforms';
import OnboardingCompleteBurst from '../../components/stingers/OnboardingCompleteBurst';

// Must match the key AppNavigator reads in decideOnboarding(). This
// AsyncStorage flag is the canonical "did this user finish onboarding?"
// signal — bio emptiness is a legacy fallback only.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

const STEP_WELCOME = 0;
const STEP_PROFILE = 1;

// ─── Business-card scan plumbing ────────────────────────────
// The edge function returns these fields (all nullable). bio_draft
// is handled separately (it feeds the bio, not a biolink); the
// rest are contact handles that map onto piktag_biolinks rows.
type CardData = {
  full_name: string | null;
  job_title: string | null;
  company: string | null;
  bio_draft: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  line: string | null;
};

// Which CardData keys are contact handles → biolink rows, and the
// piktag_biolinks.platform key each maps to. Order = display order
// in the confirmation sheet AND insert position order.
const BIOLINK_FIELDS: { key: keyof CardData; platform: string }[] = [
  { key: 'phone', platform: 'phone' },
  { key: 'email', platform: 'email' },
  { key: 'website', platform: 'website' },
  { key: 'instagram', platform: 'instagram' },
  { key: 'facebook', platform: 'facebook' },
  { key: 'linkedin', platform: 'linkedin' },
  { key: 'line', platform: 'line' },
];

// Turn a raw handle the card gave us into the canonical stored URL,
// matching how EditProfile builds biolink.url (prefix + handle).
// The card may print a full URL OR a bare handle — normalise both.
function buildBiolinkUrl(platform: string, raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  // Already a full link the model passed through verbatim.
  if (/^https?:\/\//i.test(v)) return v;
  if (platform === 'phone') {
    // Keep + and digits only; tel: tolerates spaces but stored
    // form should be clean.
    return 'tel:' + v.replace(/[^\d+]/g, '');
  }
  if (platform === 'email') {
    return v.startsWith('mailto:') ? v : 'mailto:' + v;
  }
  if (platform === 'website') {
    return 'https://' + v.replace(/^\/+/, '');
  }
  const prefix = PLATFORM_MAP[platform]?.prefix ?? '';
  // Strip a leading @ for social handles — prefixes already end at
  // the path root (instagram.com/, linkedin.com/in/, …).
  return prefix + v.replace(/^@+/, '');
}

type OnboardingScreenProps = { navigation: any };

export default function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState<number>(STEP_WELCOME);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [burstVisible, setBurstVisible] = useState(false);
  const [burstUserName, setBurstUserName] = useState<string | undefined>(undefined);

  // ─── Business-card scan state ─────────────────────────────
  // `bio` + `pendingBiolinks` are what actually get committed in
  // handleComplete. They stay empty unless the user scans a card
  // AND confirms the sheet — so a user who skips the scan has the
  // exact same minimal name+avatar flow as before (no behaviour
  // change for the skip path, which is the whole funnel premise).
  const [bio, setBio] = useState('');
  const [pendingBiolinks, setPendingBiolinks] = useState<
    { platform: string; url: string; label: string | null }[]
  >([]);
  const [scanning, setScanning] = useState(false);
  const [scanModalVisible, setScanModalVisible] = useState(false);
  // Editable working copy of what the scan returned. The user can
  // fix OCR mistakes here before anything is written.
  const [editCard, setEditCard] = useState<CardData | null>(null);
  // Per-biolink include toggles (default on for any detected field).
  const [includeMap, setIncludeMap] = useState<Record<string, boolean>>({});

  // ─── Smart prefill ──────────────────────────────────────
  // Goal: most users tap the CTA without ever opening the keyboard.
  // Priority order for the displayed default name:
  //   1. Apple / Google sign-in returns user_metadata.full_name
  //      (Apple only returns it on the VERY FIRST sign-in — must
  //      capture here while we still have it)
  //   2. user_metadata.name (some OAuth providers use this key)
  //   3. piktag_profiles.full_name (if a trigger pre-backfilled it)
  //   4. Email local-part, title-cased (armand7951 → "Armand7951")
  //   5. Blank — user types from scratch
  useEffect(() => {
    let cancelled = false;
    const prefill = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        // 1 + 2: auth metadata
        const meta = (user.user_metadata || {}) as Record<string, unknown>;
        const fromMeta =
          (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
          (typeof meta.name === 'string' && meta.name.trim()) ||
          '';
        if (fromMeta) {
          if (!cancelled) setDisplayName(fromMeta);
          return;
        }

        // 3: existing profile row (and pick up an avatar if one is
        //    already on file — covers the re-onboarding edge case
        //    where a user hit "log out" then came back)
        try {
          const { data: profile } = await supabase
            .from('piktag_profiles')
            .select('full_name, avatar_url')
            .eq('id', user.id)
            .single();
          if (!cancelled && profile?.avatar_url) setAvatarUrl(profile.avatar_url);
          const profileName = profile?.full_name?.trim();
          if (!cancelled && profileName) {
            setDisplayName(profileName);
            return;
          }
        } catch {
          // ignore — fall through to email prefix
        }

        // 4: email prefix
        const prefix = user.email?.split('@')[0];
        if (prefix && !cancelled) {
          setDisplayName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
        }
      } catch {
        // swallow — blank input is a fine fallback
      }
    };
    prefill();
    return () => { cancelled = true; };
  }, []);

  // ─── Avatar upload (optional) ───────────────────────────
  // Same validation + Storage POST as EditProfileScreen so any image
  // that uploads here also uploads there (consistency = fewer support
  // tickets about "the picker worked on one screen but not the other").
  const handlePickAvatar = useCallback(async () => {
    try {
      const { status } = await requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('auth.onboarding.avatarPermissionTitle', { defaultValue: '需要相簿權限' }),
          t('auth.onboarding.avatarPermissionMessage', { defaultValue: '請在設定中允許 PikTag 存取相簿' }),
        );
        return;
      }
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
      const MAX_FILE_SIZE = 2 * 1024 * 1024;
      if (!asset.mimeType || !ALLOWED_MIME_TYPES.includes(asset.mimeType)) {
        Alert.alert(t('common.error'), t('editProfile.invalidImageType', { defaultValue: '不支援的圖片格式' }));
        return;
      }
      if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_FILE_SIZE) {
        Alert.alert(t('common.error'), t('editProfile.imageTooLarge', { defaultValue: '檔案太大（上限 2MB）' }));
        return;
      }

      setUploadingAvatar(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('common.error'), t('auth.onboarding.alertUserNotFound', { defaultValue: '找不到使用者' }));
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('No session');

      const extFromMime: Record<string, string> = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
      };
      const ext = extFromMime[asset.mimeType];
      const filePath = `${user.id}/avatar.${ext}`;

      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: `avatar.${ext}`,
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
        throw new Error((err as any).message || 'upload failed');
      }
      // Cache-buster so the picker preview renders the new image
      // even when the old one is still in expo-image's memory cache.
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}?t=${Date.now()}`;
      await supabase.from('piktag_profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || t('common.unknownError'));
    } finally {
      setUploadingAvatar(false);
    }
  }, [t]);

  // ─── Business-card scan ─────────────────────────────────
  // Optional accelerator on the name screen. One photo →
  // edge-function vision extract → editable confirmation sheet.
  // Nothing is written until the user confirms the sheet; this
  // handler only POPULATES the editable working copy.
  const handleScanCard = useCallback(async () => {
    try {
      const { status } = await requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('auth.onboarding.avatarPermissionTitle', { defaultValue: '需要相簿權限' }),
          t('auth.onboarding.avatarPermissionMessage', { defaultValue: '請在設定中允許 PikTag 存取相簿' }),
        );
        return;
      }
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        // No aspect crop — business cards are landscape; a 1:1
        // crop would slice off half the contact info.
        quality: 0.7,
        base64: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];

      const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
      const mimeType = asset.mimeType || 'image/jpeg';
      if (!ALLOWED.includes(mimeType) || !asset.base64) {
        Alert.alert(
          t('common.error'),
          t('editProfile.invalidImageType', { defaultValue: '不支援的圖片格式' }),
        );
        return;
      }

      setScanning(true);
      const { data, error } = await supabase.functions.invoke(
        'scan-business-card',
        { body: { image: asset.base64, mimeType } },
      );
      if (error) {
        console.warn('[Onboarding] scan-business-card failed:', error);
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
        card &&
        Object.values(card).some((v) => typeof v === 'string' && v.trim());
      if (!card || !anyField) {
        Alert.alert(
          t('auth.onboarding.cardScanEmptyTitle', { defaultValue: '沒讀到資料' }),
          t('auth.onboarding.cardScanEmptyMessage', {
            defaultValue: '這張名片看不太清楚 — 換一張清楚的照片，或直接手動填。',
          }),
        );
        return;
      }
      // Default-include any contact field that came back non-null.
      const nextInclude: Record<string, boolean> = {};
      for (const f of BIOLINK_FIELDS) {
        const val = card[f.key];
        nextInclude[f.key] = typeof val === 'string' && val.trim().length > 0;
      }
      setEditCard(card);
      setIncludeMap(nextInclude);
      setScanModalVisible(true);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || t('common.unknownError'));
    } finally {
      setScanning(false);
    }
  }, [t]);

  // Commit the (possibly user-edited) sheet into local state.
  // Still nothing in the DB — handleComplete does the writes.
  const handleApplyCard = useCallback(() => {
    if (!editCard) {
      setScanModalVisible(false);
      return;
    }
    const name = (editCard.full_name ?? '').trim();
    if (name) setDisplayName(name);
    const draft = (editCard.bio_draft ?? '').trim();
    if (draft) setBio(draft);

    const links: { platform: string; url: string; label: string | null }[] = [];
    for (const f of BIOLINK_FIELDS) {
      if (!includeMap[f.key]) continue;
      const raw = (editCard[f.key] ?? '').toString().trim();
      if (!raw) continue;
      links.push({
        platform: f.platform,
        url: buildBiolinkUrl(f.platform, raw),
        label: null,
      });
    }
    setPendingBiolinks(links);
    setScanModalVisible(false);
    setEditCard(null);
  }, [editCard, includeMap]);

  // ─── Save & finish ──────────────────────────────────────
  // The ONLY field this commits is `full_name`. Avatar is already
  // committed by handlePickAvatar at pick time, so we don't re-write
  // it here. Bio / birthday / tags / biolinks are all deferred —
  // they get filled later via EditProfile (linked from the first-QR
  // celebration sheet in AddTagScreen).
  const handleComplete = useCallback(async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      Alert.alert(
        t('auth.onboarding.nameRequiredTitle', { defaultValue: '需要一個名字' }),
        t('auth.onboarding.nameRequiredMessage', { defaultValue: '朋友掃 QR 會看到這個名字，至少幫自己取一個吧。' }),
      );
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('common.error'), t('auth.onboarding.alertUserNotFound', { defaultValue: '找不到使用者' }));
        return;
      }
      // Bio rides along with full_name in the same UPDATE when the
      // user scanned a card and kept a bio_draft. Empty bio → don't
      // send the column at all (skip-scan users keep the exact old
      // behaviour: only full_name is touched).
      const profilePatch: Record<string, string> = { full_name: trimmed };
      const trimmedBio = bio.trim();
      if (trimmedBio) profilePatch.bio = trimmedBio;

      const { error } = await supabase
        .from('piktag_profiles')
        .update(profilePatch)
        .eq('id', user.id);
      if (error) {
        console.warn('[Onboarding] profile update failed:', error.message);
        // Non-fatal — we still mark onboarding done and let the user
        // continue. They can fix name/bio from EditProfile.
      }

      // Biolinks from a confirmed card scan. Best-effort + non-fatal:
      // a failed biolink insert must never block finishing onboarding
      // (the user can always re-add links in EditProfile). Insert as
      // one batch so position order is preserved.
      if (pendingBiolinks.length > 0) {
        try {
          const rows = pendingBiolinks.map((b, i) => ({
            user_id: user.id,
            platform: b.platform,
            url: b.url,
            label: b.label,
            position: i,
            is_active: true,
            display_mode: 'icon',
            visibility: 'public',
          }));
          const { error: linkErr } = await supabase
            .from('piktag_biolinks')
            .insert(rows);
          if (linkErr) {
            console.warn('[Onboarding] biolink insert failed:', linkErr.message);
          }
        } catch (e) {
          console.warn('[Onboarding] biolink insert threw:', e);
        }
      }
      try {
        await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
      } catch (err) {
        console.warn('[Onboarding] flag persist failed:', err);
      }
      setBurstUserName(trimmed);
      setBurstVisible(true);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setSaving(false);
    }
  }, [displayName, bio, pendingBiolinks, t]);

  // ─── Render: Step 0 (Welcome card) ──────────────────────
  const renderWelcome = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeIconWrap}>
        <QrCode size={64} color={COLORS.piktag500} strokeWidth={2.2} />
      </View>
      <Text style={styles.welcomeTitle}>
        {t('auth.onboarding.welcomeTitle', { defaultValue: '一個 QR，加完所有朋友' })}
      </Text>
      <Text style={styles.welcomeSubtitle}>
        {t('auth.onboarding.welcomeSubtitle', { defaultValue: '貼上標籤，下次見面就知道是誰' })}
      </Text>
      {/* Brand tagline — small, English, uppercase-letterspaced.
          Sits under the functional copy so it reads as a signature,
          not a competing headline. Drives the same idea ("tag now,
          keep the people later") in 6 words that the longer
          Chinese above explains. */}
      <Text style={styles.brandTagline}>
        {t('auth.onboarding.brandTagline', { defaultValue: 'Tag the Vibe, Keep the Tribe' })}
      </Text>
      <View style={{ flex: 1 }} />
      <TouchableOpacity
        style={styles.primaryButton}
        activeOpacity={0.85}
        onPress={() => setStep(STEP_PROFILE)}
        accessibilityRole="button"
      >
        <Text style={styles.primaryButtonText}>
          {t('auth.onboarding.welcomeCta', { defaultValue: '開始使用 PikTag' })}
        </Text>
        <ChevronRight size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );

  // ─── Render: Step 1 (Name + Avatar) ─────────────────────
  const renderProfile = () => {
    const ctaDisabled = saving || !displayName.trim();
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.profileTitle}>
          {t('auth.onboarding.profileTitle', { defaultValue: '你叫什麼名字？' })}
        </Text>
        <Text style={styles.profileSubtitle}>
          {t('auth.onboarding.profileSubtitle', { defaultValue: '朋友掃 QR 會看到這個名字' })}
        </Text>

        {/* Avatar picker — sits ABOVE the name input so the user
            reads top-down "face → name". Optional: tapping is
            invitation, not requirement. */}
        <TouchableOpacity
          style={styles.avatarPicker}
          activeOpacity={0.7}
          onPress={handlePickAvatar}
          disabled={uploadingAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('auth.onboarding.avatarPickA11y', { defaultValue: '選擇頭像' })}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatarImage}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              {uploadingAvatar ? (
                <BrandSpinner size={32} />
              ) : (
                <Camera size={32} color={COLORS.piktag500} strokeWidth={1.8} />
              )}
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.avatarHint}>
          {t('auth.onboarding.avatarHint', { defaultValue: '頭像選填（之後可以再加）' })}
        </Text>

        <TextInput
          style={styles.nameInput}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('auth.onboarding.profileNamePlaceholder', { defaultValue: '你的名字' })}
          placeholderTextColor={COLORS.gray400}
          maxLength={40}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!ctaDisabled) handleComplete();
          }}
        />

        {/* Optional accelerator. Sits BELOW the name input as a
            secondary outlined affordance — visually subordinate to
            the primary CTA so it reads as "or, the fast way",
            never competing with "just type your name and go".
            Skipping it leaves the original minimal flow untouched. */}
        <TouchableOpacity
          style={styles.scanCardBtn}
          activeOpacity={0.7}
          onPress={handleScanCard}
          disabled={scanning}
          accessibilityRole="button"
          accessibilityLabel={t('auth.onboarding.scanCardCta', { defaultValue: '掃名片快速帶入' })}
        >
          {scanning ? (
            <BrandSpinner size={20} />
          ) : (
            <>
              <ScanLine size={18} color={COLORS.piktag500} strokeWidth={2} />
              <Text style={styles.scanCardBtnText}>
                {t('auth.onboarding.scanCardCta', { defaultValue: '掃名片快速帶入' })}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.scanCardHint}>
          {t('auth.onboarding.scanCardHint', { defaultValue: '有名片？拍一張，自動帶入 bio 和聯絡方式（選填）' })}
        </Text>

        <View style={{ flex: 1, minHeight: 32 }} />

        <TouchableOpacity
          style={[styles.primaryButton, ctaDisabled && styles.primaryButtonDisabled]}
          activeOpacity={0.85}
          onPress={handleComplete}
          disabled={ctaDisabled}
          accessibilityRole="button"
        >
          {saving ? (
            <BrandSpinner size={20} />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>
                {t('auth.onboarding.profileCta', { defaultValue: '建立我的第一個 Vibe' })}
              </Text>
              <ChevronRight size={20} color="#FFFFFF" />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {step === STEP_WELCOME ? renderWelcome() : renderProfile()}

      {/* Celebration burst plays after handleComplete succeeds. Its
          onComplete then drives the navigation reset — we defer to
          onComplete so the animation isn't interrupted by tab-stack
          mounting. */}
      <OnboardingCompleteBurst
        visible={burstVisible}
        userName={burstUserName}
        onComplete={async () => {
          setBurstVisible(false);

          // Pending invite handoff (preserved from old flow). If the
          // user signed up via an /i/{code} link, RedeemInvite has to
          // be the TOP route so the invite consumes correctly before
          // they touch anything else.
          let pendingCode: string | null = null;
          try {
            const { consumePendingInviteCode } = await import('../../lib/pendingInvite');
            pendingCode = await consumePendingInviteCode();
          } catch {}

          // Drop the user directly on the create-first-event surface.
          //
          // Nested-state navigation: root → Main → AddTagTab → AddTagCreate
          //
          // Tab indexing in MainTabs (AppNavigator.tsx, ~line 153+):
          //   0=HomeTab  1=SearchTab  2=AddTagTab  3=NotificationsTab  4=ProfileTab
          //
          // Stack indexing in AddTagStackNavigator:
          //   0=AddTagMain (QrGroupListScreen)
          //   1=AddTagCreate (AddTagScreen) ← we land here
          //
          // Back-gesture pops AddTagCreate → AddTagMain (the # tab's
          // landing) which is the natural "I'm done creating, show me
          // my groups" destination.
          const mainState = {
            index: 2,
            routes: [
              { name: 'HomeTab' },
              { name: 'SearchTab' },
              {
                name: 'AddTagTab',
                state: {
                  index: 1,
                  routes: [
                    { name: 'AddTagMain' },
                    { name: 'AddTagCreate' },
                  ],
                },
              },
              { name: 'NotificationsTab' },
              { name: 'ProfileTab' },
            ],
          };
          const routes: any[] = [{ name: 'Main', state: mainState }];
          if (pendingCode) {
            routes.push({ name: 'RedeemInvite', params: { code: pendingCode } });
          }
          navigation.reset({ index: routes.length - 1, routes });
        }}
      />

      {/* ─── Business-card confirmation sheet ───────────────
          Everything OCR'd is shown editable BEFORE it touches
          the profile. Card OCR mangles phone digits / handles;
          a 5-second review beats junk in the user's permanent
          profile. Nothing here writes to the DB — "套用" only
          lifts the values into local state; handleComplete does
          the actual writes when the user finishes onboarding. */}
      <Modal
        visible={scanModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setScanModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {t('auth.onboarding.cardConfirmTitle', { defaultValue: '確認名片資料' })}
              </Text>
              <TouchableOpacity
                onPress={() => setScanModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.close', { defaultValue: '關閉' })}
              >
                <X size={22} color={COLORS.gray500} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {t('auth.onboarding.cardConfirmSubtitle', {
                defaultValue: '檢查一下、可以改 — 確認後才會帶入',
              })}
            </Text>

            <ScrollView
              style={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Name */}
              <Text style={styles.modalFieldLabel}>
                {t('auth.onboarding.cardFieldName', { defaultValue: '名字' })}
              </Text>
              <TextInput
                style={styles.modalInput}
                value={editCard?.full_name ?? ''}
                onChangeText={(v) =>
                  setEditCard((c) => (c ? { ...c, full_name: v } : c))
                }
                placeholder={t('auth.onboarding.profileNamePlaceholder', { defaultValue: '你的名字' })}
                placeholderTextColor={COLORS.gray400}
                maxLength={40}
              />

              {/* Bio draft */}
              <Text style={styles.modalFieldLabel}>
                {t('auth.onboarding.cardFieldBio', { defaultValue: 'Bio（AI 起的草稿，可改）' })}
              </Text>
              <TextInput
                style={[styles.modalInput, styles.modalInputMultiline]}
                value={editCard?.bio_draft ?? ''}
                onChangeText={(v) =>
                  setEditCard((c) => (c ? { ...c, bio_draft: v } : c))
                }
                placeholder={t('auth.onboarding.cardBioPlaceholder', {
                  defaultValue: '一句話介紹你自己',
                })}
                placeholderTextColor={COLORS.gray400}
                multiline
                maxLength={160}
              />

              {/* Detected contact links */}
              {BIOLINK_FIELDS.some(
                (f) => (editCard?.[f.key] ?? '').toString().trim(),
              ) && (
                <Text style={styles.modalSectionLabel}>
                  {t('auth.onboarding.cardLinksLabel', { defaultValue: '聯絡方式 / 社群' })}
                </Text>
              )}
              {BIOLINK_FIELDS.map((f) => {
                const raw = (editCard?.[f.key] ?? '').toString();
                if (!raw.trim()) return null;
                const label = PLATFORM_MAP[f.platform]?.label ?? f.platform;
                const on = !!includeMap[f.key];
                return (
                  <View key={f.key} style={styles.modalLinkRow}>
                    <Switch
                      value={on}
                      onValueChange={(val) =>
                        setIncludeMap((m) => ({ ...m, [f.key]: val }))
                      }
                      trackColor={{ false: COLORS.gray200, true: COLORS.piktag500 }}
                    />
                    <View style={styles.modalLinkBody}>
                      <Text style={styles.modalLinkPlatform}>{label}</Text>
                      <TextInput
                        style={[
                          styles.modalLinkInput,
                          !on && styles.modalLinkInputOff,
                        ]}
                        value={raw}
                        editable={on}
                        onChangeText={(v) =>
                          setEditCard((c) =>
                            c ? { ...c, [f.key]: v } : c,
                          )
                        }
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalApplyBtn}
              activeOpacity={0.85}
              onPress={handleApplyCard}
              accessibilityRole="button"
            >
              <Text style={styles.modalApplyBtnText}>
                {t('auth.onboarding.cardApplyCta', { defaultValue: '套用' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.xxl,
  },

  // ── Welcome screen ──
  welcomeContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 120,
    paddingBottom: 48,
  },
  welcomeIconWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.gray900,
    textAlign: 'center',
    lineHeight: 36,
    paddingHorizontal: 16,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  brandTagline: {
    fontSize: 11,
    color: COLORS.piktag500,
    textAlign: 'center',
    marginTop: 28,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: '600',
  },

  // ── Profile screen ──
  profileContainer: {
    flexGrow: 1,
    paddingTop: 72,
    paddingBottom: 48,
  },
  profileTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  profileSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 32,
  },
  avatarPicker: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    fontSize: 12,
    color: COLORS.gray400,
    textAlign: 'center',
    marginBottom: 24,
  },
  nameInput: {
    fontSize: 18,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: 'center',
  },

  // ── Shared primary CTA ──
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.piktag500,
    marginTop: 24,
  },
  primaryButtonDisabled: {
    backgroundColor: COLORS.gray200,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Scan-card affordance (secondary, subordinate to CTA) ──
  scanCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
    marginTop: 16,
  },
  scanCardBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag500,
  },
  scanCardHint: {
    fontSize: 12,
    color: COLORS.gray400,
    textAlign: 'center',
    marginTop: 8,
  },

  // ── Card confirmation sheet ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.gray900,
  },
  modalSubtitle: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 4,
    marginBottom: 12,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray700,
    marginTop: 14,
    marginBottom: 6,
  },
  modalInput: {
    fontSize: 15,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalInputMultiline: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.piktag600,
    marginTop: 20,
    marginBottom: 4,
  },
  modalLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  modalLinkBody: {
    flex: 1,
  },
  modalLinkPlatform: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray500,
    marginBottom: 4,
  },
  modalLinkInput: {
    fontSize: 14,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modalLinkInputOff: {
    opacity: 0.4,
  },
  modalApplyBtn: {
    marginTop: 20,
    paddingVertical: 15,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
  },
  modalApplyBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
