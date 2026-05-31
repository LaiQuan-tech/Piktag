// StatsLine.tsx
//
// Two small primitives for the "6 標籤 · 2 朋友 · 1 追蹤者 · 0 Tribe"
// row that appears on profile-style pages.
//
// Why TWO primitives, not one prop-driven `<StatsLine items={...} />`:
// the actual stat CONTENT varies wildly across screens — some are
// TouchableOpacity (tappable to navigate), some embed
// <OverlappingAvatars />, some are plain text. Expressing all that
// through a single items-array prop would either limit the
// composition (no avatars, no clicks) or balloon into a typed-enum
// monster. Cleaner: extract the LAYOUT chrome (row gap + dot
// separator typography) and let each screen own its stat content.
//
// Pre-extraction gap drift (founder caught the inconsistency
// 2026-05-31): gap 6 in FriendDetail vs gap 16 in UserDetail vs
// inline " · " text in ProfileScreen. Unified to gap 6 here — it
// reads tight enough that the "·" separators look like natural
// punctuation rather than free-floating bullets.

import React, { ReactNode, useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';

type RowProps = {
  children: ReactNode;
  /** Override the default marginBottom (default 14). Use 4 for "stats
   *  appear right above an action row" cases (UserDetailScreen). */
  style?: ViewStyle;
};

export function StatsRow({ children, style }: RowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={[styles.row, style]}>{children}</View>;
}

export function StatDot() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.dot}>·</Text>;
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 14,
    },
    dot: {
      fontSize: 14,
      color: c.gray500,
    },
  });
}
