// TagChip.tsx
//
// THE one "added tag + ×" chip. Use this anywhere a removable user
// tag is shown (EditLocalContact / AddTag / EditProfile "我的標籤").
// Do NOT hand-roll a per-screen tag pill — per-screen drift (border
// vs none, gray vs purple ×, with/without "#") is exactly the bug
// this component exists to prevent.
//
// Always renders `#<normalized>` (shared normalizeTagName strips a
// leading # then we re-add one) so the # is identical app-wide
// regardless of whether the caller stores names with or without it.
//
// Props:
//   • label     raw tag name (with or without leading #)
//   • onRemove  × tapped
//   • selected? thin brand ring (e.g. EditProfile tap-to-select);
//               border space is always reserved → no layout jump
//   • onPress?  whole-chip tap (omit → plain View, no press)

import React from 'react';
import {
  Pressable,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { normalizeTagName } from '../lib/normalizeTag';

type Props = {
  label: string;
  onRemove: () => void;
  selected?: boolean;
  onPress?: () => void;
};

export default function TagChip({ label, onRemove, selected, onPress }: Props) {
  const display = `#${normalizeTagName(label)}`;
  const inner = (
    <>
      <Text style={styles.text}>{display}</Text>
      <TouchableOpacity
        onPress={onRemove}
        style={styles.removeBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${display}`}
      >
        <X size={14} color={COLORS.gray400} />
      </TouchableOpacity>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        style={[styles.chip, selected && styles.chipSelected]}
        onPress={onPress}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={[styles.chip, selected && styles.chipSelected]}>{inner}</View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    borderWidth: 1,
    borderColor: 'transparent', // reserved → selected recolor, no jump
  },
  chipSelected: { borderColor: COLORS.piktag500 },
  text: { fontSize: 14, fontWeight: '500', color: COLORS.piktag600 },
  removeBtn: { padding: 3 },
});
