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
 * inline status). The arc is a 270° wedge of the PikTag gradient
 * (`#ff5757 → #c44dff → #8c52ff`) sweeping a full revolution every 1s.
 *
 * Why 270° + no centre dot: earlier iteration used a 90° arc with a
 * `piktag500` centre dot. At size 16 the short gradient arc was visually
 * invisible — only the dot read, so the spinner looked like a static "•"
 * and users couldn't tell anything was loading. Switching to a 3/4 ring
 * with no anchoring dot makes it unmistakably a loading indicator at any
 * size, matching the universal pattern (Material, iOS, ChatGPT, etc.).
 *
 * For larger / page-level loading use `<LogoLoader />` instead — this is
 * the small sibling.
 *
 * Respects `useReducedMotion()`: when reduced motion is enabled the
 * component renders a static (non-rotating) brand-purple ring so we
 * still communicate "in progress" visually without animating.
 */

export type BrandSpinnerSize = 16 | 20 | 24 | 32;

export type BrandSpinnerProps = {
  /** Outer diameter of the spinner. Defaults to 24. */
  size?: BrandSpinnerSize;
  style?: StyleProp<ViewStyle>;
};

// The stroke needs to scale with size so the arc reads at every step.
// Bumped from the previous (90°-arc) tuning because the new 270° arc
// asks more of the stroke at small sizes. Tested on iPhone — 16px now
// reads clearly as a 3/4 ring rather than a fuzzy line.
function strokeForSize(size: BrandSpinnerSize): number {
  if (size <= 16) return 2.5;
  if (size <= 20) return 2.5;
  if (size <= 24) return 3;
  return 3.5;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function BrandSpinnerImpl({ size = 24, style }: BrandSpinnerProps) {
  const reduced = useReducedMotion();
  const rotation = useSharedValue(0);
  const stroke = strokeForSize(size);

  // Inset by half the stroke width so the arc never bleeds out of the
  // SVG viewport — otherwise stroke is clipped on rotation frames.
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 270° arc = 3/4 of circumference (visible "ring with one gap"); the
  // remaining 1/4 is the open gap that gives the spinning shape its
  // "loading" reading. This is the universal indeterminate-progress
  // ratio (Material, iOS UIActivityIndicator, etc.).
  const arcLength = circumference * 0.75;
  const dashOffset = circumference - arcLength;

  React.useEffect(() => {
    if (reduced) return;
    rotation.value = 0;
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
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

  // Reduced-motion fallback: render the same 3/4 ring statically (no
  // rotation), so accessibility users still see a "loading shape"
  // instead of a featureless dot.
  if (reduced) {
    return (
      <View style={[styles.center, containerStyle, style]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={COLORS.piktag500}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${dashOffset}`}
            fill="transparent"
          />
        </Svg>
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
});
