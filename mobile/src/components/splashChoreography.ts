import { Animated, Easing } from 'react-native';

/**
 * Splash entry choreography — extracted from SplashOverlay so the
 * component file stays focused on rendering. Each function takes the
 * Animated.Values it controls and `.start()`s a timeline keyed off the
 * mount instant (t=0).
 *
 * Timing summary:
 *   0–350ms     curtain    white → transparent (reveals gradient)
 *                          + raw logo image fades to white-tinted via
 *                          interpolate(curtain) inside SplashOverlay,
 *                          so the logo color shifts from native splash
 *                          colors to the gradient-readable white in
 *                          lockstep with the backdrop.
 *   400–1000ms  bloom      opacity 0→0.4→0, scale 1→1.5 (one-shot)
 *   500–900ms   wordmark   translateY 10→0 + opacity 0→1
 *   850–1150ms  tagline    opacity 0→1
 *
 * Logo entry (scale 0.7→1, opacity 0→1) was REMOVED. Native splash
 * shows the logo at full size and full opacity; the JS overlay must
 * match that frame-for-frame to avoid the visual blink-out users were
 * reporting at hand-off. Logo is now full-size and visible from frame 1.
 */

export type SplashAnims = {
  whiteCurtain: Animated.Value;
  bloomScale: Animated.Value;
  bloomOpacity: Animated.Value;
  wordmarkY: Animated.Value;
  wordmarkOpacity: Animated.Value;
  taglineOpacity: Animated.Value;
};

export function runSplashEntryChoreography(a: SplashAnims): void {
  // Curtain reveal — out-quad keeps it from flashing too sharply on
  // slow renders that miss the first frame. The logo's white-tint
  // crossfade is driven off this same Animated.Value via interpolate
  // in SplashOverlay, so the color shift lands exactly when the
  // gradient becomes visible.
  Animated.timing(a.whiteCurtain, {
    toValue: 0,
    duration: 350,
    easing: Easing.out(Easing.quad),
    useNativeDriver: true,
  }).start();

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
