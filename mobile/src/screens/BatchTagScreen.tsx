// BatchTagScreen — the ONE shared batch-tagging UI (CLAUDE.md contract).
// Three FREE modes live here today:
//
//   1. Burst mode (`people`, event-tag rework 方向一): auto-cohort = the
//      last hour's connection adds. All pre-selected, one tag, save/skip
//      lands on the just-added friend. Writes piktag_connection_tags
//      (is_private) — the event-QR shape.
//
//   2. Import mode (`deviceContacts`, 2026-07-04 backlog #1): cohort =
//      ContactSync's 尚未加入 device contacts. Nothing pre-selected —
//      the user picks ONE circle (同事/同學/家人/客戶/自訂), taps save,
//      the screen RESETS for the next circle (quick-sort loop), 完成
//      exits. Writes the `tags` array on piktag_local_contacts (creating
//      rows for contacts that had none) — the same array the promote
//      trigger copies into real connection tags when that person joins.
//
//   3. Manual mode (`people` + origin 'manual', 2026-09-09): cohort = the
//      friends the user picked themselves in ConnectionsScreen's select
//      mode. Same write as burst (private connection tags), different
//      copy and a separate analytics event.
//
// Mode 3 used to be a SECOND batch UI: a bare text-input modal inside
// ConnectionsScreen with its own find-or-create-tag logic, which (a) broke
// the one-shared-component rule, (b) had no presets, and (c) wrote
// piktag_connection_tags WITHOUT is_private, so a tag added from the
// friends list and the same tag added from the burst prompt could differ
// in visibility with nothing on screen saying so. Folding it in here
// deletes all three problems.
//
// Free/paid boundary: the founder's line (MONETIZATION_ROADMAP) was
// "free = system-initiated cohorts, paid = arbitrary selection". Arbitrary
// selection was ALREADY free and shipped, and the same roadmap locks
// "免費層永遠完整可用,付費是升級不是解鎖基本功能" — so it stays free and
// the Pro line moves to HOW you select (conditions, multi-tag, AI batch
// suggestions, export of the selected batch). See 60-TRIGGERS #19.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Check, Tag } from 'lucide-react-native';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { findOrCreateTag, attachPrivateTagsToConnections } from '../lib/userTags';
import { normalizeTagName, bidiMark, hashDisplay } from '../lib/normalizeTag';
import {
  trackBurstTagPromptShown,
  trackBurstTagApplied,
  trackImportBatchTagged,
  trackManualBatchTagged,
} from '../lib/analytics';
import { useLocalContacts } from '../hooks/useLocalContacts';
import InitialsAvatar from '../components/InitialsAvatar';
import type { BurstPerson } from '../lib/burstTag';

export type ImportContact = {
  /** Stable row key (the device-contact id). */
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Existing piktag_local_contacts row id, when the contact already has one. */
  existingId: string | null;
  existingTags: string[];
};

type Row = {
  key: string;
  name: string;
  avatarUrl: string | null;
  subtitle?: string;
};

type Props = {
  navigation: any;
  route: {
    params?: {
      people?: BurstPerson[];
      deviceContacts?: ImportContact[];
      // Who chose the cohort. Defaults to 'burst' so the two older
      // callers (ScanResult, UserDetail) keep their copy and their
      // metric without passing anything.
      origin?: 'burst' | 'manual';
      // Where to land afterwards — ScanResult/UserDetail pass the
      // just-added friend so burst save/skip stays a linear flow.
      next?: { friendId: string; connectionId: string };
    };
  };
};

const PRESET_KEYS = [
  { key: 'presetColleague', fallback: '同事' },
  { key: 'presetClassmate', fallback: '同學' },
  { key: 'presetFamily', fallback: '家人' },
  { key: 'presetClient', fallback: '客戶' },
] as const;

export default function BatchTagScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const people: BurstPerson[] = route.params?.people ?? [];
  const deviceContacts: ImportContact[] = route.params?.deviceContacts ?? [];
  const next = route.params?.next;
  const isImport = deviceContacts.length > 0;
  const isManual = !isImport && route.params?.origin === 'manual';

  const { add: addLocalContact, update: updateLocalContact } = useLocalContacts();

  const rows: Row[] = useMemo(
    () =>
      isImport
        ? deviceContacts.map((c) => ({
            key: c.key,
            name: c.name,
            avatarUrl: null,
            subtitle: c.phone || c.email || undefined,
          }))
        : people.map((p) => ({
            key: p.connectionId,
            name: p.name,
            avatarUrl: p.avatarUrl,
          })),
    [isImport, deviceContacts, people],
  );

  // Burst: everyone pre-selected (one event, opt-out). Import: empty —
  // a bucket is a SUBSET by definition, the user picks the circle.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(isImport ? [] : people.map((p) => p.connectionId)),
  );
  const [tagName, setTagName] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ tag: string; count: number } | null>(null);

  // Import quick-sort loop bookkeeping: created row ids + accumulated
  // tags per contact, so the SECOND bucket updates the row created by
  // the first instead of inserting a duplicate.
  const createdIdsRef = useRef<Map<string, string>>(new Map());
  const tagsByKeyRef = useRef<Map<string, string[]>>(new Map());
  useEffect(() => {
    for (const c of deviceContacts) {
      if (c.existingId) createdIdsRef.current.set(c.key, c.existingId);
      tagsByKeyRef.current.set(c.key, [...c.existingTags]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Burst only. A hand-picked cohort is not a prompt the app showed, so
    // counting it here would inflate the burst prompt's own success metric.
    if (!isImport && !isManual) trackBurstTagPromptShown(people.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    if (next) {
      navigation.replace('FriendDetail', next);
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Main');
    }
  };

  const toggle = (key: string) => {
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(key)) nextSet.delete(key);
      else nextSet.add(key);
      return nextSet;
    });
  };

  const allSelected = selected.size === rows.length && rows.length > 0;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)));
  };

  const canSave = !saving && selected.size > 0 && normalizeTagName(tagName).length > 0;

  // ── Save: burst mode → private connection tags (event-QR shape) ──
  // Shared idempotent writer (lib/userTags) — the UNIQUE constraint +
  // ignoreDuplicates makes re-tagging a no-op.
  const saveConnections = async (name: string) => {
    const tagId = await findOrCreateTag(name);
    if (!tagId) return;
    const ids = [...selected];
    await attachPrivateTagsToConnections(ids, [tagId]);
    if (isManual) trackManualBatchTagged(ids.length);
    else trackBurstTagApplied(people.length, ids.length);
  };

  // ── Save: import mode → piktag_local_contacts.tags (creating rows) ──
  // The promote trigger copies this array into real connection tags the
  // day the person registers — bucketing now IS future serendipity fuel.
  const saveLocalContacts = async (name: string) => {
    const byKey = new Map(deviceContacts.map((c) => [c.key, c]));
    let tagged = 0;
    for (const key of selected) {
      const contact = byKey.get(key);
      if (!contact) continue;
      const prior = tagsByKeyRef.current.get(key) ?? [];
      if (prior.includes(name)) {
        tagged++;
        continue; // idempotent — re-bucketing the same person is a no-op
      }
      const nextTags = [...prior, name];
      const existingId = createdIdsRef.current.get(key);
      if (existingId) {
        const ok = await updateLocalContact(existingId, { tags: nextTags });
        if (ok) {
          tagsByKeyRef.current.set(key, nextTags);
          tagged++;
        }
      } else {
        const created = await addLocalContact({
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          tags: nextTags,
          // Import mode (device contact book) → stamp as import so the
          // dashboard's card-scan count excludes these. The update()
          // branch above touches only tags on an existing row, so it
          // needs no source.
          source: 'import',
        });
        if (created?.id) {
          createdIdsRef.current.set(key, created.id);
          tagsByKeyRef.current.set(key, nextTags);
          tagged++;
        }
      }
    }
    trackImportBatchTagged(tagged);
    return tagged;
  };

  const handleSave = async () => {
    const name = normalizeTagName(tagName);
    if (!name || selected.size === 0 || saving) return;
    setSaving(true);
    try {
      if (isImport) {
        const tagged = await saveLocalContacts(name);
        // Quick-sort loop: stay here, show what landed, reset for the
        // next circle. 完成 exits when the user is done bucketing.
        setLastSaved({ tag: name, count: tagged });
        setSelected(new Set());
        setTagName('');
      } else {
        await saveConnections(name);
        leave();
      }
    } catch {
      // Best-effort — a failed batch write should never trap the user.
      if (!isImport) leave();
    } finally {
      setSaving(false);
    }
  };

  const renderRow = ({ item }: { item: Row }) => {
    const on = selected.has(item.key);
    const doneTags = isImport ? tagsByKeyRef.current.get(item.key) ?? [] : [];
    return (
      <TouchableOpacity
        style={styles.personRow}
        activeOpacity={0.7}
        onPress={() => toggle(item.key)}
      >
        {/* Shared avatar component (consistency rule: never hand-roll a
            fallback the app already owns). */}
        <InitialsAvatar name={item.name} avatarUrl={item.avatarUrl} size={40} />
        <View style={styles.personTextWrap}>
          <Text style={styles.personName} numberOfLines={1}>
            {item.name}
          </Text>
          {doneTags.length > 0 ? (
            <Text style={styles.personTags} numberOfLines={1}>
              {bidiMark() + doneTags.map((tg) => `#${tg}`).join(' ')}
            </Text>
          ) : item.subtitle ? (
            <Text style={styles.personTags} numberOfLines={1}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.checkWrap, on && styles.checkWrapOn]}>
          {on ? <Check size={14} color={'#FFFFFF'} /> : null}
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.iconWrap}>
        <Tag size={28} color={colors.piktag500} />
      </View>
      <Text style={styles.title}>
        {isImport
          ? t('batchTag.importTitle', { defaultValue: '幫聯絡人快速分類' })
          : isManual
            ? t('batchTag.manualTitle', { defaultValue: '一次幫這些人加標籤' })
            : t('batchTag.title', { defaultValue: '同一場合認識的嗎？' })}
      </Text>
      <Text style={styles.subtitle}>
        {isImport
          ? t('batchTag.importSubtitle', {
              defaultValue: '挑出同一類的人，一次加上標籤 — 之後搜這個標籤，他們全都找得到。',
            })
          : isManual
            ? t('batchTag.manualSubtitle', {
                count: people.length,
                defaultValue: '你選了 {{count}} 位 — 加上共同的標籤，之後搜這個標籤就能一次找回他們。',
              })
            : t('batchTag.subtitle', {
                count: people.length,
                defaultValue: '過去一小時你加了 {{count}} 位朋友 — 一次幫他們加上這場活動的標籤。',
              })}
      </Text>
      {rows.length > 1 ? (
        <TouchableOpacity style={styles.selectAllBtn} activeOpacity={0.7} onPress={toggleAll}>
          <Text style={styles.selectAllText}>
            {allSelected
              ? t('batchTag.clearAll', { defaultValue: '取消全選' })
              : t('batchTag.selectAll', { defaultValue: '全選' })}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footerWrap}>
      <View style={styles.presetRow}>
        {PRESET_KEYS.map(({ key, fallback }) => {
          const label = t(`batchTag.${key}`, { defaultValue: fallback });
          const active = normalizeTagName(tagName) === normalizeTagName(label);
          return (
            <TouchableOpacity
              key={key}
              style={[styles.presetChip, active && styles.presetChipOn]}
              activeOpacity={0.7}
              onPress={() => setTagName(label)}
            >
              <Text style={[styles.presetChipText, active && styles.presetChipTextOn]}>
                {hashDisplay(label)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={tagName}
        onChangeText={setTagName}
        placeholder={t('batchTag.placeholder', { defaultValue: '例：台北設計聚' })}
        placeholderTextColor={colors.gray400}
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={() => { if (canSave) void handleSave(); }}
      />
      {lastSaved ? (
        <Text style={styles.savedToast}>
          {t('batchTag.savedToast', {
            count: lastSaved.count,
            tag: lastSaved.tag,
            defaultValue: '已為 {{count}} 位加上 #{{tag}}',
          })}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        activeOpacity={0.85}
        disabled={!canSave}
        onPress={handleSave}
      >
        <Text style={styles.saveBtnText}>
          {t('batchTag.save', { defaultValue: '全部加上標籤' })}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.skipBtn} activeOpacity={0.7} onPress={leave}>
        <Text style={styles.skipText}>
          {isImport
            ? t('batchTag.done', { defaultValue: '完成' })
            : isManual
              // The user walked in here on purpose — "先不用" is the answer
              // to a question nobody asked them.
              ? t('common.cancel', { defaultValue: '取消' })
              : t('batchTag.skip', { defaultValue: '先不用' })}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        extraData={[selected, lastSaved]}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    scroll: {
      paddingHorizontal: 24,
      paddingTop: 36,
      paddingBottom: 24,
    },
    headerWrap: {
      marginBottom: 16,
    },
    iconWrap: {
      alignSelf: 'center',
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.piktag50,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.gray900,
      textAlign: 'center',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      color: c.gray500,
      textAlign: 'center',
      lineHeight: 20,
    },
    selectAllBtn: {
      alignSelf: 'flex-end',
      paddingVertical: 10,
      paddingHorizontal: 4,
    },
    selectAllText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.piktag600,
    },
    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.gray200,
      backgroundColor: c.white,
      marginBottom: 8,
    },
    personTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    personName: {
      fontSize: 15,
      fontWeight: '600',
      color: c.gray900,
    },
    personTags: {
      fontSize: 12,
      color: c.gray400,
      marginTop: 1,
    },
    checkWrap: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: c.gray300,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkWrapOn: {
      backgroundColor: c.piktag500,
      borderColor: c.piktag500,
    },
    footerWrap: {
      marginTop: 12,
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    presetChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.gray200,
      backgroundColor: c.gray50,
    },
    presetChipOn: {
      backgroundColor: c.piktag500,
      borderColor: c.piktag500,
    },
    presetChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.gray700,
    },
    presetChipTextOn: {
      color: '#FFFFFF',
    },
    input: {
      borderWidth: 1,
      borderColor: c.gray200,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 13,
      fontSize: 16,
      color: c.gray900,
      backgroundColor: c.white,
      marginBottom: 12,
    },
    savedToast: {
      fontSize: 13,
      color: c.piktag600,
      textAlign: 'center',
      marginBottom: 12,
      fontWeight: '600',
    },
    saveBtn: {
      backgroundColor: c.piktag500,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
    },
    saveBtnDisabled: {
      opacity: 0.4,
    },
    saveBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    skipBtn: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    skipText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.gray500,
    },
  });
}
