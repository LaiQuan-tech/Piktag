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
  ActivityIndicator,
  Modal,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Star, ArrowLeft, Share2, Trash2 } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { COLORS } from '../constants/theme';
import type { TagPreset, ScanSession, PiktagProfile } from '../types';

// ─── Popular Tags Constants ───
const POPULAR_TAGS = {
  soft: ['#攝影', '#旅行', '#美食', '#健身', '#音樂'],
  hard: ['#工程師', '#設計師', '#行銷', '#創業', '#PM'],
};

type AddTagScreenProps = {
  navigation: any;
};

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

function getQuickDates(): { label: string; date: Date }[] {
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const saturday = new Date(today); saturday.setDate(today.getDate() + (6 - today.getDay()));
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  return [
    { label: '今天', date: today },
    { label: '明天', date: tomorrow },
    { label: '本週末', date: saturday },
    { label: '下週', date: nextWeek },
  ];
}

export default function AddTagScreen({ navigation }: AddTagScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Mode: 'setup' or 'qr'
  const [mode, setMode] = useState<'setup' | 'qr' | 'event'>('setup');

  // Setup form state
  const [eventDate, setEventDate] = useState(formatDate(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDateObj, setSelectedDateObj] = useState(new Date());
  const [eventLocation, setEventLocation] = useState('');
  const [eventTags, setEventTags] = useState<string[]>([]);
  const eventTagSet = useMemo(() => new Set(eventTags), [eventTags]);
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
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [generating, setGenerating] = useState(false);

  // Presets modal
  const [showPresetsModal, setShowPresetsModal] = useState(false);
  const [presets, setPresets] = useState<TagPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);

  // ─── Load presets ───
  const loadPresets = useCallback(async () => {
    if (!user) return;
    setLoadingPresets(true);
    try {
      const { data } = await supabase
        .from('piktag_tag_presets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setPresets((data as TagPreset[]) ?? []);
    } catch {
      // Table may not exist yet — ignore
      setPresets([]);
    } finally {
      setLoadingPresets(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadPresets();
    }
  }, [user, loadPresets]);

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
    try {
      const { error } = await supabase.from('piktag_tag_presets').insert({
        user_id: user.id,
        name: presetNameInput.trim(),
        location: eventLocation,
        tags: eventTags,
      });
      if (error) {
        Alert.alert(t('common.error'), t('addTag.alertPresetSaveError'));
      } else {
        Alert.alert(t('addTag.alertPresetSavedTitle'), t('addTag.alertPresetSavedMessage', { name: presetNameInput.trim() }));
        loadPresets();
      }
    } catch {
      Alert.alert(t('common.error'), t('addTag.alertPresetSaveError'));
    } finally {
      setSavingPreset(false);
    }
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
  };

  // ─── Delete preset ───
  const handleDeletePreset = async (id: string) => {
    setDeletingPresetId(id);
    try {
      const { error } = await supabase
        .from('piktag_tag_presets')
        .delete()
        .eq('id', id);

      if (error) {
        Alert.alert(t('common.error'), t('addTag.alertPresetDeleteError'));
      } else {
        setPresets((prev) => prev.filter((p) => p.id !== id));
      }
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
      let sessionData: any = null;

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
          })
          .select('*')
          .single();

        if (!error && data) {
          sessionId = data.id;
          sessionData = data;
        }
      } catch {
        // DB table may not exist yet — continue with local session ID
      }

      // 3. Build QR URL — standard URL that any camera can scan
      const username = (profileData as PiktagProfile | null)?.username || user.id;
      const qrUrl = `https://pikt.ag/${username}?sid=${sessionId}`;

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
      });
    } catch {
      // user cancelled
    }
  };

  // ─── Render Setup Mode ───
  const renderSetupMode = () => (
    <>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerSideBtn} />
        <Text style={styles.headerTitle}># PikTag</Text>
        <TouchableOpacity
          onPress={async () => {
            await loadPresets();
            setShowPresetsModal(true);
          }}
          activeOpacity={0.6}
          style={styles.headerSideBtn}
        >
          <Star size={24} color={COLORS.piktag500} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 日期 Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addTag.dateLabel')}</Text>

          {/* Quick date buttons */}
          <View style={styles.quickDateRow}>
            {getQuickDates().map((qd) => {
              const isSelected = eventDate === formatDate(qd.date);
              return (
                <TouchableOpacity
                  key={qd.label}
                  style={[styles.quickDateBtn, isSelected && styles.quickDateBtnActive]}
                  onPress={() => { setEventDate(formatDate(qd.date)); setSelectedDateObj(qd.date); setShowDatePicker(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickDateText, isSelected && styles.quickDateTextActive]}>{qd.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.quickDateBtn, showDatePicker && styles.quickDateBtnActive]}
              onPress={() => setShowDatePicker(!showDatePicker)}
              activeOpacity={0.7}
            >
              <Text style={[styles.quickDateText, showDatePicker && styles.quickDateTextActive]}>
                {t('addTag.pickDate') || '選日期'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Selected date display */}
          <Text style={styles.selectedDateText}>{eventDate}</Text>

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
                            style={[styles.calendarDayCell, isSelected && styles.calendarDayCellSelected]}
                            onPress={() => { setEventDate(dateStr); setShowDatePicker(false); }}
                          >
                            <Text style={[styles.calendarDayText, isToday && styles.calendarDayToday, isSelected && styles.calendarDayTextSelected]}>{day}</Text>
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
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={eventLocation}
              onChangeText={setEventLocation}
              placeholder={t('addTag.locationPlaceholder')}
              placeholderTextColor={COLORS.gray400}
            />
          </View>
        </View>

        {/* 自訂標籤 Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('addTag.customTagsLabel')}</Text>
          <Text style={styles.hiddenTagHint}>{t('addTag.hiddenTagHint') || '這些標籤僅自己可見，幫助你記住在哪認識'}</Text>
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
            <TouchableOpacity
              style={styles.addTagBtn}
              onPress={handleAddTag}
              activeOpacity={0.8}
            >
              <Text style={styles.addTagBtnText}>{t('common.add')}</Text>
            </TouchableOpacity>
          </View>

          {eventTags.length > 0 && (
            <View style={styles.chipsContainer}>
              {eventTags.map((tag) => (
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
            {POPULAR_TAGS.soft.map((tag) => {
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
                    {tag}{isSelected ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.popularChipsContainer}>
            {POPULAR_TAGS.hard.map((tag) => {
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
                    {tag}{isSelected ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 儲存為常用模板 */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.outlineButton}
            onPress={handleSavePreset}
            activeOpacity={0.7}
            disabled={savingPreset}
          >
            {savingPreset
              ? <ActivityIndicator size={16} color={COLORS.piktag500} />
              : <Text style={styles.outlineButtonText}>{t('addTag.saveAsPreset')}</Text>
            }
          </TouchableOpacity>
        </View>

        {/* 產生 QR Code CTA */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.primaryButton, generating && styles.buttonDisabled]}
            onPress={handleGenerateQr}
            activeOpacity={0.8}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator size={18} color={COLORS.gray900} />
            ) : (
              <Text style={styles.primaryButtonText}>{t('addTag.generateQrButton')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );

  // ─── Render QR Mode ───
  const renderQrMode = () => (
    <>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => setMode('setup')}
          activeOpacity={0.6}
          style={styles.headerBackBtn}
        >
          <ArrowLeft size={20} color={COLORS.gray900} />
          <Text style={styles.headerBackText}>{t('addTag.backToEdit')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleShare}
          activeOpacity={0.6}
          style={styles.headerSideBtn}
        >
          <Share2 size={22} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.qrScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Branded title */}
        <Text style={styles.qrBrandTitle}>{t('addTag.qrBrandTitle')}</Text>

        {/* QR Code */}
        <View style={styles.qrWrapper}>
          <QRCode value={qrValue} size={200} backgroundColor={COLORS.white} />
        </View>

        {/* Event info */}
        <Text style={styles.qrEventInfo}>
          {eventDate}
          {eventLocation ? ` · ${eventLocation}` : ''}
        </Text>

        {/* Tags */}
        {eventTags.length > 0 && (
          <View style={styles.qrTagsContainer}>
            {eventTags.map((tag) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Scan count */}
        <Text style={styles.qrScanCount}>
          {t('addTag.scanCount', { count: scanSession?.scan_count ?? 0 })}
        </Text>

        {/* Event mode button */}
        <TouchableOpacity
          style={styles.eventModeBtn}
          onPress={() => setMode('event')}
          activeOpacity={0.8}
        >
          <Text style={styles.eventModeBtnText}>{t('addTag.eventModeBtn') || '活動模式'}</Text>
        </TouchableOpacity>

        {/* Edit button */}
        <TouchableOpacity
          style={styles.outlineButton}
          onPress={() => setMode('setup')}
          activeOpacity={0.7}
        >
          <Text style={styles.outlineButtonText}>
            {t('addTag.editTagSettings')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </>
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
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.piktag500} />
            </View>
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
                      <ActivityIndicator size={16} color={COLORS.gray400} />
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
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
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
          </View>

          {/* Scan count */}
          <Text style={styles.eventScanCount}>
            {scanSession?.scan_count ?? 0} {t('addTag.eventScanned') || '人已掃描'}
          </Text>

          {/* Tags */}
          {eventTags.length > 0 && (
            <View style={styles.eventTagsRow}>
              {eventTags.slice(0, 5).map((tag) => (
                <View key={tag} style={styles.eventTagChip}>
                  <Text style={styles.eventTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.eventHint}>{t('addTag.eventHint') || '讓朋友掃描加你為好友'}</Text>
        </View>
      )}
      {showPresetsModal && renderPresetsModal()}


      {/* Preset Name Input Modal (cross-platform replacement for Alert.prompt) */}
      <Modal
        visible={showPresetNameModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowPresetNameModal(false)}
      >
        <View style={styles.presetNameModalOverlay}>
          <View style={styles.presetNameModalContainer}>
            <Text style={styles.presetNameModalTitle}>{t('addTag.saveAsPreset')}</Text>
            <Text style={styles.presetNameModalSubtitle}>{t('addTag.presetNamePrompt')}</Text>
            <TextInput
              style={styles.presetNameModalInput}
              value={presetNameInput}
              onChangeText={setPresetNameInput}
              placeholder={t('addTag.presetNamePlaceholder')}
              placeholderTextColor={COLORS.gray400}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConfirmSavePreset}
            />
            <View style={styles.presetNameModalButtons}>
              <TouchableOpacity
                style={styles.presetNameModalCancelBtn}
                onPress={() => setShowPresetNameModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.presetNameModalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.presetNameModalConfirmBtn, !presetNameInput.trim() && styles.buttonDisabled]}
                onPress={handleConfirmSavePreset}
                activeOpacity={0.8}
                disabled={!presetNameInput.trim()}
              >
                <Text style={styles.presetNameModalConfirmText}>{t('common.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
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
  calendarDayCellSelected: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 20,
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
  addTagBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addTagBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
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
    color: COLORS.gray900,
  },
  // Event mode button
  eventModeBtn: {
    backgroundColor: COLORS.gray900,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  eventModeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
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
  eventScanCount: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.piktag500,
    marginBottom: 16,
  },
  eventTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 40,
    marginBottom: 16,
  },
  eventTagChip: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  eventTagText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  eventHint: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
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
    borderColor: COLORS.gray200,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  presetCancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
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
    color: COLORS.gray900,
  },

  // ── QR Mode ──
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
  qrEventInfo: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray700,
    marginBottom: 16,
  },
  qrTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
    marginBottom: 20,
  },
  qrScanCount: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    marginBottom: 24,
  },

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
    maxHeight: '80%',
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
    color: COLORS.gray900,
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
    color: COLORS.gray900,
  },
  presetHintText: {
    fontSize: 13,
    color: COLORS.gray400,
    textAlign: 'center',
    marginBottom: 12,
  },
});
