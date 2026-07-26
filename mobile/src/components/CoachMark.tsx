// CoachMark.tsx
//
// THE one-time hint bubble. Use this — never copy-paste a tooltip per
// screen (shared-UI-is-one-component founder rule).
//
// Behaviour: shows once per `hintId`, fades in after the screen settles,
// dismisses on tap (anywhere on the bubble) and never returns — state is
// persisted device-side via useCoachMark (same one-shot pattern as the
// phone / push prompts). NON-BLOCKING: the container is pointerEvents
// "box-none" so only the bubble itself captures touches; the page's CTA
// and scrolling underneath keep working, and nothing gates navigation.
//
// Design contract:
//   • NO emoji in `text` (app-wide rule).
//   • It is a HINT, not a CTA — a plain dark surface, deliberately NOT
//     the signature gradient and NOT a solid-purple submit pill, so it
//     never competes with the one gradient CTA a page is allowed.
//   • Fixed foreground (white) on a fixed-family dark surface, per the
//     dark-mode rule. The surface has TWO fixed values (one for light
//     pages, a lighter one for dark pages) purely so the bubble lifts off
//     the page in both themes — both are dark, so white text is always
//     correct.
//   • NO hairline border: a 1px high-contrast outline on a dark fill is
//     what made the first pass read as cheap. Separation comes from the
//     surface/page contrast plus a soft shadow.
//   • The arrow is a REAL triangle (transparent side borders + one solid
//     edge), not a rotated bordered square — the rotated-square trick
//     leaves a visible seam and corner where it meets the bubble.
//
// Props:
//   • hintId       stable key; the storage namespace (piktag_coach_<id>).
//   • text         the hint copy (already localized by the caller).
//   • style?       absolute positioning from the page (top/left/right).
//   • arrow?       'up' | 'down' | 'none' (default 'none').
//   • arrowAlign?  'left' | 'center' | 'right' — put the arrow under the
//                  feature being taught. A full-width bubble with a
//                  centred arrow points at nothing when the anchor is a
//                  top-right icon.
//   • dismissLabel? overrides the default "知道了" affordance text.
import React, { useMemo, useRef, useEffect } from 'react';
import {
  Animated,
  Pressable,
  Text,
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
  Easing,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useCoachMark } from '../hooks/useCoachMark';

type ArrowDir = 'up' | 'down' | 'none';
type ArrowAlign = 'left' | 'center' | 'right';

type Props = {
  hintId: string;
  text: string;
  style?: StyleProp<ViewStyle>;
  arrow?: ArrowDir;
  arrowAlign?: ArrowAlign;
  dismissLabel?: string;
};

// Fixed surfaces — intentionally theme-selected but always dark, so the
// white foreground below is valid in both themes (see contract).
const SURFACE_ON_LIGHT = '#171B24';
const SURFACE_ON_DARK = '#2C313D';
const FG = '#FFFFFF';
const FG_MUTED = 'rgba(255,255,255,0.62)';

const ARROW_W = 10; // half-width of the triangle
const ARROW_H = 9;

export default function CoachMark({
  hintId,
  text,
  style,
  arrow = 'none',
  arrowAlign = 'center',
  dismissLabel,
}: Props) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const surface = isDark ? SURFACE_ON_DARK : SURFACE_ON_LIGHT;
  const styles = useMemo(() => makeStyles(surface), [surface]);
  const { visible, dismiss } = useCoachMark(hintId);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, anim]);

  if (!visible) return null;

  const alignStyle =
    arrowAlign === 'left'
      ? styles.arrowLeft
      : arrowAlign === 'right'
        ? styles.arrowRight
        : styles.arrowCenter;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        style,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [arrow === 'down' ? -8 : 8, 0],
              }),
            },
            {
              scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }),
            },
          ],
        },
      ]}
    >
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={text}>
        {arrow === 'up' && <View style={[styles.arrowUp, alignStyle]} />}
        <View style={styles.bubble}>
          <Text style={styles.text}>{text}</Text>
          <Text style={styles.dismiss}>
            {dismissLabel ?? t('common.gotIt', { defaultValue: '知道了' })}
          </Text>
        </View>
        {arrow === 'down' && <View style={[styles.arrowDown, alignStyle]} />}
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(surface: string) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      zIndex: 50,
      elevation: 12,
    },
    bubble: {
      backgroundColor: surface,
      borderRadius: 18,
      paddingHorizontal: 18,
      paddingVertical: 15,
      // Soft, wide shadow — the bubble floats instead of being outlined.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
    },
    text: {
      color: FG,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: '500',
      letterSpacing: 0.1,
    },
    dismiss: {
      color: FG_MUTED,
      fontSize: 13,
      fontWeight: '600',
      alignSelf: 'flex-end',
      marginTop: 10,
    },
    // Real triangles: transparent sides + one solid edge. No seam, no
    // corner artifact, colour matches the bubble exactly.
    arrowUp: {
      width: 0,
      height: 0,
      borderLeftWidth: ARROW_W,
      borderRightWidth: ARROW_W,
      borderBottomWidth: ARROW_H,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderBottomColor: surface,
    },
    arrowDown: {
      width: 0,
      height: 0,
      borderLeftWidth: ARROW_W,
      borderRightWidth: ARROW_W,
      borderTopWidth: ARROW_H,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: surface,
    },
    arrowLeft: { alignSelf: 'flex-start', marginLeft: 26 },
    arrowCenter: { alignSelf: 'center' },
    arrowRight: { alignSelf: 'flex-end', marginRight: 26 },
  });
}
