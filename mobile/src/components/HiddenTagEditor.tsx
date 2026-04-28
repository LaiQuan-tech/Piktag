import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  Alert,
} from 'react-native';
import BrandSpinner from './loaders/BrandSpinner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { X } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';
import LocationPickerModal from './LocationPickerModal';

export type HiddenTag = { id: string; tagId: string; name: string };

type Props = {
  connectionId: string;
  userId: string;
  hiddenTags: HiddenTag[];
  onTagsChanged: () => Promise<void> | void;
};

const RECENT_LOCATIONS_KEY = 'piktag_recent_locations';
const MAX_FREQUENT = 12;

const DATE_LIKE_RE = /^\d{4}/;

function formatDateDisplay(d: Date): string {
  const locale = getLocales()?.[0]?.languageTag || 'zh-TW';
  try {
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
}

export default function HiddenTagEditor({ connectionId, userId, hiddenTags, onTagsChanged }: Props) {
  const { t } = useTranslation();

  const [frequentTags, setFrequentTags] = useState<{ id: string; name: string }[]>([]);
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [busy, setBusy] = useState(false);

  const currentNames = useMemo(() => new Set(hiddenTags.map((h) => h.name)), [hiddenTags]);

  const loadFrequentTags = useCallback(async () => {
    if (!userId) return;
    const { data: conns, error: connsErr } = await supabase
      .from('piktag_connections')
      .select('id')
      .eq('user_id', userId);
    if (connsErr || !conns || conns.length === 0) {
      setFrequentTags([]);
      return;
    }
    const connIds = conns.map((c: any) => c.id);

    const { data: tagRows, error: tagsErr } = await supabase
      .from('piktag_connection_tags')
      .select('tag_id, piktag_tags!inner(id, name)')
      .eq('is_private', true)
      .in('connection_id', connIds);
    if (tagsErr || !tagRows) return;

    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const row of tagRows as any[]) {
      const tag = row.piktag_tags;
      if (!tag?.id || !tag?.name) continue;
      const existing = counts.get(tag.id);
      if (existing) existing.count++;
      else counts.set(tag.id, { id: tag.id, name: tag.name, count: 1 });
    }
    const sorted = [...counts.values()]
      .filter((t) => !DATE_LIKE_RE.test(t.name))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_FREQUENT);
    setFrequentTags(sorted.map(({ id, name }) => ({ id, name })));
  }, [userId]);

  const loadRecentLocations = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_LOCATIONS_KEY);
      if (raw) setRecentLocations(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    loadFrequentTags();
    loadRecentLocations();
  }, [loadFrequentTags, loadRecentLocations]);

  const saveToRecentLocations = async (name: string) => {
    const next = [name, ...recentLocations.filter((l) => l !== name)].slice(0, 2);
    setRecentLocations(next);
    try {
      await AsyncStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next));
    } catch {}
  };

  const applyHiddenTag = async (rawName: string) => {
    const name = rawName.trim().replace(/^#/, '');
    if (!name || !connectionId || busy) return;

    setBusy(true);
    try {
      let tagId: string;
      const { data: existing } = await supabase
        .from('piktag_tags')
        .select('id')
        .eq('name', name)
        .maybeSingle();
      if (existing) {
        tagId = existing.id;
      } else {
        // Race-safe insert: concurrent clients can both take the `!existing`
        // branch. The unique index on piktag_tags.name will reject the
        // loser with Postgres error 23505; look up the winning row instead
        // of giving up silently.
        const { data: newTag, error: insertErr } = await supabase
          .from('piktag_tags')
          .insert({ name })
          .select('id')
          .single();
        if (newTag) {
          tagId = newTag.id;
        } else if (insertErr && (insertErr as any).code === '23505') {
          const { data: raced } = await supabase
            .from('piktag_tags')
            .select('id')
            .eq('name', name)
            .maybeSingle();
          if (!raced) return;
          tagId = raced.id;
        } else {
          return;
        }
      }
      await supabase.from('piktag_connection_tags').insert({
        connection_id: connectionId,
        tag_id: tagId,
        is_private: true,
      });
      await onTagsChanged();
      require('../lib/analytics').trackHiddenTagAdded('text');
      loadFrequentTags();
    } catch (err) {
      console.warn('[HiddenTagEditor] applyHiddenTag failed:', err);
      Alert.alert(t('common.error'), t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  };

  const removeHiddenTag = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.from('piktag_connection_tags').delete().eq('id', id);
      await onTagsChanged();
    } catch (err) {
      console.warn('[HiddenTagEditor] removeHiddenTag failed:', err);
      Alert.alert(t('common.error'), t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  };

  const handleLocationPicked = (placeName: string) => {
    setLocationPickerVisible(false);
    if (!placeName) return;
    saveToRecentLocations(placeName);
    applyHiddenTag(placeName);
  };

  const handleTextSubmit = async () => {
    const v = textValue.trim();
    if (!v) return;
    setTextValue('');
    await applyHiddenTag(v);
    Keyboard.dismiss();
  };

  // Date chips — today + yesterday with locale-formatted dates, matching AddTagScreen
  const dateChips = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const todayStr = formatDateDisplay(today);
    const yesterdayStr = formatDateDisplay(yesterday);
    return [
      { label: `#${todayStr}`, value: todayStr },
      { label: `#${yesterdayStr}`, value: yesterdayStr },
    ];
  }, []);

  const filteredFrequent = useMemo(
    () => frequentTags,
    [frequentTags],
  );

  // All names that appear as preset chips (date / location / frequent)
  const presetChipNames = useMemo(() => {
    const names = new Set<string>();
    dateChips.forEach(c => names.add(c.value));
    recentLocations.forEach(l => names.add(l));
    frequentTags.forEach(t => names.add(t.name));
    return names;
  }, [dateChips, recentLocations, frequentTags]);

  // 已加入: only manually typed tags (not visible in any chip row above)
  const manualHiddenTags = useMemo(
    () => hiddenTags.filter(ht => !presetChipNames.has(ht.name)),
    [hiddenTags, presetChipNames],
  );

  // Toggle: tap selected chip → remove; tap unselected → add
  const toggleHiddenTag = async (name: string) => {
    const existing = hiddenTags.find(h => h.name === name);
    if (existing) {
      await removeHiddenTag(existing.id);
    } else {
      await applyHiddenTag(name);
    }
  };

  return (
    <View>
      {/* ── 日期 ── */}
      <Text style={styles.sectionTitle}>{t('addTag.dateLabel') || '日期'}</Text>
      <View style={styles.chipRow}>
        {dateChips.map((chip) => {
          const isSelected = currentNames.has(chip.value);
          return (
            <TouchableOpacity
              key={chip.label}
              style={[styles.pickChip, isSelected && styles.pickChipSelected]}
              onPress={() => toggleHiddenTag(chip.value)}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={[styles.pickChipText, isSelected && styles.pickChipTextSelected]}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── 地點 ── */}
      <Text style={styles.sectionTitle}>{t('addTag.locationLabel') || '地點'}</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={styles.pickChip}
          onPress={() => setLocationPickerVisible(true)}
          disabled={busy}
          activeOpacity={0.7}
        >
          <Text style={styles.pickChipText}>{t('addTag.selectLocation') || '選地點'}</Text>
        </TouchableOpacity>
        {recentLocations.map((loc) => {
          const isSelected = currentNames.has(loc);
          return (
            <TouchableOpacity
              key={loc}
              style={[styles.pickChip, isSelected && styles.pickChipSelected]}
              onPress={() => toggleHiddenTag(loc)}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={[styles.pickChipText, isSelected && styles.pickChipTextSelected]}>
                #{loc}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── 常用標籤 ── */}
      {filteredFrequent.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('hiddenTagEditor.frequentTitle')}</Text>
          <View style={styles.chipRow}>
            {filteredFrequent.map((tag) => {
              const isSelected = currentNames.has(tag.name);
              return (
                <TouchableOpacity
                  key={tag.id}
                  style={[styles.pickChip, isSelected && styles.pickChipSelected]}
                  onPress={() => toggleHiddenTag(tag.name)}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickChipText, isSelected && styles.pickChipTextSelected]}>
                    #{tag.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* ── 已加入 (manual-only, not duplicating chips above) ── */}
      {manualHiddenTags.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('hiddenTagEditor.addedTitle')}</Text>
          <View style={styles.chipRow}>
            {manualHiddenTags.map((ht) => (
              <View key={ht.id} style={styles.addedChip}>
                <Text style={styles.addedChipText}>#{ht.name}</Text>
                <TouchableOpacity
                  onPress={() => removeHiddenTag(ht.id)}
                  disabled={busy}
                  activeOpacity={0.6}
                  style={styles.addedChipRemove}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <X size={12} color={COLORS.piktag600} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── 自訂輸入 ── */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={textValue}
          onChangeText={setTextValue}
          placeholder={t('hiddenTagEditor.otherPlaceholder')}
          placeholderTextColor={COLORS.gray400}
          returnKeyType="done"
          onSubmitEditing={handleTextSubmit}
        />
        <TouchableOpacity
          style={[styles.addBtn, (!textValue.trim() || busy) && { opacity: 0.5 }]}
          onPress={handleTextSubmit}
          disabled={!textValue.trim() || busy}
          activeOpacity={0.7}
        >
          {busy ? (
            <BrandSpinner size={20} />
          ) : (
            <Text style={styles.addBtnText}>{t('common.add')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <LocationPickerModal
        visible={locationPickerVisible}
        onClose={() => setLocationPickerVisible(false)}
        onSelect={(placeName) => handleLocationPicked(placeName)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray600,
    marginTop: 14,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pickChipSelected: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  pickChipDisabled: {
    backgroundColor: COLORS.gray100,
    borderColor: COLORS.gray200,
    opacity: 0.5,
  },
  pickChipText: {
    fontSize: 14,
    color: COLORS.gray600,
    fontWeight: '500',
  },
  pickChipTextSelected: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  pickChipTextDisabled: {
    color: COLORS.gray400,
  },
  addedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 14,
    paddingRight: 10,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: COLORS.piktag50,
  },
  addedChipText: {
    fontSize: 14,
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  addedChipRemove: {
    padding: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.gray900,
    backgroundColor: COLORS.white,
  },
  addBtn: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
