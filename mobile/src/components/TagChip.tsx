// TagChip.tsx
//
// THE one user-tag chip. Use this anywhere a user tag is shown
// (EditLocalContact / AddTag / EditProfile "我的標籤"). Do NOT
// hand-roll a per-screen tag pill — per-screen drift (border vs
// none, gray vs purple ×, with/without "#") is exactly the bug
// this component exists to prevent.
//
// Always renders `#<normalized>` (shared normalizeTagName strips a
// leading # then we re-add one) so the # is identical app-wide
// regardless of whether the caller stores names with or without it.
//
// Two variants — one component, never a per-screen copy:
//   • 'removable' (default) — "#tag ×". The × deletes. Used where
//     removal is harmless/cheap (EditLocalContact, AddTag, the
//     EditProfile web fallback's add-list).
//   • 'toggle' — NO ×. A plain pill whose look is driven by
//     `selected`: gray = not selected, purple = selected. Removal
//     is a deliberate two-step the *caller* owns (tap → purple →
//     tap → gone). Used for EditProfile "我的標籤" where an
//     accidental one-tap delete was a real footgun.
//
// Props:
//   • label     raw tag name (with or without leading #)
//   • variant?  'removable' (default) | 'toggle'
//   • onRemove? × tapped — required in practice for 'removable',
//               unused by 'toggle'
//   • selected? 'removable': thin brand ring (border space is always
//               reserved → no layout jump). 'toggle': gray↔purple.
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
  variant?: 'removable' | 'toggle';
  onRemove?: () => void;
  selected?: boolean;
  onPress?: () => void;
};

export default function TagChip({
  label,
  variant = 'removable',
  onRemove,
  selected,
  onPress,
}: Props) {
  const display = `#${normalizeTagName(label)}`;
  const isToggle = variant === 'toggle';

  const chipStyle = isToggle
    ? [styles.chip, selected ? styles.chipSelected : styles.chipToggleOff]
    : [styles.chip, selected && styles.chipSelected];
  const textStyle =
    isToggle && !selected ? [styles.text, styles.textToggleOff] : styles.text;

  const inner = (
    <>
      <Text style={textStyle}>{display}</Text>
      {!isToggle && (
        <TouchableOpacity
          onPress={onRemove}
          style={styles.removeBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${display}`}
        >
          <X size={14} color={COLORS.gray400} />
        </TouchableOpacity>
      )}
    </>
  );
  if (onPress) {
    return (
      <Pressable style={chipStyle} onPress={onPress}>
        {inner}
      </Pressable>
    );
  }
  return <View style={chipStyle}>{inner}</View>;
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
  // "已選=紫色" aesthetic, founder definitive: fill-only, no border.
  // Selected state visually = chip base (piktag50 bg + piktag600 text).
  // Kept as an empty rule so the chipStyle render logic stays intact
  // and the prop semantics remain — the slot is just visually a no-op.
  chipSelected: {},
  // 'toggle' unselected = gray. Border stays reserved (transparent)
  // so toggling gray↔purple never shifts layout.
  chipToggleOff: {
    backgroundColor: COLORS.gray100,
    borderColor: 'transparent',
  },
  text: { fontSize: 14, fontWeight: '500', color: COLORS.piktag600 },
  textToggleOff: { color: COLORS.gray700 },
  removeBtn: { padding: 3 },
});
