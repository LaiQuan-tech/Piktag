import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Animated, Platform } from 'react-native';

/**
 * IG-style launch overlay: small logo centered, 'from PikTag' at bottom.
 * Rendered on top of the app until the app reports `ready` (auth resolved +
 * first-screen data hydrated) or the safety-net max wait elapses.
 *
 * This complements the native Expo splash screen (which can only show a
 * static image). The native splash hides automatically when React mounts —
 * this component picks up from there to give the 'from PikTag' branding
 * moment while we wait for auth/data to come in.
 *
 * Previously this used a hard 700ms `setTimeout` that ignored real
 * readiness, which on slow networks either flashed the UI too early (data
 * still loading) or taxed the user unnecessarily (data already ready).
 * Now it fades out as soon as `ready` flips to `true`, with a 3s
 * safety-net ceiling so a stuck auth/data fetch can never wedge the
 * splash.
 */
type Props = {
  /** When true, the overlay begins fading out (respects MIN_DISPLAY_MS). */
  ready?: boolean;
  /** Safety-net max time to hold the splash (ms). Default 3000. */
  maxWaitMs?: number;
  onHidden?: () => void;
};

// Minimum display window so the brand moment still registers even if
// everything is instantly ready (warm-start, cached session, etc).
const MIN_DISPLAY_MS = 400;

export default function SplashOverlay({ ready = false, maxWaitMs = 3000, onHidden }: Props) {
  const opacity = useRef(new Animated.Value(1)).current;
  const fadedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    const fadeOut = () => {
      if (fadedRef.current) return;
      fadedRef.current = true;
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    };

    // Safety-net: never hold the splash longer than maxWaitMs, even if
    // `ready` never flips (broken auth, offline, etc). This runs
    // independently of the ready-driven timer below.
    const safetyTimer = setTimeout(fadeOut, maxWaitMs);

    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    if (ready) {
      const elapsed = Date.now() - mountedAtRef.current;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      readyTimer = setTimeout(fadeOut, remaining);
    }

    return () => {
      clearTimeout(safetyTimer);
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [ready, maxWaitMs, opacity, onHidden]);

  return (
    <Animated.View
      style={[styles.container, { opacity }]}
      pointerEvents="none"
    >
      <View style={styles.logoWrap}>
        <Image
          source={require('../../assets/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.bottomWrap}>
        <Text style={styles.fromLabel}>from</Text>
        <Text style={styles.brandLabel}>PikTag</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    zIndex: 9999,
  },
  // Absolute-fill layer so the logo sits at exact screen center — matches
  // where the native Expo splash renders it. The old flex layout put the
  // logo inside a `flex: 1` view above the bottomWrap, which shifted it
  // up by ~42px and caused a visible "jump" when the native splash
  // handed off to this overlay.
  logoWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 84,
    height: 84,
  },
  // Bottom branding floats over the logoWrap instead of displacing it.
  bottomWrap: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 48 : 36,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fromLabel: {
    fontSize: 13,
    color: '#8e8e93',
    marginBottom: 4,
  },
  brandLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
});
