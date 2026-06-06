// GradientButton.tsx
//
// THE one brand-gradient button. Founder design system, 2026-06-07:
//
//   PikTag has a 3-tier button hierarchy. This component owns tier 1.
//   1. GRADIENT logo-color  = the "signature / 招牌" action — the moment
//      that IS PikTag's magic (AI tag recommendation, generate-my-QR).
//      White text/icon. AT MOST ONE per screen.
//        • If the signature action is ALSO the screen's commit (e.g.
//          產生 QR Code — there's no separate save), gradient is the CTA.
//        • If the screen has a mundane commit too (儲存 / 下一步 / 完成),
//          that stays tier 2 (solid piktag500) and the gradient marks
//          the signature feature. They read as DIFFERENT ROLES (magic
//          vs commit), never as two competing CTAs.
//   2. SOLID piktag500 + white = standard commit/continue (saveBtn token).
//   3. Outlined piktag500       = secondary / optional.
//   (The old light-purple piktag50 button tier is RETIRED — anything
//    that was a signature action moves up to this gradient.)
//
// The gradient `['#ff5757','#c44dff','#8c52ff']` is a FIXED brand asset —
// identical in light + dark mode (same doctrine as the splash / QR sheet
// gradient), so this component is intentionally theme-agnostic for colour.
//
// Replaces the per-screen inline LinearGradient copies (AddTag 產生 QR,
// onboarding AI button) — one component, per the "shared UI = one
// component" rule.

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BrandSpinner from './loaders/BrandSpinner';

// Brand signature gradient — DO NOT theme-swap (fixed in light + dark).
export const BRAND_GRADIENT = ['#ff5757', '#c44dff', '#8c52ff'] as const;

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown next to the spinner while `loading` (e.g. "AI 想標籤中…"). */
  loadingLabel?: string;
  /** Leading icon — pass it white (#FFFFFF) to sit on the gradient. */
  icon?: React.ReactNode;
  /** Extra container style (padding / margin / width overrides). */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export default function GradientButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  loadingLabel,
  icon,
  style,
  accessibilityLabel,
}: Props) {
  const dim = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={dim}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.base, dim && styles.dim, style]}
      >
        {loading ? (
          <>
            <BrandSpinner size={20} />
            {loadingLabel ? <Text style={styles.text}>{loadingLabel}</Text> : null}
          </>
        ) : (
          <>
            {icon}
            <Text style={styles.text}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Same footprint tokens as the locked solid-piktag500 CTA (saveBtn),
  // so a gradient primary and a solid primary line up pixel-for-pixel.
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  dim: { opacity: 0.5 },
  text: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
