// TagChip.tsx
//
// THE one user-tag chip. Use this anywhere a user tag is shown.
// Founder design contract — DO NOT VIOLATE:
//   • NO × on any chip anywhere in the app. Removal happens by
//     tapping the chip itself. (The previous tiny × button was an
//     accidental-trigger footgun and visually competed with the
//     pill content.)
//   • "已選=紫色" is FILL-ONLY (piktag50 bg + piktag600 text, no
//     piktag500 outline). The chip body IS the purple — borders
//     would read as "outlined chip" and clash with the same-colour
//     primary CTAs reserved for screen-level actions.
//
// Always renders `#<normalized>` (shared normalizeTagName strips a
// leading # then we re-add one) so the # is identical app-wide
// regardless of whether the caller stores names with or without it.
//
// Two variants — one component, never a per-screen copy:
//   • 'removable' (default) — the chip IS the remove affordance:
//     the entire pill is Pressable and tap calls onRemove. Visual =
//     purple fill (selected/owned). Used where the chip represents
//     a tag the user can remove from a list (EditLocalContact edit
//     form, AddTag custom tag list).
//   • 'toggle' — the chip's colour is driven by `selected`:
//     unselected = gray, selected = purple. The caller owns tap
//     behaviour via onPress (e.g. EditProfile "我的標籤" where tap
//     stages a removal; LocalContactDetail read view passes neither
//     selected nor onPress → static gray display chip).
//
// Props:
//   • label     raw tag name (with or without leading #)
//   • variant?  'removable' (default) | 'toggle'
//   • onRemove? required in practice for 'removable'; tap target.
//   • selected? 'toggle' only — gray↔purple. (No-op on 'removable',
//               which is always purple.)
//   • onPress?  whole-chip tap for 'toggle'. Ignored for
//               'removable' (tap is bound to onRemove there).

import React from 'react';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
} from 'react-native';
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

  // Toggle: selected=purple (chip base) / unselected=gray override.
  // Removable: always purple (chip base) regardless of selected.
  const chipStyle = isToggle && !selected ? [styles.chip, styles.chipToggleOff] : styles.chip;
  const textStyle = isToggle && !selected ? [styles.text, styles.textToggleOff] : styles.text;

  // Effective tap binding: removable → onRemove (whole pill = tap to
  // remove, no ×). Toggle → onPress (caller owns the semantic).
  const handlePress = isToggle ? onPress : onRemove;

  const inner = <Text style={textStyle}>{display}</Text>;

  if (handlePress) {
    return (
      <Pressable
        style={chipStyle}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={isToggle ? display : `Remove ${display}`}
      >
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
    backgroundColor: COLORS.piktag50,
    borderRadius: 9999,
    // Symmetric padding now that × is gone (was 14/8 with the icon
    // sitting on the right). The chip body IS the tappable region.
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipToggleOff: { backgroundColor: COLORS.gray100 },
  text: { fontSize: 14, fontWeight: '500', color: COLORS.piktag600 },
  textToggleOff: { color: COLORS.gray700 },
});
