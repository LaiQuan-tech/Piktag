import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Animated, Platform } from 'react-native';

/**
 * IG-style launch overlay: small logo centered, 'from PikTag' at bottom.
 * Rendered on top of the app for ~700ms after mount, then fades out.
 *
 * This complements the native Expo splash screen (which can only show a
 * static image). The native splash hides automatically when React mounts —
 * this component picks up from there to give the 'from PikTag' branding
 * moment before the real UI becomes visible.
 */
type Props = {
  onHidden?: () => void;
};

export default function SplashOverlay({ onHidden }: Props) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [opacity, onHidden]);

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
