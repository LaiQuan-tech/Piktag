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

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import BrandSpinner from '../../components/loaders/BrandSpinner';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronRight, ChevronLeft, Camera, QrCode, ScanLine, X, Sparkles, Plus } from 'lucide-react-native';
import { supabase, supabaseUrl, supabaseAnonKey } from '../../lib/supabase';
import { scanCard } from '../../lib/scanCard';
import { normalizeTagName } from '../../lib/normalizeTag';
import { addUserTagByName } from '../../lib/userTags';
import TagChip from '../../components/TagChip';
import { Image } from 'expo-image';
import {
  requestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from 'expo-image-picker';
import { COLORS, SPACING, BORDER_RADIUS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import {
  PLATFORM_MAP,
  getQuickPickKeys,
  getPlatformLabel,
  buildPlatformUrl,
} from '../../lib/platforms';
import PlatformIcon from '../../components/PlatformIcon';
import { toBirthdayDate } from '../../lib/birthday';
import OnboardingCompleteBurst from '../../components/stingers/OnboardingCompleteBurst';

// Must match the key AppNavigator reads in decideOnboarding(). This
// AsyncStorage flag is the canonical "did this user finish onboarding?"
// signal — bio emptiness is a legacy fallback only.
const ONBOARDING_COMPLETED_KEY = 'piktag_onboarding_completed_v1';

const STEP_WELCOME = 0;
const STEP_PROFILE = 1; // identity: avatar + name + username
const STEP_TAGS = 2;    // 你是誰: headline + bio + tags
const STEP_LINKS = 3;   // 電子名片: social/contact links
const MAX_ONB_TAGS = 10;
const MIN_ONB_TAGS = 3; // gate: tags are the engine — require a few
const MIN_ONB_LINKS = 3; // gate: ≥3 links (phone/email count) — 電子名片

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

// ─── Username (帳號) helpers ────────────────────────────────
// The handle lives in the public URL pikt.ag/{username}, so keep it
// URL-safe: lowercase, [a-z0-9_.] only. normalizeUsername cleans as
// the user types (auto-lowercase, strip stray chars) so they can't
// even enter an invalid character. isUsernameFormatValid is the gate
// the live RPC check runs behind (no point pinging the server for a
// malformed handle).
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
function normalizeUsername(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, USERNAME_MAX);
}
function isUsernameFormatValid(u: string): boolean {
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return false;
  // no leading/trailing dot (pikt.ag/.x or pikt.ag/x. read badly)
  if (u.startsWith('.') || u.endsWith('.')) return false;
  return /^[a-z0-9_.]+$/.test(u);
}

type OnboardingScreenProps = { navigation: any };

export default function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const { t, i18n } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<number>(STEP_WELCOME);
  const [displayName, setDisplayName] = useState('');
  // ─── Username (帳號) — the pikt.ag/{username} handle ──────────
  // 2026-06-05: onboarding now lets the user SET their handle (it was
  // auto-generated + only editable in EditProfile, which the testers
  // never found). Prefilled with the current auto-generated value;
  // live-checked via the check_username_available RPC (case-insensitive,
  // excludes self, rejects reserved route names). usernameStatus drives
  // the inline ✓/✗ indicator AND gates the CTA.
  const [username, setUsername] = useState('');
  type UsernameStatus = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  // The value the live-check last RESOLVED for — guards against a slow
  // response landing after the user kept typing (stale-write race).
  const usernameCheckSeq = useRef(0);
  const usernameInputRef = useRef<TextInput>(null);
  // Keys of tags removed BEFORE their optimistic insert resolved — so
  // addTagLocal can undo the DB write instead of leaving an orphan row
  // (add-then-remove within the network round-trip). 2026-06-05.
  const removedTagKeysRef = useRef<Set<string>>(new Set());

  // ─── Step 2 (你是誰): headline + bio + tags ──────────────────
  // headline = 職稱 (optional). bio lives in the existing `bio` state
  // (shared with the card-scan prefill). Tags persist IMMEDIATELY on
  // add (piktag_user_tags), mirroring ManageTags — so going back or
  // abandoning keeps them, and the ≥3 gate reads the live list.
  const [headline, setHeadline] = useState('');
  const [selectedTags, setSelectedTags] = useState<
    { key: string; name: string; tagId?: string }[]
  >([]);
  const [tagInput, setTagInput] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTried, setAiTried] = useState(false);

  // ─── Step 3 (電子名片): link picker ──────────────────────────
  // The biolinks themselves live in `pendingBiolinks` (shared with the
  // card-scan path — a scanned card's links count toward the ≥3 gate).
  // linkPlatform/linkInput drive the "pick a platform → type handle →
  // add" mini-flow using the locale-aware quick-pick.
  const [linkPlatform, setLinkPlatform] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  // Self-declared birthday — the engine for "it's X's birthday"
  // friend notifications (core CRM). Collected here so EVERY signup
  // path (email + Apple + Google) gets a chance to set it; OAuth
  // users skip RegisterScreen entirely and would otherwise never
  // have a birthday. Stored as YYYY-MM-DD (see lib/birthday.ts).
  const [birthday, setBirthday] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [burstVisible, setBurstVisible] = useState(false);
  const [burstUserName, setBurstUserName] = useState<string | undefined>(undefined);
  // Completion navigation used to live ONLY inside the burst's
  // onComplete callback — if that never fired (animation lib error,
  // unmount), the user was stranded on the profile screen with the
  // DB written + flag set but no way forward. finishedRef makes the
  // nav idempotent; navTimerRef is a safety net that fires it
  // anyway if onComplete is late/missing.
  const finishedRef = useRef(false);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            .select('full_name, avatar_url, username')
            .eq('id', user.id)
            .single();
          if (!cancelled && profile?.avatar_url) setAvatarUrl(profile.avatar_url);
          // Prefill the current (auto-generated) username so the user
          // can keep or customise it. It's their own → RPC excludes
          // self → starts as 'available' (CTA enabled by default).
          if (!cancelled && profile?.username) {
            setUsername(profile.username);
            setUsernameStatus('available');
          }
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

  // ─── Live username availability ─────────────────────────
  // Format-validate locally first (no point pinging the server for a
  // malformed handle), then debounce 400ms and call the RPC. The seq
  // guard drops a slow response that resolves after a newer keystroke.
  useEffect(() => {
    const u = username.trim();
    if (!u) { setUsernameStatus('idle'); return; }
    if (!isUsernameFormatValid(u)) { setUsernameStatus('invalid'); return; }
    setUsernameStatus('checking');
    const seq = ++usernameCheckSeq.current;
    const handle = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc('check_username_available', {
          p_username: u,
        });
        if (seq !== usernameCheckSeq.current) return; // superseded
        if (error) { setUsernameStatus('error'); return; }
        setUsernameStatus(data ? 'available' : 'taken');
      } catch {
        if (seq === usernameCheckSeq.current) setUsernameStatus('error');
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [username]);

  // ─── Step 1 → Step 2 advance ────────────────────────────
  // Upsert {id, full_name, username} BEFORE entering the tag step so
  // the piktag_profiles row exists (piktag_user_tags inserts in Step 2
  // may FK to it) and the identity is saved early (resilient to
  // abandon). The CTA is already gated on name + available username.
  const goToTags = useCallback(async () => {
    const trimmed = displayName.trim();
    const uname = username.trim();
    if (!trimmed || !uname || usernameStatus !== 'available') return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('piktag_profiles')
          .upsert({ id: user.id, full_name: trimmed, username: uname }, { onConflict: 'id' });
      }
    } catch (e) {
      console.warn('[Onboarding] identity pre-save failed:', e);
      // Non-fatal — handleComplete upserts again at the end. Proceed.
    }
    setStep(STEP_TAGS);
  }, [displayName, username, usernameStatus]);

  // ─── Step 2: tags (immediate-persist) ───────────────────
  const addTagLocal = useCallback(async (rawName: string) => {
    const norm = normalizeTagName(rawName);
    if (!norm) return;
    if (selectedTags.length >= MAX_ONB_TAGS) return;
    if (selectedTags.some((tg) => tg.name.toLowerCase() === norm.toLowerCase())) return;
    const key = `t-${Date.now()}-${norm}`;
    const position = selectedTags.length;
    // Optimistic add; drop from AI suggestions if it came from there.
    setSelectedTags((prev) => [...prev, { key, name: norm }]);
    setAiSuggestions((prev) => prev.filter((s) => s.toLowerCase() !== norm.toLowerCase()));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const tagId = await addUserTagByName(user.id, norm, position);
        if (tagId) {
          // If the user removed this chip while the insert was still
          // in flight, removeTagLocal couldn't delete (no tagId yet) and
          // marked the key. Undo the now-completed insert instead of
          // leaving an invisible orphan row.
          if (removedTagKeysRef.current.has(key)) {
            removedTagKeysRef.current.delete(key);
            await supabase
              .from('piktag_user_tags')
              .delete()
              .eq('user_id', user.id)
              .eq('tag_id', tagId);
            await supabase.rpc('decrement_tag_usage', { tag_id: tagId });
          } else {
            setSelectedTags((prev) =>
              prev.map((tg) => (tg.key === key ? { ...tg, tagId } : tg)),
            );
          }
        }
      }
    } catch (e) {
      console.warn('[Onboarding] tag add failed:', e);
    }
  }, [selectedTags]);

  const handleAddTypedTag = useCallback(() => {
    const v = tagInput.trim();
    if (!v) return;
    void addTagLocal(v);
    setTagInput('');
  }, [tagInput, addTagLocal]);

  const removeTagLocal = useCallback(async (key: string) => {
    const tg = selectedTags.find((x) => x.key === key);
    setSelectedTags((prev) => prev.filter((x) => x.key !== key));
    if (!tg?.tagId) {
      // Insert still in flight — mark the key so addTagLocal undoes the
      // write once it resolves (otherwise an orphan row would persist).
      removedTagKeysRef.current.add(key);
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('piktag_user_tags')
          .delete()
          .eq('user_id', user.id)
          .eq('tag_id', tg.tagId);
        await supabase.rpc('decrement_tag_usage', { tag_id: tg.tagId });
      }
    } catch (e) {
      console.warn('[Onboarding] tag remove failed:', e);
    }
  }, [selectedTags]);

  // AI tag suggestions — explicit button (clear intent: "suggestions
  // to PICK", not "already applied"). Uses the in-memory bio + name
  // (no DB round-trip needed).
  const loadAiSuggestions = useCallback(async () => {
    setAiTried(true);
    setAiLoading(true);
    try {
      const ctx = `${bio} ${displayName}`;
      const lang = /[一-鿿]/.test(ctx) ? '繁體中文' :
        /[぀-ヿ]/.test(ctx) ? '日本語' :
        /[가-힯]/.test(ctx) ? '한국어' :
        /[฀-๿]/.test(ctx) ? 'ภาษาไทย' : 'the same language as the content';
      const { data, error } = await supabase.functions.invoke<{ suggestions?: string[] }>(
        'suggest-tags',
        {
          body: {
            bio: bio.trim(),
            name: displayName.trim(),
            location: '',
            existingTags: selectedTags.map((tg) => tg.name).join(', '),
            lang,
          },
        },
      );
      if (!error && Array.isArray(data?.suggestions)) {
        const taken = new Set(selectedTags.map((tg) => tg.name.toLowerCase()));
        setAiSuggestions(data.suggestions.filter((s) => s && !taken.has(s.toLowerCase())));
      }
    } catch (e) {
      console.warn('[Onboarding] suggest-tags failed:', e);
    } finally {
      setAiLoading(false);
    }
  }, [bio, displayName, selectedTags]);

  // ─── Step 2 → Step 3 advance ────────────────────────────
  const goToLinks = useCallback(() => {
    if (selectedTags.length < MIN_ONB_TAGS || !bio.trim()) return;
    setStep(STEP_LINKS);
  }, [selectedTags.length, bio]);

  // ─── Step 3: link picker (stages into pendingBiolinks) ──
  const selectLinkPlatform = useCallback((key: string) => {
    setLinkPlatform(key);
    // Prefill https:// for the generic "custom" link so the user
    // doesn't fight the scheme (mirrors EditProfile).
    setLinkInput(key === 'custom' ? 'https://' : '');
  }, []);

  const addLink = useCallback(() => {
    if (!linkPlatform) return;
    const raw = linkInput.trim();
    if (!raw || raw === 'https://') return;
    const url = buildPlatformUrl(linkPlatform, raw);
    if (!url) return;
    setPendingBiolinks((prev) => {
      // dedupe by platform+url
      if (prev.some((b) => b.platform === linkPlatform && b.url === url)) return prev;
      return [...prev, { platform: linkPlatform!, url, label: null }];
    });
    setLinkInput('');
    setLinkPlatform(null);
  }, [linkPlatform, linkInput]);

  const removeLink = useCallback((index: number) => {
    setPendingBiolinks((prev) => prev.filter((_, i) => i !== index));
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
  // Optional accelerator on the name screen. Opens the CAMERA to
  // photograph a physical card (not the library — "掃描名片" means
  // point-and-shoot the real card) → edge-function vision extract →
  // editable confirmation sheet. Nothing is written until the user
  // confirms the sheet; this handler only POPULATES the working copy.
  // Scan pipeline, fed a captured photo by CardCameraScreen via its
  // onCaptured callback param. The framing-guide camera owns the
  // camera + permission; this owns the timeout + confirmation sheet.
  const runScan = useCallback(async (uri: string, mimeType: string) => {
    try {
      setScanning(true);
      // scanCard runs on-device OCR first (fast) and auto-falls back
      // to the multimodal image call; same { data, error } shape as
      // the raw invoke. 2026-06-03 speed pass: uri-only input — base64
      // is lazy-encoded inside scanCard only when the fallback fires.
      const SCAN_TIMEOUT_MS = 30000;
      const { data, error } = await Promise.race([
        scanCard({ uri, mimeType }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SCAN_TIMEOUT')), SCAN_TIMEOUT_MS),
        ),
      ]);
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
      const isTimeout = err?.message === 'SCAN_TIMEOUT';
      Alert.alert(
        isTimeout
          ? t('auth.onboarding.cardScanFailedTitle', { defaultValue: '掃描失敗' })
          : t('common.error'),
        isTimeout
          ? t('auth.onboarding.cardScanFailedMessage', {
              defaultValue: '名片沒有讀取成功，再試一次或手動填寫。',
            })
          : err?.message || t('common.unknownError'),
      );
    } finally {
      setScanning(false);
    }
  }, [t]);

  // Open the custom framing-guide camera; it returns the photo here.
  const handleScanCard = useCallback(() => {
    navigation.navigate('CardCamera', { onCaptured: runScan });
  }, [navigation, runScan]);

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

  // Post-completion navigation. Extracted out of the burst's
  // onComplete so a safety timer can also call it: if the burst
  // animation never fires onComplete, the user is no longer
  // stranded. finishedRef makes it run exactly once.
  const finishOnboarding = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (navTimerRef.current) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    setBurstVisible(false);

    // (Invite-code handoff removed — the invite/redeem gate was
    // retired; open signup, no codes.)

    // Drop the user on the create-first-event surface.
    // root → Main → AddTagTab(2) → AddTagCreate(1). Back-gesture
    // pops AddTagCreate → AddTagMain (the # tab's landing).
    const mainState = {
      index: 2,
      routes: [
        { name: 'HomeTab' },
        { name: 'SearchTab' },
        {
          name: 'AddTagTab',
          state: {
            index: 1,
            routes: [{ name: 'AddTagMain' }, { name: 'AddTagCreate' }],
          },
        },
        { name: 'NotificationsTab' },
        { name: 'ProfileTab' },
      ],
    };
    navigation.reset({ index: 0, routes: [{ name: 'Main', state: mainState }] });
  }, [navigation]);

  // Clear the safety timer if the screen unmounts first.
  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current);
  }, []);

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
    // Username gate — must be a confirmed-available handle. The CTA is
    // already disabled unless usernameStatus === 'available', but guard
    // here too (onSubmitEditing can reach this path).
    const uname = username.trim();
    if (!uname || usernameStatus !== 'available') {
      Alert.alert(
        t('auth.onboarding.usernameRequiredTitle', { defaultValue: '幫帳號取個名字' }),
        t('auth.onboarding.usernameRequiredMessage', {
          defaultValue: '帳號是你的名片網址 pikt.ag/你的帳號，先選一個可用的吧。',
        }),
      );
      return;
    }
    // Birthday is optional, but if they typed something it must be a
    // real date — a silently-dropped/garbled birthday means the
    // friend notification (core CRM) never fires. Normalized to the
    // strict MM/DD the daily-birthday-check cron matches on.
    const bday = toBirthdayDate(birthday);
    if (birthday.trim() !== '' && !bday) {
      Alert.alert(
        t('common.error', { defaultValue: '錯誤' }),
        t('friendDetail.alertInvalidDate', { defaultValue: '請輸入正確的日期格式（MM/DD）' }),
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
      const profilePatch: Record<string, string> = { full_name: trimmed, username: uname };
      const trimmedBio = bio.trim();
      if (trimmedBio) profilePatch.bio = trimmedBio;
      const trimmedHeadline = headline.trim();
      if (trimmedHeadline) profilePatch.headline = trimmedHeadline;
      if (bday) profilePatch.birthday = bday;

      // upsert (not update().eq) so a profile row the signup trigger
      // hasn't committed yet still gets written — closes the
      // post-signup race. And the name write is now FATAL: it is the
      // core deliverable of onboarding ("friends scanning your QR
      // see this name"). Marking onboarding complete on a failed
      // name write strands the user with a nameless profile AND no
      // way back in (the completed flag + age check both say skip).
      // onboarding_completed = true is set HERE and ONLY here — the
      // single point where the whole wizard has actually been walked
      // (name/username from step 1, bio/headline/tags from step 2,
      // links from step 3 all written by now). A user who bails after
      // step 1 has username+full_name on their profile but NOT this
      // flag, so the gate correctly re-prompts them. (boolean, so it
      // can't ride along in the string-typed profilePatch.)
      const { error } = await supabase
        .from('piktag_profiles')
        .upsert({ id: user.id, ...profilePatch, onboarding_completed: true }, { onConflict: 'id' });
      if (error) {
        console.warn('[Onboarding] profile upsert failed:', error.message);
        Alert.alert(
          t('common.error', { defaultValue: '錯誤' }),
          t('auth.onboarding.saveFailed', {
            defaultValue: '資料沒存成功，請檢查網路後再試一次。',
          }),
        );
        setSaving(false);
        return;
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
            // 'both' (icon row + card) to match every other biolink
            // creation path and the DB column default
            // (20260531000000). Was hardcoded 'icon' here, which meant
            // a user who scanned their card during onboarding saw
            // their links render ONLY as compact icons — never as
            // cards — until they manually edited one (which upgraded
            // it to 'both'). That's exactly the per-surface drift the
            // founder unified away from; onboarding shouldn't be the
            // one place that starts links half-shown. (4.8 onboarding
            // audit 2026-06-03; reverses the earlier "leave as icon"
            // deferral now that display_mode is unified to 'both'.)
            display_mode: 'both',
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
        // Per-ACCOUNT cache key (namespaced by user id) — the old bare
        // key was device-global and leaked completion across accounts on
        // the same device, so every later account skipped the wizard.
        // Mirrors AppNavigator.onboardingFlagKey().
        const { data: { user: completedUser } } = await supabase.auth.getUser();
        if (completedUser) {
          await AsyncStorage.setItem(`${ONBOARDING_COMPLETED_KEY}_${completedUser.id}`, 'true');
        }
      } catch (err) {
        console.warn('[Onboarding] flag persist failed:', err);
      }
      setBurstUserName(trimmed);
      setBurstVisible(true);
      // Safety net: if the burst's onComplete never fires (animation
      // lib error / unmount), navigate anyway after the animation
      // would have finished. finishedRef keeps it single-shot.
      navTimerRef.current = setTimeout(() => { finishOnboarding(); }, 4000);
    } catch (err: any) {
      Alert.alert(t('common.error'), err.message || t('common.unknownError'));
    } finally {
      setSaving(false);
    }
  }, [displayName, username, usernameStatus, bio, headline, birthday, pendingBiolinks, t, finishOnboarding]);

  // ─── Render: Step 0 (Welcome card) ──────────────────────
  // Step header: back chevron (or balancing spacer) + a centered
  // 3-segment progress bar. `current` is 1-based (identity=1, tags=2,
  // links=3); the welcome splash isn't counted. Segments up to and
  // including `current` are filled.
  const renderStepHeader = (current: number, onBack?: () => void) => (
    <View style={styles.stepHeader}>
      <View style={styles.stepHeaderSide}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', { defaultValue: '返回' })}
          >
            <ChevronLeft size={26} color={colors.gray700} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.progressRow}>
        {[1, 2, 3].map((n) => (
          <View
            key={n}
            style={[styles.progressSeg, n <= current && styles.progressSegActive]}
          />
        ))}
      </View>
      <View style={styles.stepHeaderSide} />
    </View>
  );

  const renderWelcome = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.welcomeIconWrap}>
        <QrCode size={64} color={colors.piktag500} strokeWidth={2.2} />
      </View>
      <Text style={styles.welcomeTitle}>
        {t('auth.onboarding.welcomeTitle', { defaultValue: '一個 QR，加完所有朋友' })}
      </Text>
      <Text style={styles.welcomeSubtitle}>
        {t('auth.onboarding.welcomeSubtitle', { defaultValue: '貼上標籤，下次見面就知道是誰' })}
      </Text>
      {/* Brand tagline — small, English, uppercase-letterspaced.
          Sits under the functional copy so it reads as a signature,
          not a competing headline. Drives the product loop —
          self-tag asserts identity, find anyone discovers the
          network — in 4 words. Replaces the 2026-mid "Tag the
          Vibe, Keep the Tribe" line (2026-05-30 — "tribe" was a
          NA-launch landmine and "vibe/tribe" didn't describe the
          product). */}
      <Text style={styles.brandTagline}>
        {t('auth.onboarding.brandTagline', { defaultValue: 'Tag yourself. Find anyone.' })}
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
    const ctaDisabled = saving || !displayName.trim() || usernameStatus !== 'available';
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepHeader(1)}
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
                <Camera size={32} color={colors.piktag500} strokeWidth={1.8} />
              )}
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.avatarHint}>
          {t('auth.onboarding.avatarHintRecommend', {
            defaultValue: '建議放一張照片 — 朋友更容易認出你（可跳過）',
          })}
        </Text>

        <TextInput
          style={styles.nameInput}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('auth.onboarding.profileNamePlaceholder', { defaultValue: '你的名字' })}
          placeholderTextColor={colors.gray400}
          maxLength={40}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => usernameInputRef.current?.focus()}
        />

        {/* Username (帳號) — the public pikt.ag/{username} handle.
            Auto-lowercased + char-filtered on input; live-checked
            against the RPC. The status line below doubles as the
            "why" explanation when idle. */}
        <TextInput
          ref={usernameInputRef}
          style={styles.nameInput}
          value={username}
          onChangeText={(v) => setUsername(normalizeUsername(v))}
          placeholder={t('editProfile.usernamePlaceholder', { defaultValue: '你的帳號' })}
          placeholderTextColor={colors.gray400}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
        />
        {/* Status / why-this line. */}
        <View style={styles.usernameStatusRow}>
          {usernameStatus === 'checking' && (
            <>
              <ActivityIndicator size="small" color={colors.gray400} />
              <Text style={[styles.usernameStatusText, { color: colors.gray500 }]}>
                {t('auth.onboarding.usernameChecking', { defaultValue: '檢查中…' })}
              </Text>
            </>
          )}
          {usernameStatus === 'available' && (
            <Text style={[styles.usernameStatusText, { color: colors.green500 }]}>
              {t('auth.onboarding.usernameAvailable', { defaultValue: '✓ 可使用' })}
            </Text>
          )}
          {usernameStatus === 'taken' && (
            <Text style={[styles.usernameStatusText, { color: colors.red500 }]}>
              {t('auth.onboarding.usernameTaken', { defaultValue: '這個帳號已被使用' })}
            </Text>
          )}
          {usernameStatus === 'invalid' && (
            <Text style={[styles.usernameStatusText, { color: colors.gray500 }]}>
              {t('auth.onboarding.usernameInvalid', {
                defaultValue: '3–30 字，限小寫英文、數字、_ 與 .',
              })}
            </Text>
          )}
          {usernameStatus === 'error' && (
            <Text style={[styles.usernameStatusText, { color: colors.gray500 }]}>
              {t('auth.onboarding.usernameCheckError', {
                defaultValue: '暫時無法檢查，稍後再試',
              })}
            </Text>
          )}
          {(usernameStatus === 'idle') && (
            <Text style={[styles.usernameStatusText, { color: colors.gray500 }]}>
              {t('auth.onboarding.usernameWhy', {
                defaultValue: '這是你的名片網址：pikt.ag/你的帳號',
              })}
            </Text>
          )}
        </View>

        {/* (Birthday moved to Step 2 — Step 1 is identity only:
            avatar + name + username.) */}

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
            // Explicit "reading…" feedback, consistent with
            // EditLocalContact (reuses localContact.scanningCard —
            // already in all 19 locales). Light piktag50 button bg,
            // so a piktag500 indicator stays visible.
            <>
              <ActivityIndicator size="small" color={colors.piktag500} />
              <Text style={styles.scanCardBtnText}>
                {t('localContact.scanningCard', { defaultValue: '辨識名片中…' })}
              </Text>
            </>
          ) : (
            <>
              <ScanLine size={18} color={colors.piktag500} strokeWidth={2} />
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
          onPress={goToTags}
          disabled={ctaDisabled}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {t('auth.onboarding.next', { defaultValue: '下一步' })}
          </Text>
          <ChevronRight size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ─── Render: Step 2 (你是誰 — headline + bio + tags) ─────
  const renderTags = () => {
    const tagsStepValid = selectedTags.length >= MIN_ONB_TAGS && bio.trim().length > 0;
    const ctaDisabled = saving || !tagsStepValid;
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepHeader(2, () => setStep(STEP_PROFILE))}

        <Text style={styles.profileTitle}>
          {t('auth.onboarding.tagsTitle', { defaultValue: '你是誰？' })}
        </Text>
        <Text style={styles.profileSubtitle}>
          {t('auth.onboarding.tagsSubtitle', { defaultValue: '幾個標籤，讓對的人找到你' })}
        </Text>

        {/* Headline (職稱) — optional */}
        <TextInput
          style={styles.nameInput}
          value={headline}
          onChangeText={setHeadline}
          placeholder={t('auth.onboarding.headlinePlaceholder', { defaultValue: '職稱（選填，例：產品設計師）' })}
          placeholderTextColor={colors.gray400}
          maxLength={50}
          returnKeyType="next"
        />

        {/* Bio — required (feeds AI tag suggestions + matching) */}
        <TextInput
          style={[styles.nameInput, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder={t('auth.onboarding.bioPlaceholder', { defaultValue: '一句話介紹你自己' })}
          placeholderTextColor={colors.gray400}
          multiline
          maxLength={80}
          textAlignVertical="top"
        />

        {/* ── Tags ── */}
        <View style={styles.tagsSectionHeader}>
          <Text style={styles.sectionLabel}>
            {t('auth.onboarding.tagsSectionLabel', { defaultValue: '我的標籤' })}
          </Text>
          <Text style={styles.tagCount}>
            {t('manageTags.tagCount', { count: selectedTags.length, max: MAX_ONB_TAGS })}
          </Text>
        </View>
        {/* Why tags exist — the founder's explicit ask: explain that
            tags are for matching / meeting the right people. */}
        <Text style={styles.tagPurpose}>
          {t('auth.onboarding.tagPurpose', {
            defaultValue: '標籤讓對的人搜尋得到你，也幫你配對新朋友。',
          })}
        </Text>

        {/* AI suggestions — explicit "推薦 → 點選加入" so users don't
            think the gray chips are already applied. */}
        <TouchableOpacity
          style={styles.scanCardBtn}
          activeOpacity={0.7}
          onPress={loadAiSuggestions}
          disabled={aiLoading}
          accessibilityRole="button"
        >
          {aiLoading ? (
            <>
              <ActivityIndicator size="small" color={colors.piktag500} />
              <Text style={styles.scanCardBtnText}>
                {t('auth.onboarding.aiThinking', { defaultValue: 'AI 想標籤中…' })}
              </Text>
            </>
          ) : (
            <>
              <Sparkles size={18} color={colors.piktag500} strokeWidth={2} />
              <Text style={styles.scanCardBtnText}>
                {aiTried
                  ? t('auth.onboarding.aiMore', { defaultValue: '再推薦一些' })
                  : t('auth.onboarding.aiSuggest', { defaultValue: '讓 AI 推薦標籤' })}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {aiSuggestions.length > 0 && (
          <>
            <Text style={styles.aiPickLabel}>
              {t('auth.onboarding.aiPickHint', { defaultValue: '👇 點選想加入的標籤' })}
            </Text>
            <View style={styles.chipsWrap}>
              {aiSuggestions.map((s) => (
                <TagChip
                  key={`ai-${s}`}
                  label={s}
                  variant="toggle"
                  onPress={() => addTagLocal(s)}
                />
              ))}
            </View>
          </>
        )}

        {/* Type your own */}
        <View style={styles.tagInputRow}>
          <TextInput
            style={styles.tagInputField}
            value={tagInput}
            onChangeText={setTagInput}
            placeholder={t('auth.onboarding.tagInputPlaceholder', { defaultValue: '輸入標籤，例：攝影' })}
            placeholderTextColor={colors.gray400}
            maxLength={30}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleAddTypedTag}
          />
          <TouchableOpacity
            style={[styles.tagAddBtn, !tagInput.trim() && styles.tagAddBtnDisabled]}
            onPress={handleAddTypedTag}
            disabled={!tagInput.trim()}
            accessibilityRole="button"
            accessibilityLabel={t('manageTags.addTag', { defaultValue: '新增標籤' })}
          >
            <Plus size={20} color="#FFFFFF" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        {/* Selected tags — purple, tap to remove */}
        {selectedTags.length > 0 && (
          <View style={styles.chipsWrap}>
            {selectedTags.map((tg) => (
              <TagChip
                key={tg.key}
                label={tg.name}
                variant="toggle"
                selected
                onPress={() => removeTagLocal(tg.key)}
              />
            ))}
          </View>
        )}

        {/* Birthday — moved from Step 1 (optional, CRM core). */}
        <TextInput
          style={styles.nameInput}
          value={birthday}
          onChangeText={setBirthday}
          placeholder={t('auth.register.birthdayLabel', { defaultValue: '生日（選填）' }) + '  MM/DD'}
          placeholderTextColor={colors.gray400}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          returnKeyType="done"
        />

        <View style={{ flex: 1, minHeight: 24 }} />

        {!tagsStepValid && (
          <Text style={styles.gateHint}>
            {selectedTags.length < MIN_ONB_TAGS
              ? t('auth.onboarding.tagsGateHint', {
                  count: MIN_ONB_TAGS,
                  defaultValue: '至少選 3 個標籤再繼續',
                })
              : t('auth.onboarding.bioGateHint', { defaultValue: '寫一句自我介紹再繼續' })}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.primaryButton, ctaDisabled && styles.primaryButtonDisabled]}
          activeOpacity={0.85}
          onPress={goToLinks}
          disabled={ctaDisabled}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>
            {t('auth.onboarding.next', { defaultValue: '下一步' })}
          </Text>
          <ChevronRight size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ─── Render: Step 3 (電子名片 — links) ──────────────────
  const renderLinks = () => {
    const linksValid = pendingBiolinks.length >= MIN_ONB_LINKS;
    const ctaDisabled = saving || !linksValid;
    const quickKeys = getQuickPickKeys(i18n.language);
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepHeader(3, () => setStep(STEP_TAGS))}

        <Text style={styles.profileTitle}>
          {t('auth.onboarding.linksTitle', { defaultValue: '你的電子名片' })}
        </Text>
        <Text style={styles.profileSubtitle}>
          {t('auth.onboarding.linksSubtitle', {
            defaultValue: '留下聯絡方式與社群，別人掃一下就完整收藏你',
          })}
        </Text>

        {/* Platform quick-pick (locale-aware). Tap → reveals input. */}
        <View style={styles.platformChipsWrap}>
          {quickKeys.map((key) => {
            const active = linkPlatform === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.platformChip, active && styles.platformChipActive]}
                onPress={() => selectLinkPlatform(key)}
                activeOpacity={0.7}
              >
                <PlatformIcon platform={key} size={18} />
                <Text style={[styles.platformChipText, active && styles.platformChipTextActive]}>
                  {getPlatformLabel(key, t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Input for the selected platform */}
        {linkPlatform && (
          <View style={styles.tagInputRow}>
            <TextInput
              style={styles.tagInputField}
              value={linkInput}
              onChangeText={setLinkInput}
              placeholder={PLATFORM_MAP[linkPlatform]?.placeholder ?? ''}
              placeholderTextColor={colors.gray400}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={linkPlatform === 'phone' ? 'phone-pad' : 'default'}
              returnKeyType="done"
              onSubmitEditing={addLink}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.tagAddBtn, !linkInput.trim() && styles.tagAddBtnDisabled]}
              onPress={addLink}
              disabled={!linkInput.trim()}
              accessibilityRole="button"
              accessibilityLabel={t('manageTags.addTag', { defaultValue: '新增' })}
            >
              <Plus size={20} color="#FFFFFF" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        )}

        {/* Added links */}
        {pendingBiolinks.length > 0 && (
          <View style={styles.linksList}>
            {pendingBiolinks.map((b, i) => (
              <View key={`${b.platform}-${i}`} style={styles.linkRow}>
                <PlatformIcon platform={b.platform} size={20} />
                <Text style={styles.linkRowText} numberOfLines={1}>
                  {getPlatformLabel(b.platform, t)}
                </Text>
                <TouchableOpacity
                  onPress={() => removeLink(i)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.remove', { defaultValue: '移除' })}
                >
                  <X size={18} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={{ flex: 1, minHeight: 24 }} />

        {!linksValid && (
          <Text style={styles.gateHint}>
            {t('auth.onboarding.linksGateHint', {
              count: Math.max(0, MIN_ONB_LINKS - pendingBiolinks.length),
              defaultValue: '再加 {{count}} 個就好（電子名片至少 3 個聯絡方式或社群）',
            })}
          </Text>
        )}

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
                {t('auth.onboarding.finishCta', { defaultValue: '完成，開始用 PikTag' })}
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
      {step === STEP_WELCOME
        ? renderWelcome()
        : step === STEP_PROFILE
          ? renderProfile()
          : step === STEP_TAGS
            ? renderTags()
            : renderLinks()}

      {/* Celebration burst plays after handleComplete succeeds. Its
          onComplete then drives the navigation reset — we defer to
          onComplete so the animation isn't interrupted by tab-stack
          mounting. */}
      <OnboardingCompleteBurst
        visible={burstVisible}
        userName={burstUserName}
        onComplete={finishOnboarding}
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
                <X size={22} color={colors.gray500} />
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
                placeholderTextColor={colors.gray400}
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
                placeholderTextColor={colors.gray400}
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
                      trackColor={{ false: colors.gray200, true: colors.piktag500 }}
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
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
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  welcomeTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: c.gray900,
    textAlign: 'center',
    lineHeight: 36,
    paddingHorizontal: 16,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: c.gray500,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  brandTagline: {
    fontSize: 11,
    color: c.piktag500,
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
    color: c.gray900,
    textAlign: 'center',
  },
  profileSubtitle: {
    fontSize: 14,
    color: c.gray500,
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
    borderColor: c.piktag500,
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHint: {
    fontSize: 12,
    color: c.gray400,
    textAlign: 'center',
    marginBottom: 24,
  },
  nameInput: {
    fontSize: 18,
    color: c.gray900,
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  // Username live-status / why-this line under the 帳號 input.
  usernameStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    minHeight: 18,
    paddingHorizontal: 8,
  },
  usernameStatusText: {
    fontSize: 13,
    textAlign: 'center',
  },

  // ── Step header (back + 3-segment progress) ──
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  stepHeaderSide: {
    width: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSeg: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.gray200,
  },
  progressSegActive: {
    backgroundColor: c.piktag500,
  },
  bioInput: {
    minHeight: 64,
    textAlign: 'left',
    paddingTop: 12,
  },
  tagsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray900,
  },
  tagCount: {
    fontSize: 13,
    color: c.gray400,
  },
  tagPurpose: {
    fontSize: 13,
    color: c.gray500,
    lineHeight: 18,
    marginBottom: 12,
  },
  aiPickLabel: {
    fontSize: 13,
    color: c.piktag600,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  tagInputField: {
    flex: 1,
    fontSize: 16,
    color: c.gray900,
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tagAddBtn: {
    width: 46,
    height: 46,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: c.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAddBtnDisabled: {
    backgroundColor: c.gray200,
  },
  gateHint: {
    fontSize: 13,
    color: c.gray500,
    textAlign: 'center',
    marginBottom: 10,
  },

  // ── Step 3 (電子名片) link picker ──
  platformChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: c.gray200,
    backgroundColor: c.gray100,
  },
  platformChipActive: {
    borderColor: c.piktag500,
    backgroundColor: c.piktag50,
  },
  platformChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.gray700,
  },
  platformChipTextActive: {
    color: c.piktag600,
  },
  linksList: {
    marginTop: 16,
    gap: 8,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  linkRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: c.gray900,
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
    backgroundColor: c.piktag500,
    marginTop: 24,
  },
  primaryButtonDisabled: {
    backgroundColor: c.gray200,
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
    borderColor: c.piktag500,
    backgroundColor: c.piktag50,
    marginTop: 16,
  },
  scanCardBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag500,
  },
  scanCardHint: {
    fontSize: 12,
    color: c.gray400,
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
    backgroundColor: c.white,
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
    color: c.gray900,
  },
  modalSubtitle: {
    fontSize: 13,
    color: c.gray500,
    marginTop: 4,
    marginBottom: 12,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray700,
    marginTop: 14,
    marginBottom: 6,
  },
  modalInput: {
    fontSize: 15,
    color: c.gray900,
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
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
    color: c.piktag600,
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
    color: c.gray500,
    marginBottom: 4,
  },
  modalLinkInput: {
    fontSize: 14,
    color: c.gray900,
    backgroundColor: c.gray50,
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
    backgroundColor: c.piktag500,
    alignItems: 'center',
  },
  modalApplyBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  });
}
