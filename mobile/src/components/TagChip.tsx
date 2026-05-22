// TagChip.tsx
//
// THE one user-tag chip. Use this anywhere a user tag is shown.
// Founder design contract — DO NOT VIOLATE:
//   • NO × on any chip anywhere in the app. Removal happens by
//     tapping the chip itself. (The previous tiny × button was an
//     accidental-trigger footgun and visually competed with the
//     pill content.)
//   • "已選=紫色" is now SOLID PIKTAG500 + WHITE text (founder,
//     2026-05-23 — reverses the prior "fill-only piktag50 +
//     piktag600" contract; matches the long-standing Ask sheet
//     style which the founder picked as the new canonical look).
//     Every selected/owned tag in the app — edit surfaces AND
//     view surfaces — uses this strong saturated colour. The old
//     "view tags must be gray to not compete with the CTA" rule
//     is retired: founder accepted the "wall of purple" trade-off
//     for stronger visual presence of owned tags.
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

import React, { useMemo } from 'react';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  // "已選=紫色 piktag500 實心 + 白字" — founder, 2026-05-23,
  // reverses the prior "fill-only piktag50 + piktag600" contract.
  // Every selected/owned tag chip app-wide now uses this strong
  // saturated look (matches the Ask sheet which was always this
  // colour). The 'toggle' variant's UN-selected state stays gray
  // (chipToggleOff) — that's the "recommended but not selected"
  // counterpart, no change there.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.piktag500,
    borderRadius: 9999,
    // Symmetric padding now that × is gone (was 14/8 with the icon
    // sitting on the right). The chip body IS the tappable region.
    paddingVertical: 8,
    paddingHorizontal: 14,
    // Reserve a border on the base so the toggle-OFF (gray) variant
    // can show a visible hairline with zero layout shift. The
    // selected/purple state keeps it transparent (the solid fill
    // is its own edge).
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // Gray toggle-OFF chips need a defined edge in dark mode — the
  // c.gray100 fill alone barely separates from a near-black page.
  chipToggleOff: { backgroundColor: c.gray100, borderColor: c.gray200 },
  text: { fontSize: 14, fontWeight: '500', color: '#FFFFFF' },
  textToggleOff: { color: c.gray700 },
  });
}
