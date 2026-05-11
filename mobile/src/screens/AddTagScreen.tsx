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
import { X, Star, Share2, Trash2, ScanLine, Link2, Pencil, Plus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import LocationPickerModal from '../components/LocationPickerModal';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { getLocales } from 'expo-localization';
import { setStringAsync as setClipboardStringAsync } from 'expo-clipboard';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import type { TagPreset, ScanSession, PiktagProfile } from '../types';

// ─── Fallback Popular Tags (used if DB fetch fails) ───
const FALLBACK_POPULAR_TAGS = ['#攝影', '#旅行', '#美食', '#健身', '#音樂', '#工程師'];

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
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Mode: 'setup' or 'qr'
  const [mode, setMode] = useState<'setup' | 'qr' | 'event'>('setup');

  // Setup form state
  const [eventDate, setEventDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDateObj, setSelectedDateObj] = useState(new Date());
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [eventLocation, setEventLocation] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [popularTags, setPopularTags] = useState<string[]>(FALLBACK_POPULAR_TAGS);
  const [eventTags, setEventTags] = useState<string[]>([]);
  const eventTagSet = useMemo(() => new Set(eventTags), [eventTags]);
  const popularTagSet = useMemo(() => new Set(popularTags), [popularTags]);
  const manualTags = useMemo(() => eventTags.filter(t => !popularTagSet.has(t)), [eventTags, popularTagSet]);
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
            if (cached.date) setEventDate(cached.date);
            if (cached.location) setEventLocation(cached.location);
            if (cached.tags) setEventTags(cached.tags);
          }
        } catch {}
      });
      // Load recent locations
      AsyncStorage.getItem('piktag_recent_locations').then(val => {
        if (cancelled || !val) return;
        setRecentLocations(JSON.parse(val));
      });
      // Fetch user's own most-used tags first, fallback to global popular
      supabase
        .from('piktag_user_tags')
        .select('tag:piktag_tags!tag_id(name)')
        .eq('user_id', user.id)
        .eq('is_private', false)
        .limit(6)
        .then(({ data }) => {
          if (cancelled) return;
          if (data && data.length >= 3) {
            setPopularTags(data.map((t: any) => `#${t.tag?.name}`).filter(Boolean));
          } else {
            // Not enough personal tags, use global popular
            supabase
              .from('piktag_tags')
              .select('name, usage_count')
              .order('usage_count', { ascending: false })
              .limit(6)
              .then(({ data: globalData }) => {
                if (cancelled) return;
                if (globalData && globalData.length > 0) {
                  setPopularTags(globalData.map((t: any) => `#${t.name}`));
                }
              });
          }
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
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (eventTags.includes(trimmed)) {
      Alert.alert(t('addTag.alertTagExists'), t('addTag.alertTagExistsMessage'));
      return;
    }
    setEventTags((prev) => [...prev, trimmed]);
    setTagInput('');
  };

  // ─── Remove tag ───
  const handleRemoveTag = (tag: string) => {
    setEventTags((prev) => prev.filter((t) => t !== tag));
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
        const { data, error } = await supabase
          .from('piktag_scan_sessions')
          .insert({
            host_user_id: user.id,
            preset_id: appliedPresetId,
            event_date: eventDate,
            event_location: eventLocation,
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
        }
      } catch {
        // DB table may not exist yet — continue with local session ID
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
      AsyncStorage.setItem('piktag_last_qr', JSON.stringify({ url: qrUrl, date: eventDate, location: eventLocation, tags: eventTags }));
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
  const handleShare = async () => {
    try {
      await Share.share({
        message: t('addTag.shareMessage', { eventDate, eventLocation, tags: eventTags.join(', ') }),
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
        <Text style={styles.headerTitle}>{t('addTag.headerTitle', { defaultValue: '活動標籤' })}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
          <TouchableOpacity
            onPress={() => navigation.navigate('CameraScan')}
            activeOpacity={0.6}
            style={styles.headerSideBtn}
          >
            <ScanLine size={24} color={COLORS.gray700} />
          </TouchableOpacity>
          {/* Preset star button removed for task 2 — QR codes are
              now persistent groups themselves (visible from the
              AddTagTab landing page), making the "常用模板" feature
              redundant. */}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* 日期 Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addTag.dateLabel')}</Text>

          {/* Date selector — just [選日期] button + selected date chip */}
          <View style={styles.quickDateRow}>
            <TouchableOpacity
              style={[styles.quickDateBtn, showDatePicker && styles.quickDateBtnActive]}
              onPress={() => setShowDatePicker(!showDatePicker)}
              activeOpacity={0.7}
            >
              <Text style={[styles.quickDateText, showDatePicker && styles.quickDateTextActive]}>
                {t('addTag.pickDate')}
              </Text>
            </TouchableOpacity>
            {eventDate && (
              <TouchableOpacity
                style={[styles.quickDateBtn, styles.quickDateBtnActive]}
                onPress={() => setEventDate('')}
                activeOpacity={0.7}
              >
                <Text style={[styles.quickDateText, styles.quickDateTextActive]}>
                  #{formatDateDisplay(selectedDateObj)}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Simple month calendar (when expanded) */}
          {showDatePicker && (
            <View style={styles.calendarGrid}>
              {(() => {
                const year = selectedDateObj.getFullYear();
                const month = selectedDateObj.getMonth();
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const days: (number | null)[] = Array(firstDay).fill(null);
                for (let i = 1; i <= daysInMonth; i++) days.push(i);

                return (
                  <>
                    <View style={styles.calendarHeader}>
                      <TouchableOpacity onPress={() => { const d = new Date(selectedDateObj); d.setMonth(d.getMonth() - 1); setSelectedDateObj(d); }}>
                        <Text style={styles.calendarNav}>{'<'}</Text>
                      </TouchableOpacity>
                      <Text style={styles.calendarMonthText}>{year}/{String(month + 1).padStart(2, '0')}</Text>
                      <TouchableOpacity onPress={() => { const d = new Date(selectedDateObj); d.setMonth(d.getMonth() + 1); setSelectedDateObj(d); }}>
                        <Text style={styles.calendarNav}>{'>'}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.calendarWeekRow}>
                      {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                        <Text key={d} style={styles.calendarWeekDay}>{d}</Text>
                      ))}
                    </View>
                    <View style={styles.calendarDaysGrid}>
                      {days.map((day, i) => {
                        if (!day) return <View key={`empty-${i}`} style={styles.calendarDayCell} />;
                        const dateStr = formatDate(new Date(year, month, day));
                        const isToday = dateStr === formatDate(new Date());
                        const isSelected = dateStr === eventDate;
                        return (
                          <TouchableOpacity
                            key={day}
                            style={styles.calendarDayCell}
                            onPress={() => { setEventDate(dateStr); setSelectedDateObj(new Date(year, month, day)); setShowDatePicker(false); }}
                          >
                            <View style={[styles.calendarDayInner, isSelected && styles.calendarDayInnerSelected]}>
                              <Text style={[styles.calendarDayText, isToday && styles.calendarDayToday, isSelected && styles.calendarDayTextSelected]}>{day}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                );
              })()}
            </View>
          )}
        </View>

        {/* 地點 Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addTag.locationLabel')}</Text>

          {/* Select location button + recent location chips (same row) */}
          <View style={styles.quickDateRow}>
            <TouchableOpacity
              style={styles.quickDateBtn}
              onPress={() => setShowLocationPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.quickDateText}>{t('addTag.selectLocation', { defaultValue: '選地點' })}</Text>
            </TouchableOpacity>
            {recentLocations.slice(0, 2).map((loc) => (
                <TouchableOpacity
                  key={loc}
                  style={[styles.quickDateBtn, eventLocation === loc && styles.quickDateBtnActive]}
                  onPress={() => setEventLocation(loc)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickDateText, eventLocation === loc && styles.quickDateTextActive]} numberOfLines={1}>
                    #{loc}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveRecentLocation(loc)}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
                    activeOpacity={0.6}
                    accessibilityLabel="刪除"
                    accessibilityRole="button"
                  >
                    <X size={12} color={eventLocation === loc ? COLORS.piktag600 : COLORS.gray400} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
          </View>

        </View>

        {/* Location Picker Modal */}
        <LocationPickerModal
          visible={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          onSelect={handleLocationSelected}
          initialLocation={eventLocation}
        />

        {/* 自訂標籤 Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addTag.customTagsLabel')}</Text>
          <Text style={styles.hiddenTagHint}>{t('addTag.hiddenTagHint', { defaultValue: '這些標籤僅自己可見，幫助你記住在哪認識' })}</Text>
          <View style={styles.tagInputRow}>
            <View style={[styles.inputRow, { flex: 1 }]}>
              <TextInput
                style={styles.textInput}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder={t('addTag.tagPlaceholder')}
                placeholderTextColor={COLORS.gray400}
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

          {manualTags.length > 0 && (
            <View style={styles.chipsContainer}>
              {manualTags.map((tag) => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveTag(tag)}
                    style={styles.chipRemoveBtn}
                    activeOpacity={0.6}
                  >
                    <X size={14} color={COLORS.piktag600} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 熱門標籤 Section */}
        <View style={styles.section}>
          <View style={styles.popularChipsContainer}>
            {popularTags.map((tag) => {
              const isSelected = eventTagSet.has(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[styles.popularChip, isSelected && styles.popularChipSelected]}
                  onPress={() => {
                    if (!isSelected) {
                      setEventTags((prev) => [...prev, tag]);
                    } else {
                      setEventTags((prev) => prev.filter((t) => t !== tag));
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.popularChipText, isSelected && styles.popularChipTextSelected]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

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
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
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

      {/* Center white card with QR code + username */}
      <View style={styles.qrCardWrap}>
        <View style={styles.qrWhiteCard}>
          <QRCode value={qrValue} size={220} backgroundColor="#fff" />
          <Text style={styles.qrCardUsername}>@{qrUsername}</Text>
          {(eventDate || eventLocation || eventTags.length > 0) && (
            <View style={styles.qrEventInfo}>
              {eventDate ? (
                <Text style={styles.qrEventInfoLine}>#{eventDate}</Text>
              ) : null}
              {eventLocation ? (
                <Text style={styles.qrEventInfoLine}>#{eventLocation}</Text>
              ) : null}
              {eventTags.length > 0 ? (
                <Text style={styles.qrEventInfoLine}>{eventTags.map(t => '#' + t.replace(/^#/, '')).join('  ')}</Text>
              ) : null}
            </View>
          )}
        </View>
      </View>

      {/* Bottom 3 action buttons (share / copy / edit) */}
      <View style={[styles.qrBottomRow, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity style={styles.qrBottomBtn} onPress={handleShare} activeOpacity={0.7}>
          <Share2 size={22} color={COLORS.gray900} />
          <Text style={styles.qrBottomBtnText}>{t('addTag.shareFile', { defaultValue: '分享檔案' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.qrBottomBtn} onPress={handleCopyLink} activeOpacity={0.7}>
          <Link2 size={22} color={COLORS.gray900} />
          <Text style={styles.qrBottomBtnText}>{t('addTag.copyLink', { defaultValue: '複製連結' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.qrBottomBtn} onPress={() => setMode('setup')} activeOpacity={0.7}>
          <Pencil size={22} color={COLORS.gray900} />
          <Text style={styles.qrBottomBtnText}>{t('addTag.editQr', { defaultValue: '編輯QRcode' })}</Text>
        </TouchableOpacity>
      </View>
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
              <X size={24} color={COLORS.gray900} />
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
      {mode === 'event' && (
        <View style={styles.eventModeContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#000000" />
          {/* Close button */}
          <TouchableOpacity
            style={[styles.eventCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setMode('qr')}
            activeOpacity={0.7}
          >
            <X size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Event info */}
          <Text style={styles.eventTitle}>
            {eventLocation || eventDate || 'PikTag'}
          </Text>

          {/* Large QR Code */}
          <View style={styles.eventQrWrapper}>
            <QRCode value={qrValue} size={280} backgroundColor="#FFFFFF" />
            {(eventDate || eventLocation || eventTags.length > 0) && (
              <View style={styles.qrEventInfo}>
                {eventDate ? (
                  <Text style={styles.qrEventInfoLine}>#{eventDate}</Text>
                ) : null}
                {eventLocation ? (
                  <Text style={styles.qrEventInfoLine}>#{eventLocation}</Text>
                ) : null}
                {eventTags.length > 0 ? (
                  <Text style={styles.qrEventInfoLine}>{eventTags.map(t => '#' + t.replace(/^#/, '')).join('  ')}</Text>
                ) : null}
              </View>
            )}
          </View>

          <Text style={styles.eventHint}>{t('addTag.eventHint', { defaultValue: '讓朋友掃描加你為好友' })}</Text>
        </View>
      )}
      {/* Preset modals removed for task 2. The state hooks
          (showPresetsModal, showPresetNameModal, presets, ...)
          and handlers (handleSavePreset, handleConfirmSavePreset,
          loadPresets, etc.) are left as dead code in this file
          for now to keep the diff focused on UI surfaces — a
          follow-up cleanup commit can rip them out. */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },

  // ── Header ──
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
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  headerSideBtn: {
    padding: 4,
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
    color: COLORS.gray900,
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  hiddenTagHint: {
    fontSize: 12,
    color: COLORS.gray400,
    marginBottom: 12,
  },

  // ── Input ──
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray100,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 48,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.gray900,
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
    borderColor: COLORS.piktag200,
    backgroundColor: COLORS.white,
  },
  quickDateBtnActive: {
    borderColor: COLORS.piktag500,
    backgroundColor: COLORS.piktag50,
  },
  quickDateText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray600,
  },
  quickDateTextActive: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  selectedDateText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  // Calendar
  calendarGrid: {
    marginTop: 8,
    backgroundColor: COLORS.gray50,
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
    color: COLORS.gray600,
    paddingHorizontal: 12,
  },
  calendarMonthText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
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
    color: COLORS.gray400,
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
    backgroundColor: COLORS.piktag500,
  },
  calendarDayText: {
    fontSize: 14,
    color: COLORS.gray700,
  },
  calendarDayToday: {
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  calendarDayTextSelected: {
    color: COLORS.white,
    fontWeight: '700',
  },

  // ── Tag input row ──
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  // Square 44×44 icon button — matches the textInput height so the row
  // reads as a single horizontal control. Width-fixed (not paddingX) so
  // it doesn't grow when the icon size changes; previously the textual
  // "新增" version sized itself to the label which made the row jiggle
  // when locales swapped to longer translations like "Aggiungi" / "추가".
  addTagBtn: {
    backgroundColor: COLORS.piktag500,
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
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 10,
    gap: 6,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.piktag600,
  },
  chipRemoveBtn: {
    padding: 2,
  },

  // ── Popular tags ──
  popularChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  popularChip: {
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  popularChipSelected: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  popularChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.gray600,
  },
  popularChipTextSelected: {
    color: COLORS.piktag600,
    fontWeight: '600',
  },

  // ── Buttons ──
  primaryButton: {
    backgroundColor: COLORS.piktag500,
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
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  eventModeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  cameraScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
  },
  cameraScanBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  // Event mode fullscreen
  eventModeContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  eventCloseBtn: {
    position: 'absolute',
    right: 20,
    zIndex: 101,
    padding: 4,
  },
  eventTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 24,
    textAlign: 'center',
  },
  eventQrWrapper: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginBottom: 20,
  },
  eventHint: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
  },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
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
    borderColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetCancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  presetConfirmBtn: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
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
  qrCardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  qrWhiteCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  qrCardUsername: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c44dff',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  qrEventInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  qrEventInfoLine: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '500',
    textAlign: 'center',
  },
  qrBottomRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  qrBottomBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  qrBottomBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  // ── Legacy QR mode styles (kept because other modes may reference) ──
  qrBrandTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.gray900,
    marginTop: 32,
    marginBottom: 24,
  },
  qrWrapper: {
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    marginBottom: 24,
  },
  // (Duplicate `qrEventInfo` block removed — was a stale text-style
  // leftover from an earlier refactor when qrEventInfo was a single
  // <Text>. The actual container style above L1445 was being silently
  // shadowed by JS's "last key wins" rule, breaking the flex/center
  // layout of the QR-card event-info row.)
  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.white,
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
    color: COLORS.gray900,
  },
  modalScrollView: {
    flex: 1,
  },

  // ── Preset items ──
  presetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.gray50,
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
    color: COLORS.gray900,
    marginBottom: 4,
  },
  presetItemLocation: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 8,
  },
  presetTagsPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
  presetTagMini: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  presetTagMiniText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.piktag600,
  },
  presetMoreText: {
    fontSize: 12,
    color: COLORS.gray400,
    fontWeight: '500',
  },
  presetItemActions: {
    justifyContent: 'center',
  },
  presetApplyBtn: {
    backgroundColor: COLORS.piktag500,
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
    color: COLORS.gray400,
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
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  presetNameModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  presetNameModalSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 16,
  },
  presetNameModalInput: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.gray900,
    backgroundColor: COLORS.gray50,
    marginBottom: 20,
  },
  presetNameModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  presetNameModalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetNameModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  presetNameModalConfirmBtn: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetNameModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },
  presetHintText: {
    fontSize: 13,
    color: COLORS.gray400,
    textAlign: 'center',
    marginBottom: 12,
  },
});
