import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Pencil, Plus } from 'lucide-react-native';

import InitialsAvatar from './InitialsAvatar';
import { COLORS } from '../constants/theme';

/**
 * Ring style applied around the avatar.
 * - `gradient`: brand purple gradient ring (3px) + white inner ring — hero / story-like surfaces.
 * - `subtle`: 1.5px solid `piktag100` border — inline list rows where a full gradient is too loud.
 * - `none`: no ring at all — InitialsAvatar at full `size`. Used by OverlappingAvatars stacks.
 */
export type RingStyle = 'gradient' | 'subtle' | 'none';

/** Decoration overlay placed bottom-right of the avatar. */
export type BadgeKind = 'plus' | 'pencil' | null;

export type RingedAvatarProps = {
  /** Display name — passed through to InitialsAvatar for fallback initials and color. */
  name: string;
  /** Outer dimension of the ring (the visible circle's diameter). */
  size: number;
  /** Optional avatar image URL. Falls back to initials when missing or load fails. */
  avatarUrl?: string | null;
  /** Ring variant. Defaults to `'gradient'`. */
  ringStyle?: RingStyle;
  /** Override ring gradient colors. Only applies when `ringStyle === 'gradient'`. */
  ringColors?: readonly [string, string, ...string[]];
  /** Optional decoration badge in the bottom-right corner. */
  badge?: BadgeKind;
  /** When supplied, renders the avatar as a Pressable with a pressed-opacity effect. */
  onPress?: () => void;
  /** Accessibility label — only attached when `onPress` is set. */
  accessibilityLabel?: string;
  /** Outer wrapper style for margin / positioning. Avoid sizing here — the component owns size. */
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_GRADIENT: readonly [string, string, string] = [
  '#ff5757',
  '#c44dff',
  '#8c52ff',
];

/**
 * Shared avatar surface that wraps `InitialsAvatar` with the brand gradient ring established by
 * `AskStoryRow`. Use `ringStyle` to pick the visual variant — gradient for hero surfaces, subtle
 * for inline rows, none when stacking (e.g. `OverlappingAvatars`).
 *
 * Badge sizing scales down for sub-48px avatars so the "+" / pencil decoration doesn't dominate
 * the icon at small sizes.
 */
function RingedAvatarImpl({
  name,
  size,
  avatarUrl,
  ringStyle = 'gradient',
  ringColors = DEFAULT_GRADIENT,
  badge = null,
  onPress,
  accessibilityLabel,
  style,
}: RingedAvatarProps) {
  // Sub-48px avatars get a smaller badge so the "+" doesn't visually overpower the photo.
  const isSmall = size < 48;
  const badgeDimension = isSmall ? 16 : 20;
  const badgeIconSize = isSmall ? 10 : 12;

  // Container matches the outer ring diameter so the absolute-positioned badge anchors correctly.
  const containerSizeStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  const badgeStyle: ViewStyle = {
    width: badgeDimension,
    height: badgeDimension,
    borderRadius: badgeDimension / 2,
  };

  let inner: React.ReactNode;

  if (ringStyle === 'gradient') {
    // 3px gradient padding → white inner ring → image. Mirrors AskStoryRow exactly.
    const innerSize = size - 6;
    const imageSize = size - 12;
    inner = (
      <LinearGradient
        colors={ringColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.gradientRing,
          containerSizeStyle,
        ]}
      >
        <View
          style={[
            styles.whiteRing,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerSize / 2,
            },
          ]}
        >
          <InitialsAvatar
            name={name}
            size={imageSize}
            avatarUrl={avatarUrl}
          />
        </View>
      </LinearGradient>
    );
  } else if (ringStyle === 'subtle') {
    // Single 1.5px border. Image gets size - 3 so the border doesn't crop the avatar.
    const imageSize = size - 3;
    inner = (
      <View
        style={[
          styles.subtleRing,
          containerSizeStyle,
        ]}
      >
        <InitialsAvatar
          name={name}
          size={imageSize}
          avatarUrl={avatarUrl}
        />
      </View>
    );
  } else {
    // 'none' — InitialsAvatar renders at full size with no wrapper ring.
    inner = (
      <InitialsAvatar
        name={name}
        size={size}
        avatarUrl={avatarUrl}
      />
    );
  }

  // Badge overhangs the ring by 2px on bottom/right so it visually breaks the circle silhouette.
  const badgeNode =
    badge === null ? null : (
      <View style={[styles.badge, badgeStyle]}>
        {badge === 'plus' ? (
          <Plus size={badgeIconSize} color={COLORS.white} strokeWidth={3} />
        ) : (
          <Pencil size={badgeIconSize} color={COLORS.white} strokeWidth={2.5} />
        )}
      </View>
    );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          styles.wrapper,
          containerSizeStyle,
          pressed && styles.pressed,
          style,
        ]}
      >
        {inner}
        {badgeNode}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.wrapper, containerSizeStyle, style]}
      accessibilityLabel={accessibilityLabel}
    >
      {inner}
      {badgeNode}
    </View>
  );
}

// Avatars in long lists re-render frequently — memo prevents wasted reconciles when props are stable.
const RingedAvatar = React.memo(RingedAvatarImpl);
RingedAvatar.displayName = 'RingedAvatar';

export default RingedAvatar;

// Styles are precomputed at module load — per-render style allocation would defeat the memo above.
const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  gradientRing: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
  },
  whiteRing: {
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  subtleRing: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.piktag100,
    padding: 0,
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: COLORS.piktag500,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.white,
  },
});
