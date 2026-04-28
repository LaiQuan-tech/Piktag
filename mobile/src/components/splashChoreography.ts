import { Animated, Easing } from 'react-native';

/**
 * Splash entry choreography — extracted from SplashOverlay so the
 * component file stays focused on rendering. Each function takes the
 * Animated.Values it controls and `.start()`s a timeline keyed off the
 * mount instant (t=0).
 *
 * Timing summary:
 *   0–350ms     curtain    white → transparent (reveals gradient)
 *   200–550ms   logo       scale 0.7→1 (spring) + opacity 0→1
 *   400–1000ms  bloom      opacity 0→0.4→0, scale 1→1.5 (one-shot)
 *   500–900ms   wordmark   translateY 10→0 + opacity 0→1
 *   850–1150ms  tagline    opacity 0→1
 */

export type SplashAnims = {
  whiteCurtain: Animated.Value;
  logoScale: Animated.Value;
  logoOpacity: Animated.Value;
  bloomScale: Animated.Value;
  bloomOpacity: Animated.Value;
  wordmarkY: Animated.Value;
  wordmarkOpacity: Animated.Value;
  taglineOpacity: Animated.Value;
};

export function runSplashEntryChoreography(a: SplashAnims): void {
  // Curtain reveal — out-quad keeps it from flashing too sharply on
  // slow renders that miss the first frame.
  Animated.timing(a.whiteCurtain, {
    toValue: 0,
    duration: 350,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  }).start();

  // Logo entry — spring matches the spec (damping 10, stiffness 120).
  Animated.parallel([
    Animated.spring(a.logoScale, {
      toValue: 1,
      damping: 10,
      stiffness: 120,
      delay: 200,
      useNativeDriver: true,
    }),
    Animated.timing(a.logoOpacity, {
      toValue: 1,
      duration: 350,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }),
  ]).start();

  // Bloom pulse — quick fade-in (100ms) so it feels reactive to the
  // logo landing, then a slower fade-out (200ms) so it dissolves rather
  // than disappears.
  Animated.sequence([
    Animated.delay(400),
    Animated.parallel([
      Animated.timing(a.bloomOpacity, {
        toValue: 0.4,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(a.bloomScale, {
        toValue: 1.5,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]),
    Animated.timing(a.bloomOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }),
  ]).start();

  // Wordmark slide-up + fade.
  Animated.parallel([
    Animated.timing(a.wordmarkY, {
      toValue: 0,
      duration: 400,
      delay: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }),
    Animated.timing(a.wordmarkOpacity, {
      toValue: 1,
      duration: 400,
      delay: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }),
  ]).start();

  // Tagline — softest entry, last in the sequence.
  Animated.timing(a.taglineOpacity, {
    toValue: 1,
    duration: 300,
    delay: 850,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start();
}

/**
 * Reduced-motion entry: a single 200ms fade-in on the container. The
 * caller still owns the container Animated.Value; this helper just
 * exists so the SplashOverlay component reads as "either run the
 * choreography OR run the static fade".
 */
export function runReducedMotionEntry(containerOpacity: Animated.Value): void {
  Animated.timing(containerOpacity, {
    toValue: 1,
    duration: 200,
    useNativeDriver: true,
  }).start();
}
