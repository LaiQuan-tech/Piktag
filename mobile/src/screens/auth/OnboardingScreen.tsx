import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
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
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

type OnboardingScreenProps = {
  navigation: any;
};

const SUPABASE_URL = 'https://utlhlkhlzirfjmvcrerm.supabase.co';

type SocialLinkKey = 'facebook' | 'instagram' | 'linkedin';

export default function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const { t } = useTranslation();
  const DEFAULT_TAGS = t('auth.onboarding.defaultTags', { returnObjects: true }) as string[];
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
  const [loading, setLoading] = useState(false);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAiTags = useCallback(async (bioText: string) => {
    if (!bioText.trim() || bioText.trim().length < 3) {
      setSuggestedTags(DEFAULT_TAGS);
      return;
    }
    setAiLoading(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/suggest-tags`, {
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

  const totalSteps = 3;

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
        .update({ bio: bio.trim() })
        .eq('id', user.id);

      if (profileError) {
        console.warn('Profile update error:', profileError.message);
      }

      // Insert social links as biolinks
      const linksToInsert = (Object.entries(socialLinks) as [SocialLinkKey, string][])
        .filter(([, url]) => url.trim() !== '')
        .map(([platform, url], index) => ({
          user_id: user.id,
          platform,
          url: url.trim(),
          label: platform.charAt(0).toUpperCase() + platform.slice(1),
          position: index,
          is_active: true,
        }));

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

      // Navigate to main app (replace the navigation stack)
      navigation.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      });
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

      <View style={styles.tagSectionHeader}>
        <Sparkles size={18} color={COLORS.piktag600} />
        <Text style={styles.tagSectionTitle}>{t('auth.onboarding.aiTagSectionTitle')}</Text>
        {aiLoading && <ActivityIndicator size="small" color={COLORS.piktag500} style={{ marginLeft: 8 }} />}
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

  const renderStep3 = () => (
    <View style={styles.stepContentCenter}>
      <View style={styles.successIconContainer}>
        <CheckCircle size={72} color={COLORS.piktag500} />
      </View>
      <Text style={styles.successTitle}>{t('auth.onboarding.step3Title')}</Text>
      <Text style={styles.successDescription}>
        {t('auth.onboarding.step3Description')}
      </Text>
    </View>
  );

  const renderCurrentStep = () => {
    switch (step) {
      case 0:
        return renderStep1();
      case 1:
        return renderStep2();
      case 2:
        return renderStep3();
      default:
        return null;
    }
  };

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
        {step > 0 ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            activeOpacity={0.7}
          >
            <ChevronLeft size={20} color={COLORS.gray700} />
            <Text style={styles.backButtonText}>{t('auth.onboarding.backButton')}</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}

        <TouchableOpacity
          style={[styles.nextButton, loading && styles.nextButtonDisabled]}
          onPress={goNext}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} size="small" />
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    marginBottom: SPACING.xxl,
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
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
