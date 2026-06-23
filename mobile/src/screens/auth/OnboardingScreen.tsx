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
import * as Sentry from '@sentry/react-native';
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
  ActivityIndicator,
} from 'react-native';
import BrandSpinner from '../../components/loaders/BrandSpinner';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronRight, ChevronLeft, Camera, X, Plus } from 'lucide-react-native';
import BoltIcon from '../../components/BoltIcon';
import GradientButton from '../../components/GradientButton';
import { supabase, supabaseUrl, supabaseAnonKey } from '../../lib/supabase';
import { normalizeTagName } from '../../lib/normalizeTag';
import { addUserTagByName } from '../../lib/userTags';
import { recordAiSuggestions, markAiSuggestionAccepted } from '../../lib/aiTagLogger';
import TagChip from '../../components/TagChip';
import QrNameCard from '../../components/QrNameCard';
import { LinearGradient } from 'expo-linear-gradient';
import BirthdayInput from '../../components/BirthdayInput';
import { buildProfileUrl } from '../../lib/shareProfile';
import PhoneNumberInput from '../../components/PhoneNumberInput';
import { type Country, buildTelUrl, getDefaultCountry } from '../../lib/countryCodes';
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

// Onboarding opens on STEP_PROFILE — the welcome interstitial (step 0)
// was removed 2026-06-05. Numbering kept (profile=1) so the 3-segment
// progress bar maps 1:1 to the three real steps.
const STEP_PROFILE = 1; // identity: avatar + name + username
const STEP_TAGS = 2;    // 你是誰: headline + bio + tags
const STEP_LINKS = 3;   // 電子名片: social/contact links
const STEP_DONE = 4;    // payoff: 你的名片+QR — teaches the mutual-scan
                        // gesture BEFORE landing on the (empty) home.
                        // Terminal screen, not a branch: the server flag
                        // is already TRUE when it shows (founder 2026-06-10,
                        // "測試者不知道怎麼用" — wizard taught setup, never usage).
const MAX_ONB_TAGS = 10;
const MIN_ONB_TAGS = 3; // gate: tags are the engine — require a few
const MIN_ONB_LINKS = 3; // gate: ≥3 links (phone/email count) — 電子名片

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

  // Onboarding opens DIRECTLY on the identity form (step 1). The old
  // marketing-hero welcome interstitial ("一個 QR，加完所有朋友 → 開始使用
  // PikTag") was removed 2026-06-05 — the founder wants register →
  // straight into the 精靈, no splash page in between.
  const [step, setStep] = useState<number>(STEP_PROFILE);
  const [displayName, setDisplayName] = useState('');
  // True when the display name came from OAuth (Apple / Google) — the
  // identity provider already gave us the user's name via the
  // Authentication Services framework, so we MUST NOT show another
  // "what's your name?" input (Apple Guideline 4 Sign-In rejection,
  // 1.0.5 build 891, 2026-06-10). The name is written silently to the
  // profile; the step 1 UI shows only the handle picker + avatar.
  const [nameFromOAuth, setNameFromOAuth] = useState(false);
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
  // tag_name -> piktag_ai_tag_suggestions.id, for accept logging (#5).
  const [aiSuggestionIds, setAiSuggestionIds] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTried, setAiTried] = useState(false);

  // Rotating placeholder hints for 職稱 + bio — the SAME 5-example
  // carousels EditProfile uses (editProfile.headlinePromptHints /
  // bioPromptHints). Restored into the wizard's step 2 so a user
  // staring at a blank field sees concrete examples cycle through
  // (founder, 2026-06-05: the 五個預設輪播 went missing in the wizard).
  const headlineHints = useMemo(() => {
    const raw = t('editProfile.headlinePromptHints', { returnObjects: true });
    return Array.isArray(raw) && raw.length > 0 ? (raw as string[]) : null;
  }, [t]);
  const bioHints = useMemo(() => {
    const raw = t('editProfile.bioPromptHints', { returnObjects: true });
    return Array.isArray(raw) && raw.length > 0 ? (raw as string[]) : null;
  }, [t]);
  // ONE shared index + ONE timer drives BOTH carousels so they advance
  // IN SYNC at the SAME rhythm (founder, 2026-06-05: 節奏也要一樣). The
  // shared useRotatingPlaceholder hook times each prompt by its own
  // length (3500ms + 130ms/char), so the short 職稱 and the long bio
  // rotate at different speeds and drift apart — exactly the
  // inconsistency to avoid. Both hint arrays are 5 items → one index
  // maps to both. Fixed 4.5s dwell ≈ comfortable for the longer bio.
  const [exampleIdx, setExampleIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setExampleIdx((i) => i + 1), 4500);
    return () => clearInterval(id);
  }, []);
  const headlinePlaceholder = headlineHints
    ? headlineHints[exampleIdx % headlineHints.length]
    : t('auth.onboarding.headlinePlaceholder', { defaultValue: '例：產品設計師' });
  const bioPlaceholder = bioHints
    ? bioHints[exampleIdx % bioHints.length]
    : t('auth.onboarding.bioPlaceholder', { defaultValue: '例：在銀行上班，假日都在爬山' });

  // ─── Step 3 (電子名片): link picker ──────────────────────────
  // The biolinks themselves live in `pendingBiolinks` (shared with the
  // card-scan path — a scanned card's links count toward the ≥3 gate).
  // linkPlatform/linkInput drive the "pick a platform → type handle →
  // add" mini-flow using the locale-aware quick-pick.
  const [linkPlatform, setLinkPlatform] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState('');
  // Phone uses a dedicated (country, national) pair + the shared
  // PhoneNumberInput (country-code dropdown), same as EditProfile, so
  // onboarding stores clean E.164 tel: URLs via buildTelUrl (not the raw
  // typed string buildPlatformUrl('phone', …) used to keep).
  const [phoneCountry, setPhoneCountry] = useState<Country>(() =>
    getDefaultCountry(i18n.language),
  );
  const [phoneNational, setPhoneNational] = useState('');
  // Inline feedback for Add taps on invalid input. addLink used to
  // silently return on empty / "https://" / unparsable values — that
  // is the "silent drop" anti-pattern (CLAUDE.md prevent-or-feedback
  // rule). Surfaces a red hint below the field; cleared on next edit.
  const [addLinkError, setAddLinkError] = useState<string | null>(null);
  // Self-declared birthday — the engine for "it's X's birthday"
  // friend notifications (core CRM). Collected here so OAuth signups
  // (Apple/Google skip RegisterScreen) still get asked — but ONLY when
  // the profile doesn't already have one: email signups enter it on
  // RegisterScreen, and re-asking read as a bug (founder real-device
  // test 2026-06-11, "註冊已經輸入一次生日"). hasBirthday is hydrated
  // from the existing-profile load below and hides the field.
  const [birthday, setBirthday] = useState('');
  const [hasBirthday, setHasBirthday] = useState(false);
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

  // `bio` (step 2) + `pendingBiolinks` (step 3 link picker) are what
  // get committed in handleComplete. The wizard is a strictly linear,
  // type-only funnel (founder, 2026-06-05 "線性走完，不要有其他分支"):
  // no card-scan accelerator / no camera detour — the user fills every
  // step by hand, the only skippable field is the avatar.
  const [bio, setBio] = useState('');
  const [pendingBiolinks, setPendingBiolinks] = useState<
    { platform: string; url: string; label: string | null }[]
  >([]);

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
          if (!cancelled) {
            setDisplayName(fromMeta);
            // OAuth provider supplied the name — flag it so we DON'T re-ask.
            // Required by Apple Guideline 4 Sign in with Apple (1.0.5 build
            // 891 rejection 2026-06-10): the Authentication Services
            // framework already provides `credential.fullName`, so the app
            // must not show a subsequent name-entry screen.
            setNameFromOAuth(true);
          }
          return;
        }

        // 3: existing profile row (and pick up an avatar if one is
        //    already on file — covers the re-onboarding edge case
        //    where a user hit "log out" then came back)
        try {
          const { data: profile } = await supabase
            .from('piktag_profiles')
            .select('full_name, avatar_url, username, birthday')
            .eq('id', user.id)
            .single();
          if (!cancelled && profile?.avatar_url) setAvatarUrl(profile.avatar_url);
          // Email signups set a birthday on RegisterScreen — don't ask twice.
          if (!cancelled && (profile as any)?.birthday) setHasBirthday(true);
          // Do NOT prefill the username. The signup trigger seeds an
          // auto-generated handle, but showing it pre-filled reads as
          // "here's an account we assigned you" — wrong for a real
          // product (founder, 2026-06-05: 這是開放給使用者用的產品,
          // 你預設什麼). The user picks their own from an empty field;
          // their choice overwrites the seed at goToTags. (Avatar IS
          // restored above — that's the user's own uploaded photo, not
          // a system-assigned default.)
          const profileName = profile?.full_name?.trim();
          if (!cancelled && profileName) {
            setDisplayName(profileName);
            // The trigger / appleAuth wrote this — treat as OAuth-supplied
            // (covers the re-onboarding edge case where an Apple user
            // bailed mid-wizard and came back; we must NOT re-ask their
            // name on the second pass either).
            setNameFromOAuth(true);
            return;
          }
        } catch {
          // ignore — leave the name blank
        }

        // No email-prefix fallback: deriving a DISPLAY NAME from the
        // email local-part produces junk like "Piktag.tester02" that
        // looks identical to the auto-generated username right below it
        // (the "looks like two accounts" confusion the founder caught
        // 2026-06-05). A real name only ever comes from OAuth metadata
        // or an existing profile row (handled above); an email signup
        // just types their name into the blank field.
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
    // Principle #5: if this came from an AI suggestion, log the accept.
    const sid = aiSuggestionIds[rawName] ?? aiSuggestionIds[norm];
    if (sid) void markAiSuggestionAccepted(sid);
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
  }, [selectedTags, aiSuggestionIds]);

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
        const filtered = data.suggestions.filter((s) => s && !taken.has(s.toLowerCase()));
        setAiSuggestions(filtered);
        // Principle #5: log shown suggestions for calibration. Onboarding
        // is the engine's FIRST fill — was previously dark. Fire-and-forget.
        void (async () => {
          const ids = await recordAiSuggestions('bio_extract', filtered, { surface: 'onboarding' });
          if (ids.length === filtered.length) {
            const map: Record<string, string> = {};
            filtered.forEach((name, i) => { map[name] = ids[i]; });
            setAiSuggestionIds((prev) => ({ ...prev, ...map }));
          }
        })();
      }
    } catch (e) {
      console.warn('[Onboarding] suggest-tags failed:', e);
    } finally {
      setAiLoading(false);
    }
  }, [bio, displayName, selectedTags]);

  // ─── Step 2 → Step 3 advance ────────────────────────────
  // Birthday is REQUIRED here (founder 2026-06-11) — it's the engine for
  // the birthday-reminder CRM. Only enforced when the field is actually
  // shown (!hasBirthday); accounts that already have one skip it.
  const goToLinks = useCallback(() => {
    if (selectedTags.length < MIN_ONB_TAGS || !bio.trim()) return;
    if (!hasBirthday && !toBirthdayDate(birthday)) return;
    setStep(STEP_LINKS);
  }, [selectedTags.length, bio, hasBirthday, birthday]);

  // ─── Step 3: link picker (stages into pendingBiolinks) ──
  const selectLinkPlatform = useCallback((key: string) => {
    setLinkPlatform(key);
    // Prefill https:// for the generic "custom" link so the user
    // doesn't fight the scheme (mirrors EditProfile).
    setLinkInput(key === 'custom' ? 'https://' : '');
    // Reset the phone pair to the locale default each time phone is
    // (re-)selected — mirrors EditProfile's resetPhoneFields.
    if (key === 'phone') {
      setPhoneCountry(getDefaultCountry(i18n.language));
      setPhoneNational('');
    }
  }, [i18n.language]);

  const addLink = useCallback(() => {
    if (!linkPlatform) return;
    let url: string;
    if (linkPlatform === 'phone') {
      // Phone: synthesise the canonical tel: URL from (country, national)
      // via the SAME buildTelUrl EditProfile uses, so onboarding stores
      // clean E.164 (tel:+886…) instead of the raw-typed string.
      url = buildTelUrl(phoneCountry, phoneNational);
    } else {
      const raw = linkInput.trim();
      // prevent-or-feedback: empty / scheme-only / unparsable input was
      // silently dropped before. Surface an explicit hint instead so the
      // user knows why nothing was added.
      if (!raw || raw === 'https://') {
        setAddLinkError(
          t('auth.onboarding.addLinkInvalid', { defaultValue: 'Add a real link first' }),
        );
        return;
      }
      url = buildPlatformUrl(linkPlatform, raw);
    }
    if (!url) {
      setAddLinkError(
        t('auth.onboarding.addLinkInvalid', { defaultValue: 'Add a real link first' }),
      );
      return;
    }
    setAddLinkError(null);
    setPendingBiolinks((prev) => {
      // dedupe by platform+url
      if (prev.some((b) => b.platform === linkPlatform && b.url === url)) return prev;
      return [...prev, { platform: linkPlatform!, url, label: null }];
    });
    setLinkInput('');
    setPhoneNational('');
    setLinkPlatform(null);
  }, [linkPlatform, linkInput, phoneCountry, phoneNational, t]);

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
        // Read the body ONCE (the Response stream is single-use) and report
        // status + body to Sentry so an upload-RLS / storage failure is
        // diagnosable from the dashboard instead of just an opaque alert.
        const bodyText = await uploadRes.text();
        Sentry.captureException(new Error('avatar upload failed'), {
          extra: { status: uploadRes.status, body: bodyText, filePath },
        });
        // Sentry only ships in production (App.tsx); log for dev builds too.
        console.warn('[OnboardingScreen] avatar upload failed', uploadRes.status, bodyText);
        let message = bodyText;
        try {
          message = JSON.parse(bodyText).message || bodyText;
        } catch {
          // bodyText was not JSON; fall back to the raw text.
        }
        throw new Error(message || 'upload failed');
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

  // (Card-scan accelerator removed 2026-06-05 — the wizard is a strictly
  // linear, type-only funnel with no camera detour. The CardCamera
  // screen still serves the friends-page "+人" scan flow; it just isn't
  // wired into onboarding anymore.)

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

    // Land on HOME, not the QR-creation surface. Dropping a brand-new
    // user straight into "create a QR code" right after the wizard read
    // as too abrupt (founder, 2026-06-05: 精靈完不用直接進入建立 QR
    // code，太突兀). Home's cold-start cards guide the next step (QR /
    // contacts) at the user's own pace.
    const mainState = {
      index: 0,
      routes: [
        { name: 'HomeTab' },
        { name: 'SearchTab' },
        { name: 'AddTagTab' },
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
      // Bio (typed in step 2) rides along with full_name in the same
      // upsert. Empty bio → don't send the column at all.
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

      // Biolinks added in step 3 (the link picker). Best-effort +
      // non-fatal: a failed biolink insert must never block finishing
      // onboarding (the user can always re-add links in EditProfile).
      // Insert as one batch so position order is preserved.
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
            // creation path and the DB column default (20260531000000).
            // Was hardcoded 'icon' here once, which made onboarding the
            // one place that started links half-shown (icons only, never
            // cards) until manually edited — exactly the per-surface
            // drift the founder unified away from. Keep it 'both'.
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
      // Land on the payoff step (你的名片+QR) with the burst playing over
      // it. Leaving for Main is now an EXPLICIT user action (payoff CTA →
      // finishOnboarding) — no auto-nav timer. Safe even if the app dies
      // here: onboarding_completed is already TRUE, so the next launch
      // goes straight to Main.
      setStep(STEP_DONE);
      setBurstVisible(true);
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

  // ─── Render: Step 1 (Name + Avatar) ─────────────────────
  const renderProfile = () => {
    // Apple Guideline 4 Sign-In: if the name came from OAuth, we cannot
    // require it again on this screen. Gate the CTA only on username
    // availability in that case (the name is already in `displayName`
    // from prefill — it just isn't shown / re-asked).
    const ctaDisabled = saving
      || (!nameFromOAuth && !displayName.trim())
      || usernameStatus !== 'available';
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepHeader(1)}
        <Text style={styles.profileTitle}>
          {nameFromOAuth
            ? t('auth.onboarding.profileTitleHandle', {
                defaultValue: '設定你的 PikTag 帳號',
              })
            : t('auth.onboarding.profileTitle', { defaultValue: '你叫什麼名字？' })}
        </Text>
        <Text style={styles.profileSubtitle}>
          {nameFromOAuth
            ? t('auth.onboarding.profileSubtitleHandle', {
                defaultValue: '朋友透過 pikt.ag/{你的帳號} 找到你',
              })
            : t('auth.onboarding.profileSubtitle', { defaultValue: '朋友掃 QR 會看到這個名字' })}
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

        {/* Name input — only for email signup (Apple/Google users had
            their name returned by the OAuth provider, see prefill effect).
            Apple Guideline 4: do NOT show this input to Apple-Sign-In
            users; the name from `credential.fullName` is silently written
            to the profile already. 1.0.5 build 891 rejection 2026-06-10. */}
        {!nameFromOAuth && (
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
        )}

        {/* Username (帳號) — a clearly SEPARATE thing from the name
            above. Labelled + rendered as the public profile URL
            "pikt.ag/<handle>" with an inline prefix, so it can never be
            misread as a second name field (the "looks like two accounts"
            confusion the founder caught 2026-06-05). Auto-lowercased +
            char-filtered on input; live-checked against the RPC. */}
        <Text style={styles.fieldLabel}>
          {t('auth.onboarding.usernameLabel', { defaultValue: '你的 PikTag 帳號' })}
        </Text>
        <View style={styles.usernameField}>
          <Text style={styles.usernamePrefix}>pikt.ag/</Text>
          <TextInput
            ref={usernameInputRef}
            style={styles.usernameInput}
            value={username}
            onChangeText={(v) => setUsername(normalizeUsername(v))}
            placeholder={t('editProfile.usernamePlaceholder', { defaultValue: '你的帳號' })}
            placeholderTextColor={colors.gray400}
            maxLength={USERNAME_MAX}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
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
              {t('auth.onboarding.usernameAvailable', { defaultValue: '可使用' })}
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

        {/* (Card-scan accelerator removed 2026-06-05 — strictly linear,
            type-only first step: avatar + name + username, nothing else.) */}

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
    // Birthday required when shown (founder 2026-06-11). hasBirthday
    // short-circuits for accounts that already have one (field hidden).
    const birthdayValid = hasBirthday || !!toBirthdayDate(birthday);
    const tagsStepValid =
      selectedTags.length >= MIN_ONB_TAGS && bio.trim().length > 0 && birthdayValid;
    const ctaDisabled = saving || !tagsStepValid;
    return (
      <ScrollView
        contentContainerStyle={styles.profileContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepHeader(2, () => setStep(STEP_PROFILE))}

        <Text style={styles.profileTitle}>
          {/* 2026-06-10 (founder, Zuckerberg-standard copy pass): don't ask
              users to DEFINE themselves (philosophy) — ask them to imagine
              being SEARCHED for (concrete social scenario). */}
          {t('auth.onboarding.tagsTitle', { defaultValue: '讓別人搜得到你' })}
        </Text>
        <Text style={styles.profileSubtitle}>
          {t('auth.onboarding.tagsSubtitle', { defaultValue: '朋友需要「你這種人」的時候，會搜什麼詞？' })}
        </Text>

        {/* Headline (職稱) — optional. Label keeps the field identity +
            the 選填 marker; the placeholder is the rotating 5-example
            carousel (shared with EditProfile). */}
        <Text style={styles.fieldLabel}>
          {t('auth.onboarding.headlineLabel', { defaultValue: '職稱（選填）' })}
        </Text>
        <TextInput
          style={styles.nameInput}
          value={headline}
          onChangeText={setHeadline}
          placeholder={headlinePlaceholder}
          placeholderTextColor={colors.gray400}
          maxLength={50}
          returnKeyType="next"
        />

        {/* Bio — required (feeds AI tag suggestions + matching).
            Rotating 5-example placeholder. */}
        <Text style={styles.fieldLabel}>
          {t('auth.onboarding.bioLabel', { defaultValue: '一句話介紹自己' })}
        </Text>
        <TextInput
          style={[styles.nameInput, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder={bioPlaceholder}
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
            defaultValue:
              '把那些詞加上就對了：工作（#會計師）、興趣（#攝影）、正在做的事（#找工作）。之後有人搜這些詞，出現的就是你。',
          })}
        </Text>

        {/* AI tag recommendation = PikTag's SIGNATURE feature, and the
            user's first encounter with it. Tier-1 GRADIENT (founder
            2026-06-07): a DIFFERENT role from the solid-piktag500 "完成"
            commit at the footer, so the page never shows two same-looking
            CTAs — gradient says "this is the PikTag magic", solid says
            "finish". White BoltIcon (the app-wide "from AI" cue, aligned
            from Sparkles) on the gradient. The old light-purple
            scanCardBtn tier is retired. */}
        <GradientButton
          label={
            aiTried
              ? t('auth.onboarding.aiMore', { defaultValue: '再推薦一些' })
              : t('auth.onboarding.aiSuggest', { defaultValue: '讓 AI 推薦標籤' })
          }
          onPress={loadAiSuggestions}
          loading={aiLoading}
          loadingLabel={t('auth.onboarding.aiThinking', { defaultValue: 'AI 想標籤中…' })}
          icon={<BoltIcon size={18} color="#FFFFFF" strokeWidth={2} />}
          style={{ marginTop: 16 }}
        />

        {aiSuggestions.length > 0 && (
          <>
            <Text style={styles.aiPickLabel}>
              {t('auth.onboarding.aiPickHint', { defaultValue: '點選想加入的標籤' })}
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

        {/* Birthday — optional (CRM core), but ONLY for accounts that
            don't already have one (OAuth signups skip RegisterScreen;
            email signups entered it there — never ask twice. Founder
            2026-06-11). Masked MM/DD input, locale-ordered. */}
        {!hasBirthday && (
          <>
            <Text style={styles.fieldLabel}>
              {t('auth.onboarding.birthdayLabel', { defaultValue: '生日' })}
            </Text>
            <BirthdayInput
              value={birthday}
              onChange={setBirthday}
              style={styles.nameInput}
            />
          </>
        )}

        <View style={{ flex: 1, minHeight: 24 }} />

        {!tagsStepValid && (
          <Text style={styles.gateHint}>
            {selectedTags.length < MIN_ONB_TAGS
              ? t('auth.onboarding.tagsGateHint', {
                  count: MIN_ONB_TAGS,
                  defaultValue: '至少 {{count}} 個——標籤越多，越容易被找到',
                })
              : !bio.trim()
                ? t('auth.onboarding.bioGateHint', { defaultValue: '寫一句自我介紹再繼續' })
                : t('auth.onboarding.birthdayGateHint', { defaultValue: '填一下生日，朋友才收得到你的生日提醒' })}
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
          <>
            <View style={styles.tagInputRow}>
              {linkPlatform === 'phone' ? (
                // Phone uses the shared country-code dropdown + national
                // field — same component AND stored format (tel:+886…) as
                // EditProfile, so the two screens no longer drift.
                <View style={{ flex: 1 }}>
                  <PhoneNumberInput
                    country={phoneCountry}
                    national={phoneNational}
                    onChangeCountry={setPhoneCountry}
                    onChangeNational={(v) => {
                      setPhoneNational(v);
                      if (addLinkError) setAddLinkError(null);
                    }}
                    onSubmitEditing={addLink}
                    autoFocus
                  />
                </View>
              ) : (
                <TextInput
                  style={styles.tagInputField}
                  value={linkInput}
                  onChangeText={(v) => {
                    setLinkInput(v);
                    // Clear stale error the moment the user edits — keeps the
                    // hint from lingering after they've started fixing it.
                    if (addLinkError) setAddLinkError(null);
                  }}
                  placeholder={PLATFORM_MAP[linkPlatform]?.placeholder ?? ''}
                  placeholderTextColor={colors.gray400}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="default"
                  returnKeyType="done"
                  onSubmitEditing={addLink}
                  autoFocus
                />
              )}
              <TouchableOpacity
                style={[
                  styles.tagAddBtn,
                  (linkPlatform === 'phone' ? !phoneNational.trim() : !linkInput.trim()) &&
                    styles.tagAddBtnDisabled,
                ]}
                onPress={addLink}
                disabled={linkPlatform === 'phone' ? !phoneNational.trim() : !linkInput.trim()}
                accessibilityRole="button"
                accessibilityLabel={t('manageTags.addTag', { defaultValue: '新增' })}
              >
                <Plus size={20} color="#FFFFFF" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
            {addLinkError && (
              <Text style={styles.addLinkErrorText}>{addLinkError}</Text>
            )}
          </>
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
              defaultValue: '再加 {{count}} 個——別人掃到你，才有辦法聯絡你',
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

  // ─── Render: payoff (STEP_DONE) ──────────────────────────
  // The bridge from "I filled a form" to "this is my card — people scan
  // it and we're connected". Reuses the shared QrNameCard on the locked
  // brand gradient (same doctrine as QrCodeModal / QrGroupDetail: fixed
  // colours, theme-agnostic). ONE button (tier-2 solid commit — the QR
  // card itself is the wow; no gradient button next to a gradient sheet).
  const renderDone = () => (
    <ScrollView
      contentContainerStyle={styles.doneScroll}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.doneTitle}>
        {t('auth.onboarding.payoffTitle', { defaultValue: '完成！' })}
      </Text>
      <Text style={styles.doneSubtitle}>
        {t('auth.onboarding.payoffSubtitle', { defaultValue: '這就是別人掃到你的樣子' })}
      </Text>
      <LinearGradient
        colors={['#ff5757', '#c44dff', '#8c52ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.doneGradient}
      >
        <QrNameCard
          qrValue={buildProfileUrl(username.trim())}
          handle={username.trim()}
          name={displayName.trim()}
          tags={selectedTags.map((tg) => tg.name)}
        />
      </LinearGradient>
      <Text style={styles.doneHint}>
        {t('auth.onboarding.payoffHint', {
          defaultValue: '下次見面，請對方掃這裡，立刻互加好友',
        })}
      </Text>
      <TouchableOpacity
        style={styles.doneCta}
        onPress={finishOnboarding}
        activeOpacity={0.85}
      >
        <Text style={styles.doneCtaText}>
          {t('auth.onboarding.payoffCta', { defaultValue: '開始使用 PikTag' })}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {step === STEP_PROFILE
        ? renderProfile()
        : step === STEP_TAGS
          ? renderTags()
          : step === STEP_LINKS
            ? renderLinks()
            : renderDone()}

      {/* Celebration burst plays over the payoff step after handleComplete
          succeeds. It no longer drives navigation — the payoff CTA does —
          so on animation end we just hide it. */}
      <OnboardingCompleteBurst
        visible={burstVisible}
        userName={burstUserName}
        onComplete={() => setBurstVisible(false)}
      />

      {/* (Business-card confirmation sheet removed 2026-06-05 — no
          card-scan accelerator in the linear onboarding funnel.) */}
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

  // (Welcome-screen styles removed 2026-06-05 with the welcome interstitial.)

  // ── Payoff (STEP_DONE) ──
  doneScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: SPACING.xxl,
  },
  doneTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: c.gray900,
    textAlign: 'center',
  },
  doneSubtitle: {
    fontSize: 15,
    color: c.gray600,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  doneGradient: {
    borderRadius: 24,
    padding: 20,
    alignSelf: 'stretch',
  },
  doneHint: {
    fontSize: 13,
    color: c.gray500,
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 19,
  },
  // Locked tier-2 commit CTA (saveBtn token): solid piktag500, white
  // text intentionally fixed regardless of theme.
  doneCta: {
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  doneCtaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
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
    // Left-aligned (no textAlign:center) so every field's text +
    // placeholder lines up consistently with the left-aligned tag /
    // link inputs (founder, 2026-06-05: 統一靠左).
    marginTop: 12,
  },
  // Field label (e.g. "你的 PikTag 帳號") — left-aligned so the 帳號
  // section reads as a distinct, explained field, never a second name.
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: c.gray600,
    alignSelf: 'stretch',
    marginTop: 18,
    marginBottom: 6,
  },
  // Username box: same chrome as nameInput but a row with a fixed
  // "pikt.ag/" prefix so it unmistakably reads as the profile URL.
  usernameField: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  usernamePrefix: {
    fontSize: 18,
    color: c.gray400,
  },
  usernameInput: {
    flex: 1,
    fontSize: 18,
    color: c.gray900,
    padding: 0,
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
  // alignItems:'stretch' so the "+" button matches whatever height the
  // input resolves to — keeps the row internally aligned now that the
  // input shares nameInput's metrics.
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 14,
  },
  // Same metrics as nameInput (fontSize 18 / padV 14 / padH 16) so every
  // single-line field in the wizard — 職稱 / 生日 / 輸入標籤 / 連結 —
  // renders at the SAME row height (founder, 2026-06-05).
  tagInputField: {
    flex: 1,
    fontSize: 18,
    color: c.gray900,
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  // No fixed height — stretches to the input's height via the row's
  // alignItems:'stretch'.
  tagAddBtn: {
    width: 46,
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
  addLinkErrorText: {
    fontSize: 13,
    color: c.red500,
    marginTop: 6,
    marginLeft: 4,
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

  // (scanCardBtn / scanCardBtnText removed 2026-06-07 — the AI-suggest
  //  button is now the shared tier-1 GradientButton, not a light-purple
  //  pill.)
  });
}
