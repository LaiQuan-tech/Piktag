import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'react-native-reanimated';

import BrandSpinner from './loaders/BrandSpinner';
import {
  runReducedMotionEntry,
  runSplashEntryChoreography,
} from './splashChoreography';
import { splashStyles } from './splashStyles';

/**
 * v2 launch overlay. Replaces the static white-bg + small-logo splash
 * with a full-bleed brand gradient and a choreographed entry sequence:
 *
 *   0–350ms     White overlay fades out, exposing the gradient.
 *   200–550ms   Logo enters: spring scale 0.7→1.0, opacity 0→1.
 *   400–1000ms  Radial bloom pulse behind the logo (one-shot).
 *   500–900ms   "PikTag" wordmark slides up + fades in.
 *   850–1150ms  Tagline (i18n: splash.tagline) fades in.
 *   ~1200ms+    If still not ready, surface a small spinner so the user
 *               knows we're still working (vs frozen).
 *
 * The same `ready / onHidden` API is preserved exactly so App.tsx and
 * any other mount points need no changes — only visuals are swapped.
 *
 * Constants:
 *   MIN_DISPLAY_MS — keep the brand moment on screen at least this long
 *                    even on warm starts where data is instantly ready.
 *   MAX_HOLD_MS    — safety net; if `ready` never fires (broken auth,
 *                    offline socket, etc), force-hide the overlay so the
 *                    app is never wedged behind a splash.
 *
 * Reduced-motion path: solid gradient + static logo + static text + a
 * 200ms fade-in / 300ms fade-out. No bloom, no slide, no pulse.
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
  const { t } = useTranslation();

  // ── Master fade ────────────────────────────────────────────────────
  const containerOpacity = useRef(new Animated.Value(reduced ? 0 : 1)).current;
  // White → gradient curtain. Starts opaque, fades to transparent so the
  // gradient underneath shows through.
  const whiteCurtain = useRef(new Animated.Value(reduced ? 0 : 1)).current;

  // ── Logo ───────────────────────────────────────────────────────────
  const logoScale = useRef(new Animated.Value(reduced ? 1 : 0.7)).current;
  const logoOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  // ── Bloom (one-shot radial pulse behind logo) ──────────────────────
  const bloomScale = useRef(new Animated.Value(1)).current;
  const bloomOpacity = useRef(new Animated.Value(0)).current;

  // ── Wordmark + tagline ─────────────────────────────────────────────
  const wordmarkY = useRef(new Animated.Value(reduced ? 0 : 10)).current;
  const wordmarkOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const taglineOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  const [showStillLoading, setShowStillLoading] = useState(false);
  const fadedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  // ── Entry choreography ─────────────────────────────────────────────
  // Kicked once on mount; never re-runs. The actual timeline lives in
  // ./splashChoreography so this file stays focused on rendering and
  // the lifecycle wiring (mount fade, ready-driven exit, safety net).
  useEffect(() => {
    if (reduced) {
      runReducedMotionEntry(containerOpacity);
      return;
    }
    runSplashEntryChoreography({
      whiteCurtain,
      logoScale,
      logoOpacity,
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
    logoScale,
    logoOpacity,
    bloomScale,
    bloomOpacity,
    wordmarkY,
    wordmarkOpacity,
    taglineOpacity,
  ]);

  // ── "Still loading" hint timer ─────────────────────────────────────
  // Fires once — after the choreography settles, if we're still holding
  // we drop in a small spinner so the user sees motion. Cleared if the
  // component unmounts or fades out first.
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

    // Safety-net: never hold the splash longer than maxWaitMs. Runs
    // independently of `ready` so a stuck auth flow can't wedge us.
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

      {/* White curtain — sits over the gradient and fades out to reveal it. */}
      <Animated.View
        pointerEvents="none"
        style={[splashStyles.whiteCurtain, { opacity: whiteCurtain }]}
      />

      <View style={splashStyles.center}>
        {/* Bloom pulse rendered behind the logo. Sized 1.5x logo, scales
            outward while fading. */}
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

        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          }}
        >
          <Image
            source={require('../../assets/splash-icon.png')}
            contentFit="contain"
            style={splashStyles.logo}
          />
        </Animated.View>

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

        <Animated.Text
          style={[splashStyles.tagline, { opacity: taglineOpacity }]}
        >
          {t('splash.tagline', { defaultValue: '用標籤記住每段緣分' })}
        </Animated.Text>

        {showStillLoading ? (
          <View style={splashStyles.stillLoading}>
            <BrandSpinner size={24} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}
