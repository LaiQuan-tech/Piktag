import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../constants/theme';
import { useUserActiveAsk } from '../../hooks/useUserActiveAsk';

type UserAskCardProps = {
  /** Profile owner whose active Ask we're showing. Pass null to render nothing. */
  userId: string | null | undefined;
  /** Optional outer style override (e.g. horizontal padding to match parent). */
  style?: object;
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3600000));
}

/**
 * A compact Ask card shown on a user's profile-like screens (their own
 * ProfileScreen, plus FriendDetail / UserDetail). Renders nothing when
 * the user has no active ask — the card is purely additive, never a
 * placeholder.
 *
 * Design intent: same "purple gradient ring + Ask body + tag chips"
 * vocabulary as AskStoryRow, just laid out as a single full-width card
 * since a profile only has one author so the horizontally-scrollable
 * stories shape would be misleading.
 */
export default function UserAskCard({ userId, style }: UserAskCardProps) {
  const { t } = useTranslation();
  const ask = useUserActiveAsk(userId);

  const timeLeftText = useMemo(() => {
    if (!ask) return '';
    const h = hoursLeft(ask.expires_at);
    return h > 0 ? t('ask.timeLeft', { hours: h }) : t('ask.expired');
  }, [ask, t]);

  if (!ask) return null;

  const displayText = ask.title || ask.body;

  return (
    <View style={[styles.outer, style]}>
      <LinearGradient
        colors={['#ff5757', '#c44dff', '#8c52ff']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.inner}>
          <View style={styles.headerRow}>
            <Text style={styles.headerLabel}>{t('ask.cardLabel')}</Text>
            <Text style={styles.timeLeft}>{timeLeftText}</Text>
          </View>

          <Text style={styles.body} numberOfLines={3}>
            {displayText}
          </Text>

          {ask.tag_names.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tagScroll}
              contentContainerStyle={styles.tagRow}
            >
              {ask.tag_names.map((name) => (
                <View key={name} style={styles.tagChip}>
                  <Text style={styles.tagText}>#{name}</Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  gradient: {
    borderRadius: 16,
    padding: 2,
  },
  inner: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.piktag500,
    letterSpacing: 0.3,
  },
  timeLeft: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  body: {
    fontSize: 15,
    color: COLORS.gray900,
    lineHeight: 21,
    marginBottom: 10,
  },
  tagScroll: {
    flexGrow: 0,
  },
  tagRow: {
    gap: 6,
  },
  tagChip: {
    backgroundColor: COLORS.gray100,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.gray700,
  },
});
