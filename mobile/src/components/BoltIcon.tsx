import React from 'react';
import { Zap } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

type Props = { size?: number; color?: string; strokeWidth?: number };

/**
 * App-wide accent icon — lightning bolt, echoes the PikTag "##"
 * hashtag-bolt logo (the diagonals match the logo's slanted strokes).
 * Single source of truth: every "AI nudge / completion-hint /
 * recommendation accent" header across screens. Drop-in API mirrors
 * lucide (size / color / strokeWidth) so swapping call sites only
 * needs the component name to change.
 *
 * Theme-aware default color: call sites that want the brand purple
 * don't have to repeat `colors.piktag600` boilerplate.
 *
 * Renamed from AtomIcon on 2026-05-26 — the atom shape was the v1
 * accent; bolt echoes the logo and the marketing tone (PikTag = quick).
 * Founder rejected `#` (hashtag glyph) as the alt because `#` has
 * semantic weight in copy and would read as a literal hashtag in
 * sentence flow.
 */
export default function BoltIcon({
  size = 16,
  color: colorProp,
  strokeWidth = 2,
}: Props) {
  const { colors } = useTheme();
  const color = colorProp ?? colors.piktag600;
  return <Zap size={size} color={color} strokeWidth={strokeWidth} />;
}
