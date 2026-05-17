// QrNameCard.tsx
//
// The white "name card" that floats on the red→purple share
// gradient: QR on top, then @handle, then a name line, then an
// optional divider + hashtag line. ONE component so every "show
// someone my QR" surface stays pixel-identical:
//
//   • QrCodeModal               — personal-profile share (modal)
//   • QrGroupDetailScreen       — "認識新朋友" Tag QR (full screen)
//
// Both used to compose this card inline with their own copies of
// the styles, which is exactly how they drifted apart. Keep the
// shells (modal vs screen) and actions (2 vs 3 buttons) separate —
// only the card itself is shared.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS } from '../constants/theme';

type QrNameCardProps = {
  /** The string encoded in the QR (profile URL or Tag connect payload). */
  qrValue: string;
  /** Username WITHOUT the leading @ (the @ is rendered by the card). */
  handle?: string;
  /** Display name / Tag name shown under the handle. */
  name?: string;
  /** Tag names WITHOUT the leading # (the # is rendered by the card). */
  tags?: string[];
  /** QR pixel size. Defaults to 220 (the established share size). */
  qrSize?: number;
};

export default function QrNameCard({
  qrValue,
  handle,
  name,
  tags,
  qrSize = 220,
}: QrNameCardProps) {
  const cleanTags = (tags || [])
    .map((tg) => tg.replace(/^#/, '').trim())
    .filter(Boolean);

  return (
    <View style={styles.card}>
      {qrValue ? (
        <QRCode value={qrValue} size={qrSize} backgroundColor="#fff" />
      ) : null}
      {handle ? <Text style={styles.username}>@{handle}</Text> : null}
      {name ? (
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
      ) : null}
      {cleanTags.length > 0 ? (
        <View style={styles.tagsWrap}>
          <Text style={styles.tagsLine}>
            {cleanTags.map((tg) => '#' + tg).join('  ')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Lifted verbatim from QrGroupDetailScreen's old present-card styles
// so the "认识新朋友" card is unchanged and the profile modal now
// matches it exactly.
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: '#c44dff',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
    marginTop: 4,
  },
  tagsWrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    alignItems: 'center',
    width: '100%',
  },
  tagsLine: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '500',
    textAlign: 'center',
  },
});
