import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { DARK_GRADIENTS } from '../constants/theme';

type GradientBackgroundProps = {
  children: React.ReactNode;
  preset?: keyof typeof DARK_GRADIENTS;
};

/**
 * Wraps children with a gradient background in dark mode.
 * In light mode, renders children with no gradient (transparent).
 *
 * Usage:
 *   <GradientBackground>
 *     <ScrollView>...</ScrollView>
 *   </GradientBackground>
 */
export default function GradientBackground({ children, preset = 'default' }: GradientBackgroundProps) {
  const { isDark } = useTheme();

  if (!isDark) {
    return <>{children}</>;
  }

  return (
    <LinearGradient
      colors={[...DARK_GRADIENTS[preset]]}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
});
