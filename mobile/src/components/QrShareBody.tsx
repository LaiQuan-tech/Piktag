// QrShareBody.tsx
//
// The reusable inner-body of every "share my QR" surface: the
// vertically-centred QrNameCard + a row of white pill action
// buttons at the bottom. The OUTER scaffolding (Modal vs Screen,
// gradient backdrop, top bar) stays with each caller — those
// legitimately differ. Only the body content is shared, because
// THAT is where the visible-to-user spacing / padding / pill
// styling lives, and that's where the founder kept catching
// "外型類似但邊寬又不同" drift (2026-05-31).
//
// Callers:
//   • components/QrCodeModal.tsx        — personal-profile share (modal)
//   • screens/QrGroupDetailScreen.tsx   — saved-activity share (screen)
//   • screens/AddTagScreen.tsx          — new-activity create-flow preview
//
// What's shared (and therefore CANNOT drift):
//   • Card wrap layout (flex:1, centred, 32px horizontal padding)
//   • White QrNameCard (already a shared component for the card itself)
//   • Bottom row layout (16px horizontal padding, 10px gap, paddingTop:8)
//   • Pill button (#fff bg, 14px radius, 16px vertical padding, icon + label)
//   • Pill label typography (13px / 600 weight / #111827 hardcoded —
//     hardcoded because the pill bg is hardcoded white on a brand
//     gradient, and CLAUDE.md's "fixed bg pairs with fixed fg" rule
//     applies. theme-aware c.gray900 would flip near-white in dark
//     mode and disappear on the white pill.)

import React, { ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import QrNameCard from './QrNameCard';

export type QrShareAction = {
  /** Icon node — caller pre-sizes (typically `<Share2 size={22} color="#111827" />`). */
  icon: ReactNode;
  label: string;
  onPress: () => void;
};

type Props = {
  /** The string encoded in the QR (profile URL or Tag connect payload). */
  qrValue: string;
  /** Username WITHOUT the leading @ (the @ is rendered by QrNameCard). */
  handle?: string;
  /** Display name / activity name shown under the handle. */
  name?: string;
  /** Tag names WITHOUT the leading # (the # is rendered by QrNameCard). */
  tags?: string[];
  /** Bottom action buttons. Typically 2 (profile) or 3 (activity); each
   *  gets `flex: 1` so the row stretches edge-to-edge consistently
   *  regardless of count. */
  actions: QrShareAction[];
  /** SafeArea bottom inset — caller passes from useSafeAreaInsets so the
   *  bottom row clears the home indicator on devices that have one. */
  bottomInset?: number;
  /** Override the QR size; defaults to QrNameCard's 220. */
  qrSize?: number;
};

export default function QrShareBody({
  qrValue,
  handle,
  name,
  tags,
  actions,
  bottomInset = 0,
  qrSize,
}: Props) {
  return (
    <>
      <View style={styles.cardWrap}>
        <QrNameCard
          qrValue={qrValue}
          handle={handle}
          name={name}
          tags={tags}
          qrSize={qrSize}
        />
      </View>
      <View style={[styles.bottomRow, { paddingBottom: bottomInset + 20 }]}>
        {actions.map((action, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.bottomBtn}
            onPress={action.onPress}
            activeOpacity={0.7}
          >
            {action.icon}
            <Text style={styles.bottomBtnText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  bottomRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  bottomBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 8,
  },
  bottomBtnText: {
    fontSize: 13,
    fontWeight: '600',
    // Hardcoded — see the file header. This pill sits on hardcoded
    // white background on the brand gradient (NOT the page bg), so
    // text must also be hardcoded dark. CLAUDE.md "fixed bg pairs
    // with fixed fg" rule.
    color: '#111827',
  },
});
