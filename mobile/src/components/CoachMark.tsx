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
//   • It is a HINT, not a CTA — fixed dark surface (#1F2937 + white),
//     deliberately NOT the signature gradient and NOT a solid-purple
//     submit pill, so it never competes with the one gradient CTA a
//     page is allowed. Fixed bg + fixed fg (dark-mode rule: a fixed
//     surface must carry a fixed foreground, never colors.gray*).
//   • The page positions it via `style` (absolute top/left/right) and
//     picks an `arrow` direction pointing at the feature it teaches.
//
// Props:
//   • hintId       stable key; the storage namespace (piktag_coach_<id>).
//   • text         the hint copy (already localized by the caller).
//   • style?       absolute positioning from the page (top/left/right).
//   • arrow?       'up' | 'down' | 'none' (default 'none') — visual
//                  pointer toward the anchor feature.
//   • arrowOffset? horizontal px of the arrow from the left edge; omit
//                  to center it.
//   • dismissLabel? overrides the default "知道了" affordance text.
import React, { useMemo, useRef, useEffect } from 'react';
import { Animated, Pressable, Text, View, StyleSheet, StyleProp, ViewStyle, Easing } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useCoachMark } from '../hooks/useCoachMark';

type ArrowDir = 'up' | 'down' | 'none';

type Props = {
  hintId: string;
  text: string;
  style?: StyleProp<ViewStyle>;
  arrow?: ArrowDir;
  arrowOffset?: number;
  dismissLabel?: string;
};

export default function CoachMark({
  hintId,
  text,
  style,
  arrow = 'none',
  arrowOffset,
  dismissLabel,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { visible, dismiss } = useCoachMark(hintId);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, anim]);

  if (!visible) return null;

  const arrowPos = arrowOffset != null ? { left: arrowOffset } : { alignSelf: 'center' as const };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        style,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [arrow === 'down' ? -6 : 6, 0] }) },
          ],
        },
      ]}
    >
      <Pressable onPress={dismiss} style={styles.wrap} accessibilityRole="button" accessibilityLabel={text}>
        {arrow === 'up' && <View style={[styles.arrow, styles.arrowUp, arrowPos]} />}
        <View style={styles.bubble}>
          <Text style={styles.text}>{text}</Text>
          <Text style={styles.dismiss}>{dismissLabel ?? t('common.gotIt', { defaultValue: '知道了' })}</Text>
        </View>
        {arrow === 'down' && <View style={[styles.arrow, styles.arrowDown, arrowPos]} />}
      </Pressable>
    </Animated.View>
  );
}

// Fixed hint surface — intentionally theme-independent (see contract).
const HINT_BG = '#1F2937';
const HINT_FG = '#FFFFFF';

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      zIndex: 50,
      elevation: 12,
    },
    wrap: {
      alignItems: 'stretch',
    },
    bubble: {
      backgroundColor: HINT_BG,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      // Brand-tinted hairline lifts the dark bubble off a dark-mode page.
      borderColor: c.piktag400,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
    },
    text: {
      color: HINT_FG,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
    },
    dismiss: {
      color: c.piktag300,
      fontSize: 13,
      fontWeight: '700',
      alignSelf: 'flex-end',
      marginTop: 8,
    },
    arrow: {
      width: 14,
      height: 14,
      backgroundColor: HINT_BG,
      borderColor: c.piktag400,
      transform: [{ rotate: '45deg' }],
    },
    // Only the outer two edges of the rotated square should read as the
    // pointer; the inner corner tucks under the bubble via negative margin.
    arrowUp: {
      borderTopWidth: 1,
      borderLeftWidth: 1,
      marginBottom: -7,
      marginLeft: 18,
    },
    arrowDown: {
      borderBottomWidth: 1,
      borderRightWidth: 1,
      marginTop: -7,
      marginLeft: 18,
    },
  });
}
