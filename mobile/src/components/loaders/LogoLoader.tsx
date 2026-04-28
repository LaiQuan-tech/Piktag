import React, { useEffect, useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

/**
 * Brand-marked page loader: PikTag logo encircled by a thin gradient ring
 * that rotates while the app fetches data. The ring is intentionally
 * thinner-stroke than `<BrandSpinner />` because the logo provides the
 * visual weight; a thick stroke would compete with the wordmark.
 *
 * Two concurrent worklet animations run while mounted:
 *   1. Ring rotation — 360°/1.4s linear, infinite.
 *   2. Logo pulse — scale 1.0 ↔ 1.04, 1.6s ease-in-out, infinite.
 *
 * Both honour `useReducedMotion()`: when on, the component renders the
 * static logo with no ring, no spin, no pulse — exact same hit area, just
 * frozen.
 *
 * Use `<PageLoader />` for full-screen contexts (handles centring,
 * heading, subtitle). Drop this directly when you need just the mark
 * inside an existing layout.
 */

export type LogoLoaderSize = 48 | 64 | 96;

export type LogoLoaderProps = {
  /** Logo diameter (the ring renders at `size + 12`). Defaults to 64. */
  size?: LogoLoaderSize;
  style?: StyleProp<ViewStyle>;
};

// The wrapper sits 6px wider per side so the ring orbits without
// touching the logo glyph.
const RING_PADDING = 12;

function LogoLoaderImpl({ size = 64, style }: LogoLoaderProps) {
  const reduced = useReducedMotion();
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(1);

  const wrapperSize = size + RING_PADDING;
  // Stroke scales gently with size so the ring is visible but never
  // dominant against the logo. 48→2, 64→2.25, 96→2.75.
  const stroke = size <= 48 ? 2 : size <= 64 ? 2.25 : 2.75;
  const radius = (wrapperSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 90° sweep — same wedge geometry as BrandSpinner so the family reads
  // as a system.
  const arcLength = circumference / 4;
  const dashOffset = circumference - arcLength;

  useEffect(() => {
    if (reduced) return;
    rotation.value = 0;
    pulse.value = 1;
    rotation.value = withRepeat(
      withTiming(360, { duration: 1400, easing: Easing.linear }),
      -1,
      false,
    );
    // Easing.inOut keeps the pulse from feeling mechanical — the
    // acceleration/deceleration matches a heartbeat rather than a
    // linear breathe.
    pulse.value = withRepeat(
      withTiming(1.04, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [reduced, rotation, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const wrapperStyle = useMemo<ViewStyle>(
    () => ({ width: wrapperSize, height: wrapperSize }),
    [wrapperSize],
  );

  const logoSizeStyle = useMemo(
    () => ({ width: size, height: size }),
    [size],
  );

  if (reduced) {
    return (
      <View style={[styles.center, wrapperStyle, style]}>
        <Image
          source={require('../../../assets/splash-icon.png')}
          contentFit="contain"
          style={logoSizeStyle}
        />
      </View>
    );
  }

  return (
    <View style={[styles.center, wrapperStyle, style]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.center, ringStyle]}
      >
        <Svg
          width={wrapperSize}
          height={wrapperSize}
          viewBox={`0 0 ${wrapperSize} ${wrapperSize}`}
        >
          <Defs>
            <LinearGradient id="logoLoaderRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#ff5757" />
              <Stop offset="50%" stopColor="#c44dff" />
              <Stop offset="100%" stopColor="#8c52ff" />
            </LinearGradient>
          </Defs>
          <Circle
            cx={wrapperSize / 2}
            cy={wrapperSize / 2}
            r={radius}
            stroke="url(#logoLoaderRing)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${dashOffset}`}
            fill="transparent"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={logoStyle}>
        <Image
          source={require('../../../assets/splash-icon.png')}
          contentFit="contain"
          style={logoSizeStyle}
        />
      </Animated.View>
    </View>
  );
}

const LogoLoader = React.memo(LogoLoaderImpl);
LogoLoader.displayName = 'LogoLoader';

export default LogoLoader;

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
