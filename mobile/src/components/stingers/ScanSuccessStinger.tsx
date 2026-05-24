import React, { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/**
 * Hero stinger that fires after a QR scan decodes successfully, just before
 * navigation to ScanResult. Renders as a full-screen transparent <Modal>
 * so it overlays whatever camera surface is mounted underneath.
 *
 * Integration:
 *   const [stinger, setStinger] = useState(false);
 *   // on decode success → setStinger(true)
 *   <ScanSuccessStinger
 *     visible={stinger}
 *     friendName={decoded?.name}
 *     onComplete={() => { setStinger(false); navigation.replace('ScanResult', {...}); }}
 *   />
 *
 * Total duration ~1.05s; honours useReducedMotion() with a fade-only path.
 */

type Props = {
  visible: boolean;
  onComplete: () => void;
  friendName?: string;
};

const RING_START = 40;
const RING_END = 220;

function ScanSuccessStingerImpl({ visible, onComplete, friendName }: Props) {
  const reduced = useReducedMotion();
  const { t } = useTranslation();

  const overlay = useSharedValue(0);
  const ringScale = useSharedValue(RING_START / RING_END);
  const ringOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  const chipY = useSharedValue(20);
  const chipOpacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      // Reset to start state for next firing — guard against mid-animation
      // remounts so we never leak a half-animated frame.
      cancelAnimation(overlay);
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      cancelAnimation(logoScale);
      cancelAnimation(logoOpacity);
      cancelAnimation(chipY);
      cancelAnimation(chipOpacity);
      overlay.value = 0;
      ringScale.value = RING_START / RING_END;
      ringOpacity.value = 0;
      logoScale.value = 0;
      logoOpacity.value = 0;
      chipY.value = 20;
      chipOpacity.value = 0;
      return;
    }

    if (reduced) {
      // Reduced motion: simple fade in, hold 600ms, fade out — no scale,
      // no ring expansion, but still confirms the action visually.
      overlay.value = withTiming(1, { duration: 200 });
      logoOpacity.value = withTiming(1, { duration: 200 });
      logoScale.value = 1;
      chipOpacity.value = friendName
        ? withDelay(200, withTiming(1, { duration: 200 }))
        : 0;
      chipY.value = 0;
      overlay.value = withDelay(
        800,
        withTiming(0, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onComplete)();
        }),
      );
      return;
    }

    // Frosted backdrop fade-in, 0–200ms.
    overlay.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });

    // Ring pulse, 100–400ms — scale 40px → 220px, opacity 0.4 → 0.
    ringOpacity.value = withDelay(
      100,
      withSequence(
        withTiming(0.4, { duration: 80, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }),
      ),
    );
    ringScale.value = withDelay(
      100,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }),
    );

    // Logo bloom, 200–550ms — opacity in fast, scale springs to 1.0 with
    // a tiny overshoot from the 1.1 peak.
    logoOpacity.value = withDelay(200, withTiming(1, { duration: 200 }));
    logoScale.value = withDelay(
      200,
      withSequence(
        withTiming(1.1, { duration: 200, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { damping: 8, stiffness: 120, mass: 0.6 }),
      ),
    );

    // Friend-name chip, 600–800ms — only if a name was supplied.
    if (friendName) {
      chipOpacity.value = withDelay(600, withTiming(1, { duration: 200 }));
      chipY.value = withDelay(
        600,
        withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }),
      );
    }

    // Hold then fade entire overlay; fire onComplete on the closing frame.
    overlay.value = withDelay(
      850,
      withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0, { duration: 250 }, (finished) => {
          if (finished) runOnJS(onComplete)();
        }),
      ),
    );
  }, [
    visible,
    reduced,
    friendName,
    onComplete,
    overlay,
    ringScale,
    ringOpacity,
    logoScale,
    logoOpacity,
    chipY,
    chipOpacity,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const chipStyle = useAnimatedStyle(() => ({
    opacity: chipOpacity.value,
    transform: [{ translateY: chipY.value }],
  }));

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.root, overlayStyle]} pointerEvents="none">
        <Animated.View style={[styles.ring, ringStyle]} />
        <Animated.View style={logoStyle}>
          <Image
            source={require('../../../assets/splash-icon.png')}
            contentFit="contain"
            style={styles.logo}
          />
        </Animated.View>
        {friendName ? (
          <Animated.View style={[styles.chip, chipStyle]}>
            <View style={styles.chipInner}>
              <Animated.Text style={styles.chipLabel}>
                {t('connections.addedFriend', {
                  name: friendName,
                  defaultValue: `+ ${friendName}`,
                })}
              </Animated.Text>
            </View>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

const ScanSuccessStinger = React.memo(ScanSuccessStingerImpl);
ScanSuccessStinger.displayName = 'ScanSuccessStinger';

export default ScanSuccessStinger;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_END,
    height: RING_END,
    borderRadius: RING_END / 2,
    borderWidth: 3,
    borderColor: '#c44dff',
  },
  logo: {
    width: 96,
    height: 96,
  },
  chip: {
    position: 'absolute',
    top: '58%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipInner: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  chipLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#8c52ff',
    letterSpacing: 0.2,
  },
});
