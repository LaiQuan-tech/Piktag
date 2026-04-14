import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { Plus, X, MapPin, ChevronDown, ChevronUp } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { COLORS } from '../constants/theme';
import LocationPickerModal from './LocationPickerModal';

export type HiddenTag = { id: string; tagId: string; name: string };

type Props = {
  connectionId: string;
  userId: string;
  hiddenTags: HiddenTag[];
  onTagsChanged: () => void;
};

const RECENT_LOCATIONS_KEY = 'piktag_recent_locations';
const MAX_FREQUENT = 12;

// A tag name that starts with 4 digits is assumed to be a date (e.g. "2026/04/14"
// or "2026年4月14日") and is filtered out of the "frequent tags" chip row — it
// is almost never useful to re-apply the same specific date to a different friend.
const DATE_LIKE_RE = /^\d{4}/;

function localizedDate(d: Date): string {
  // Use the device locale so date tags match whatever the user expects to read
  return d.toLocaleDateString();
}

function localizedMonth(d: Date): string {
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  } catch {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

export default function HiddenTagEditor({ connectionId, userId, hiddenTags, onTagsChanged }: Props) {
  const { t } = useTranslation();

  const [frequentTags, setFrequentTags] = useState<{ id: string; name: string }[]>([]);
  const [recentLocations, setRecentLocations] = useState<string[]>([]);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [textExpanded, setTextExpanded] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [busy, setBusy] = useState(false);

  const currentNames = useMemo(() => new Set(hiddenTags.map((h) => h.name)), [hiddenTags]);

  // ── Load frequent hidden tags ──
  // Two-step query to avoid PostgREST nested-filter syntax pitfalls:
  //   1. Fetch the user's own connection IDs
  //   2. Fetch all private tag rows for those connections
  // Then group client-side. Fine up to a few thousand rows.
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
    const next = [name, ...recentLocations.filter((l) => l !== name)].slice(0, 5);
    setRecentLocations(next);
    try {
      await AsyncStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next));
    } catch {}
  };

  // Core add: every chip tap and the text-input fallback funnel through here.
  // Same find-or-create → insert flow FriendDetailScreen.handleAddHiddenTag
  // previously implemented inline — extracted here so all paths share it.
  const applyHiddenTag = async (rawName: string) => {
    const name = rawName.trim().replace(/^#/, '');
    if (!name || !connectionId || busy) return;
    if (currentNames.has(name)) return; // Already added to this connection

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
        const { data: newTag } = await supabase
          .from('piktag_tags')
          .insert({ name })
          .select('id')
          .single();
        if (!newTag) return;
        tagId = newTag.id;
      }
      await supabase.from('piktag_connection_tags').insert({
        connection_id: connectionId,
        tag_id: tagId,
        is_private: true,
      });
      onTagsChanged();
      // Also refresh frequent list so the tag we just added bubbles up next time
      loadFrequentTags();
    } catch (err) {
      console.warn('[HiddenTagEditor] applyHiddenTag failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const removeHiddenTag = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.from('piktag_connection_tags').delete().eq('id', id);
      onTagsChanged();
    } catch (err) {
      console.warn('[HiddenTagEditor] removeHiddenTag failed:', err);
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

  const handleTextSubmit = () => {
    const v = textValue.trim();
    if (!v) return;
    applyHiddenTag(v);
    setTextValue('');
  };

  // Time chips — 4 quick presets. Stored as localized date strings so they
  // read naturally when the user reviews the friend later.
  const timeChips = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    return [
      { label: t('hiddenTagEditor.today'), value: localizedDate(today) },
      { label: t('hiddenTagEditor.yesterday'), value: localizedDate(yesterday) },
      { label: t('hiddenTagEditor.thisMonth'), value: localizedMonth(today) },
      { label: t('hiddenTagEditor.thisYear'), value: String(today.getFullYear()) },
    ];
  }, [t]);

  // Frequent tags minus whatever is already on this connection
  const filteredFrequent = useMemo(
    () => frequentTags.filter((ft) => !currentNames.has(ft.name)),
    [frequentTags, currentNames],
  );

  return (
    <View>
      {/* ── Time row ──────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{t('hiddenTagEditor.timeTitle')}</Text>
      <View style={styles.chipRow}>
        {timeChips.map((chip) => {
          const alreadyAdded = currentNames.has(chip.value);
          return (
            <TouchableOpacity
              key={chip.label}
              style={[styles.pickChip, alreadyAdded && styles.pickChipDisabled]}
              onPress={() => !alreadyAdded && applyHiddenTag(chip.value)}
              disabled={alreadyAdded || busy}
              activeOpacity={0.7}
            >
              <Plus size={12} color={alreadyAdded ? COLORS.gray400 : COLORS.piktag600} />
              <Text style={[styles.pickChipText, alreadyAdded && styles.pickChipTextDisabled]}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Location row ──────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{t('hiddenTagEditor.locationTitle')}</Text>
      <View style={styles.chipRow}>
        {recentLocations.map((loc) => {
          const alreadyAdded = currentNames.has(loc);
          return (
            <TouchableOpacity
              key={loc}
              style={[styles.pickChip, alreadyAdded && styles.pickChipDisabled]}
              onPress={() => !alreadyAdded && applyHiddenTag(loc)}
              disabled={alreadyAdded || busy}
              activeOpacity={0.7}
            >
              <Plus size={12} color={alreadyAdded ? COLORS.gray400 : COLORS.piktag600} />
              <Text style={[styles.pickChipText, alreadyAdded && styles.pickChipTextDisabled]}>
                {loc}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.pickChip, styles.pickChipAction]}
          onPress={() => setLocationPickerVisible(true)}
          disabled={busy}
          activeOpacity={0.7}
        >
          <MapPin size={12} color={COLORS.piktag600} />
          <Text style={styles.pickChipText}>{t('hiddenTagEditor.pickLocation')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Frequent tags row ─────────────────────────────── */}
      {filteredFrequent.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('hiddenTagEditor.frequentTitle')}</Text>
          <View style={styles.chipRow}>
            {filteredFrequent.map((tag) => (
              <TouchableOpacity
                key={tag.id}
                style={styles.pickChip}
                onPress={() => applyHiddenTag(tag.name)}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Plus size={12} color={COLORS.piktag600} />
                <Text style={styles.pickChipText}>#{tag.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* ── Already added ─────────────────────────────────── */}
      {hiddenTags.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t('hiddenTagEditor.addedTitle')}</Text>
          <View style={styles.chipRow}>
            {hiddenTags.map((ht) => (
              <View key={ht.id} style={styles.addedChip}>
                <Text style={styles.addedChipText}>#{ht.name}</Text>
                <TouchableOpacity
                  onPress={() => removeHiddenTag(ht.id)}
                  disabled={busy}
                  activeOpacity={0.6}
                  style={styles.addedChipRemove}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <X size={12} color={COLORS.gray600} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </>
      )}

      {/* ── Other (collapsible text input escape hatch) ───── */}
      <TouchableOpacity
        style={styles.otherToggle}
        onPress={() => setTextExpanded((v) => !v)}
        activeOpacity={0.6}
      >
        <Text style={styles.otherToggleText}>{t('hiddenTagEditor.other')}</Text>
        {textExpanded ? (
          <ChevronUp size={14} color={COLORS.gray500} />
        ) : (
          <ChevronDown size={14} color={COLORS.gray500} />
        )}
      </TouchableOpacity>
      {textExpanded && (
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
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.addBtnText}>{t('common.add')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

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
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
  },
  pickChipAction: {
    backgroundColor: COLORS.white,
    borderStyle: 'dashed',
  },
  pickChipDisabled: {
    backgroundColor: COLORS.gray100,
    borderColor: COLORS.gray200,
  },
  pickChipText: {
    fontSize: 13,
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  pickChipTextDisabled: {
    color: COLORS.gray400,
  },
  addedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.piktag100,
  },
  addedChipText: {
    fontSize: 13,
    color: COLORS.piktag600,
    fontWeight: '600',
  },
  addedChipRemove: {
    padding: 2,
  },
  otherToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 16,
    paddingVertical: 6,
  },
  otherToggleText: {
    fontSize: 13,
    color: COLORS.gray500,
    fontWeight: '500',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
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
