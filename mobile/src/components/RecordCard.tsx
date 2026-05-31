// RecordCard.tsx
//
// "Static row inside a rounded gray-50 tile" — used for birthday /
// anniversary / reminder lines on detail pages. Icon + label + value
// in a horizontal row.
//
// Pre-extraction, this was byte-identical (recordCard + reminderRow
// + recordLabel + recordValue styles) in:
//   • FriendDetailScreen
//   • LocalContactDetailScreen
// Extracted 2026-05-31 to prevent future drift (task #38 follow-up).
// Any new contact-style screen that wants a birthday row picks this
// up automatically.

import React, { ReactNode, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';

type Props = {
  /** Pre-sized icon (typically `<Gift size={16} color={colors.pink500} />`). */
  icon: ReactNode;
  label: string;
  value: string;
};

export default function RecordCard({ icon, label, value }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {icon}
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.gray50,
      borderRadius: 16,
      padding: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    label: {
      fontSize: 14,
      color: c.gray500,
      width: 70,
    },
    value: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
      color: c.gray900,
    },
  });
}
