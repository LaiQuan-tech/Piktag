// SectionTitle.tsx
//
// Single source of truth for the small header labels above sections
// on detail-style + form-style pages. Two visual variants because
// the codebase legitimately has TWO distinct conventions:
//
//   variant="detail"  (the IG-Settings small-uppercase look)
//     - 13px / gray500 / 700 weight / UPPERCASE / letterSpacing 0.8
//     - Used on: ProfileScreen, FriendDetailScreen, UserDetailScreen,
//       EditLocalContactScreen, QrGroupDetailScreen
//
//   variant="form"  (the form-section title look)
//     - 16px / gray900 / 700 weight / normal case
//     - Used on: EditProfileScreen, AddTagScreen, ScanResultScreen,
//       SocialStatsScreen, ManageTagsScreen (was 18px, normalized to 16)
//
// Pre-extraction drift the founder asked to clean (2026-05-31):
//   - QrGroupDetailScreen had gray600 + letterSpacing 0.3 instead
//     of gray500 + letterSpacing 0.8 (off-by-a-shade within the
//     detail family)
//   - ManageTagsScreen had fontSize 18 instead of 16 (oversized
//     compared to the form family)
// Both fixed by the migration to this component.

import React, { useMemo } from 'react';
import { Text, StyleSheet, type TextStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';

export type SectionTitleVariant = 'detail' | 'form';

type Props = {
  children: string;
  variant?: SectionTitleVariant;
  /** Per-instance override (e.g. tighter marginTop next to a divider). */
  style?: TextStyle;
};

export default function SectionTitle({
  children,
  variant = 'detail',
  style,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors, variant), [colors, variant]);
  return <Text style={[styles.title, style]}>{children}</Text>;
}

function makeStyles(c: ColorPalette, variant: SectionTitleVariant) {
  if (variant === 'detail') {
    return StyleSheet.create({
      title: {
        fontSize: 13,
        fontWeight: '700',
        color: c.gray500,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        paddingHorizontal: 20,
        marginBottom: 12,
        marginTop: 12,
      },
    });
  }
  return StyleSheet.create({
    title: {
      fontSize: 16,
      fontWeight: '700',
      color: c.gray900,
      // No paddingHorizontal — form-screen parents already pad
      // (typically ScrollView contentContainerStyle), unlike detail
      // pages where the section title sits at the screen root.
      marginBottom: 12,
    },
  });
}
