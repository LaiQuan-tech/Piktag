import React, { useState, useRef, useCallback } from 'react';
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
} from 'react-native';
import BrandSpinner from '../../components/loaders/BrandSpinner';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Facebook,
  Instagram,
  Linkedin,
  X,
  Sparkles,
} from 'lucide-react-native';
import { supabase, supabaseUrl, supabaseAnonKey } from '../../lib/supabase';
import { Image } from 'expo-image';
import {
  requestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { normalizePhone } from '../../hooks/useLocalContacts';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';
import OnboardingCompleteBurst from '../../components/stingers/OnboardingCompleteBurst';
import WelcomeSlides from '../../components/onboarding/WelcomeSlides';
import QuickStartTour from '../../components/onboarding/QuickStartTour';

// Must match the key used in AppNavigator. Persisting this flag is the
// source of truth for "has this user completed onboarding?" — it
// survives clock skew, bio edits, and the 5-minute "is new user"
// heuristic the navigator previously relied on exclusively.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

type OnboardingScreenProps = {
  navigation: any;
};

type SocialLinkKey = 'facebook' | 'instagram' | 'linkedin';

export default function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const { t } = useTranslation();
  const DEFAULT_TAGS = t('auth.onboarding.defaultTags', { returnObjects: true }) as string[];
  // Concept-teaching welcome slides shown before any data collection.
  // Once the user finishes the 3 slides we drop into the existing
  // bio/tags/social flow. We don't persist a separate "saw welcome"
  // flag — completing the slides is cheap and harmless to re-show on a
  // mid-onboarding kill (the only path that would re-trigger them),
  // and adding another AsyncStorage key would just be more state to
  // forget to invalidate later.
  const [welcomeDone, setWelcomeDone] = useState(false);
  const [step, setStep] = useState(0);
  const [bio, setBio] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<string[]>(DEFAULT_TAGS);
  const [aiLoading, setAiLoading] = useState(false);
  const [socialLinks, setSocialLinks] = useState<Record<SocialLinkKey, string>>({
    facebook: '',
    instagram: '',
    linkedin: '',
  });
  const [editingSocial, setEditingSocial] = useState<SocialLinkKey | null>(null);
  // Phone is collected separately from the social-platform map so we
  // can normalize to E.164 + persist as a biolink with platform='phone'.
  // Without this, Apple/Google sign-in users have NULL on every phone
  // surface (auth.users.phone, piktag_profiles.phone, biolinks) — which
  // makes them invisible to friends running contact-sync.
  const [phoneInput, setPhoneInput] = useState('');
  const [birthday, setBirthday] = useState('');
  const [loading, setLoading] = useState(false);
  // Avatar (task 4 — first-launch data setup). Uploaded immediately
  // on pick so the user sees the preview + the profile row gets
  // the URL right away. If they skip this step, they stay
  // initials-only until they hit EditProfile post-onboarding.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [burstVisible, setBurstVisible] = useState(false);
  const [burstUserName, setBurstUserName] = useState<string | undefined>(undefined);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAiTags = useCallback(async (bioText: string) => {
    if (!bioText.trim() || bioText.trim().length < 3) {
      setSuggestedTags(DEFAULT_TAGS);
      return;
    }
    setAiLoading(true);
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/suggest-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: bioText }),
      });
      const data = await resp.json();
      if (data.tags && data.tags.length > 0) {
        setSuggestedTags(data.tags.map((t: string) => `#${t}`));
      }
    } catch {
      // Keep current suggestions on error
    } finally {
      setAiLoading(false);
    }
  }, []);

  const handleBioChange = (text: string) => {
    setBio(text);
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    aiDebounceRef.current = setTimeout(() => fetchAiTags(text), 600);
  };

  const totalSteps = 4;

  // ─── Avatar upload (task 4 onboarding step 0) ───
  //
  // Mirrors EditProfileScreen.handleChangeAvatar — same MIME/size
  // validation, same Supabase Storage POST + profiles row update.
  // Kept inline rather than extracted to a shared helper because
  // the post-upload state (setAvatarUrl) is component-local.
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

      // Client-side validation — server-side bucket policy enforces
      // these too. Keep checks identical to EditProfile so any image
      // that uploads here also uploads there.
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
        Alert.alert(t('common.error'), t('auth.onboarding.alertUserNotFound'));
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
        throw new Error(err.message || 'upload failed');
      }
      // Cache-buster on the URL so the new image renders even when
      // the old one is still in the avatar cache.
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}?t=${Date.now()}`;
      const { error: updateError } = await supabase
        .from('piktag_profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.message || t('common.unknownError'));
    } finally {
      setUploadingAvatar(false);
    }
  }, [t]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert(t('common.error'), t('auth.onboarding.alertUserNotFound'));
        return;
      }

      // Update profile with bio
      const { error: profileError } = await supabase
        .from('piktag_profiles')
        .update({ bio: bio.trim(), birthday: birthday.trim() || null })
        .eq('id', user.id);

      if (profileError) {
        console.warn('Profile update error:', profileError.message);
      }

      // Insert social links as biolinks
      type BiolinkInsert = {
        user_id: string;
        platform: string;
        url: string;
        label: string;
        position: number;
        is_active: boolean;
      };
      const linksToInsert: BiolinkInsert[] = (Object.entries(socialLinks) as [SocialLinkKey, string][])
        .filter(([, url]) => url.trim() !== '')
        .map(([platform, url], index) => ({
          user_id: user.id,
          platform,
          url: url.trim(),
          label: platform.charAt(0).toUpperCase() + platform.slice(1),
          position: index,
          is_active: true,
        }));

      // Phone biolink — separate insertion so we can E.164-normalize.
      // The contact-sync RPC matches against piktag_biolinks where
      // platform='phone'; storing it here makes the user discoverable.
      //
      // normalizePhone falls back to returning the input verbatim for
      // anything it can't recognize (e.g. 'abc'), so we re-validate
      // strictly here to keep junk like `tel:abc` out of the table.
      const phoneTrimmed = phoneInput.trim();
      const e164 = normalizePhone(phoneTrimmed);
      const isValidE164 = !!e164 && /^\+\d{8,15}$/.test(e164);
      if (isValidE164 && e164) {
        linksToInsert.push({
          user_id: user.id,
          platform: 'phone',
          url: 'tel:' + e164,
          label: 'Phone',
          position: linksToInsert.length,
          is_active: true,
        });
      } else if (phoneTrimmed.length > 0) {
        // User typed something but it didn't normalize cleanly. Tell
        // them rather than silently dropping the field — they'll think
        // their phone was saved otherwise. Non-blocking: we still
        // proceed with the rest of onboarding.
        Alert.alert(
          t('auth.onboarding.phoneInvalidTitle', { defaultValue: '電話格式無效' }),
          t('auth.onboarding.phoneInvalidMessage', {
            defaultValue: '無法辨識「{{value}}」，已略過。可稍後到個人資料補上。',
            value: phoneTrimmed,
          }),
        );
      }

      if (linksToInsert.length > 0) {
        const { error: linksError } = await supabase
          .from('piktag_biolinks')
          .insert(linksToInsert);

        if (linksError) {
          console.warn('Biolinks insert error:', linksError.message);
        }
      }

      // Insert selected tags
      if (selectedTags.length > 0) {
        for (let i = 0; i < selectedTags.length; i++) {
          const tagName = selectedTags[i].replace('#', '');

          // Find or create tag
          const { data: tagData, error: tagError } = await supabase
            .from('piktag_tags')
            .select('id')
            .eq('name', tagName)
            .single();

          let tagId: string | undefined;

          if (tagError || !tagData) {
            const { data: newTag } = await supabase
              .from('piktag_tags')
              .insert({ name: tagName, created_by: user.id })
              .select('id')
              .single();
            tagId = newTag?.id;
          } else {
            tagId = tagData.id;
          }

          if (tagId) {
            await supabase.from('piktag_user_tags').insert({
              user_id: user.id,
              tag_id: tagId,
              position: i,
            });
          }
        }
      }

      // Persist the onboarding-complete flag BEFORE resetting navigation.
      // AppNavigator reads this on subsequent launches to decide the
      // initial route. If we only relied on `bio` emptiness, a user who
      // completes onboarding but whose bio insert silently failed would
      // be trapped in the flow forever.
      try {
        await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
      } catch (err) {
        // Non-fatal — the legacy bio check still kicks in as a fallback.
        console.warn('[Onboarding] failed to persist completion flag:', err);
      }

      // Pull the freshest profile name for the burst chip. Best-effort —
      // a network hiccup just means the chip falls back to the email
      // local-part (and ultimately the stinger handles undefined fine).
      let displayName: string | undefined;
      try {
        const { data: profileRow } = await supabase
          .from('piktag_profiles')
          .select('full_name, username')
          .eq('id', user.id)
          .single();
        displayName =
          profileRow?.full_name?.trim() ||
          profileRow?.username?.trim() ||
          user.email?.split('@')[0] ||
          undefined;
      } catch {
        displayName = user.email?.split('@')[0] || undefined;
      }

      // Defer the navigation.reset to the stinger's onComplete so the
      // burst animation gets to play uninterrupted before the tab stack
      // mounts and steals focus.
      setBurstUserName(displayName);
      setBurstVisible(true);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  const goNext = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      handleComplete();
    }
  };

  const goBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const renderProgressIndicator = () => (
    <View style={styles.progressContainer}>
      {Array.from({ length: totalSteps }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressDot,
            i === step && styles.progressDotActive,
            i < step && styles.progressDotCompleted,
          ]}
        />
      ))}
    </View>
  );

  // ─── Step 0: avatar (task 4) ───
  // First data-collection step. Why before bio: avatar drives the
  // strongest "real person" signal in every list/search/connection
  // row. A user with no avatar shows as gray initials all over day 1
  // and feels half-onboarded to anyone seeing them.
  const renderAvatarStep = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>
        {t('auth.onboarding.avatarStepTitle', { defaultValue: '先放一張頭貼吧' })}
      </Text>
      <Text style={styles.stepDescription}>
        {t('auth.onboarding.avatarStepDescription', { defaultValue: '讓朋友一眼認出你 — 之後也可以隨時更換。' })}
      </Text>

      <View style={styles.avatarPickerWrap}>
        <TouchableOpacity
          onPress={handlePickAvatar}
          disabled={uploadingAvatar}
          activeOpacity={0.8}
          style={styles.avatarPickerCircle}
          accessibilityRole="button"
          accessibilityLabel={t('auth.onboarding.avatarPickAria', { defaultValue: '選擇頭貼' })}
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={styles.avatarPickerImage}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <View style={styles.avatarPickerPlaceholder}>
              <Camera size={32} color={COLORS.piktag500} />
            </View>
          )}
          {uploadingAvatar ? (
            <View style={styles.avatarPickerOverlay}>
              <BrandSpinner size={24} />
            </View>
          ) : null}
        </TouchableOpacity>
        <Text style={styles.avatarPickerHint}>
          {avatarUrl
            ? t('auth.onboarding.avatarTapToChange', { defaultValue: '點頭貼可以更換' })
            : t('auth.onboarding.avatarTapToPick', { defaultValue: '點圓圈選一張照片' })}
        </Text>
      </View>
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>{t('auth.onboarding.step1Title')}</Text>
      <Text style={styles.stepDescription}>
        {t('auth.onboarding.step1Description')}
      </Text>

      <TextInput
        style={styles.bioInput}
        placeholder={t('auth.onboarding.step1BioPlaceholder')}
        placeholderTextColor={COLORS.gray400}
        value={bio}
        onChangeText={handleBioChange}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />

      {/* Birthday */}
      <View style={styles.birthdayRow}>
        <Text style={styles.birthdayLabel}>{t('auth.onboarding.birthdayLabel', { defaultValue: '生日' })}</Text>
        <TextInput
          style={styles.birthdayInput}
          placeholder="MM/DD"
          placeholderTextColor={COLORS.gray400}
          value={birthday}
          onChangeText={setBirthday}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
      </View>

      <View style={styles.tagSectionHeader}>
        <Sparkles size={18} color={COLORS.piktag600} />
        <Text style={styles.tagSectionTitle}>{t('auth.onboarding.aiTagSectionTitle')}</Text>
        {aiLoading && <BrandSpinner size={16} style={{ marginLeft: 8 }} />}
      </View>
      <Text style={styles.tagSectionDescription}>
        {t('auth.onboarding.aiTagSectionDescription')}
      </Text>
      <View style={styles.tagsContainer}>
        {suggestedTags.map((tag) => (
          <TouchableOpacity
            key={tag}
            style={[
              styles.tagButton,
              selectedTags.includes(tag) && styles.tagButtonActive,
            ]}
            onPress={() => toggleTag(tag)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tagButtonText,
                selectedTags.includes(tag) && styles.tagButtonTextActive,
              ]}
            >
              {tag}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const socialPlatforms: { key: SocialLinkKey; label: string; icon: React.ReactNode }[] = [
    {
      key: 'facebook',
      label: t('auth.onboarding.facebookLabel'),
      icon: <Facebook size={20} color={COLORS.gray700} />,
    },
    {
      key: 'instagram',
      label: t('auth.onboarding.instagramLabel'),
      icon: <Instagram size={20} color={COLORS.gray700} />,
    },
    {
      key: 'linkedin',
      label: t('auth.onboarding.linkedinLabel'),
      icon: <Linkedin size={20} color={COLORS.gray700} />,
    },
  ];

  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>{t('auth.onboarding.step2Title')}</Text>
      <Text style={styles.stepDescription}>
        {t('auth.onboarding.step2Description')}
      </Text>

      {/* Phone — for contact-sync discoverability. Optional but strongly
          encouraged; without it, friends doing contact-sync won't match
          the user against their address book. */}
      <View style={styles.phoneSection}>
        <Text style={styles.phoneSectionTitle}>
          {t('auth.onboarding.phoneSectionTitle', { defaultValue: '📱 手機號碼（選填）' })}
        </Text>
        <Text style={styles.phoneSectionHint}>
          {t('auth.onboarding.phoneSectionHint', { defaultValue: '讓朋友的通訊錄能找到你 — 永遠不會公開，也不會用來打給你。' })}
        </Text>
        <TextInput
          style={styles.phoneInput}
          placeholder={t('auth.onboarding.phonePlaceholder', { defaultValue: '0912345678' })}
          placeholderTextColor={COLORS.gray400}
          value={phoneInput}
          onChangeText={setPhoneInput}
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
        />
      </View>

      <View style={styles.socialLinksContainer}>
        {socialPlatforms.map(({ key, label, icon }) => (
          <View key={key} style={styles.socialLinkItem}>
            <TouchableOpacity
              style={[
                styles.socialButton,
                socialLinks[key] !== '' && styles.socialButtonActive,
              ]}
              onPress={() =>
                setEditingSocial(editingSocial === key ? null : key)
              }
              activeOpacity={0.7}
            >
              {icon}
              <Text
                style={[
                  styles.socialButtonText,
                  socialLinks[key] !== '' && styles.socialButtonTextActive,
                ]}
              >
                {label}
              </Text>
              {socialLinks[key] !== '' && (
                <CheckCircle size={16} color={COLORS.piktag500} />
              )}
            </TouchableOpacity>

            {editingSocial === key && (
              <View style={styles.socialInputContainer}>
                <TextInput
                  style={styles.socialInput}
                  placeholder={t('auth.onboarding.socialLinkPlaceholder', { label })}
                  placeholderTextColor={COLORS.gray400}
                  value={socialLinks[key]}
                  onChangeText={(text) =>
                    setSocialLinks((prev) => ({ ...prev, [key]: text }))
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <TouchableOpacity
                  style={styles.socialInputClose}
                  onPress={() => setEditingSocial(null)}
                >
                  <X size={18} color={COLORS.gray500} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );

  // Step 3 used to be a vanity "you're all set" card with a checkmark. We
  // swapped it for the QuickStartTour — same step in the flow, same CTA
  // ("開始使用 PikTag" → handleComplete → burst), but the screen now teaches
  // the four day-one actions (加朋友 / 加標籤 / 找人 / 發 Ask) instead of
  // just celebrating. The celebration still fires via the existing burst
  // overlay when the user taps the bottom button, so we don't lose that
  // moment — we just put it after a screen of useful info.
  const renderStep3 = () => <QuickStartTour />;

  const renderCurrentStep = () => {
    switch (step) {
      case 0:
        return renderAvatarStep();  // task 4 — new avatar step
      case 1:
        return renderStep1();        // bio + tags + birthday
      case 2:
        return renderStep2();        // phone + social links
      case 3:
        return renderStep3();        // QuickStartTour
      default:
        return null;
    }
  };

  // Gate: show the 3-slide concept carousel before the data-collection
  // flow. Returning early avoids loading the rest of the form mount
  // (TextInputs / FlatList suggestions) until the user actually needs
  // them — keeps first-paint snappier on cold start.
  if (!welcomeDone) {
    return <WelcomeSlides onComplete={() => setWelcomeDone(true)} />;
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {renderProgressIndicator()}
        {renderCurrentStep()}
      </ScrollView>

      {/* Navigation Buttons */}
      <View style={styles.navigationBar}>
        <View style={styles.navLeftCluster}>
          {step > 0 ? (
            <TouchableOpacity
              style={styles.backButton}
              onPress={goBack}
              activeOpacity={0.7}
            >
              <ChevronLeft size={20} color={COLORS.gray700} />
              <Text style={styles.backButtonText}>{t('auth.onboarding.backButton')}</Text>
            </TouchableOpacity>
          ) : null}

          {/* "Skip this step" — only on data steps (0, 1, 2). The
              final QuickStartTour step doesn't collect data so
              there's nothing to skip. Each data step's fields are
              saved on the final handleComplete; skipping just
              advances without filling state, which the save logic
              already handles gracefully (empty bio → no bio update,
              empty social URL → no biolink insert, etc). */}
          {step < totalSteps - 1 && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={goNext}
              activeOpacity={0.6}
            >
              <Text style={styles.skipButtonText}>
                {t('auth.onboarding.skipStep', { defaultValue: '略過' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, loading && styles.nextButtonDisabled]}
          onPress={goNext}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <BrandSpinner size={20} />
          ) : step === totalSteps - 1 ? (
            <Text style={styles.nextButtonText}>{t('auth.onboarding.enterPikTag')}</Text>
          ) : (
            <>
              <Text style={styles.nextButtonText}>{t('auth.onboarding.nextButton')}</Text>
              <ChevronRight size={20} color={COLORS.white} />
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Hero burst plays after the user taps "Start using PikTag" and
          drives the actual reset to the Main tab stack on completion.
          Mounted at the screen root so its full-screen Modal layers
          above both the ScrollView content and the navigation bar. */}
      <OnboardingCompleteBurst
        visible={burstVisible}
        userName={burstUserName}
        onComplete={async () => {
          setBurstVisible(false);
          // After onboarding finishes, drop the user on EditProfile
          // (with `fromOnboarding: true`) instead of straight into
          // Main / Connections. Reason: cold-start users land on an
          // empty Connections feed and the app feels broken; routing
          // them to their own profile editor first lets them finish
          // their bio / biolinks / tags so they have a complete,
          // shareable PikTag page on day 1 — Linktree-style. Reset
          // index = 1 so the back gesture pops to Main, not the
          // onboarding screen they just finished.
          //
          // Pending invite handoff: if the user reached signup via a
          // /i/{code} link, stack RedeemInvite on top of EditProfile so
          // they tap Redeem → instantly connected → back to EditProfile
          // to finish their card. Without this, the consume effect in
          // ConnectionsScreen never fires (Connections doesn't mount
          // while EditProfile is on top), and the invite stalls until
          // the user manually navigates to Home.
          let pendingCode: string | null = null;
          try {
            const { consumePendingInviteCode } = await import('../../lib/pendingInvite');
            pendingCode = await consumePendingInviteCode();
          } catch {}
          const routes: any[] = [
            { name: 'Main' },
            { name: 'EditProfile', params: { fromOnboarding: true } },
          ];
          if (pendingCode) {
            routes.push({ name: 'RedeemInvite', params: { code: pendingCode } });
          }
          navigation.reset({ index: routes.length - 1, routes });
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.xxl,
    paddingTop: 60,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 40,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.gray200,
  },
  progressDotActive: {
    width: 28,
    backgroundColor: COLORS.piktag500,
    borderRadius: 5,
  },
  progressDotCompleted: {
    backgroundColor: COLORS.piktag300,
  },
  stepContent: {
    flex: 1,
  },
  stepContentCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.gray900,
    marginBottom: SPACING.sm,
  },
  stepDescription: {
    fontSize: 15,
    color: COLORS.gray500,
    lineHeight: 22,
    marginBottom: SPACING.xxl,
  },
  // ── Avatar picker (task 4 onboarding step 0) ──
  avatarPickerWrap: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: 14,
  },
  avatarPickerCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.piktag50,
    borderWidth: 2,
    borderColor: COLORS.piktag200,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPickerImage: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  avatarPickerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  avatarPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPickerHint: {
    fontSize: 13,
    color: COLORS.gray500,
    textAlign: 'center',
  },
  bioInput: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    fontSize: 16,
    color: COLORS.gray900,
    backgroundColor: COLORS.white,
    minHeight: 120,
    marginBottom: SPACING.lg,
  },
  birthdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: SPACING.xxl,
  },
  birthdayLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  birthdayInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.gray900,
    backgroundColor: COLORS.white,
  },
  tagSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: SPACING.xs,
  },
  tagSectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray800,
  },
  tagSectionDescription: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: SPACING.lg,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  tagButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
  },
  tagButtonActive: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  tagButtonText: {
    fontSize: 14,
    color: COLORS.gray600,
    fontWeight: '500',
  },
  tagButtonTextActive: {
    color: COLORS.piktag600,
  },
  phoneSection: {
    marginBottom: SPACING.xl,
    paddingBottom: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  phoneSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  phoneSectionHint: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.gray600,
    marginBottom: 12,
  },
  phoneInput: {
    backgroundColor: COLORS.gray50,
    borderColor: COLORS.gray200,
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.gray900,
  },
  socialLinksContainer: {
    gap: SPACING.md,
  },
  socialLinkItem: {
    gap: SPACING.sm,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderRadius: BORDER_RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
  },
  socialButtonActive: {
    borderColor: COLORS.piktag300,
    backgroundColor: COLORS.piktag50,
  },
  socialButtonText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.gray700,
    fontWeight: '500',
  },
  socialButtonTextActive: {
    color: COLORS.gray900,
  },
  socialInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  socialInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
  },
  socialInputClose: {
    padding: SPACING.sm,
  },
  // Contact sync step
  contactSyncIcon: {
    marginBottom: SPACING.xl,
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center', justifyContent: 'center',
  },
  syncBtn: {
    backgroundColor: COLORS.piktag500, borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 14, paddingHorizontal: 32, marginTop: SPACING.xl,
    alignItems: 'center', minWidth: 200,
  },
  syncBtnText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
  skipBtn: { marginTop: SPACING.md, padding: SPACING.sm },
  skipBtnText: { fontSize: 14, color: COLORS.gray500 },
  contactResultBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.piktag50, borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 14, paddingHorizontal: 20, marginTop: SPACING.xl,
    borderWidth: 1, borderColor: COLORS.piktag500,
  },
  contactResultText: { fontSize: 15, fontWeight: '600', color: COLORS.piktag600 },

  successIconContainer: {
    marginBottom: SPACING.xxl,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.gray900,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  successDescription: {
    fontSize: 16,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: SPACING.lg,
  },
  navigationBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.lg,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  // Left cluster wraps the back button + skip link so they sit
  // together on the left while the primary Next CTA stays right.
  navLeftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  // Skip = subtle text link, deliberately less prominent than the
  // primary Next CTA so first-time users still default to the
  // intended flow but power users / re-installers can dash through.
  skipButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  skipButtonText: {
    fontSize: 14,
    color: COLORS.gray500,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.gray700,
    fontWeight: '500',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.piktag500,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
    borderRadius: BORDER_RADIUS.xl,
  },
  nextButtonDisabled: {
    opacity: 0.7,
  },
  nextButtonText: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: 'bold',
  },
});
