// PikTag Design System
// Bold typography · 8-12px radius · Dark mode ready

// ── Light palette ──────────────────────────────────────────────────────
const LIGHT = {
  // Brand (Teal — #2dc7ce base)
  piktag50: '#f0fdfd',
  piktag100: '#ccf2f4',
  piktag200: '#99e5e9',
  piktag300: '#5dd6db',
  piktag400: '#2dc7ce',
  piktag500: '#2dc7ce',
  piktag600: '#1a9ba1',

  // Accent (darker teal for contrast)
  accent50: '#f0fdfd',
  accent100: '#ccf2f4',
  accent200: '#99e5e9',
  accent300: '#5dd6db',
  accent400: '#2dc7ce',
  accent500: '#1a9ba1',
  accent600: '#137377',

  // Brand gradient colors
  gradientStart: '#0cc0df',
  gradientMid: '#5dd6a8',
  gradientEnd: '#ffde59',
  gradientAccent: '#ffde59',

  // Grays
  white: '#FFFFFF',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',
  black: '#000000',

  // Accents
  blue50: '#eff6ff',
  blue500: '#3b82f6',
  red500: '#ef4444',
  pink500: '#ec4899',
  orange500: '#f97316',
  green500: '#22c55e',
  purple500: '#a855f7',

  // Semantic backgrounds
  background: '#FFFFFF',
  backgroundSecondary: '#f3f4f6',
  card: '#FFFFFF',
  border: '#e5e7eb',
  text: '#111827',
  textSecondary: '#6b7280',
  textTertiary: '#9ca3af',
};

// ── Dark palette (Linktree-inspired gradient style) ────────────────────
// Background is transparent — actual gradient is rendered by GradientBackground component
// Cards use semi-transparent surfaces for depth
const DARK: typeof LIGHT = {
  // Brand — brighter for dark backgrounds (Vercel-inspired dark)
  piktag50: '#0a1e1f',
  piktag100: '#0d2e30',
  piktag200: '#1a4a4d',
  piktag300: '#2dc7ce',
  piktag400: '#45d1d7',
  piktag500: '#5dd6db',
  piktag600: '#a8e8eb',

  // Accent (teal) — for dark mode
  accent50: '#0a1e1f',
  accent100: '#0d2e30',
  accent200: '#1a4a4d',
  accent300: '#2dc7ce',
  accent400: '#45d1d7',
  accent500: '#5dd6db',
  accent600: '#a8e8eb',

  // Brand gradient colors
  gradientStart: '#0cc0df',
  gradientMid: '#5dd6a8',
  gradientEnd: '#ffde59',
  gradientAccent: '#ffde59',

  // Grays — soft, not pure black
  white: 'transparent',       // background is gradient, not flat color
  gray50: 'rgba(255,255,255,0.04)',
  gray100: 'rgba(255,255,255,0.08)',
  gray200: 'rgba(255,255,255,0.12)',
  gray300: 'rgba(255,255,255,0.16)',
  gray400: 'rgba(255,255,255,0.4)',
  gray500: 'rgba(255,255,255,0.55)',
  gray600: 'rgba(255,255,255,0.7)',
  gray700: 'rgba(255,255,255,0.8)',
  gray800: 'rgba(255,255,255,0.9)',
  gray900: '#f0f0f0',
  black: '#FFFFFF',

  // Accents — same or slightly adjusted
  blue50: '#1a2332',
  blue500: '#60a5fa',
  red500: '#f87171',
  pink500: '#f472b6',
  orange500: '#fb923c',
  green500: '#4ade80',
  purple500: '#c084fc',

  // Semantic backgrounds — semi-transparent for gradient to show through
  background: 'transparent',
  backgroundSecondary: 'rgba(255,255,255,0.05)',
  card: 'rgba(255,255,255,0.1)',
  border: 'rgba(255,255,255,0.15)',
  text: '#f0f0f0',
  textSecondary: '#8a8a8a',
  textTertiary: '#666666',
};

// ── Export (default = light, components use useTheme() for dynamic) ────
export const COLORS = LIGHT;
export const COLORS_DARK = DARK;

export type ColorPalette = typeof LIGHT;

// ── Dark mode gradient presets (Linktree-inspired) ─────────────────────
export const DARK_GRADIENTS = {
  // Default: deep purple → dark navy
  default: ['#0f0a1e', '#1a1035', '#0d1a2e'] as const,
  // Midnight: dark blue → dark teal
  midnight: ['#0a1628', '#0d1f35', '#0a2a2e'] as const,
  // Brand: dark gold → deep purple
  brand: ['#1a1508', '#1a0f1e', '#0f0a1e'] as const,
  // Charcoal: warm dark gray gradient
  charcoal: ['#1a1a1a', '#1f1a24', '#1a1a22'] as const,
};

// ── Typography ─────────────────────────────────────────────────────────
// Bold, high-contrast typography for professional feel
export const TYPOGRAPHY = {
  // Display — hero text, splash
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 40 },
  // Headlines
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, letterSpacing: 0, lineHeight: 24 },
  // Body
  body: { fontSize: 16, fontWeight: '400' as const, letterSpacing: 0.1, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: '600' as const, letterSpacing: 0.1, lineHeight: 24 },
  // Small
  caption: { fontSize: 13, fontWeight: '500' as const, letterSpacing: 0.2, lineHeight: 18 },
  label: { fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.3, lineHeight: 20 },
  // Button
  button: { fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.3, lineHeight: 20 },
  buttonSmall: { fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.2, lineHeight: 18 },
};

// ── Fonts (system for now, ready for custom) ───────────────────────────
export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
};

// ── Spacing (4px base) ─────────────────────────────────────────────────
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// ── Border Radius (8-12px range for friendly, professional feel) ──────
export const BORDER_RADIUS = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  full: 9999,
};

// ── Semantic Tag Types ─────────────────────────────────────────────────
export const SEMANTIC_TYPES = [
  { key: 'identity', labelKey: 'semanticType.identity' },
  { key: 'personality', labelKey: 'semanticType.personality' },
  { key: 'career', labelKey: 'semanticType.career' },
  { key: 'skill', labelKey: 'semanticType.skill' },
  { key: 'interest', labelKey: 'semanticType.interest' },
  { key: 'social', labelKey: 'semanticType.social' },
  { key: 'meta', labelKey: 'semanticType.meta' },
  { key: 'relation', labelKey: 'semanticType.relation' },
] as const;
