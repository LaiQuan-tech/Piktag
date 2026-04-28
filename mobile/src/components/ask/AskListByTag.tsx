import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants/theme';
import { useAsksByTag } from '../../hooks/useAsksByTag';
import InitialsAvatar from '../InitialsAvatar';

type AskListByTagProps = {
  tagId: string | null | undefined;
  onPressAsk?: (userId: string) => void;
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
}

/**
 * Renders all active Asks tagged with `tagId` as a vertical list of
 * compact cards. Designed for TagDetailScreen so a viewer can quickly
 * scan "who is currently asking about #X" before drilling into the
 * tab-by-tab user lists below.
 *
 * Renders nothing when there are no asks — keeps the surface clean
 * for tags that have no active discovery moment.
 */
export default function AskListByTag({ tagId, onPressAsk }: AskListByTagProps) {
  const { t } = useTranslation();
  const asks = useAsksByTag(tagId);

  const handlePress = useCallback(
    (userId: string) => {
      onPressAsk?.(userId);
    },
    [onPressAsk],
  );

  const sectionTitle = useMemo(() => t('ask.askingNow'), [t]);

  if (asks.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{sectionTitle}</Text>
      {asks.map((ask) => {
        const name = ask.author_full_name || ask.author_username || '?';
        const text = ask.title || ask.body;
        const h = hoursLeft(ask.expires_at);
        const time = h > 0 ? t('ask.timeLeft', { hours: h }) : t('ask.expired');
        return (
          <TouchableOpacity
            key={ask.ask_id}
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => handlePress(ask.author_id)}
          >
            <View style={styles.headerRow}>
              {ask.author_avatar_url ? (
                <Image
                  source={{ uri: ask.author_avatar_url }}
                  style={styles.avatar}
                  cachePolicy="memory-disk"
                />
              ) : (
                <InitialsAvatar name={name} size={32} style={styles.avatar} />
              )}
              <View style={styles.nameWrap}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <Text style={styles.time}>{time}</Text>
              </View>
            </View>
            <Text style={styles.body} numberOfLines={2}>{text}</Text>
            {ask.tag_names.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tagRow}
              >
                {ask.tag_names.map((n) => (
                  <View key={n} style={styles.tagChip}>
                    <Text style={styles.tagText}>#{n}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray700,
    marginBottom: 4,
  },
  card: {
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.gray200,
  },
  nameWrap: {
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  time: {
    fontSize: 11,
    color: COLORS.gray500,
    marginTop: 1,
  },
  body: {
    fontSize: 14,
    color: COLORS.gray800,
    lineHeight: 20,
  },
  tagRow: {
    gap: 6,
    paddingTop: 4,
  },
  tagChip: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray700,
  },
});
