import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import LogoLoader from '../loaders/LogoLoader';

/**
 * Subtle entrance wrapper for the share-QR modal — gives the QR sheet a
 * branded logo-led intro instead of a plain slide-up.
 *
 * Integration (wraps INSIDE the parent <Modal>, never replaces it):
 *   <Modal visible={open} animationType="slide" onRequestClose={...}>
 *     <QrModalStinger visible={open}>
 *       <ActualQrCodeModalContents />
 *     </QrModalStinger>
 *   </Modal>
 *
 * On visible false→true: children scale 0.92→1 + opacity 0→1, with a small
 * <LogoLoader size={48} /> blooming top-center then auto-fading at 700ms.
 * On true→false: pass-through (parent <Modal> owns dismiss).
 * Reduced motion: pass-through (children only, no animation, no logo).
 */

type Props = {
  children: React.ReactNode;
  visible: boolean;
};

function QrModalStingerImpl({ children, visible }: Props) {
  const reduced = useReducedMotion();

  const childScale = useSharedValue(0.92);
  const childOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0);
  const logoOpacity = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;

    if (!visible) {
      // Reset for the next open. Parent Modal handles its own dismiss
      // animation, so we don't run a closing tween here — we just clear
      // state so the next open replays from zero.
      cancelAnimation(childScale);
      cancelAnimation(childOpacity);
      cancelAnimation(logoScale);
      cancelAnimation(logoOpacity);
      childScale.value = 0.92;
      childOpacity.value = 0;
      logoScale.value = 0;
      logoOpacity.value = 0;
      return;
    }

    // Children: 0–300ms scale + opacity in.
    childOpacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) });
    childScale.value = withSpring(1, { damping: 14, stiffness: 140, mass: 0.7 });

    // Logo cap: 100–400ms in, hold, auto-fade starting at 700ms.
    logoOpacity.value = withDelay(
      100,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }),
    );
    logoScale.value = withDelay(
      100,
      withSpring(1, { damping: 10, stiffness: 130, mass: 0.6 }),
    );
    // Auto-fade at 700ms from open. Doesn't gate on completion — the
    // wrapper just needs the cap to clear so the QR sheet reads cleanly.
    logoOpacity.value = withDelay(
      700,
      withTiming(0, { duration: 250, easing: Easing.in(Easing.quad) }),
    );
  }, [visible, reduced, childScale, childOpacity, logoScale, logoOpacity]);

  const childStyle = useAnimatedStyle(() => ({
    opacity: childOpacity.value,
    transform: [{ scale: childScale.value }],
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  // Reduced motion / not-visible-yet pass-through.
  if (reduced) {
    return <>{children}</>;
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.children, childStyle]}>{children}</Animated.View>
      <Animated.View style={[styles.logoCap, logoStyle]} pointerEvents="none">
        <LogoLoader size={48} />
      </Animated.View>
    </View>
  );
}

const QrModalStinger = React.memo(QrModalStingerImpl);
QrModalStinger.displayName = 'QrModalStinger';

export { QrModalStinger };
export default QrModalStinger;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  children: {
    flex: 1,
  },
  logoCap: {
    position: 'absolute',
    top: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
