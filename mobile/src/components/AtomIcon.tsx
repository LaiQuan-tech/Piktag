import React from 'react';
import Svg, { Circle, Ellipse, G } from 'react-native-svg';
import { COLORS } from '../constants/theme';

type Props = { size?: number; color?: string; strokeWidth?: number };

/**
 * App-wide accent icon — atom shape, purple line, transparent background.
 * Single source of truth: replaces the old per-screen sparkle/star usages
 * (AI 為你推薦 headers, AI-suggestion buttons, vibes header, completion nudge).
 * Drop-in API mirrors lucide (size / color / strokeWidth) so call sites
 * only swap the component name. Stroke-only + fill="none" = 紫色線條＆去背.
 * Authored with react-native-svg following the PlatformIcon.tsx pattern.
 */
export default function AtomIcon({
  size = 16,
  color = COLORS.piktag600,
  strokeWidth = 2,
}: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="1.4" fill={color} />
      <G stroke={color} strokeWidth={strokeWidth} fill="none">
        <Ellipse cx="12" cy="12" rx="10" ry="4.2" />
        <Ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
        <Ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
      </G>
    </Svg>
  );
}
