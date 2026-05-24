import React, { useEffect } from 'react';
import { Modal, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
 * Hero stinger that plays after the user finishes onboarding step 3
 * ("Start using PikTag") and before navigation to the Main tab stack.
 *
 * Integration:
 *   const [burst, setBurst] = useState(false);
 *   // when "enterPikTag" pressed → setBurst(true)
 *   <OnboardingCompleteBurst
 *     visible={burst}
 *     userName={user?.displayName}
 *     onComplete={() => navigation.replace('Main')}
 *   />
 *
 * Total duration ~1.4s. Reduced motion: 200ms fade in / 800ms hold /
 * 200ms fade out, with no scale or halo animation.
 */

type Props = {
  visible: boolean;
  userName?: string;
  onComplete: () => void;
};

const GRADIENT = ['#ff5757', '#c44dff', '#8c52ff'] as const;

function OnboardingCompleteBurstImpl({ visible, userName, onComplete }: Props) {
  const reduced = useReducedMotion();
  const { t } = useTranslation();

  const overlay = useSharedValue(0);
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);
  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0);
  const textY = useSharedValue(15);
  const textOpacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      cancelAnimation(overlay);
      cancelAnimation(logoScale);
      cancelAnimation(logoOpacity);
      cancelAnimation(haloScale);
      cancelAnimation(haloOpacity);
      cancelAnimation(textY);
      cancelAnimation(textOpacity);
      overlay.value = 0;
      logoScale.value = 0.6;
      logoOpacity.value = 0;
      haloScale.value = 1;
      haloOpacity.value = 0;
      textY.value = 15;
      textOpacity.value = 0;
      return;
    }

    if (reduced) {
      // Reduced motion path: solid gradient flash with no movement.
      overlay.value = withTiming(1, { duration: 200 });
      logoOpacity.value = withTiming(1, { duration: 200 });
      logoScale.value = 1;
      textOpacity.value = withDelay(200, withTiming(1, { duration: 200 }));
      textY.value = 0;
      overlay.value = withDelay(
        1000,
        withTiming(0, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onComplete)();
        }),
      );
      return;
    }

    // 0–250ms: gradient bg fades in.
    overlay.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });

    // 200–550ms: logo scale 0.6 → 1 spring + opacity 0 → 1.
    logoOpacity.value = withDelay(200, withTiming(1, { duration: 250 }));
    logoScale.value = withDelay(
      200,
      withSpring(1, { damping: 9, stiffness: 110, mass: 0.7 }),
    );

    // 350–950ms: halo scale 1 → 8, opacity 0.5 → 0. Bezier-eased so it
    // feels like a shockwave, not a linear inflate.
    haloOpacity.value = withDelay(
      350,
      withSequence(
        withTiming(0.5, { duration: 80, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }),
      ),
    );
    haloScale.value = withDelay(
      350,
      withTiming(8, { duration: 600, easing: Easing.out(Easing.cubic) }),
    );

    // 600–1000ms: welcome text — y+15 → y0, opacity 0 → 1.
    textOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));
    textY.value = withDelay(
      600,
      withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }),
    );

    // 1100–1400ms: full overlay fades; fire onComplete on close.
    overlay.value = withDelay(
      1100,
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: 300 }, (finished) => {
          if (finished) runOnJS(onComplete)();
        }),
      ),
    );
  }, [
    visible,
    reduced,
    onComplete,
    overlay,
    logoScale,
    logoOpacity,
    haloScale,
    haloOpacity,
    textY,
    textOpacity,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value,
    transform: [{ scale: haloScale.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  if (!visible) return null;

  const welcome = t('auth.onboarding.welcomeName', {
    name: userName ?? '',
    defaultValue: userName ? `Welcome, ${userName}` : 'Welcome',
  });

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      <Animated.View style={[styles.root, overlayStyle]} pointerEvents="none">
        <LinearGradient
          colors={GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[styles.halo, haloStyle]} />
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Image
            source={require('../../../assets/splash-icon.png')}
            contentFit="contain"
            style={styles.logo}
          />
        </Animated.View>
        <Animated.Text style={[styles.welcome, textStyle]} numberOfLines={2}>
          {welcome}
        </Animated.Text>
      </Animated.View>
    </Modal>
  );
}

const OnboardingCompleteBurst = React.memo(OnboardingCompleteBurstImpl);
OnboardingCompleteBurst.displayName = 'OnboardingCompleteBurst';

export default OnboardingCompleteBurst;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  halo: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  welcome: {
    position: 'absolute',
    top: '60%',
    paddingHorizontal: 24,
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
