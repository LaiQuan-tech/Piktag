import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';

import BrandSpinner from './loaders/BrandSpinner';
import {
  runReducedMotionEntry,
  runSplashEntryChoreography,
} from './splashChoreography';
import { splashStyles } from './splashStyles';

/**
 * v3 launch overlay — frame-for-frame seamless hand-off from native splash.
 *
 * Previous v2 had two visible glitches at the native→JS hand-off:
 *
 *   1. Logo POSITION jumped because v2 centered (logo + wordmark + tagline)
 *      as one flex column, pulling the logo upward off true screen center.
 *      Native splash centers the logo absolutely, so the position shift
 *      was visible as a "jump down then back up".
 *
 *   2. Logo VISIBILITY blinked because the v2 entry choreography started
 *      logo at scale 0.7 / opacity 0 and animated it in over 200–550ms.
 *      The first JS frame therefore showed an invisible logo over the
 *      white curtain — a brief blank-white moment before the spring.
 *
 * v3 fixes both by making the JS overlay's first frame IDENTICAL to the
 * native splash's last frame:
 *
 *   * Logo absolutely positioned at exact screen center (matches native)
 *   * Logo opacity 1 + scale 1 from frame 0 (no spring entry)
 *   * Two stacked Image instances: raw colors (matches native asset)
 *     and white-tinted (readable on the gradient). White-tint opacity
 *     is interpolated off `whiteCurtain` so the color crossfades in
 *     LOCKSTEP with the curtain dissolve — the user never sees a
 *     mid-transition mismatched logo color.
 *
 * Choreographed motion that REMAINS:
 *   0–350ms     White curtain → transparent (gradient revealed)
 *                + logo color crossfades raw → white via interpolate
 *   400–1000ms  Bloom pulse (one-shot, behind logo)
 *   500–900ms   Wordmark slides up + fades in
 *   850–1150ms  Tagline fades in
 *   ~1200ms+    "Still loading" spinner if `ready` hasn't fired
 *
 * Reduced-motion path: solid gradient + static logo + static text + a
 * 200ms fade-in / 300ms fade-out. No bloom, no slide, no curtain.
 */

type Props = {
  /** When true, the overlay begins fading out (respects MIN_DISPLAY_MS). */
  ready?: boolean;
  /** Safety-net max time to hold the splash (ms). Default MAX_HOLD_MS. */
  maxWaitMs?: number;
  onHidden?: () => void;
};

const MIN_DISPLAY_MS = 400;
const MAX_HOLD_MS = 3000;
// When we're still holding past this, swap in a small spinner under the
// tagline so the user understands the app is loading, not frozen.
const STILL_LOADING_THRESHOLD_MS = 1200;

const GRADIENT_COLORS: readonly [string, string, string] = [
  '#ff5757',
  '#c44dff',
  '#8c52ff',
];

export default function SplashOverlay({
  ready = false,
  maxWaitMs = MAX_HOLD_MS,
  onHidden,
}: Props) {
  const reduced = useReducedMotion();

  // ── Master fade ────────────────────────────────────────────────────
  const containerOpacity = useRef(new Animated.Value(reduced ? 0 : 1)).current;
  // White → gradient curtain. Starts opaque so the first frame visually
  // matches the native splash's white background; fades to transparent
  // as the choreography runs.
  const whiteCurtain = useRef(new Animated.Value(reduced ? 0 : 1)).current;

  // ── Bloom (one-shot radial pulse behind logo) ──────────────────────
  const bloomScale = useRef(new Animated.Value(1)).current;
  const bloomOpacity = useRef(new Animated.Value(0)).current;

  // ── Wordmark + tagline ─────────────────────────────────────────────
  const wordmarkY = useRef(new Animated.Value(reduced ? 0 : 10)).current;
  const wordmarkOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const taglineOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  // White-tinted logo opacity is derived from `whiteCurtain` rather than
  // animated independently — that guarantees the color crossfade lands
  // exactly when the gradient becomes visible (curtain at 0 → tint at 1).
  // Reduced motion path skips the curtain entirely, so the white-tinted
  // logo is fully visible from frame 1.
  const whiteTintOpacity = whiteCurtain.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const [showStillLoading, setShowStillLoading] = useState(false);
  const fadedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  // ── Entry choreography ─────────────────────────────────────────────
  useEffect(() => {
    if (reduced) {
      runReducedMotionEntry(containerOpacity);
      return;
    }
    runSplashEntryChoreography({
      whiteCurtain,
      bloomScale,
      bloomOpacity,
      wordmarkY,
      wordmarkOpacity,
      taglineOpacity,
    });
  }, [
    reduced,
    containerOpacity,
    whiteCurtain,
    bloomScale,
    bloomOpacity,
    wordmarkY,
    wordmarkOpacity,
    taglineOpacity,
  ]);

  // ── "Still loading" hint timer ─────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => {
      setShowStillLoading(true);
    }, STILL_LOADING_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, []);

  // ── Exit (ready-driven + safety net) ───────────────────────────────
  useEffect(() => {
    const fadeOut = () => {
      if (fadedRef.current) return;
      fadedRef.current = true;
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    };

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
  }, [ready, maxWaitMs, containerOpacity, onHidden]);

  return (
    <Animated.View
      style={[splashStyles.container, { opacity: containerOpacity }]}
      pointerEvents="none"
    >
      <LinearGradient
        colors={GRADIENT_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* White curtain — sits over the gradient and fades out to reveal
          it. Anchors the first JS frame visually to the native splash. */}
      <Animated.View
        pointerEvents="none"
        style={[splashStyles.whiteCurtain, { opacity: whiteCurtain }]}
      />

      {/* Bloom pulse rendered behind the logo. Centered on screen so it
          sits exactly under the logo regardless of the text below. */}
      <Animated.View
        pointerEvents="none"
        style={[
          splashStyles.bloom,
          {
            opacity: bloomOpacity,
            transform: [{ scale: bloomScale }],
          },
        ]}
      />

      {/* Logo at exact screen center. Two stacked Images crossfade
          between native-splash-matching raw colors and gradient-readable
          white tint as the curtain dissolves. */}
      <View style={splashStyles.logoCenter} pointerEvents="none">
        <Image
          source={require('../../assets/splash-icon.png')}
          contentFit="contain"
          style={splashStyles.logoImage}
        />
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: whiteTintOpacity }]}
        >
          <Image
            source={require('../../assets/splash-icon.png')}
            contentFit="contain"
            tintColor="#ffffff"
            style={splashStyles.logoImage}
          />
        </Animated.View>
      </View>

      {/* Text column anchored below the logo so it doesn't pull the
          logo off screen-center. Both lines are JS-only additions
          (native splash has no text), so fading them in from 0 is fine
          — there's no native counterpart to mismatch with. */}
      <View style={splashStyles.textBelow} pointerEvents="none">
        <Animated.Text
          style={[
            splashStyles.wordmark,
            {
              opacity: wordmarkOpacity,
              transform: [{ translateY: wordmarkY }],
            },
          ]}
        >
          PikTag
        </Animated.Text>

        {/* Brand slogan — locked to English in every locale. NOT
            wrapped in t() on purpose: this is the brand voice (think
            Nike's "Just Do It"), localizing it would dilute the
            global identity. Translators reading this file: please
            don't wire up an i18n key here. */}
        <Animated.Text
          style={[splashStyles.tagline, { opacity: taglineOpacity }]}
        >
          Pick. Tag. Connect.
        </Animated.Text>
      </View>

      {showStillLoading ? (
        <View style={splashStyles.stillLoading}>
          <BrandSpinner size={24} />
        </View>
      ) : null}
    </Animated.View>
  );
}
