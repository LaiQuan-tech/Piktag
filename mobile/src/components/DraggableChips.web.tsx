import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';

type ChipItem = {
  id: string;
  label: string;
  // isPinned removed when the pin feature was pulled (commit e11a9d6).
};

type Props = {
  items: ChipItem[];
  onReorder?: (items: ChipItem[]) => void;
  onRemove?: (item: ChipItem) => void;
  // onDoubleTap kept on the type for future re-introduction; no
  // current caller passes it.
  onDoubleTap?: (item: ChipItem) => void;
  onDragStateChange?: (isDragging: boolean) => void;
};

// Web fallback: non-draggable chips (no react-native-reanimated)
export default function DraggableChips({ items, onRemove }: Props) {
  return (
    <View style={styles.wrap}>
      {items.map((item) => (
        <Pressable key={item.id} style={styles.chip}>
          <Text style={styles.chipText}>{item.label}</Text>
          <Pressable onPress={() => onRemove?.(item)} style={styles.chipX}>
            <X size={14} color={COLORS.gray400} />
          </Pressable>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.gray100, borderRadius: 20,
    paddingVertical: 8, paddingLeft: 14, paddingRight: 6,
    borderWidth: 2, borderColor: 'transparent',
  },
  chipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray900 },
  chipX: { padding: 4 },
});
