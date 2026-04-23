import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

// 8 pleasant muted/pastel colors that complement the PikTag aesthetic
const COLOR_PALETTE = [
  '#a8c5da', // muted blue
  '#b5d5c5', // muted green
  '#f5c6a0', // muted orange
  '#d4a8d4', // muted purple
  '#f5a8b4', // muted pink
  '#a8d4c8', // muted teal
  '#f5d4a8', // muted amber
  '#b4b8d4', // muted indigo
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32-bit int
  }
  const index = Math.abs(hash) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

type Props = {
  name: string;
  size: number;
  /**
   * Optional avatar image URL. When provided, the image is shown and the
   * initials color block is used as the loading/error placeholder so the
   * UI never flashes empty. If the image fails to load, we fall back to
   * initials automatically (matches IG behavior for broken avatars).
   */
  avatarUrl?: string | null;
  style?: object;
};

const InitialsAvatar = React.memo(({ name, size, avatarUrl, style }: Props) => {
  const backgroundColor = getColorFromName(name);
  const initials = getInitials(name);
  const fontSize = Math.round(size * 0.38);
  const borderRadius = size / 2;

  // Track image load failure per-instance so we gracefully fall back to
  // initials without flickering. useState (not useMemo) because the flag
  // must persist across re-renders once set.
  const [imageFailed, setImageFailed] = useState(false);

  const showImage = !!avatarUrl && !imageFailed;

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius, backgroundColor },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: avatarUrl as string }}
          style={{ width: size, height: size, borderRadius }}
          onError={() => setImageFailed(true)}
          // `cover` so portraits don't stretch; border-radius clips to circle.
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.text, { fontSize }]}>{initials}</Text>
      )}
    </View>
  );
});

InitialsAvatar.displayName = 'InitialsAvatar';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    color: '#4b5563',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});

export default InitialsAvatar;
