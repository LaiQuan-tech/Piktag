import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Modal,
  Share,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Share2, Trash2, ScanLine, Copy, Pencil, Plus, RefreshCw, ArrowLeft } from 'lucide-react-native';
import BoltIcon from '../components/BoltIcon';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QrShareBody from '../components/QrShareBody';
import SectionTitle from '../components/SectionTitle';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { recordAiSuggestions, markAiSuggestionAccepted, markAiSuggestionDismissed } from '../lib/aiTagLogger';
import LocationPickerModal from '../components/LocationPickerModal';
import { useAuth } from '../hooks/useAuth';
import { useRotatingPlaceholder } from '../hooks/useRotatingPlaceholder';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { getLocales } from 'expo-localization';
import {
  requestForegroundPermissionsAsync,
  getCurrentPositionAsync,
  Accuracy,
  reverseGeocodeAsync,
} from 'expo-location';
import { logApiUsage } from '../lib/apiUsage';
import { normalizeTagName } from '../lib/normalizeTag';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import TagChip from '../components/TagChip';
import type { TagPreset, ScanSession, PiktagProfile } from '../types';


type AddTagScreenProps = {
  navigation: any;
};

// Canonical storage format (YYYY/MM/DD). This value is what we push to the
// DB's `event_date` column and what we compare against in state, so it MUST
// stay locale-independent. Display formatting is separate — see below.
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// Locale-aware display format for the quick-date buttons. Reads device
// locale from expo-localization so each user sees their regional ordering
// (US: 04/17/2026, UK: 17/04/2026, TW/JP: 2026/04/17, etc.).
function formatDateDisplay(date: Date): string {
  const locale = getLocales()?.[0]?.languageTag || 'zh-TW';
  try {
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    // Fallback if the runtime's Intl can't handle the tag (older Hermes).
    return formatDate(date);
  }
}

function getQuickDates(): { label: string; date: Date }[] {
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  return [
    { label: `#${formatDateDisplay(today)}`, date: today },
    { label: `#${formatDateDisplay(tomorrow)}`, date: tomorrow },
  ];
}

export default function AddTagScreen({ navigation }: AddTagScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Rotating "what's this QR for?" placeholder — same calibrated
  // hook as SearchScreen's search box, for a consistent
  // intent-input feel across the app. Cycles occasion examples
  // (龍洞潛水揪團 / 創業者週末聚會 …) so the user learns by
  // example what to type. Falls back to the old static line if
  // the hint array is missing in a locale. Hook is called at
  // component scope (Rules of Hooks) and read inside renderSetupMode.
  const contextHints = useMemo(() => {
    const raw = t('addTag.contextPromptHints', { returnObjects: true });
    return Array.isArray(raw) && raw.length > 0 ? (raw as string[]) : null;
  }, [t]);
  const contextPlaceholder = useRotatingPlaceholder(
    contextHints,
    t('addTag.contextPlaceholder', { defaultValue: '例如：週末聚餐、客戶 demo、新書發表會' }),
  );

  // Mode: 'setup' or 'qr'
  const [mode, setMode] = useState<'setup' | 'qr'>('setup');

  // Setup form state
  const [eventDate, setEventDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDateObj, setSelectedDateObj] = useState(new Date());
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [eventLocation, setEventLocation] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [eventTags, setEventTags] = useState<string[]>([]);
  // Every selected tag (manual input OR an AI-suggestion tap) is the
  // user's own curation — show them all as removable chips. The old
  // "熱門標籤 / previously-used" quick-pick row was removed: those
  // tags belong to a PAST event/context (for a similar context the
  // host should just reuse that QR), and the row buried the CTA.
  const manualTags = eventTags;
  const [tagInput, setTagInput] = useState('');

  // Save preset
  const [showPresetNameInput, setShowPresetNameInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [showPresetNameModal, setShowPresetNameModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');

  // Track which preset was applied (for linking scan sessions)
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);

  // QR / session state
  const [qrValue, setQrValue] = useState('');
  const [qrUsername, setQrUsername] = useState('');
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [generating, setGenerating] = useState(false);
  // (First-QR celebration sheet removed — it interrupted the
  // just-created-a-QR moment with a modal that duplicated the
  // share buttons already on the QR screen and re-pitched bio
  // setup, which onboarding's card-scan path now covers. Same
  // "一期一會, don't interrupt" call as dropping the Gather-the-
  // Tribe button. The piktag_first_qr_celebrated_v1 AsyncStorage
  // flag is intentionally left unread — old installs keep it,
  // it's harmless, and never writing it again means a future
  // re-introduction wouldn't mis-fire on existing users.)

  // Task 3 — AI-driven tag suggestions for QR groups.
  //
  // Replaces the old date/location pickers with a single freeform
  // context input + ambient signals (GPS, time, viewer identity).
  // The user types "週末聚餐" and AI returns 6-10 tag chips that
  // make sense for the situation. Tap chips to add to eventTags.
  //
  // State:
  //   contextDescription  user's freeform "what is this QR for"
  //   aiLocation          reverse-geocoded place name (e.g. "Taipei")
  //   aiSuggestions       AI-returned tag names (without #)
  //   aiLoading           single-flight flag
  //   aiContext           cached "what we last sent to AI", used to
  //                       avoid re-firing for the same prompt
  const [contextDescription, setContextDescription] = useState('');
  // aiLocation     = primary place name ("Las Vegas Convention Center")
  // aiLocationDetail = multi-level joined ("Las Vegas Convention Center,
  //                    Las Vegas, Nevada, USA") so AI can suggest the
  //                    city + state + country individually if useful.
  // popularNearby  = top tags other PikTag hosts have used at this
  //                  location in the last 90 days — AI grounding so
  //                  the CES scenario surfaces #CES2026 etc rather
  //                  than the LLM hallucinating.
  const [aiLocation, setAiLocation] = useState<string>('');
  const [aiLocationDetail, setAiLocationDetail] = useState<string>('');
  const [popularNearby, setPopularNearby] = useState<string[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  // Principle #5 — AI confidence calibration log. Each batch of
  // suggestions shown to the user gets recorded server-side so we can
  // later plot position-in-list vs accept rate. Map tag_name → row id
  // so when the user taps a chip we can flip its accepted flag.
  const [aiSuggestionIds, setAiSuggestionIds] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [viewerBio, setViewerBio] = useState('');
  const [viewerTagNames, setViewerTagNames] = useState<string[]>([]);

  // Presets modal
  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [presets, setPresets] = useState<TagPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);

  const PRESETS_KEY = 'piktag_user_presets';

  // ─── Load presets (local-first, Supabase sync) ───
  const loadPresets = useCallback(async () => {
    if (!user?.id) return;
    setLoadingPresets(true);
    try {
      // 1. Load from AsyncStorage first (instant, always works)
      const stored = await AsyncStorage.getItem(PRESETS_KEY);
      const localPresets: TagPreset[] = stored ? JSON.parse(stored) : [];
      setPresets(localPresets);
      // Local data ready → unblock the UI immediately
      setLoadingPresets(false);

      // 2. Try Supabase in background — if it returns data, merge & update
      try {
        const { data } = await supabase
          .from('piktag_tag_presets')
          .select('id, user_id, name, location, tags, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          const merged = data as TagPreset[];
          const dbIds = new Set(merged.map(p => p.id));
          for (const lp of localPresets) {
            if (!dbIds.has(lp.id)) merged.push(lp);
          }
          setPresets(merged);
          await AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(merged));
        }
      } catch {
        // Supabase sync failed — local data is already displayed, no action needed
      }
    } catch (err) {
      console.warn('[AddTag] loadPresets:', err);
    }
  }, [user]);

  useEffect(() => {
    // Cancelled-flag pattern for unmount safety. All async callbacks in
    // this effect check `cancelled` before calling setState to avoid
    // "setState on unmounted component" warnings if the user navigates
    // away before the AsyncStorage reads / Supabase queries resolve.
    let cancelled = false;
    if (user) {
      loadPresets();
      // Load cached QR for offline use
      AsyncStorage.getItem('piktag_last_qr').then(val => {
        if (cancelled || !val) return;
        try {
          const cached = JSON.parse(val);
          if (cached.url && !qrValue) {
            setQrValue(cached.url);
            // NOTE: deliberately NOT restoring cached.date /
            // cached.location anymore. They're remnants from the
            // legacy date/location-picker flow — under the new
            // AI-driven UI the user doesn't see those pickers, so
            // restoring values from a previous session leaks ghost
            // tags onto the current QR's display (user reported
            // "I didn't pick those, why are they here?").
            // event_tags are kept because the user DID explicitly
            // tap chips to add them — that's their intent.
            if (cached.tags) setEventTags(cached.tags);
          }
        } catch {}
      });
      // Load recent locations
      AsyncStorage.getItem('piktag_recent_locations').then(val => {
        if (cancelled || !val) return;
        setRecentLocations(JSON.parse(val));
      });
    }
    return () => { cancelled = true; };
  }, [user, loadPresets]);

  const saveToRecent = (name: string) => {
    setRecentLocations(prev => {
      const next = [name, ...prev.filter(l => l !== name)].slice(0, 2);
      AsyncStorage.setItem('piktag_recent_locations', JSON.stringify(next));
      return next;
    });
  };

  const handleRemoveRecentLocation = (name: string) => {
    setRecentLocations(prev => {
      const next = prev.filter(l => l !== name);
      AsyncStorage.setItem('piktag_recent_locations', JSON.stringify(next));
      return next;
    });
  };

  const handleLocationSelected = (placeName: string, _address: string) => {
    setEventLocation(placeName);
    saveToRecent(placeName);
  };

  // ─── Add tag ───
  const handleAddTag = () => {
    // Was `tagInput.trim()` with NO '#' strip → typing "#design"
    // stored the literal "#design" and rendered "##design", a
    // distinct broken tag vs the same tag added elsewhere. Use the
    // shared normalizer so every entry point produces one identity.
    const trimmed = normalizeTagName(tagInput);
    if (!trimmed) return;
    if (eventTags.includes(trimmed)) {
      Alert.alert(t('addTag.alertTagExists'), t('addTag.alertTagExistsMessage'));
      return;
    }
    setEventTags((prev) => [...prev, trimmed]);
    setTagInput('');
  };

  // ─── AI tag suggestions (task 3) ──────────────────────────────
  //
  // On mount: load viewer's identity (bio + public tags) and try to
  // reverse-geocode current GPS to a place name. Both feed AI as
  // ambient context so the suggestions reflect WHO is making this
  // QR + WHERE they are.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        const { data: profile } = await supabase
          .from('piktag_profiles')
          .select('bio, headline, full_name')
          .eq('id', user.id)
          .maybeSingle();
        if (!cancelled && profile) {
          setViewerBio(
            [profile.bio, profile.headline, profile.full_name]
              .filter(Boolean)
              .join(' · '),
          );
        }
        const { data: ut } = await supabase
          .from('piktag_user_tags')
          .select('piktag_tags(name)')
          .eq('user_id', user.id)
          .eq('is_private', false)
          .limit(10);
        if (!cancelled && Array.isArray(ut)) {
          const names = ut
            .map((row: any) => row?.piktag_tags?.name)
            .filter(Boolean) as string[];
          setViewerTagNames(names);
        }
      } catch (err) {
        console.warn('[AddTag] viewer identity fetch failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    // GPS → reverse-geocode → primary place + multi-level joined
    // string. Fire once on mount; if the user denies permission we
    // silently fall back to no-location context (AI still works on
    // bio + description).
    //
    // Then with the primary place, fetch popular_tags_near_location
    // — what other PikTag hosts have used as event_tags in this
    // area in the last 90 days. These get passed to the AI as
    // grounding so suggestions stay anchored in real usage instead
    // of being made up.
    let cancelled = false;
    (async () => {
      try {
        const { status } = await requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await getCurrentPositionAsync({ accuracy: Accuracy.Balanced });
        const places = await reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (cancelled) return;
        const first = places[0];
        if (!first) return;

        const primary =
          first.name ||
          first.district ||
          first.subregion ||
          first.city ||
          first.region ||
          '';

        // Multi-level: build a deduped, ordered list of levels.
        // Closest-to-user first, then broadening. Drop duplicates
        // because reverseGeocode often returns the same string
        // across multiple fields (e.g. name === city for landmarks).
        const levels = Array.from(
          new Set(
            [
              first.name,
              first.district,
              first.subregion,
              first.city,
              first.region,
              first.country,
            ].filter((s): s is string => !!s && s.trim().length > 0),
          ),
        );
        const detail = levels.join(', ');

        if (primary) setAiLocation(primary);
        if (detail) setAiLocationDetail(detail);

        // popular_tags_near_location uses lenient ILIKE matching
        // against scan_sessions.event_location — won't blow up on
        // unfamiliar areas (returns empty array if no matches).
        if (primary) {
          try {
            const { data: popData } = await supabase.rpc(
              'popular_tags_near_location',
              { p_location: primary, p_limit: 10 },
            );
            if (cancelled) return;
            const popNames = Array.isArray(popData)
              ? (popData as Array<{ name: string }>)
                  .map((r) => r.name)
                  .filter(Boolean)
              : [];
            setPopularNearby(popNames);
          } catch {
            /* RPC missing or RLS — non-fatal */
          }
        }
      } catch {
        /* GPS failures are non-fatal — AI just gets less context */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAiSuggestions = useCallback(async (force = false) => {
    if (!user) return;
    // Build context blob. We pass:
    //   bio       = viewer's identity (bio + headline + name) +
    //               their existing public tags — so AI knows "who's
    //               creating this QR"
    //   name      = the freeform context description (what's the
    //               situation) + current time hint (今天是週六晚上)
    //   location  = reverse-geocoded place name
    //   existingTags = tags already selected on this QR (so AI
    //               doesn't repeat them)
    //   lang      = device script auto-detect (matches EditProfile)
    const desc = contextDescription.trim();
    const tagsBlob = viewerTagNames.join(', ');
    const identity = [viewerBio, tagsBlob].filter(Boolean).join(' · ');
    if (!identity && !desc && !aiLocation) return;
    // Date only (per user spec — drop hour/minute). Used so AI can
    // surface season / year / event-of-the-week tags like #Jan2026.
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateOnly = `${yyyy}-${mm}-${dd}`;
    const contextKey = `${identity}|${desc}|${aiLocationDetail || aiLocation}|${eventTags.join(',')}|${popularNearby.join(',')}|${dateOnly}`;
    // `force` = explicit "重新推薦" tap — bypass the unchanged-context
    // cache guard, otherwise the button is a visible no-op (looked
    // broken). Auto-callers pass nothing and keep the cache.
    if (!force && contextKey === aiContext && aiSuggestions.length > 0) return;
    setAiContext(contextKey);
    setAiLoading(true);
    try {
      const userLang = (desc + identity).match(/[一-鿿]/) ? '繁體中文' :
        (desc + identity).match(/[぀-ヿ]/) ? '日本語' :
        (desc + identity).match(/[가-힯]/) ? '한국어' :
        (desc + identity).match(/[฀-๿]/) ? 'ภาษาไทย' : 'the same language as the content';
      logApiUsage('gemini_generate', { via: 'edge-fn:qr-group' });
      const { data, error } = await supabase.functions.invoke<{
        suggestions?: string[];
      }>('suggest-tags', {
        body: {
          bio: identity,
          name: desc,
          location: aiLocation,
          locationDetail: aiLocationDetail,
          date: dateOnly,
          popularNearby: popularNearby.join(', '),
          existingTags: eventTags.join(', '),
          lang: userLang,
        },
      });
      if (error) {
        console.warn('[AddTag] AI suggest-tags error:', error.message);
        setAiSuggestions([]);
        return;
      }
      const raw = Array.isArray(data?.suggestions) ? data!.suggestions : [];
      const cleaned = Array.from(
        new Set(
          raw
            .map((n) => (typeof n === 'string' ? n.replace(/^#/, '').trim() : ''))
            .filter(Boolean)
            .filter((n) => !eventTags.includes(n)),
        ),
      ).slice(0, 10);

      // Guaranteed-selectable date + location tags.
      //
      // The suggest-tags prompt already ASKS the model for a date
      // tag and a location tag, but an LLM is probabilistic — for a
      // hard product requirement ("the chip strip must ALWAYS offer
      // at least one date tag and at least one location tag") asking
      // nicely isn't enough. So we synthesise them deterministically
      // here and merge them to the FRONT, then slice. This makes the
      // guarantee independent of model compliance.
      //
      //   • Date: always available (computed from `now`). Format
      //     mirrors this screen's existing quick-date chips
      //     (getQuickDates → "#2026/05/16"), so it reads as the
      //     same kind of tag, not a foreign format.
      //   • Location: only when we actually have a GPS-derived
      //     signal. We deliberately do NOT fabricate a location
      //     when GPS is denied/unavailable — a wrong location tag
      //     is worse than none. It auto-appears on the next
      //     re-fire once aiLocation resolves (it's in the effect
      //     deps), or when the user taps refresh.
      const guaranteed: string[] = [`${yyyy}/${mm}/${dd}`];
      const locRaw = (aiLocation || aiLocationDetail.split(',')[0] || '').trim();
      const locTag = locRaw.replace(/\s+/g, '');
      if (locTag) guaranteed.push(locTag);

      const merged = Array.from(new Set([...guaranteed, ...cleaned]))
        .filter((n) => !eventTags.includes(n))
        .slice(0, 10);
      setAiSuggestions(merged);
      // Principle #5: log every shown suggestion for calibration.
      // Fire-and-forget — never blocks the UI even on RPC failure.
      // `position_in_list` is preserved by RPC (uses array index),
      // so the first-listed suggestion gets position 0 = highest
      // confidence proxy until Gemini returns real confidence.
      void (async () => {
        const ids = await recordAiSuggestions('suggest_tags_rpc', merged, {
          context_description: contextKey.slice(0, 200),
          location: aiLocation || null,
        });
        if (ids.length === merged.length) {
          const map: Record<string, string> = {};
          merged.forEach((name, i) => {
            map[name] = ids[i];
          });
          setAiSuggestionIds(map);
        }
      })();
    } catch (err) {
      console.warn('[AddTag] AI suggest-tags exception:', err);
      setAiSuggestions([]);
    } finally {
      setAiLoading(false);
    }
  }, [user, contextDescription, aiLocation, aiLocationDetail, popularNearby, viewerBio, viewerTagNames, eventTags, aiContext, aiSuggestions.length]);

  // Auto-fire AI suggestions when context settles. Debounced so
  // typing in the description input doesn't hammer the edge fn.
  // popularNearby is in the dep list so the suggestions refresh
  // once the popular-tags RPC resolves (it may complete after the
  // initial GPS / identity fetches).
  useEffect(() => {
    const id = setTimeout(() => {
      if (viewerBio || contextDescription.trim() || aiLocation) {
        loadAiSuggestions();
      }
    }, 900);
    return () => clearTimeout(id);
  }, [contextDescription, aiLocation, aiLocationDetail, popularNearby, viewerBio, viewerTagNames.length, loadAiSuggestions]);

  // ─── Remove tag ───
  // Principle #6 wire-up: if the removed tag came from an AI
  // suggestion in THIS session (we still have its suggestion_id
  // in the aiSuggestionIds map), log the user's accept-then-undo
  // as an explicit dismissal. Strongest dismiss signal we get —
  // user tried it, decided no, walked it back. Stronger than
  // "never accepted" (which could just mean "didn't notice").
  const handleRemoveTag = (tag: string) => {
    setEventTags((prev) => prev.filter((t) => t !== tag));
    const id = aiSuggestionIds[tag];
    if (id) void markAiSuggestionDismissed(id);
  };

  // ─── Save preset ───
  const handleSavePreset = () => {
    if (!user) return;
    setPresetNameInput('');
    setShowPresetNameModal(true);
  };

  const handleConfirmSavePreset = async () => {
    if (!presetNameInput.trim() || !user) return;
    setSavingPreset(true);
    setShowPresetNameModal(false);

    const now = new Date().toISOString();
    // Build a local preset object — always persisted to AsyncStorage even
    // if Supabase is unreachable or RLS blocks the write.
    const localPreset: TagPreset = {
      id: `local_${Date.now()}`,
      user_id: user.id,
      name: presetNameInput.trim(),
      location: eventLocation || '',
      tags: eventTags.length > 0 ? eventTags : [],
      created_at: now,
      last_used_at: now,
    };

    try {
      // Try Supabase — if it works, use the DB-generated row (real UUID, etc.)
      const { data } = await supabase
        .from('piktag_tag_presets')
        .insert({
          user_id: user.id,
          name: localPreset.name,
          location: localPreset.location,
          tags: localPreset.tags,
          created_at: now,
        })
        .select('id')
        .single();

      if (data) {
        localPreset.id = data.id; // replace local id with real DB id
      }
    } catch {
      // Supabase failed — we still save locally below
    }

    // Always persist to local state + AsyncStorage
    setPresets((prev) => {
      const updated = [localPreset, ...prev];
      AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
      return updated;
    });
    Alert.alert(t('addTag.alertPresetSavedTitle'), t('addTag.alertPresetSavedMessage', { name: localPreset.name }));
    setSavingPreset(false);
  };

  // ─── Apply preset ───
  const handleApplyPreset = async (preset: TagPreset) => {
    setEventLocation(preset.location || '');
    setEventTags(preset.tags || []);
    setAppliedPresetId(preset.id);
    setShowPresetsModal(false);

    // Update last_used_at
    try {
      await supabase
        .from('piktag_tag_presets')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', preset.id);
    } catch {
      // ignore
    }

    // Directly generate QR — "使用" not just "套用"
    setTimeout(() => handleGenerateQr(), 100);
  };

  // ─── Delete preset ───
  const handleDeletePreset = async (id: string) => {
    if (!user?.id) return;
    setDeletingPresetId(id);
    try {
      // Try DB delete (may fail if local-only preset or DB issue)
      if (!id.startsWith('local_')) {
        await supabase
          .from('piktag_tag_presets')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);
      }

      // Always remove from local state + AsyncStorage
      setPresets((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch {
      Alert.alert(t('common.error'), t('addTag.alertPresetDeleteError'));
    } finally {
      setDeletingPresetId(null);
    }
  };

  // ─── Generate QR Code ───
  const handleGenerateQr = async () => {
    if (!user) return;
    setGenerating(true);
    try {
      // 1. Fetch user profile for display name
      const { data: profileData } = await supabase
        .from('piktag_profiles')
        .select('full_name, username')
        .eq('id', user.id)
        .single();

      const displayName =
        (profileData as PiktagProfile | null)?.full_name ||
        (profileData as PiktagProfile | null)?.username ||
        t('addTag.defaultDisplayName');

      // 2. Try to create a scan session in DB (graceful fallback if table doesn't exist)
      let sessionId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Only the row's `id` is consumed downstream (see the
      // `.eq('id', sessionData.id)` lookup further down). Typing this
      // narrowly avoids the historical mismatch where the `.select(...)`
      // projection diverged from the full `ScanSession` shape and TS
      // complained about missing fields we never actually used.
      let sessionData: { id: string } | null = null;

      try {
        // event_date is `date` in Postgres — it accepts a YYYY-MM-DD
        // string OR null, but NOT "". The new AI-driven flow often
        // leaves eventDate as an empty string (no explicit date
        // picker anymore), which previously fired Postgres error
        // 22007 ("invalid input syntax for type date") and got
        // silently swallowed → QR appeared to "save" but the row
        // was never written. Coerce empty → null here.
        //
        // event_location is `text` so "" is technically valid, but
        // we coerce to null for consistency: empty string and "no
        // location" are semantically the same thing in this flow.
        const dateForDb = eventDate?.trim() ? eventDate.trim() : null;
        const locationForDb = eventLocation?.trim() ? eventLocation.trim() : null;

        const { data, error } = await supabase
          .from('piktag_scan_sessions')
          .insert({
            host_user_id: user.id,
            preset_id: appliedPresetId,
            event_date: dateForDb,
            event_location: locationForDb,
            event_tags: eventTags,
            qr_code_data: '', // placeholder
            is_active: true,
            // Task 2: QRs are persistent groups now. Don't set
            // expires_at — leaving it NULL means the row never
            // expires and can be re-shared any time.
            expires_at: null,
          })
          .select('id')
          .single();

        if (!error && data) {
          sessionId = data.id;
          sessionData = { id: data.id };
        } else if (error) {
          // Surface the failure instead of silently dropping it on the
          // floor. Old behaviour: insert fails → fall back to a local
          // sessionId → user sees a "successfully generated" QR but
          // the row is NEVER written to the DB, so the QR group list
          // stays empty and the user can't diagnose why.
          //
          // We don't block the UX (QR can still be displayed for
          // immediate share), but a console.warn + Alert tells the
          // user this QR won't appear in their event-group list and
          // surfaces the actual Postgres error code so we can debug
          // RLS / NOT-NULL / missing-column failures.
          console.warn('[AddTag] scan_session insert failed:', error);
          Alert.alert(
            t('addTag.saveWarnTitle', { defaultValue: 'QR 已產生，但無法儲存到 Tag' }),
            t('addTag.saveWarnMsg', {
              code: (error as any).code || '?',
              message: error.message,
              defaultValue: `這個 QR 可以馬上分享，但不會出現在你的 Tag 清單中。\n\n錯誤代碼：${(error as any).code || '?'}\n${error.message}`,
            }),
          );
        }
      } catch (err) {
        console.warn('[AddTag] scan_session insert threw:', err);
      }

      // 3. Build QR URL — encode event info as URL params so tags transfer
      //    even if the scan session DB insert failed
      const username = (profileData as PiktagProfile | null)?.username || user.id;
      setQrUsername(username);
      const params = new URLSearchParams();
      params.set('sid', sessionId);
      if (eventTags.length > 0) params.set('tags', eventTags.join(','));
      if (eventDate) params.set('date', eventDate);
      if (eventLocation) params.set('loc', eventLocation);
      const qrUrl = `https://pikt.ag/${username}?${params.toString()}`;

      // 4. Update session in DB if it was created
      if (sessionData) {
        try {
          await supabase
            .from('piktag_scan_sessions')
            .update({ qr_code_data: qrUrl })
            .eq('id', sessionData.id);
        } catch {
          // ignore
        }
      }

      // 5. Set state — build a local ScanSession object for display
      setQrValue(qrUrl);
      // Cache QR code for offline use
      // Cache for offline display — only the URL + user-picked tags.
      // Deliberately NOT caching date/location anymore: they're
      // implicit DB-side context (used by AI grounding) but the
      // user never sees a "set date/location" UI, so persisting
      // them would silently leak ghost tags into the next QR.
      AsyncStorage.setItem('piktag_last_qr', JSON.stringify({ url: qrUrl, tags: eventTags }));
      setScanSession({
        id: sessionId,
        host_user_id: user.id,
        preset_id: null,
        event_date: eventDate,
        event_location: eventLocation,
        event_tags: eventTags,
        qr_code_data: qrUrl,
        scan_count: 0,
        is_active: true,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as ScanSession);
      setMode('qr');
    } catch (err) {
      console.error('QR generation error:', err);
      Alert.alert(t('common.error'), t('addTag.alertQrError'));
    } finally {
      setGenerating(false);
    }
  };

  // ─── Share QR ───
  // 2026-05-26 LINE-style copy refresh: dropped the 4-line "PikTag
  // Social Event / Date / Location / Tags / Scan to join" template
  // in favor of a single friendly sentence + URL inline. The QR
  // image + scan landing page already convey the event details;
  // the share text just needs a tappable hook. URL is interpolated
  // (not just passed as Share.url) so the link is tappable on
  // Android too — Share.url is iOS-only.
  const handleShare = async () => {
    try {
      await Share.share({
        message: t('addTag.shareMessage', { url: qrValue }),
        url: Platform.OS === 'ios' ? qrValue : undefined,
      });
    } catch {
      // user cancelled
    }
  };

  // ─── Copy QR link ───
  const handleCopyLink = async () => {
    if (!qrValue) return;
    try {
      await setClipboardStringAsync(qrValue);
      Alert.alert(t('addTag.alertLinkCopiedTitle', { defaultValue: '已複製' }), t('addTag.alertLinkCopiedMessage', { defaultValue: '連結已複製到剪貼簿' }));
    } catch {
      // no-op
    }
  };

  // ─── Render Setup Mode ───
  const renderSetupMode = () => (
    <>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        {/* Back button — this screen is pushed from QrGroupListScreen,
            so goBack() returns to the list. Previously the only way
            to exit was tapping the # tab icon, which felt like a
            workaround rather than navigation. */}
        <View style={styles.headerLeftGroup}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.6}
            style={styles.headerSideBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', { defaultValue: '返回' })}
          >
            <ArrowLeft size={24} color={colors.gray900} strokeWidth={2.2} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('addTag.headerTitle', { defaultValue: '建立 Tag' })}</Text>
        </View>
        {/* Scan icon previously lived here — moved to the parent
            QrGroupListScreen header (the # tab's landing page) where
            "scan someone else's QR" is a peer action to "create my
            QR", not a buried sub-feature of this create form.
            Preset star button also removed for task 2 — QR codes
            are now persistent groups themselves. */}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Context description — single optional line that
            describes the situation in natural language. AI uses it
            as the strongest signal when generating suggestions.
            "公司週年活動", "週末聚餐", "客戶 demo" 之類。 */}
        <View style={styles.section}>
          <SectionTitle variant="form" style={{ marginBottom: 4 }}>
            {t('addTag.contextLabel', { defaultValue: '這次是什麼場合？' })}
          </SectionTitle>
          <Text style={styles.hiddenTagHint}>
            {t('addTag.contextHint', { defaultValue: '一句話描述就好。AI 會根據你說的、時間和地點推薦標籤，幫你記住在這認識的人。' })}
          </Text>
          <View style={[styles.inputRow, { marginTop: 4 }]}>
            <TextInput
              style={styles.textInput}
              value={contextDescription}
              onChangeText={setContextDescription}
              placeholder={contextPlaceholder}
              placeholderTextColor={colors.gray400}
              returnKeyType="done"
              maxLength={60}
            />
          </View>
        </View>

        {/* AI 推薦標籤 Section — auto-fires after GPS resolves +
            after the context description settles (debounced). Each
            chip taps onto eventTags and disappears from the
            suggestion strip. Refresh icon re-rolls. */}
        <View style={styles.section}>
          <View style={styles.aiHeaderRow}>
            <View style={styles.aiHeaderLeft}>
              {aiLoading ? (
                <BrandSpinner size={16} />
              ) : (
                <BoltIcon size={14} color={colors.piktag600} />
              )}
              <Text style={styles.aiHeaderTitle}>
                {aiLoading
                  ? `${t('addTag.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}…`
                  : t('addTag.aiSuggestionsTitle', { defaultValue: 'AI 為你推薦' })}
              </Text>
            </View>
            {!aiLoading && (
              <View style={styles.aiHeaderActions}>
                {/* "全部加入" button removed — founder: over-confident
                    in AI; users pick a few, not all; the purple-fill
                    pill clashed visually with tag chips. The per-chip
                    tap remains the one accept path. */}
                <TouchableOpacity
                  onPress={() => loadAiSuggestions(true)}
                  activeOpacity={0.7}
                  hitSlop={8}
                  style={styles.aiRefreshBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTag.aiRegenerate', { defaultValue: '重新推薦' })}
                >
                  <RefreshCw size={14} color={colors.piktag600} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          {aiSuggestions.length > 0 ? (
            <View style={styles.popularChipsContainer}>
              {/* Shared TagChip toggle (unselected = gray fill, no
                  border, no ×). Tap = add to eventTags + drop from
                  suggestions. Replaces hand-rolled popularChip so
                  every gray "tap-to-add" pill in the app is one
                  component (founder rule, kills the 1.5dp border
                  drift). */}
              {aiSuggestions.map((s) => (
                <TagChip
                  key={s}
                  label={s}
                  variant="toggle"
                  onPress={() => {
                    setEventTags((prev) => (prev.includes(s) ? prev : [...prev, s]));
                    setAiSuggestions((prev) => prev.filter((x) => x !== s));
                    // Principle #5: mark this suggestion accepted in the
                    // calibration log. Fire-and-forget — the tag is
                    // already added optimistically; logging is best-effort.
                    const id = aiSuggestionIds[s];
                    if (id) void markAiSuggestionAccepted(id);
                  }}
                />
              ))}
            </View>
          ) : aiLoading ? null : aiContext.length > 0 ? (
            // AI actually ran and found nothing — keep this, it's
            // actionable feedback ("try again or add your own").
            <Text style={styles.hiddenTagHint}>
              {t('addTag.aiSuggestionsEmpty', { defaultValue: 'AI 想不到合適的標籤 — 再試一次或自己加。' })}
            </Text>
          ) : null
          /* Pre-input state: render nothing. The old
             aiSuggestionsHint repeated what the section header
             ("這次是什麼場合？" + its sub-line) already says — pure
             redundancy under "AI 為你推薦". The rotating
             placeholder up top already shows what to type. */}
        </View>

        {/* 自訂標籤 Section */}
        <View style={styles.section}>
          <SectionTitle variant="form" style={{ marginBottom: 4 }}>{t('addTag.customTagsLabel')}</SectionTitle>
          <Text style={styles.hiddenTagHint}>{t('addTag.hiddenTagHint', { defaultValue: '這些標籤僅自己可見，幫助你記住在哪認識' })}</Text>

          {/* Chip placement contract: chips ABOVE input — existing
              items first, the input is the action prompt at the
              bottom. UX-grounded (Gmail/Notion/GitHub/iOS native
              all do this), keyboard-friendly (the focused input
              stays visible while chips remain readable above), and
              matches EditProfile / EditLocalContact / QrGroup
              detail. Founder rule across the app. */}
          {manualTags.length > 0 && (
            <View style={styles.chipsContainer}>
              {manualTags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  onRemove={() => handleRemoveTag(tag)}
                />
              ))}
            </View>
          )}

          <View style={styles.tagInputRow}>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <TextInput
                style={styles.textInput}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder={t('addTag.tagPlaceholder')}
                placeholderTextColor={colors.gray400}
                returnKeyType="done"
                onSubmitEditing={handleAddTag}
              />
            </View>
            {/* Plus-icon submit — replaces the prior "新增" / "Add" text
                button. The "+" affordance is what AskStoryRow's create-ask
                badge and RingedAvatar's Plus badge already use, so this
                row now reads as the same "create new" action across the
                app instead of the QR-setup screen looking visually
                different from everywhere else. Round button, fixed 44×44
                tap target so it lines up with the input height. */}
            <TouchableOpacity
              style={styles.addTagBtn}
              onPress={handleAddTag}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('common.add')}
            >
              <Plus size={22} color="#FFFFFF" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 熱門標籤 Section removed: those were the host's tags from
            PAST events/contexts — for a similar context they should
            just reuse that QR — and the row pushed the 產生 QR Code
            CTA below the fold. Less noise, CTA in reach. */}

        {/* 儲存為常用模板 — section removed for task 2 — every QR
            is already a persistent group; templates are redundant. */}

        {/* 產生 QR Code CTA */}
        <View style={styles.section}>
          <TouchableOpacity onPress={handleGenerateQr} activeOpacity={0.8} disabled={generating}>
            <LinearGradient
              colors={['#ff5757', '#c44dff', '#8c52ff']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.primaryButton, generating && { opacity: 0.5 }]}
            >
              {generating ? (
                <BrandSpinner size={20} />
              ) : (
                <Text style={styles.primaryButtonText}>{t('addTag.generateQrButton')}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );

  // ─── Render QR Mode (IG-style gradient + white card + 3 bottom buttons) ───
  const renderQrMode = () => (
    <LinearGradient
      colors={['#ff5757', '#c44dff', '#8c52ff']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.qrGradient}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />
      {/* Top bar: close (left) + scan / save-preset (right) */}
      <View style={[styles.qrTopBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => setMode('setup')} activeOpacity={0.6} style={styles.qrTopBtn}>
          <X size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.qrTopRightRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('CameraScan')}
            activeOpacity={0.6}
            style={styles.qrTopBtn}
          >
            <ScanLine size={24} color="#fff" />
          </TouchableOpacity>
          {/* QR-mode top-right star button removed — task 2 made
              QRs into persistent groups themselves, so saving them
              as "templates" is redundant. */}
        </View>
      </View>

      {/* Shared body (card + bottom pill row). Same component as
          QrCodeModal + QrGroupDetailScreen, so all three sheets stay
          pixel-identical. (task #38 follow-up 2026-05-31 — founder
          ask 「這二個外型類似，但邊寬又不同，可以有一致性嗎」.)
          name={presetName || undefined} surfaces the activity name
          when the user applied a saved preset (matches
          QrGroupDetail's behaviour); empty during a fresh ad-hoc
          create, which correctly skips the name line. */}
      <QrShareBody
        qrValue={qrValue}
        handle={qrUsername}
        name={presetName || undefined}
        tags={eventTags}
        actions={[
          {
            // Order unified 2026-06-03: 複製連結 LEFT, 分享檔案 next,
            // 編輯 last — copy-before-share, same as every QR sheet.
            icon: <Copy size={22} color="#111827" />,
            label: t('addTag.copyLink', { defaultValue: '複製連結' }),
            onPress: handleCopyLink,
          },
          {
            icon: <Share2 size={22} color="#111827" />,
            label: t('addTag.shareFile', { defaultValue: '分享檔案' }),
            onPress: handleShare,
          },
          {
            icon: <Pencil size={22} color="#111827" />,
            label: t('addTag.editQr', { defaultValue: '編輯QRcode' }),
            onPress: () => setMode('setup'),
          },
        ]}
        bottomInset={insets.bottom}
      />
    </LinearGradient>
  );

  // ─── Presets Modal ───
  const renderPresetsModal = () => (
    <Modal
      visible={showPresetsModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowPresetsModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('addTag.presetsModalTitle')}</Text>
            <TouchableOpacity
              onPress={() => setShowPresetsModal(false)}
              activeOpacity={0.6}
              style={styles.headerSideBtn}
            >
              <X size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          {/* Modal body */}
          {/* Hint about long-press to delete */}
          {presets.length > 0 && (
            <Text style={styles.presetHintText}>{t('addTag.longPressToDelete')}</Text>
          )}

          {loadingPresets ? (
            <PageLoader />
          ) : presets.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('addTag.noPresets')}</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.modalScrollView}
              showsVerticalScrollIndicator={false}
            >
              {presets.map((preset) => (
                <TouchableOpacity
                  key={preset.id}
                  style={styles.presetItem}
                  activeOpacity={0.7}
                  onLongPress={() => {
                    Alert.alert(
                      t('addTag.alertDeletePresetTitle'),
                      t('addTag.alertDeletePresetMessage', { name: preset.name }),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('common.delete'),
                          style: 'destructive',
                          onPress: () => handleDeletePreset(preset.id),
                        },
                      ]
                    );
                  }}
                >
                  <View style={styles.presetItemContent}>
                    <Text style={styles.presetItemName}>{preset.name}</Text>
                    {preset.location ? (
                      <Text style={styles.presetItemLocation} numberOfLines={1}>
                        {preset.location}
                      </Text>
                    ) : null}
                    {preset.tags && preset.tags.length > 0 && (
                      <View style={styles.presetTagsPreview}>
                        {preset.tags.slice(0, 4).map((tag) => (
                          <View key={tag} style={styles.presetTagMini}>
                            <Text style={styles.presetTagMiniText}>{tag}</Text>
                          </View>
                        ))}
                        {preset.tags.length > 4 && (
                          <Text style={styles.presetMoreText}>
                            +{preset.tags.length - 4}
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                  <View style={styles.presetItemActions}>
                    {deletingPresetId === preset.id ? (
                      <BrandSpinner size={16} />
                    ) : (
                      <TouchableOpacity
                        style={styles.presetApplyBtn}
                        onPress={() => handleApplyPreset(preset)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.presetApplyBtnText}>{t('addTag.applyPreset')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
      {mode === 'setup' && renderSetupMode()}
      {mode === 'qr' && renderQrMode()}
      {/* mode === 'event' (fullscreen black QR "live mode") was
          removed — it duplicated mode === 'qr' visually and had
          no callable entry point in the current UI. The
          renderQrMode gradient screen is now the canonical
          "show off my QR" surface. */}
      {/* Preset modals removed for task 2. The state hooks
          (showPresetsModal, showPresetNameModal, presets, ...)
          and handlers (handleSavePreset, handleConfirmSavePreset,
          loadPresets, etc.) are left as dead code in this file
          for now to keep the diff focused on UI surfaces — a
          follow-up cleanup commit can rip them out. */}

      {/* First-QR celebration sheet removed — see the note on the
          state declaration. The QR screen's own share/copy/edit
          buttons + the reframed Vibes-tab copy carry the share
          and profile nudges without a flow-interrupting modal. */}
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.white,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.white,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: c.gray900,
    lineHeight: 32,
  },
  headerSideBtn: {
    padding: 4,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 4,
  },
  headerBackText: {
    fontSize: 16,
    fontWeight: '500',
    color: c.gray900,
  },

  // ── Scroll ──
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  qrScrollContent: {
    paddingBottom: 100,
    alignItems: 'center',
  },

  // ── Sections ──
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  // (sectionTitle moved into shared SectionTitle, variant="form".
  // marginBottom:4 applied per call site. task #38.)
  hiddenTagHint: {
    fontSize: 12,
    color: c.gray400,
    marginBottom: 12,
  },

  // ── Input ──
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: c.gray900,
    padding: 0,
  },
  // Quick date buttons
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  quickDateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
    borderWidth: 1.5,
    borderColor: c.piktag200,
    backgroundColor: c.white,
  },
  quickDateBtnActive: {
    borderColor: c.piktag500,
    backgroundColor: c.piktag50,
  },
  quickDateText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.gray600,
  },
  quickDateTextActive: {
    color: c.piktag600,
    fontWeight: '700',
  },
  selectedDateText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray900,
    marginBottom: 4,
  },
  // Calendar
  calendarGrid: {
    marginTop: 8,
    backgroundColor: c.gray50,
    borderRadius: 12,
    padding: 12,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  calendarNav: {
    fontSize: 18,
    fontWeight: '700',
    color: c.gray600,
    paddingHorizontal: 12,
  },
  calendarMonthText: {
    fontSize: 15,
    fontWeight: '700',
    color: c.gray900,
  },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calendarWeekDay: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: c.gray400,
  },
  calendarDaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayInnerSelected: {
    backgroundColor: c.piktag500,
  },
  calendarDayText: {
    fontSize: 14,
    color: c.gray700,
  },
  calendarDayToday: {
    fontWeight: '700',
    color: c.piktag600,
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── Tag input row ──
  // marginTop 14 = breathing room when chips sit above (the
  // standardized layout); when there are no chips yet, the hint
  // text above provides equivalent spacing.
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  // Square 44×44 icon button — matches the textInput height so the row
  // reads as a single horizontal control. Width-fixed (not paddingX) so
  // it doesn't grow when the icon size changes; previously the textual
  // "新增" version sized itself to the label which made the row jiggle
  // when locales swapped to longer translations like "Aggiungi" / "추가".
  addTagBtn: {
    backgroundColor: c.piktag500,
    borderRadius: 14,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Chips ──
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  // added-tag chip → shared <TagChip/> (one design contract)

  // ── AI suggestions header (task 3) ──
  aiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  aiHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Title weight/size + refresh-btn dimensions matched to
  // EditProfileScreen's ai_headerTitle / ai_refreshBtn so all three
  // AI-suggest surfaces (AddTag / EditProfile / AskCreateModal) read
  // as the same component family.
  aiHeaderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag600,
  },
  aiHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // (aiAddAllBtn / aiAddAllText removed with the "全部加入" CTA.)
  aiRefreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.piktag200,
    backgroundColor: c.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Popular tags ──
  popularChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  // (popularChip / *Selected / *Text / *TextSelected removed — AI
  // suggestion chips now render via the shared <TagChip variant=
  // "toggle">; popularChipsContainer is kept as the wrap.)

  // ── Buttons ──
  primaryButton: {
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Event mode button
  qrActionButtons: {
    width: '100%',
    paddingHorizontal: 24,
    gap: 12,
    marginTop: 8,
  },
  eventModeBtn: {
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  eventModeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cameraScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: c.piktag50,
    borderWidth: 1.5,
    borderColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
  },
  cameraScanBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: c.piktag600,
  },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.piktag600,
  },
  buttonDisabled: {
    opacity: 0.7,
  },

  // ── Save preset row ──
  presetSaveRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  presetCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetCancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.piktag600,
  },
  presetConfirmBtn: {
    flex: 1,
    backgroundColor: c.piktag500,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetConfirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── QR Mode (IG-style) ──
  qrGradient: {
    flex: 1,
  },
  qrTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  qrTopBtn: {
    padding: 8,
  },
  qrTopRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // (qrCardWrap / qrWhiteCard / qrCardUsername / qrEventInfo /
  // qrEventInfoLine / qrBottomRow / qrBottomBtn / qrBottomBtnText
  // all moved into the shared QrShareBody component — single source
  // of truth for the QR-share inner layout, matching QrCodeModal +
  // QrGroupDetailScreen exactly. 2026-05-31 task #38 follow-up.)
  // (qrBrandTitle + qrWrapper "kept because other modes may reference"
  // were verified dead 2026-05-31 — no other mode references them.
  // Removed in the tech-debt sweep.)
  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: c.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    minHeight: '85%',
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: c.gray900,
  },
  modalScrollView: {
    flex: 1,
  },

  // ── Preset items ──
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray50,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  presetItemContent: {
    flex: 1,
    marginRight: 12,
  },
  presetItemName: {
    fontSize: 16,
    fontWeight: '700',
    color: c.gray900,
    marginBottom: 4,
  },
  presetItemLocation: {
    fontSize: 14,
    color: c.gray500,
    marginBottom: 8,
  },
  presetTagsPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  presetTagMini: {
    backgroundColor: c.piktag50,
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  presetTagMiniText: {
    fontSize: 12,
    fontWeight: '500',
    color: c.piktag600,
  },
  presetMoreText: {
    fontSize: 12,
    color: c.gray400,
    fontWeight: '500',
  },
  presetItemActions: {
    justifyContent: 'center',
  },
  presetApplyBtn: {
    backgroundColor: c.piktag500,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  presetApplyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Misc ──
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: c.gray400,
  },

  // ── Preset Name Modal ──
  presetNameModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  presetNameModalContainer: {
    backgroundColor: c.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  presetNameModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: c.gray900,
    marginBottom: 4,
  },
  presetNameModalSubtitle: {
    fontSize: 14,
    color: c.gray500,
    marginBottom: 16,
  },
  presetNameModalInput: {
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: c.gray900,
    backgroundColor: c.gray50,
    marginBottom: 20,
  },
  presetNameModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  presetNameModalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.gray200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetNameModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: c.gray500,
  },
  presetNameModalConfirmBtn: {
    flex: 1,
    backgroundColor: c.piktag500,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetNameModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  presetHintText: {
    fontSize: 13,
    color: c.gray400,
    textAlign: 'center',
    marginBottom: 12,
  },
  // (First-QR celebration sheet styles removed with the sheet.)
  });
}
