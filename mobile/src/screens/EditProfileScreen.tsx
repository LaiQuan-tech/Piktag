import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, Pencil, Trash2, X, Hash, EyeOff, Eye, GripVertical, ChevronDown, Sparkles, CheckCircle2, RefreshCw, AlertTriangle, ArrowLeftRight, ChevronUp } from 'lucide-react-native';
import { logApiUsage } from '../lib/apiUsage';
import RingedAvatar from '../components/RingedAvatar';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { requestMediaLibraryPermissionsAsync, launchImageLibraryAsync } from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import PlatformIcon from '../components/PlatformIcon';
import CountryCodePicker from '../components/CountryCodePicker';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import {
  type Country,
  buildTelUrl,
  getDefaultCountry,
  splitTelUrl,
} from '../lib/countryCodes';
import { useAuth } from '../hooks/useAuth';
import { useAskFeed } from '../hooks/useAskFeed';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import PlatformSearchModal from '../components/PlatformSearchModal';
import type { Biolink, Tag, UserTag } from '../types';
import {
  PLATFORM_MAP,
  QUICK_PICK_KEYS,
  detectPlatformFromUrl,
  stripPlatformPrefix as platformStripPrefix,
  buildPlatformUrl as platformBuildUrl,
  getPlatformLabel,
} from '../lib/platforms';

// Tag-management constants — moved here so EditProfileScreen owns
// the full tag editing surface (add / remove / drag / cap).
// Mirrors what ManageTagsScreen used; both pages should produce the
// same constraints. NOTE: tag pinning ("標籤置頂") was removed from
// this screen — it's reserved as a future paid feature. The
// `is_pinned` column on piktag_user_tags is kept intact in the
// schema and existing rows still sort by it on detail screens, but
// no UI here lets users toggle it.
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

// DraggableChips uses react-native-reanimated which crashes on web.
// Same conditional require pattern as ManageTagsScreen used.
const DraggableChips = Platform.OS !== 'web' ? require('../components/DraggableChips').default : null;

// Map a saved (platform, url) pair back to a preset key. Tries the
// stored platform string first, then falls back to URL-based
// detection (handles legacy 'custom' rows that actually came from
// known services). Returns 'custom' when nothing matches so the
// form always lands on a valid key.
const detectPlatformKey = (platform: string, url: string): string => {
  const lower = (platform || '').toLowerCase().trim();
  if (PLATFORM_MAP[lower]) return lower;
  return detectPlatformFromUrl(url) || 'custom';
};

// Bridge constants — shape of the OLD local tables, populated from
// the new platforms.ts catalog. Kept so the existing render paths
// (legacy add-link form + edit modal) keep working without a flag-
// day rewrite. UI was already reading these as Record<string, …>;
// PLATFORM_MAP gives us the same keys + the extra long-tail entries
// for free.
const PLATFORM_LABELS_STATIC: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_MAP).map(([k, p]) => [k, p.label]),
);
const PLATFORM_PREFIXES: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_MAP).map(([k, p]) => [k, p.prefix]),
);
const PLATFORM_PLACEHOLDER_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_MAP).map(([k, p]) => [k, p.placeholder]),
);
const PRESET_PLATFORM_KEYS = QUICK_PICK_KEYS as readonly string[];
const stripPlatformPrefix = platformStripPrefix;
const buildPlatformUrl = platformBuildUrl;

type EditProfileScreenProps = {
  navigation: any;
  route?: { params?: { fromOnboarding?: boolean; focusPhone?: boolean } };
};

type FormData = {
  full_name: string;
  username: string;
  headline: string;
  bio: string;
};

type BiolinkFormData = {
  platform: string;             // preset key: 'email', 'instagram', 'phone', 'custom', ...
  account: string;              // account/path part (or full URL when platform === 'custom').
                                // For 'phone', this field is unused — phoneCountry / phoneNational are the source of truth.
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
          <BrandSpinner size={16} />
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

export default function EditProfileScreen({ navigation, route }: EditProfileScreenProps) {
  const fromOnboarding = !!route?.params?.fromOnboarding;
  const focusPhone = !!route?.params?.focusPhone;
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // myAsk drives the avatar's gradient ring on this screen too — same
  // semantic as ProfileScreen: the gradient ring signals "I have an
  // active Ask", subtle when not. Without this, every user editing
  // their profile would see a permanent gradient and the visual signal
  // means nothing.
  const { myAsk } = useAskFeed();
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
  // Browse-all-platforms search modal. Surfaces the long tail of 50
  // platforms that don't fit on the 8-chip quick-pick row.
  const [platformSearchVisible, setPlatformSearchVisible] = useState(false);
  // Tracks where the next platform pick should land — either the
  // legacy inline-add form (`legacy`) or the edit modal's biolinkForm
  // (`modal`). Set when opening the search modal, read when the
  // modal calls back with a platform key.
  const [platformSearchTarget, setPlatformSearchTarget] = useState<'legacy' | 'modal'>('modal');
  // Auto-detect feedback in the URL field. When the user types or
  // pastes a URL we run detectPlatformFromUrl and show a "✓ Detected
  // as Instagram" hint below the input. Auto-applied to
  // biolinkForm.platform but the user can override by tapping a
  // different chip / picking from the search modal.
  const [autoDetectedPlatform, setAutoDetectedPlatform] = useState<string | null>(null);
  const [biolinkForm, setBiolinkForm] = useState<BiolinkFormData>({
    platform: 'email',
    account: '',
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

  // Phone-specific state. The new-link form's `newLinkAccount` holds
  // the generic account/path string for every other platform; for
  // `phone` we keep a dedicated (country, national-number) pair so the
  // user can pick a dial code without encoding it into one text field.
  // These are also used by the edit-link modal when the biolink being
  // edited has `platform === 'phone'`, so a single source of truth.
  const [phoneCountry, setPhoneCountry] = useState<Country>(() =>
    getDefaultCountry(i18n.language),
  );
  const [phoneNational, setPhoneNational] = useState<string>('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  // Reset the phone-specific fields back to the locale default. Called
  // when the user cancels a form, successfully saves, or switches the
  // selected platform away from phone.
  const resetPhoneFields = useCallback(() => {
    setPhoneCountry(getDefaultCountry(i18n.language));
    setPhoneNational('');
  }, []);

  // Tags state
  const [userTags, setUserTags] = useState<(UserTag & { tag?: Tag })[]>([]);
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const [isTagPrivate, setIsTagPrivate] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  // Drag / pin state — ported from ManageTagsScreen so this screen
  // is now the single home for tag editing.
  const [isDragging, setIsDragging] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null); // web tap-to-swap
  // Collapse-by-default for the popular-tags section so it doesn't
  // bloat the page; expand only when the user wants to browse.
  const [showPopularTags, setShowPopularTags] = useState(false);

  // Inline AI tag suggestions — mirrors AskStoryRow's pattern: manual
  // ✨ button trigger (no auto-debounce / no auto-fire on screen mount)
  // so the user knows when an API call is happening and we don't burn
  // tokens on half-typed bio drafts. Replaces the "type bio here →
  // navigate to ManageTagsScreen → wait for auto-load" two-page flow
  // with a single inline action on the same screen.
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTriedAndEmpty, setAiTriedAndEmpty] = useState(false);
  // Debounce timer for auto-triggered AI suggestions on bio /
  // full_name / headline edits. Reported case: users finish typing
  // their bio and don't realize they have to navigate to a separate
  // 標籤管理 page (or even tap a ✨ button on this page) to see AI
  // recommendations — the connection between "簡介" and "AI tags"
  // wasn't obvious. Auto-firing on edit makes the relationship
  // visible: type bio → suggestions appear → tap to add. Same UX
  // contract as AskStoryRow's auto-fire when composing an Ask body.
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Don't auto-fire on the first render — the form is being
  // populated from the user's saved profile, not from a fresh user
  // edit. Once the user actually touches a field, this flips true
  // and auto-fire is enabled for subsequent changes.
  const aiAutoFireArmedRef = useRef<boolean>(false);

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

    // Defense-in-depth: client-side MIME + size validation
    // (storage bucket policy enforces this server-side as well)
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

    if (!asset.mimeType || !ALLOWED_MIME_TYPES.includes(asset.mimeType)) {
      Alert.alert(t('common.error'), t('editProfile.invalidImageType'));
      return;
    }

    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_FILE_SIZE) {
      Alert.alert(t('common.error'), t('editProfile.imageTooLarge'));
      return;
    }

    const extFromMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extFromMime[asset.mimeType];
    const filePath = `${userId}/avatar.${ext}`;

    try {
      setUploadingAvatar(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('未登入');

      const mimeType = asset.mimeType;
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

  // The focus-listener below skips ONE focus event — the one that
  // fires right after this screen first mounts (which the initial
  // load useEffect already covers). Every subsequent focus (e.g.
  // returning from ManageTagsScreen) does refetch.
  const focusSkippedOnceRef = useRef<boolean>(false);

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
      if (isMounted) {
        setLoading(false);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [fetchProfile, fetchBiolinks, fetchUserTags, fetchPopularTags]);

  // Refresh tags whenever the screen regains focus — i.e. on every
  // return from ManageTagsScreen. Reported case: user deletes all
  // tags in 標籤管理, taps back, EditProfile still shows the old
  // tags until they tap Save. The previous "skip if mounted within
  // 60s" guard accidentally swallowed this refetch when the round
  // trip happened quickly. New rule: skip only the FIRST focus
  // event (which fires right after mount and would duplicate the
  // initial load useEffect above), then every subsequent focus
  // refetches.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (!focusSkippedOnceRef.current) {
        focusSkippedOnceRef.current = true;
        return;
      }
      fetchUserTags();
    });
    return unsubscribe;
  }, [navigation, fetchUserTags]);

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Bio / name / headline edits invalidate the previous "AI returned
    // nothing" hint — the user is changing the prompt, so the next ✨
    // tap should present as a fresh attempt, not as still-empty.
    if (field === 'bio' || field === 'full_name' || field === 'headline') {
      setAiTriedAndEmpty(false);

      // Auto-trigger AI suggestions ~1.2s after the user stops
      // typing. Replaces the requirement to navigate to 標籤管理 (or
      // tap the ✨ button) to see suggestions — the relationship
      // between "I edited my bio" and "AI surfaced relevant tags"
      // is now immediate and visible. The manual ✨ button stays as
      // a re-roll option after the auto-fire lands.
      //
      // Guards (in roughly the order they fire):
      //   * armed ref — first render populates `form` from the saved
      //     profile, not from user input; we don't fire on that.
      //     Flips true the first time the user actually touches a
      //     field.
      //   * 1.2s debounce — coalesces rapid typing into one call.
      //   * length >= 5 (inside loadAiSuggestions itself).
      //   * !aiLoading guard there too — prevents stacking calls.
      aiAutoFireArmedRef.current = true;
      if (aiDebounceRef.current) {
        clearTimeout(aiDebounceRef.current);
      }
      aiDebounceRef.current = setTimeout(() => {
        if (!aiAutoFireArmedRef.current) return;
        // Stale-closure-safe: read the latest form via the setter
        // form-functional-update trick. Bio shorter than 5 chars
        // skips inside loadAiSuggestions.
        loadAiSuggestions();
      }, 1200);
    }
  };

  // Tear down the auto-fire timer on unmount so a slow network
  // request doesn't fire after the user navigated away.
  useEffect(() => {
    return () => {
      if (aiDebounceRef.current) {
        clearTimeout(aiDebounceRef.current);
        aiDebounceRef.current = null;
      }
    };
  }, []);

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

  const openAddBiolinkModal = (initialPlatform: string = 'email') => {
    setEditingBiolink(null);
    setBiolinkForm({
      platform: initialPlatform,
      account: '',
      label: '',
      display_mode: 'card',
      visibility: 'public',
    });
    resetPhoneFields();
    setAutoDetectedPlatform(null);
    setBiolinkModalVisible(true);
  };

  // When ConnectionsScreen's phone-prompt banner deep-links here with
  // `focusPhone: true`, jump directly to the add-biolink modal already
  // pre-selected to phone — saves the user from having to discover the
  // "+" button + scroll the platform picker down to phone.
  // Run-once: depending on `focusPhone` would re-fire on every render if
  // we kept it in the deps; the boolean is stable across this screen's
  // lifetime so a single mount-effect is correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusPhone) return;
    const timer = setTimeout(() => {
      openAddBiolinkModal('phone');
      // Clear the param so navigating back here later (without the
      // banner intent) doesn't re-open the modal.
      navigation.setParams?.({ focusPhone: undefined } as any);
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  const openEditBiolinkModal = (biolink: Biolink) => {
    const platformKey = detectPlatformKey(biolink.platform, biolink.url);
    // For phone, the editable value lives in phoneCountry/phoneNational; account stays empty.
    const account = platformKey === 'phone' ? '' : stripPlatformPrefix(biolink.url, platformKey);
    setEditingBiolink(biolink);
    setBiolinkForm({
      platform: platformKey,
      account,
      label: biolink.label || '',
      display_mode: biolink.display_mode || 'card',
      visibility: biolink.visibility || 'public',
    });
    // Pre-fill the phone-specific fields when editing a phone biolink so
    // the picker + national-number input reflect what's on file. Legacy
    // bare numbers (e.g. `tel:0916581787` with no `+` prefix) don't
    // resolve to a country — fall back to the locale default so users
    // still see a sensible country chip instead of an empty box.
    if (platformKey === 'phone') {
      const { country, national } = splitTelUrl(biolink.url);
      setPhoneCountry(country ?? getDefaultCountry(i18n.language));
      setPhoneNational(national);
    } else {
      resetPhoneFields();
    }
    setBiolinkModalVisible(true);
  };

  const closeBiolinkModal = () => {
    setBiolinkModalVisible(false);
    setEditingBiolink(null);
    setBiolinkForm({
      platform: 'email',
      account: '',
      label: '',
      display_mode: 'card',
      visibility: 'public',
    });
    resetPhoneFields();
    setAutoDetectedPlatform(null);
    // Defensive teardown — close any sub-modals that the user may
    // have left open while inside the biolink form. Reported case:
    // user taps "More…" (sets platformSearchVisible=true), the
    // search modal can't render because iOS won't stack native
    // modals — the search modal's invisible backdrop ends up
    // intercepting every tap on the EditProfile screen after the
    // biolink modal dismisses, looking like the page froze.
    // Closing them here when the parent dismisses guarantees no
    // orphan overlays survive.
    setPlatformSearchVisible(false);
    setCountryPickerOpen(false);
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
    // For phone entries the canonical URL is synthesised from (country,
    // national); every other platform composes prefix + account.
    const platformKey = biolinkForm.platform.trim();
    const isPhone = platformKey === 'phone';
    const effectiveUrl = isPhone
      ? buildTelUrl(phoneCountry, phoneNational)
      : buildPlatformUrl(platformKey, biolinkForm.account);
    if (!platformKey || !effectiveUrl) {
      Alert.alert(t('editProfile.alertHintTitle'), t('editProfile.alertFillRequired'));
      return;
    }

    const iconUrl = getIconUrl(effectiveUrl);
    // The display name field was removed from the modal — always
    // derive the label from the platform on save. Previous behaviour
    // ("user-typed label OR fallback") let stale labels survive a
    // platform switch, producing the reported "Instagram URL with
    // title LINE" bug. Now the label is fully a function of the
    // platform key, computed at save time.
    const effectiveLabel =
      PLATFORM_LABELS_STATIC[platformKey] ||
      (platformKey === 'website'
        ? t('editProfile.personalWebsite')
        : t('editProfile.customLink'));

    setSavingBiolink(true);
    try {
      if (editingBiolink) {
        const { error } = await supabase
          .from('piktag_biolinks')
          .update({
            platform: platformKey,
            url: effectiveUrl,
            label: effectiveLabel,
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
            platform: platformKey,
            url: effectiveUrl,
            label: effectiveLabel,
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

  // --- Biolink reorder: serialize + coalesce to kill the race ---
  //
  // Prior behavior: every drag-end fired N UPDATE statements in
  // Promise.all. Rapid re-orders stacked concurrent writes and the
  // last-to-land was not guaranteed to be the user's actual final
  // order — we saw rows flicker back to a stale position when the
  // server returned out-of-order. The races also tripped the API
  // rate-limit on "spam users".
  //
  // New behavior: only one save runs at a time. The `pendingOrderRef`
  // always holds the latest order the user wants; while a save is
  // inflight, new reorders update that ref only. When the save
  // completes, we check if the ref has drifted and kick off one more
  // save. This guarantees the final on-server order matches the last
  // drag-end, with at most 1 inflight write per ~RTT.
  //
  // A `saving` flag drives the small "儲存中" indicator in the UI
  // (existing `saving` state is used — a dedicated flag would
  // also be fine).
  const pendingOrderRef = useRef<Biolink[] | null>(null);
  const savingOrderRef = useRef<boolean>(false);
  const [reorderSaving, setReorderSaving] = useState(false);

  const runReorderSave = useCallback(async () => {
    if (savingOrderRef.current) return;
    savingOrderRef.current = true;
    setReorderSaving(true);
    try {
      // Drain pending orders in a single-flight loop so the final
      // server state reflects the *latest* user-visible order.
      while (pendingOrderRef.current) {
        const snapshot = pendingOrderRef.current;
        pendingOrderRef.current = null;
        try {
          await Promise.all(
            snapshot.map((link, i) =>
              supabase.from('piktag_biolinks').update({ position: i }).eq('id', link.id)
            )
          );
        } catch (err) {
          console.warn('[biolink-reorder] save failed:', err);
          // If it fails, break out — don't infinite-loop on a dead
          // network. The next drag-end will retry.
          break;
        }
      }
    } finally {
      savingOrderRef.current = false;
      setReorderSaving(false);
    }
  }, []);

  const handleDragEnd = useCallback(({ data }: { data: Biolink[] }) => {
    // Optimistic UI update — instant.
    setBiolinks(data);
    // Stash the latest order and wake the saver.
    pendingOrderRef.current = data;
    void runReorderSave();
  }, [runReorderSave]);

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

  const handleAddTag = useCallback(async (overrideName?: string) => {
    if (!userId) return;
    // Two callers: the (legacy) tagInput field path passes nothing and
    // we pull from state; the AI-suggestion chip path passes the chip
    // name directly. Without overrideName we'd have to setTagInput()
    // and wait a render before firing — which races against fast taps
    // and blanks the inputat the wrong time.
    const source = (overrideName ?? tagInput).trim();
    if (!source) return;

    // Normalize: remove leading # for DB storage, keep for display comparison
    const rawName = source.startsWith('#') ? source.slice(1) : source;
    const displayName = `#${rawName}`;

    if (userTagNames.includes(displayName)) {
      // For AI chip path, silently ignore re-tap on an already-added
      // chip (the chip will simply disappear from suggestions on the
      // next render via the de-dupe filter). Only the manual tagInput
      // path warrants the modal alert — the user explicitly typed it
      // and expects feedback when something stops them.
      if (overrideName === undefined) {
        Alert.alert(t('manageTags.alertTagExists'), t('manageTags.alertTagExistsMessage'));
      }
      return;
    }

    setAddingTag(true);
    try {
      // 1. Check if tag exists. maybeSingle() avoids the PGRST116 "no rows"
      // false-positive error that .single() produces on brand-new tags.
      let tagId: string;
      const { data: existingTag, error: findError } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', rawName)
        .maybeSingle();

      if (findError) {
        console.warn('[EditProfileScreen] handleAddTag findError:', findError.message);
      }

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        // 2. Create new tag. Another client may have inserted the same name
        // between our select and insert — the unique index turns that into
        // a 23505 error, so re-select in that case instead of surfacing it.
        const { data: newTag, error: createError } = await supabase
          .from('piktag_tags')
          .insert({ name: rawName })
          .select('id')
          .single();

        if (newTag) {
          tagId = newTag.id;
        } else if (createError && (createError as any).code === '23505') {
          const { data: raced } = await supabase
            .from('piktag_tags')
            .select('id')
            .eq('name', rawName)
            .maybeSingle();
          if (!raced) {
            Alert.alert(t('common.error'), t('manageTags.alertAddError'));
            setAddingTag(false);
            return;
          }
          tagId = raced.id;
        } else {
          console.warn('[EditProfileScreen] handleAddTag createError:', createError?.message);
          Alert.alert(t('common.error'), t('manageTags.alertAddError'));
          setAddingTag(false);
          return;
        }
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

      // 5. Increment usage_count via RPC. Previously this code ran a
      //    `update({ usage_count: 1 })` *before* the RPC, which reset
      //    the counter to 1 on every add (so every tag looked like
      //    it was fresh even when thousands of users shared it). The
      //    RPC is authoritative; the fallback below reads-then-writes
      //    but still increments rather than resetting.
      try {
        const { error: batchErr } = await supabase.rpc('batch_tag_increment', {
          p_tag_ids: [tagId],
          p_delta: 1,
        });
        if (batchErr) throw batchErr;
      } catch (err) {
        console.warn('[EditProfileScreen] batch_tag_increment fallback:', err);
        try {
          // Legacy fallback: single-tag RPC, then read-then-write.
          await supabase.rpc('increment_tag_usage', { tag_id: tagId });
        } catch {
          try {
            const { data: tagData } = await supabase
              .from('piktag_tags')
              .select('usage_count')
              .eq('id', tagId)
              .single();
            const next = (tagData?.usage_count ?? 0) + 1;
            await supabase.from('piktag_tags').update({ usage_count: next }).eq('id', tagId);
          } catch {}
        }
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

  // Inline AI tag generation. Mirrors AskStoryRow.suggestTagsForBody —
  // manual ✨ button trigger, surfaces empty-result state explicitly so
  // the user knows the request landed and the LLM just had nothing to
  // say. Builds context from (bio + full_name + headline + existing
  // tag names) — same shape as ManageTagsScreen used to send. Edge
  // function caps inputs at 500 chars and runs Gemini server-side.
  const loadAiSuggestions = useCallback(async () => {
    const bioText = (form.bio || '').trim();
    if (bioText.length < 5) {
      // Button is disabled in this state, but guard defensively in
      // case a stale closure fires.
      return;
    }
    setAiLoading(true);
    setAiTriedAndEmpty(false);
    try {
      const nameText = (form.full_name || '').trim();
      const headlineText = (form.headline || '').trim();
      const tagNames = userTagNames
        .map((n) => n.replace(/^#/, ''))
        .filter(Boolean)
        .join(', ');

      const context = [bioText, nameText, headlineText].filter(Boolean).join('\n');
      const userLang = context.match(/[一-鿿]/) ? '繁體中文' :
        context.match(/[぀-ヿ]/) ? '日本語' :
        context.match(/[가-힯]/) ? '한국어' :
        context.match(/[฀-๿]/) ? 'ภาษาไทย' : 'the same language as the content';

      logApiUsage('gemini_generate', { via: 'edge-fn' });
      const { data, error } = await supabase.functions.invoke<{
        suggestions?: string[];
      }>('suggest-tags', {
        body: { bio: bioText, name: nameText, location: headlineText, existingTags: tagNames, lang: userLang },
      });

      if (error) {
        console.warn('[EditProfileScreen] loadAiSuggestions edge fn error:', error.message);
        setAiSuggestions([]);
        setAiTriedAndEmpty(true);
        return;
      }
      const raw = Array.isArray(data?.suggestions) ? data!.suggestions : [];
      const normalized = Array.from(
        new Set(
          raw
            .map((n) => (typeof n === 'string' ? n.replace(/^#/, '').trim() : ''))
            .filter((n) => !!n)
        )
      );
      // Drop any name the user already has — the chips below are
      // "tap to add", so showing already-added suggestions creates
      // dead UI that does nothing on tap.
      const filtered = normalized.filter(
        (n) => !userTagNames.includes(`#${n}`)
      );
      setAiSuggestions(filtered);
      if (filtered.length === 0) {
        setAiTriedAndEmpty(true);
      }
    } catch (err) {
      console.warn('[EditProfileScreen] loadAiSuggestions exception:', err);
      setAiSuggestions([]);
      setAiTriedAndEmpty(true);
    } finally {
      setAiLoading(false);
    }
  }, [form.bio, form.full_name, form.headline, userTagNames]);

  const handleAddAiSuggestion = useCallback(
    async (name: string) => {
      // Optimistic remove from suggestions so the chip disappears
      // immediately on tap. handleAddTag does its own dedupe + RLS
      // checks; on failure the next render will rebuild suggestions
      // via fetchUserTags but the chip we tapped won't bounce back
      // (we're not trying that hard — the user can re-trigger AI).
      setAiSuggestions((prev) => prev.filter((s) => s !== name));
      await handleAddTag(name);
    },
    // handleAddTag depends on tagInput, but the override path doesn't
    // touch it; deps still need the function reference to stay
    // aligned with React's exhaustive-deps rule.
    [handleAddTag],
  );

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

        // Increment usage_count via batch RPC (single-element array).
        try {
          const { error: batchErr } = await supabase.rpc('batch_tag_increment', {
            p_tag_ids: [tag.id],
            p_delta: 1,
          });
          if (batchErr) throw batchErr;
        } catch {
          try {
            await supabase.rpc('increment_tag_usage', { tag_id: tag.id });
          } catch {
            try {
              await supabase.from('piktag_tags').update({ usage_count: (tag.usage_count || 0) + 1 }).eq('id', tag.id);
            } catch {}
          }
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

  // ── Tag management (ported from ManageTagsScreen) ──────────────────
  // EditProfile is now the single home for tag editing — chips here
  // support drag-to-reorder and tap-the-X to remove, in addition to
  // the existing add-via-input + AI suggestions + popular-tags flows.
  // Mirrors ManageTagsScreen handler shape so DraggableChips wiring
  // works identically.
  //
  // Tag pinning was removed — kept as a future paid feature. The
  // is_pinned column still exists in piktag_user_tags and existing
  // rows still sort first on detail screens, but no UI here lets you
  // toggle it.

  // Convert userTags → DraggableChips items shape.
  const chipItems = useMemo(
    () =>
      userTags.map((ut) => {
        const name = ut.tag?.name ?? '';
        return {
          id: ut.id,
          label: name.startsWith('#') ? name : `#${name}`,
        };
      }),
    [userTags],
  );

  // Drag-to-reorder finished — persist new positions.
  const handleChipReorder = useCallback(
    async (newItems: { id: string; label: string; isPinned?: boolean }[]) => {
      const idOrder = newItems.map((i) => i.id);
      const reordered = idOrder
        .map((id) => userTags.find((t) => t.id === id))
        .filter(Boolean) as typeof userTags;
      setUserTags(reordered);
      try {
        await Promise.all(
          reordered.map((tag, i) =>
            supabase.from('piktag_user_tags').update({ position: i }).eq('id', tag.id),
          ),
        );
      } catch {
        await fetchUserTags();
      }
    },
    [userTags, fetchUserTags],
  );

  const handleChipRemove = useCallback(
    (chipItem: { id: string }) => {
      const ut = userTags.find((t) => t.id === chipItem.id);
      if (ut) handleRemoveTag(ut);
    },
    [userTags, handleRemoveTag],
  );

  // Web tap-to-swap (no native drag handler on web). Two-tap pattern:
  // first tap selects, second tap on a different chip swaps positions.
  const handleTagTap = useCallback(
    async (tappedTag: UserTag & { tag?: Tag }) => {
      if (!selectedTagId) {
        setSelectedTagId(tappedTag.id);
        return;
      }
      if (selectedTagId === tappedTag.id) {
        setSelectedTagId(null);
        return;
      }
      const fromIdx = userTags.findIndex((t) => t.id === selectedTagId);
      const toIdx = userTags.findIndex((t) => t.id === tappedTag.id);
      if (fromIdx === -1 || toIdx === -1) {
        setSelectedTagId(null);
        return;
      }
      const updated = [...userTags];
      [updated[fromIdx], updated[toIdx]] = [updated[toIdx], updated[fromIdx]];
      setUserTags(updated);
      setSelectedTagId(null);
      try {
        await Promise.all(
          updated.map((tag, i) =>
            supabase.from('piktag_user_tags').update({ position: i }).eq('id', tag.id),
          ),
        );
      } catch {
        await fetchUserTags();
      }
    },
    [selectedTagId, userTags, fetchUserTags],
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('editProfile.headerTitle')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <PageLoader />
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
            <BrandSpinner size={20} />
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
          {/* Profile completion nudge — earlier iteration was a heavy
              card with a progress bar, 4-row checklist, and a big
              purple share-now CTA at 100%. User feedback: the card
              looms over the avatar and feels oppressive ("看了會很
              討厭，有壓迫感"). Replaced with a single soft gray line
              listing what's still missing — same information density,
              fraction of the visual weight, no demand on the user.
              At 100% the line silently disappears (no replacement
              CTA, no celebratory banner, just empty space). */}
          {(() => {
            const missing: string[] = [];
            if (!avatarUrl) {
              missing.push(t('editProfile.missingAvatar', { defaultValue: '大頭照' }));
            }
            if (form.bio.trim().length < 10) {
              missing.push(t('editProfile.missingBio', { defaultValue: '簡介' }));
            }
            if (userTags.length < 3) {
              missing.push(t('editProfile.missingTags', { defaultValue: '3 個標籤' }));
            }
            if (biolinks.length < 1) {
              missing.push(t('editProfile.missingBiolink', { defaultValue: '社群連結' }));
            }
            const showWelcome = fromOnboarding;
            const showMissing = missing.length > 0;
            if (!showWelcome && !showMissing) return null;
            return (
              <View style={styles.completionInlineRow}>
                {showWelcome && (
                  <Text style={styles.completionWelcomeInline}>
                    {t('editProfile.welcomeShort', { defaultValue: '歡迎到 PikTag' })}
                  </Text>
                )}
                {showMissing && (
                  <View style={styles.completionInlineMissingRow}>
                    <Sparkles size={12} color={COLORS.piktag500} />
                    <Text style={styles.completionInlineText}>
                      {t('editProfile.completionInline', {
                        items: missing.join('、'),
                        defaultValue: '讓對的人秒找到你 — 差 {{items}}',
                      })}
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}

          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarStack}>
              <RingedAvatar
                size={108}
                ringStyle={myAsk ? 'gradient' : 'subtle'}
                badge="pencil"
                name={form.full_name || form.username || ''}
                avatarUrl={avatarUrl}
                onPress={uploadingAvatar ? undefined : handleChangeAvatar}
                accessibilityLabel="更換大頭貼"
              />
              {uploadingAvatar ? (
                <View style={styles.avatarUploadOverlay} pointerEvents="none">
                  <BrandSpinner size={24} />
                </View>
              ) : null}
            </View>
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
              <Text style={styles.fieldLabel}>{t('editProfile.headlineLabel', { defaultValue: '職稱' })}</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.headline}
                onChangeText={(v) => updateField('headline', v)}
                placeholder={t('editProfile.headlinePlaceholder', { defaultValue: '例：PM @ Google、自由接案設計師' })}
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

          {/* Tags Section — full editing surface, no longer routes
              to a separate ManageTagsScreen. Reported case: deleting
              tags in 標籤管理 then returning here didn't sync until
              Save was tapped (the focus listener swallowed the
              refetch on quick round-trips, since fixed in 9e1c59b).
              The deeper issue: splitting "edit profile" and "manage
              tags" across two pages forced the user to context-switch
              between bio editing and tag editing, which feels like
              two unrelated features. Merged them. */}
          <View style={styles.tag_divider} />

          <View style={styles.tag_section}>
            <View style={styles.tag_sectionHeader}>
              <Text style={styles.sectionTitle}>{t('manageTags.myTagsTitle')}</Text>
              <View style={styles.tag_countRow}>
                <View style={styles.tag_countItem}>
                  <Text
                    style={[
                      styles.tag_countText,
                      userTags.length >= MAX_TAGS && styles.tag_countTextLimit,
                    ]}
                  >
                    {t('manageTags.tagCount', { count: userTags.length, max: MAX_TAGS })}
                  </Text>
                  {userTags.length >= MAX_TAGS && (
                    <AlertTriangle size={13} color={COLORS.red500} />
                  )}
                </View>
                {/* Pinned count badge removed — pinning is a future
                    paid feature. */}
              </View>
            </View>

            {/* Hint text — only shown for native (DraggableChips
                supports the gesture). Web tap-to-swap has its own
                inline hint when a chip is selected. Note: the
                "雙擊置頂" pinning hint was removed when pinning was
                pulled out as a future paid feature. */}
            {userTags.length > 1 && Platform.OS !== 'web' && (
              <Text style={styles.tag_sortHint}>
                {t('manageTags.nativeHintNoPin', { defaultValue: '長按拖曳排序' })}
              </Text>
            )}

            {/* My tags — native: draggable chips / web: tap-to-swap */}
            {userTags.length > 0 ? (
              Platform.OS !== 'web' && DraggableChips ? (
                <DraggableChips
                  items={chipItems}
                  onReorder={handleChipReorder}
                  onRemove={handleChipRemove}
                  onDragStateChange={setIsDragging}
                />
              ) : (
                <>
                  {selectedTagId && (
                    <View style={styles.tag_swapHintBar}>
                      <ArrowLeftRight size={14} color={COLORS.piktag600} />
                      <Text style={styles.tag_swapHintText}>
                        {t('manageTags.dragSelectTarget', { defaultValue: '點選要交換位置的標籤' })}
                      </Text>
                      <Pressable onPress={() => setSelectedTagId(null)}>
                        <Text style={styles.tag_swapCancel}>
                          {t('common.cancel', { defaultValue: '取消' })}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  <View style={styles.tag_chipsContainer}>
                    {userTags.map((ut) => {
                      const isSelected = ut.id === selectedTagId;
                      const dn = getTagDisplayName(ut);
                      return (
                        <Pressable
                          key={ut.id}
                          style={[
                            styles.tag_webChip,
                            isSelected && styles.tag_webChipSelected,
                          ]}
                          onPress={() => handleTagTap(ut)}
                        >
                          <Text style={styles.tag_webChipText}>
                            {dn}
                          </Text>
                          <Pressable
                            onPress={() => handleRemoveTag(ut)}
                            style={styles.tag_webChipX}
                          >
                            <X size={14} color={COLORS.gray400} />
                          </Pressable>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )
            ) : (
              <Text style={styles.tag_emptyText}>
                {t('manageTags.noTagsYet', { defaultValue: '還沒有標籤' })}
              </Text>
            )}

            {/* Inline add — was the bottom-anchored input on
                ManageTagsScreen, now part of this section so users
                stay on a single page. # icon prefix + textinput +
                circular plus button. */}
            {userTags.length < MAX_TAGS && (
              <View style={styles.tag_addRow}>
                {/* Bordered input pill with the Hash prefix + char counter
                    inside, exactly like before — but the + button is now
                    a separate sibling outside the pill, matching the
                    AddTagScreen / ManageTagsScreen / HiddenTagEditor /
                    AskCreateModal pattern. Same 40×40 / borderRadius 12
                    square-rounded shape across the whole app. */}
                <View style={styles.tag_addInputPill}>
                  <Hash size={18} color={COLORS.gray400} />
                  <TextInput
                    style={styles.tag_addInput}
                    placeholder={t('manageTags.tagInputPlaceholder', { defaultValue: '+ 新增標籤' })}
                    placeholderTextColor={COLORS.gray400}
                    value={tagInput}
                    onChangeText={(v) => v.length <= MAX_TAG_LENGTH && setTagInput(v)}
                    returnKeyType="done"
                    onSubmitEditing={() => handleAddTag()}
                    editable={!addingTag}
                    maxLength={MAX_TAG_LENGTH}
                  />
                  <Text style={styles.tag_charCount}>
                    {tagInput.length}/{MAX_TAG_LENGTH}
                  </Text>
                </View>
                <Pressable
                  style={styles.tag_addBtn}
                  onPress={() => handleAddTag()}
                  disabled={!tagInput.trim() || addingTag}
                  accessibilityRole="button"
                  accessibilityLabel={t('manageTags.addButton', { defaultValue: '新增' })}
                >
                  {addingTag ? (
                    <BrandSpinner size={20} />
                  ) : (
                    <Plus size={20} color="#FFFFFF" strokeWidth={2.5} />
                  )}
                </Pressable>
              </View>
            )}

            {/* Inline AI tag generation — replaces the previous two-page
                flow ("save bio here → navigate to ManageTagsScreen → wait
                for auto-load → pick"). Same pattern as AskStoryRow's
                AI-trigger button: manual trigger, disabled until bio is
                at least 5 chars, swappable label between "AI 生成" and
                "重新生成" so re-rolls are explicit. Tapping a suggestion
                chip pipes straight into handleAddTag — the chip moves up
                into the user's tag list above on the next render. */}
            {/* AI tag suggestion section. Auto-fires 1.2s after the
                user pauses typing in bio / name / headline (see
                updateField). Layout pattern was rebuilt because the
                previous "soft chip with sparkles + label" trigger
                button didn't read as tappable — users assumed it was
                a passive label.

                Now a clean section-header row:
                  Left:  Sparkles icon + "AI 為你推薦" label
                  Right: refresh icon button
                Below: chip list of suggestions (tap to add).

                The ↻ icon is the universal "regenerate" affordance
                (ChatGPT, Midjourney, every modern AI surface) so
                users immediately recognize it as a re-roll. Hidden
                while loading (spinner replaces the icon) and during
                the initial-render-before-first-auto-fire state.

                Section is rendered when bio is non-empty so the user
                sees the AI surface light up shortly after they
                finish typing — making the bio↔AI relationship
                visible. Hidden when tags reach the 10 cap. */}
            {form.bio.trim().length > 0 && userTags.length < 10 && (
              <View style={styles.ai_inlineSection}>
                {(aiLoading || aiSuggestions.length > 0 || aiTriedAndEmpty) && (
                  <View style={styles.ai_headerRow}>
                    <View style={styles.ai_headerLeft}>
                      {aiLoading ? (
                        <BrandSpinner size={16} />
                      ) : (
                        <Sparkles size={14} color={COLORS.piktag600} />
                      )}
                      <Text style={styles.ai_headerTitle}>
                        {aiLoading
                          ? `${t('manageTags.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}…`
                          : (t('manageTags.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' }))}
                      </Text>
                    </View>
                    {/* Refresh icon button — clearly tappable shape
                        (circular, bordered) at the right end. Hidden
                        during load (spinner is in the title slot
                        instead) and disabled when bio is too short
                        for a meaningful prompt. */}
                    {!aiLoading && (
                      <TouchableOpacity
                        style={[
                          styles.ai_refreshBtn,
                          (form.bio.trim().length < 5 || addingTag) && styles.ai_refreshBtnDisabled,
                        ]}
                        onPress={loadAiSuggestions}
                        disabled={form.bio.trim().length < 5 || addingTag}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('ask.regenerateAiTags', { defaultValue: '重新生成' })}
                      >
                        <RefreshCw size={14} color={COLORS.piktag600} strokeWidth={2.2} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {aiSuggestions.length > 0 && (
                  <View style={styles.ai_chipsWrap}>
                    {aiSuggestions.map((s) => (
                      <Pressable
                        key={`ai-${s}`}
                        style={({ pressed }) => [
                          styles.ai_chip,
                          pressed && styles.ai_chipPressed,
                        ]}
                        onPress={() => handleAddAiSuggestion(s)}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('common.add', { defaultValue: '新增' })} #${s}`}
                      >
                        <Text style={styles.ai_chipText}>#{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {aiTriedAndEmpty && aiSuggestions.length === 0 && !aiLoading && (
                  <Text style={styles.ai_emptyHint}>
                    {t('ask.aiNoSuggestions', { defaultValue: 'AI 沒有想到合適的標籤，再試一次或自己輸入' })}
                  </Text>
                )}
              </View>
            )}

            {/* Popular tags — collapsible. Default collapsed so the
                section doesn't bloat the page; users who want to
                browse tap to expand. Replaces the gradient
                「管理全部標籤」CTA that used to navigate to a
                separate ManageTagsScreen. */}
            {userTags.length < MAX_TAGS && popularTags.length > 0 && (
              <View style={styles.tag_popularSection}>
                <Pressable
                  style={styles.tag_popularToggle}
                  onPress={() => setShowPopularTags((v) => !v)}
                  accessibilityRole="button"
                >
                  <Text style={styles.tag_popularToggleText}>
                    {t('manageTags.popularTagsTitle', { defaultValue: '熱門標籤' })}
                  </Text>
                  {showPopularTags ? (
                    <ChevronUp size={16} color={COLORS.gray500} />
                  ) : (
                    <ChevronDown size={16} color={COLORS.gray500} />
                  )}
                </Pressable>
                {showPopularTags && (
                  <View style={styles.tag_popularChipsWrap}>
                    {popularTags
                      .filter((tag) => {
                        const dn = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
                        return !userTagNames.includes(dn);
                      })
                      .map((tag) => {
                        const dn = tag.name.startsWith('#') ? tag.name : `#${tag.name}`;
                        return (
                          <Pressable
                            key={tag.id}
                            style={styles.tag_popularChip}
                            onPress={() => handleAddPopularTag(tag)}
                          >
                            <Text style={styles.tag_popularChipText}>{dn}</Text>
                          </Pressable>
                        );
                      })}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Biolinks Section */}
          <View style={styles.biolinksSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.sectionTitle}>{t('editProfile.socialLinksTitle')}</Text>
              {reorderSaving && (
                <BrandSpinner size={16} />
              )}
            </View>
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
                        {/* Strip the platform's URL scheme prefix
                            (`tel:`, `mailto:`, `https://`, etc.) for
                            display only — the stored value keeps the
                            scheme so taps on the public profile still
                            dial / open the mail client. */}
                        {platformStripPrefix(link.url, detectPlatformFromUrl(link.url) ?? link.platform)}
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
                {(QUICK_PICK_KEYS as readonly string[]).map((key) => {
                  const label = getPlatformLabel(key, t);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={styles.platformOption}
                      onPress={() => {
                        setSelectedPlatform(key);
                        setShowPlatformPicker(false);
                        setNewLinkAccount('');
                        setNewLinkLabel(key === 'custom' ? '' : label);
                        // Reset the phone-specific state every time the
                        // platform is (re-)selected so the country chip
                        // defaults to the current locale on each entry.
                        if (key === 'phone') resetPhoneFields();
                      }}
                    >
                      <PlatformIcon platform={key} size={28} />
                      <Text style={styles.platformOptionText}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
                {/* "更多平台" entry — opens the search modal so the user
                    can pick from the remaining ~42 platforms not in the
                    quick-pick 8. Without this, users on the legacy
                    inline-add flow had no path to TikTok / Threads /
                    GitHub / etc. */}
                <TouchableOpacity
                  style={styles.platformOption}
                  onPress={() => {
                    setPlatformSearchTarget('legacy');
                    setPlatformSearchVisible(true);
                  }}
                >
                  <View style={styles.platformOptionMoreIcon}>
                    <Plus size={18} color={COLORS.piktag500} />
                  </View>
                  <Text style={[styles.platformOptionText, { color: COLORS.piktag600, fontWeight: '600' }]}>
                    {t('editProfile.browseAllPlatforms', { defaultValue: 'Browse all platforms' })}
                  </Text>
                </TouchableOpacity>
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
                {/* Phone gets its own (country dial code + national
                    number) row. Every other platform keeps the legacy
                    prefix + account input flow. */}
                {selectedPlatform === 'phone' ? (
                  <View style={styles.phoneRow}>
                    <TouchableOpacity
                      style={styles.countryChip}
                      onPress={() => setCountryPickerOpen(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.countryFlag}>{phoneCountry.flag}</Text>
                      <Text style={styles.countryDial}>{phoneCountry.dial}</Text>
                      <ChevronDown size={14} color={COLORS.gray500} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.phoneInput}
                      value={phoneNational}
                      onChangeText={(v) => setPhoneNational(v.replace(/\D/g, ''))}
                      placeholder={t('editProfile.phonePlaceholder')}
                      placeholderTextColor={COLORS.gray400}
                      keyboardType="phone-pad"
                      maxLength={15}
                      autoFocus
                    />
                  </View>
                ) : (
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
                )}
                <View style={styles.newLinkActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedPlatform(null);
                      setNewLinkAccount('');
                      setNewLinkLabel('');
                      resetPhoneFields();
                    }}
                    style={styles.cancelBtn}
                  >
                    <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={async () => {
                      if (!userId || !selectedPlatform) return;
                      let fullUrl: string;
                      if (selectedPlatform === 'phone') {
                        fullUrl = buildTelUrl(phoneCountry, phoneNational);
                      } else {
                        if (!newLinkAccount.trim()) return;
                        const prefix = PLATFORM_PREFIXES[selectedPlatform] ?? '';
                        fullUrl = selectedPlatform === 'custom'
                          ? newLinkAccount.trim()
                          : `${prefix}${newLinkAccount.trim()}`;
                      }
                      if (!fullUrl) return;
                      // Custom can still have a user-typed label (the
                      // legacy form's only text input for naming) —
                      // the open-text URL has no platform brand name
                      // to derive from. Everything else: derive from
                      // platform, ignore any state. Mirrors the edit
                      // modal's "no display name field, derive on
                      // save" rule so both flows produce consistent
                      // labels.
                      const platformDerivedLabel =
                        PLATFORM_LABELS_STATIC[selectedPlatform] ||
                        t(`editProfile.${selectedPlatform === 'website' ? 'personalWebsite' : 'customLink'}`);
                      const label =
                        selectedPlatform === 'custom'
                          ? (newLinkLabel.trim() || platformDerivedLabel)
                          : platformDerivedLabel;
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
                        resetPhoneFields();
                      }
                    }}
                  >
                    <Text style={styles.saveBtnText}>{t('common.add', { defaultValue: '新增' })}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Save Button */}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Biolink Add/Edit Modal */}
      <Modal
        visible={biolinkModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeBiolinkModal}
      >
        {/* KAV wraps the bottom-sheet so the four TextInputs (platform,
            url/phone, display name) float above the keyboard instead
            of being buried beneath it. Without this wrapper, tapping
            the URL field in the middle of the sheet brought up the
            keyboard and left the focused input hidden behind it. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        {/* Backdrop is now tappable — taps outside the bottom sheet
            dismiss the modal. Previously it was a plain View, which
            meant if the X button ever became unreachable (offscreen
            from a leftover keyboard avoid, etc.) the user had no
            way to recover and the page felt frozen. The inner
            modalContent uses TouchableWithoutFeedback to swallow taps
            so taps INSIDE the sheet don't bubble up and dismiss. */}
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeBiolinkModal}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}
            onPress={() => {}}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingBiolink ? t('editProfile.modalTitleEdit') : t('editProfile.modalTitleAdd')}
              </Text>
              <TouchableOpacity onPress={closeBiolinkModal} activeOpacity={0.6}>
                <X size={24} color={COLORS.gray900} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {/* Platform picker — 8 quick-pick chips + "browse all"
                  for the long tail. Replaced the horizontal-scroll
                  chip rail of every preset, which forced users to
                  swipe through 50 chips to find anything past the
                  popular ones. Selected chip uses the same
                  piktag50/piktag500 selected treatment as the rest
                  of the app's chip pickers (FriendDetail pickModal,
                  ManageTags). The currently-selected platform shows
                  as a quick-pick chip even when it's not in the
                  default 8 — picked-from-search non-quick-pick
                  platforms surface as a "current" pill so the user
                  can still see what's selected at a glance. */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.platformLabel')}</Text>
                <View style={styles.platformQuickRow}>
                  {(QUICK_PICK_KEYS as readonly string[]).map((key) => {
                    const active = biolinkForm.platform === key;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.platformChip, active && styles.platformChipActive]}
                        onPress={() => setBiolinkForm((prev) => ({ ...prev, platform: key }))}
                        activeOpacity={0.7}
                      >
                        <PlatformIcon platform={key} size={18} />
                        <Text
                          style={[
                            styles.platformChipText,
                            active && styles.platformChipTextActive,
                          ]}
                        >
                          {getPlatformLabel(key, t)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* If the active platform isn't in the quick-pick
                      8 (user picked from "browse all"), surface it
                      as an additional always-visible chip so they
                      see what they currently have selected. */}
                  {biolinkForm.platform &&
                    !(QUICK_PICK_KEYS as readonly string[]).includes(biolinkForm.platform) && (
                      <View style={[styles.platformChip, styles.platformChipActive]}>
                        <PlatformIcon platform={biolinkForm.platform} size={18} />
                        <Text style={[styles.platformChipText, styles.platformChipTextActive]}>
                          {getPlatformLabel(biolinkForm.platform, t)}
                        </Text>
                      </View>
                    )}
                  <TouchableOpacity
                    style={styles.browseAllChip}
                    onPress={() => {
                      setPlatformSearchTarget('modal');
                      setPlatformSearchVisible(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.browseAllChipText}>
                      {t('editProfile.browseAllPlatformsCta', { defaultValue: 'More…' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>
                  {biolinkForm.platform === 'phone'
                    ? t('editProfile.phoneLabel')
                    : t('editProfile.urlLabel')}
                </Text>
                {biolinkForm.platform === 'phone' ? (
                  // Phone gets the country-code chip + national-number
                  // input. The actual `tel:` URL is synthesised at save
                  // time from (phoneCountry, phoneNational).
                  <View style={styles.phoneRow}>
                    <TouchableOpacity
                      style={styles.countryChip}
                      onPress={() => setCountryPickerOpen(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.countryFlag}>{phoneCountry.flag}</Text>
                      <Text style={styles.countryDial}>{phoneCountry.dial}</Text>
                      <ChevronDown size={14} color={COLORS.gray500} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.phoneInput}
                      value={phoneNational}
                      onChangeText={(v) => setPhoneNational(v.replace(/\D/g, ''))}
                      placeholder={t('editProfile.phonePlaceholder')}
                      placeholderTextColor={COLORS.gray400}
                      keyboardType="phone-pad"
                      maxLength={15}
                    />
                  </View>
                ) : biolinkForm.platform === 'custom' ? (
                  <>
                    <TextInput
                      style={styles.fieldInput}
                      value={biolinkForm.account}
                      onChangeText={(v) => {
                        setBiolinkForm((prev) => ({ ...prev, account: v }));
                        // Auto-detect: if the user pasted a URL that
                        // matches a known platform, hint at it. We
                        // DON'T auto-switch the platform here (user
                        // is on `custom` deliberately), just surface
                        // the option below the input as a tap-to-
                        // apply chip.
                        const detected = detectPlatformFromUrl(v);
                        setAutoDetectedPlatform(
                          detected && detected !== 'custom' ? detected : null,
                        );
                      }}
                      placeholder={t('editProfile.urlPlaceholder')}
                      placeholderTextColor={COLORS.gray400}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                    {autoDetectedPlatform ? (
                      <TouchableOpacity
                        style={styles.detectHint}
                        onPress={() => {
                          // Switching to the detected platform — strip
                          // the prefix from the URL so the
                          // bare-account input shows just the handle.
                          const stripped = platformStripPrefix(
                            biolinkForm.account,
                            autoDetectedPlatform,
                          );
                          setBiolinkForm((prev) => ({
                            ...prev,
                            platform: autoDetectedPlatform,
                            account: stripped,
                          }));
                          setAutoDetectedPlatform(null);
                        }}
                        activeOpacity={0.7}
                      >
                        <CheckCircle2 size={14} color={COLORS.piktag500} />
                        <Text style={styles.detectHintText}>
                          {t('editProfile.detectedAs', {
                            platform: getPlatformLabel(autoDetectedPlatform, t),
                            defaultValue: `Detected as ${getPlatformLabel(autoDetectedPlatform, t)}`,
                          })}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View style={styles.prefixInputRow}>
                      {PLATFORM_PREFIXES[biolinkForm.platform] ? (
                        <Text style={styles.prefixText} numberOfLines={1}>
                          {PLATFORM_PREFIXES[biolinkForm.platform]}
                        </Text>
                      ) : null}
                      <TextInput
                        style={styles.accountInput}
                        value={biolinkForm.account}
                        onChangeText={(v) => {
                          setBiolinkForm((prev) => ({ ...prev, account: v }));
                          // If the user pasted a FULL URL belonging
                          // to a different platform than the current
                          // chip, surface that as a tap-to-switch
                          // hint. Same UX as the custom branch.
                          const detected = detectPlatformFromUrl(v);
                          setAutoDetectedPlatform(
                            detected && detected !== biolinkForm.platform && detected !== 'custom'
                              ? detected
                              : null,
                          );
                        }}
                        placeholder={
                          PLATFORM_PLACEHOLDER_KEYS[biolinkForm.platform]?.startsWith('editProfile.')
                            ? t(PLATFORM_PLACEHOLDER_KEYS[biolinkForm.platform])
                            : PLATFORM_PLACEHOLDER_KEYS[biolinkForm.platform] || ''
                        }
                        placeholderTextColor={COLORS.gray400}
                        autoCapitalize="none"
                        keyboardType="url"
                      />
                    </View>
                    {autoDetectedPlatform ? (
                      <TouchableOpacity
                        style={styles.detectHint}
                        onPress={() => {
                          const stripped = platformStripPrefix(
                            biolinkForm.account,
                            autoDetectedPlatform,
                          );
                          setBiolinkForm((prev) => ({
                            ...prev,
                            platform: autoDetectedPlatform,
                            account: stripped,
                          }));
                          setAutoDetectedPlatform(null);
                        }}
                        activeOpacity={0.7}
                      >
                        <CheckCircle2 size={14} color={COLORS.piktag500} />
                        <Text style={styles.detectHintText}>
                          {t('editProfile.detectedAs', {
                            platform: getPlatformLabel(autoDetectedPlatform, t),
                            defaultValue: `Detected as ${getPlatformLabel(autoDetectedPlatform, t)}`,
                          })}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
              </View>

              {/* 顯示名稱 field removed.
                  Reported case: user added a LINE biolink (label
                  defaulted to "LINE"), then edited that row, switched
                  the platform chip to Instagram — but the label field
                  stayed "LINE" because we never re-synced it. The
                  list view then showed an Instagram URL with the title
                  "LINE", which was the visible bug.
                  Fix: stop letting users edit the display label
                  altogether. The label is now derived from the
                  platform on save (see handleSaveBiolink → fallback
                  always wins because biolinkForm.label is unset). The
                  field had ~zero legitimate use cases — IG / X / LinkedIn
                  /etc all want the platform name as the title; the rare
                  "two IG accounts, label them differently" case can be
                  handled by the URL itself differentiating the cards. */}
              {/* Display Mode Toggle */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.displayModeLabel', { defaultValue: '顯示方式' })}</Text>
                <View style={styles.displayModeRow}>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'icon' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'icon' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'icon' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeIcon', { defaultValue: '圖示並排' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'card' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'card' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'card' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeCard', { defaultValue: '清單卡片' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.displayModeBtn, biolinkForm.display_mode === 'both' && styles.displayModeBtnActive]}
                    onPress={() => setBiolinkForm(prev => ({ ...prev, display_mode: 'both' }))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.displayModeBtnText, biolinkForm.display_mode === 'both' && styles.displayModeBtnTextActive]}>
                      {t('editProfile.displayModeBoth', { defaultValue: '全部顯示' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Visibility Picker */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('editProfile.visibilityLabel', { defaultValue: '誰能看到' })}</Text>
                <View style={styles.visibilityRow}>
                  {([
                    { key: 'public', label: t('editProfile.visibilityPublic', { defaultValue: '公開' }) },
                    { key: 'friends', label: t('editProfile.visibilityFriends', { defaultValue: '朋友' }) },
                    { key: 'close_friends', label: t('editProfile.visibilityCloseFriends', { defaultValue: '摯友' }) },
                    { key: 'private', label: t('editProfile.visibilityPrivate', { defaultValue: '自己' }) },
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
                <BrandSpinner size={20} />
              ) : (
                <Text style={styles.modalSaveBtnText}>
                  {editingBiolink ? t('editProfile.modalButtonUpdate') : t('editProfile.modalButtonAdd')}
                </Text>
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
        </KeyboardAvoidingView>

        {/* PlatformSearchModal mounted INSIDE this Modal's view tree.
            Why: rendering a second native <Modal> as a sibling of the
            root <Modal> on iOS hits a known stacking limit — the
            second presentation controller silently fails when the
            first is already on screen. The user's reported bug
            ("更多 按了沒反應") was exactly this. PlatformSearchModal
            no longer wraps in its own <Modal>, just an absolute-
            positioned overlay; mounting it here makes it part of the
            biolink-edit Modal's view hierarchy so it layers cleanly
            on top via z-stacking, no native presentation involved.
            Gated on platformSearchTarget so the legacy inline-add
            path uses the root-level instance below instead. */}
        {platformSearchTarget === 'modal' && (
          <PlatformSearchModal
            visible={platformSearchVisible}
            onClose={() => setPlatformSearchVisible(false)}
            onSelect={(key) => {
              setBiolinkForm((prev) => ({ ...prev, platform: key }));
              setAutoDetectedPlatform(null);
            }}
          />
        )}
      </Modal>

      {/* Country-code picker — rendered at the root so it overlays
          every other modal and the inline link form alike. */}
      <CountryCodePicker
        visible={countryPickerOpen}
        onClose={() => setCountryPickerOpen(false)}
        onSelect={(c) => setPhoneCountry(c)}
        selectedIso={phoneCountry.iso}
      />

      {/* Browse-all search for the LEGACY inline-add path only — the
          biolink-edit-modal path uses the dedicated instance mounted
          INSIDE that Modal's view tree (above) so iOS doesn't choke
          on stacking two native modals. When the user is on the
          legacy add form there's no parent Modal in the way and
          mounting at root works fine. */}
      {platformSearchTarget === 'legacy' && (
        <PlatformSearchModal
          visible={platformSearchVisible}
          onClose={() => setPlatformSearchVisible(false)}
          onSelect={(key) => {
            setSelectedPlatform(key);
            setShowPlatformPicker(false);
          }}
        />
      )}
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
    padding: 12,
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
  // ── Profile completion nudge ─────────────────────────────────────
  // Single soft line above the avatar that lists what's still missing
  // ("還差: 大頭照、簡介"). No card, no border, no progress bar — the
  // earlier card design felt oppressive sitting above the avatar.
  // Just enough text to remind, never enough to demand.
  completionInlineRow: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 4,
    alignItems: 'center',
    gap: 4,
  },
  completionWelcomeInline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
    textAlign: 'center',
  },
  completionInlineMissingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
    flexWrap: 'wrap',
  },
  completionInlineText: {
    fontSize: 12,
    color: COLORS.gray600,
    textAlign: 'center',
    lineHeight: 17,
    fontWeight: '500',
    flexShrink: 1,
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
  avatarStack: {
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 54,
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
  // "Selected" state — already in the user's tag list. Matches the
  // FriendDetail pickModalTagSelected treatment so the "this is one
  // of mine" signal looks the same everywhere in the app: light
  // purple fill + 1.5dp purple border + bold purple text.
  tag_previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  tag_previewChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  tag_moreText: {
    fontSize: 13,
    color: COLORS.gray400,
    alignSelf: 'center',
  },
  tag_manageButton: {
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
  // ── Merged-from-ManageTags styles ─────────────────────────────────
  // Section header row: title on the left, count surfaces (N/10 +
  // pin K/1) on the right. Replaces the read-only single-text
  // header that EditProfile used before merging in the full tag
  // editor.
  tag_sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tag_countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  tag_countItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tag_countText: {
    fontSize: 13,
    color: COLORS.gray500,
  },
  tag_countTextLimit: {
    color: COLORS.red500,
    fontWeight: '600',
  },
  tag_sortHint: {
    fontSize: 12,
    color: COLORS.gray400,
    marginBottom: 8,
  },
  // Web tap-to-swap helper bar (no native drag handler on web).
  tag_swapHintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.piktag50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.piktag500,
  },
  tag_swapHintText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.piktag600,
  },
  tag_swapCancel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  // Web chip — full editing affordance (X to remove + tap-to-swap).
  // Native uses DraggableChips component instead; this is the web
  // fallback. Same selected-purple visual contract as the rest of
  // the app's chip pickers.
  tag_webChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.piktag50,
    borderRadius: 20,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
  },
  tag_webChipSelected: {
    borderColor: COLORS.piktag600,
    borderWidth: 2,
  },
  tag_webChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  tag_webChipX: {
    padding: 4,
  },
  tag_emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
    paddingVertical: 8,
  },
  // Inline add row — bordered input pill + separate + button. The
  // pill holds the Hash prefix, text input, and char counter; the
  // 40×40 square-rounded button is a sibling at the right with a
  // gap. Mirrors HiddenTagEditor / AddTagScreen / ManageTagsScreen /
  // ActivityReviewScreen / AskCreateModal so the same "type a tag,
  // tap +" affordance reads identically across every entry point.
  tag_addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  tag_addInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    minHeight: 40,
  },
  tag_addInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.gray900,
    paddingVertical: Platform.OS === 'ios' ? 6 : 2,
  },
  tag_charCount: {
    fontSize: 11,
    color: COLORS.gray400,
    minWidth: 32,
    textAlign: 'right',
  },
  tag_addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // tag_addBtnDisabled removed — keeping the button full piktag500
  // even when the input is empty. The `disabled` prop on the
  // Pressable still blocks the tap; we just don't visually gray
  // it out, so the action button reads identically across the app
  // (Instagram-style: post/send/+ buttons stay full color all the
  // time, the user knows it's tappable once they type).
  // Collapsible "popular tags" group. Default collapsed so the
  // section doesn't bloat the page; users tap the toggle to browse.
  tag_popularSection: {
    marginTop: 16,
  },
  tag_popularToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  tag_popularToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  tag_popularChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  // Popular tag chip — gray "tap to add" treatment, identical to
  // the AI suggestion chips below.
  tag_popularChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: COLORS.gray100,
  },
  tag_popularChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  // Inline AI tag suggestion styles.
  //
  // Section header layout pattern: ✨ + label on the left, refresh
  // (↻) icon button on the right. Replaces the old "soft chip with
  // sparkles + label" trigger button that users were reading as a
  // passive label rather than a tappable CTA. The icon-button-on-
  // the-right is the universal "regenerate" affordance (ChatGPT,
  // Midjourney, etc.) so it reads as obviously interactive.
  ai_inlineSection: {
    marginTop: 12,
    gap: 10,
  },
  ai_headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  ai_headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ai_headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // 32x32 circular icon button with a clear border + light fill —
  // unambiguously tappable. Disabled state drops opacity so users
  // see the "I can't tap this yet" cue.
  ai_refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
  },
  ai_refreshBtnDisabled: {
    opacity: 0.4,
  },
  ai_chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // "Unselected" state — AI suggestion not yet added. Mirrors the
  // FriendDetail pickModalTag (gray100 fill, transparent border that
  // gets replaced when selected, gray-700 text @ medium weight).
  // Same shape and weight as the selected chip above so the only
  // visual delta on tap is color — that's the design contract the
  // friend pickModal already uses, now applied here for consistency.
  ai_chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: COLORS.gray100,
  },
  ai_chipPressed: {
    // Brief press flash — gives haptic-like feedback on tap before
    // the chip removes itself from the suggestion list. Same color
    // family as the selected state so the transition reads as
    // "going from gray to purple" not as a foreign hover color.
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  ai_chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  ai_emptyHint: {
    fontSize: 12,
    color: COLORS.gray500,
    fontStyle: 'italic',
    paddingHorizontal: 4,
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
  // "更多平台" row icon — square gray placeholder so a Plus icon
  // sits in the same horizontal slot as the platform brand glyphs
  // above it, keeping the row left-edge aligned across the list.
  platformOptionMoreIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformOptionText: {
    fontSize: 15,
    color: COLORS.gray900,
    fontWeight: '500',
  },
  platformChipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingRight: 4,
  },
  // 8 quick-pick chips wrapping to multiple rows + a "More…" chip
  // anchored to the end. Wrap (vs scroll) keeps everything visible
  // at once on a typical phone width — no horizontal swiping needed
  // for the common case. Long tail goes through PlatformSearchModal.
  platformQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  // "More…" / Browse-all chip — visually subdued (no border, gray
  // text) so it doesn't compete with the real platform chips, but
  // still tappable and clearly an action.
  browseAllChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.gray100,
  },
  browseAllChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  // Auto-detect "Detected as X" hint below the URL field. Sits
  // inside the same fieldGroup so it visually anchors to the input
  // it describes. Tap = apply the detected platform + strip prefix.
  detectHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    alignSelf: 'flex-start',
  },
  detectHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
  },
  platformChipActive: {
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
  },
  platformChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  platformChipTextActive: {
    color: COLORS.piktag600,
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
  // Phone-specific row: [🇹🇼 +886 ▾] [ national number ... ]
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200 ?? '#E5E7EB',
    borderRadius: 8,
    backgroundColor: COLORS.white,
  },
  countryFlag: {
    fontSize: 18,
  },
  countryDial: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  phoneInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200 ?? '#E5E7EB',
    borderRadius: 8,
    backgroundColor: COLORS.white,
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
