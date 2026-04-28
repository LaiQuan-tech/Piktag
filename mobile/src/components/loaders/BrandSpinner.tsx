import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { COLORS } from '../../constants/theme';

/**
 * Brand-coloured rotating spinner used at micro-scale (in-button, toolbar,
 * inline status). The arc is a 90° wedge of the PikTag gradient
 * (`#ff5757 → #c44dff → #8c52ff`) sweeping a full revolution every 1.2s
 * with a small `piktag500` dot in the centre to anchor the eye.
 *
 * For larger / page-level loading use `<LogoLoader />` instead — this is
 * the small sibling.
 *
 * Respects `useReducedMotion()`: when reduced motion is enabled the
 * component renders a static centre dot (no rotating ring) so we still
 * occupy the same footprint without animating.
 */

export type BrandSpinnerSize = 16 | 20 | 24 | 32;

export type BrandSpinnerProps = {
  /** Outer diameter of the spinner. Defaults to 24. */
  size?: BrandSpinnerSize;
  style?: StyleProp<ViewStyle>;
};

// The stroke needs to scale with size so the arc reads at every step.
// Tuned by eye against a real device — 16/20 want a 2px stroke, 24 a
// 2.5px feel (rounded to 3 since SVG strokes look thin when antialiased
// over small radii) and 32 wants 3.5px.
function strokeForSize(size: BrandSpinnerSize): number {
  if (size <= 16) return 2;
  if (size <= 20) return 2;
  if (size <= 24) return 2.5;
  return 3;
}

// Centre dot diameter — small enough to feel like a focal anchor, never
// fighting with the arc. Caller-visible via `dotSize / 2` calc below.
function dotForSize(size: BrandSpinnerSize): number {
  if (size <= 16) return 3;
  if (size <= 20) return 3;
  if (size <= 24) return 4;
  return 5;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function BrandSpinnerImpl({ size = 24, style }: BrandSpinnerProps) {
  const reduced = useReducedMotion();
  const rotation = useSharedValue(0);
  const stroke = strokeForSize(size);
  const dotSize = dotForSize(size);

  // Inset by half the stroke width so the arc never bleeds out of the
  // SVG viewport — otherwise stroke is clipped on rotation frames.
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 90° arc = 1/4 of the full circumference; the remaining 3/4 is gap.
  const arcLength = circumference / 4;
  const dashOffset = circumference - arcLength;

  React.useEffect(() => {
    if (reduced) return;
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [reduced, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const containerStyle = useMemo<ViewStyle>(
    () => ({ width: size, height: size }),
    [size],
  );

  // Reduced-motion fallback: render only the central dot (matches the
  // visual footprint without spinning).
  if (reduced) {
    return (
      <View style={[styles.center, containerStyle, style]}>
        <View
          style={[
            styles.dot,
            { width: dotSize, height: dotSize, borderRadius: dotSize / 2 },
          ]}
        />
      </View>
    );
  }

  return (
    <View style={[styles.center, containerStyle, style]}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <LinearGradient id="brandSpinnerGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#ff5757" />
              <Stop offset="50%" stopColor="#c44dff" />
              <Stop offset="100%" stopColor="#8c52ff" />
            </LinearGradient>
          </Defs>
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#brandSpinnerGrad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${dashOffset}`}
            fill="transparent"
          />
        </Svg>
      </Animated.View>
      <View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            position: 'absolute',
          },
        ]}
      />
    </View>
  );
}

const BrandSpinner = React.memo(BrandSpinnerImpl);
BrandSpinner.displayName = 'BrandSpinner';

export default BrandSpinner;

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    backgroundColor: COLORS.piktag500,
  },
});
