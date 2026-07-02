// BatchTagScreen — "同一場合認識的嗎?" one-move tagging for a connection
// burst (founder 2026-07-03, event-tag rework 方向一; see lib/burstTag.ts
// for the detection). Reached from ScanResultScreen when the last hour's
// adds hit the burst threshold; params carry the cohort so this screen
// does zero re-querying.
//
// Writes the SAME data shape the event-QR scan flow writes: private
// connection tags (piktag_connection_tags, is_private=true) on the
// owner's own connection rows — owner-only "where/how we met" context,
// findable via the Friends-page tag filter, never enters the matching
// algorithm. This screen is also the seed of the future full batch-tag
// feature (that version widens the cohort from "the burst" to "pick any
// friends").

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Check, Tag } from 'lucide-react-native';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { findOrCreateTag } from '../lib/userTags';
import { normalizeTagName } from '../lib/normalizeTag';
import { trackBurstTagPromptShown, trackBurstTagApplied } from '../lib/analytics';
import type { BurstPerson } from '../lib/burstTag';

type Props = {
  navigation: any;
  route: {
    params?: {
      people?: BurstPerson[];
      // Where to land afterwards — ScanResult passes the just-added friend
      // so save/skip both end on FriendDetail, keeping the flow linear.
      next?: { friendId: string; connectionId: string };
    };
  };
};

export default function BatchTagScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const people: BurstPerson[] = route.params?.people ?? [];
  const next = route.params?.next;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(people.map((p) => p.connectionId)),
  );
  const [tagName, setTagName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    trackBurstTagPromptShown(people.length);
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

  const toggle = (connectionId: string) => {
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(connectionId)) nextSet.delete(connectionId);
      else nextSet.add(connectionId);
      return nextSet;
    });
  };

  const canSave = !saving && selected.size > 0 && normalizeTagName(tagName).length > 0;

  const handleSave = async () => {
    const name = normalizeTagName(tagName);
    if (!name || selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const tagId = await findOrCreateTag(name);
      if (!tagId) {
        leave();
        return;
      }
      const ids = [...selected];
      // Dedupe against rows that already carry this tag (re-runs, or the
      // scan flow already attached it) — insert only the missing pairs.
      const { data: existing } = await supabase
        .from('piktag_connection_tags')
        .select('connection_id')
        .eq('tag_id', tagId)
        .in('connection_id', ids);
      const has = new Set((existing ?? []).map((r: any) => r.connection_id));
      const rows = ids
        .filter((id) => !has.has(id))
        .map((id) => ({ connection_id: id, tag_id: tagId, is_private: true }));
      if (rows.length > 0) {
        await supabase.from('piktag_connection_tags').insert(rows);
      }
      trackBurstTagApplied(people.length, ids.length);
    } catch {
      // Best-effort — a failed batch write should never trap the user here.
    } finally {
      setSaving(false);
      leave();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconWrap}>
          <Tag size={28} color={colors.piktag500} />
        </View>
        <Text style={styles.title}>
          {t('batchTag.title', { defaultValue: '同一場合認識的嗎？' })}
        </Text>
        <Text style={styles.subtitle}>
          {t('batchTag.subtitle', {
            count: people.length,
            defaultValue: '過去一小時你加了 {{count}} 位朋友 — 一次幫他們加上這場活動的標籤。',
          })}
        </Text>

        <View style={styles.peopleList}>
          {people.map((p) => {
            const on = selected.has(p.connectionId);
            return (
              <TouchableOpacity
                key={p.connectionId}
                style={styles.personRow}
                activeOpacity={0.7}
                onPress={() => toggle(p.connectionId)}
              >
                {p.avatarUrl ? (
                  <Image source={{ uri: p.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>
                      {(p.name || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.personName} numberOfLines={1}>
                  {p.name}
                </Text>
                <View style={[styles.checkWrap, on && styles.checkWrapOn]}>
                  {on ? <Check size={14} color={'#FFFFFF'} /> : null}
                </View>
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
            {t('batchTag.skip', { defaultValue: '先不用' })}
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 36,
      paddingBottom: 24,
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
      marginBottom: 20,
    },
    peopleList: {
      gap: 8,
      marginBottom: 20,
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
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    avatarFallback: {
      backgroundColor: c.piktag50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: {
      fontSize: 16,
      fontWeight: '700',
      color: c.piktag600,
    },
    personName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: c.gray900,
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
    input: {
      borderWidth: 1,
      borderColor: c.gray200,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 13,
      fontSize: 16,
      color: c.gray900,
      backgroundColor: c.white,
      marginBottom: 16,
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
