import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { X, Pin } from 'lucide-react-native';
import { COLORS } from '../constants/theme';

type ChipItem = {
  id: string;
  label: string;
  isPinned?: boolean;
};

type Props = {
  items: ChipItem[];
  onReorder?: (items: ChipItem[]) => void;
  onRemove?: (item: ChipItem) => void;
  onDoubleTap?: (item: ChipItem) => void;
  onDragStateChange?: (isDragging: boolean) => void;
};

// Web fallback: non-draggable chips (no react-native-reanimated)
export default function DraggableChips({ items, onRemove, onDoubleTap }: Props) {
  return (
    <View style={styles.wrap}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={[styles.chip, item.isPinned && styles.chipPinned]}
          onLongPress={() => onDoubleTap?.(item)}
        >
          {item.isPinned && <Pin size={11} color={COLORS.piktag600} fill={COLORS.piktag600} />}
          <Text style={[styles.chipText, item.isPinned && styles.chipTextPinned]}>{item.label}</Text>
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
  chipPinned: { backgroundColor: '#FFFBEB', borderColor: COLORS.piktag400 },
  chipText: { fontSize: 14, fontWeight: '500', color: COLORS.gray900 },
  chipTextPinned: { fontWeight: '700', color: COLORS.piktag600 },
  chipX: { padding: 4 },
});
