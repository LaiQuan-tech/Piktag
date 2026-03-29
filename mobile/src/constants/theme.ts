// PikTag Design System
// Bold typography · 8-12px radius · Dark mode ready

// ── Light palette ──────────────────────────────────────────────────────
const LIGHT = {
  // Brand (golden/yellow)
  piktag50: '#fef9e8',
  piktag100: '#fdf2c6',
  piktag200: '#fce890',
  piktag300: '#fadd51',
  piktag400: '#f8cf22',
  piktag500: '#f5c518',
  piktag600: '#d9a50b',

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

// ── Dark palette ───────────────────────────────────────────────────────
const DARK: typeof LIGHT = {
  // Brand — slightly brighter for dark backgrounds
  piktag50: '#2a2315',
  piktag100: '#3d3118',
  piktag200: '#5c4a1a',
  piktag300: '#8a6f1c',
  piktag400: '#c49b16',
  piktag500: '#f5c518',
  piktag600: '#fad44a',

  // Grays — inverted
  white: '#0f0f0f',
  gray50: '#1a1a1a',
  gray100: '#222222',
  gray200: '#2e2e2e',
  gray300: '#3d3d3d',
  gray400: '#666666',
  gray500: '#8a8a8a',
  gray600: '#a3a3a3',
  gray700: '#c4c4c4',
  gray800: '#e0e0e0',
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

  // Semantic backgrounds
  background: '#0f0f0f',
  backgroundSecondary: '#1a1a1a',
  card: '#1e1e1e',
  border: '#2e2e2e',
  text: '#f0f0f0',
  textSecondary: '#8a8a8a',
  textTertiary: '#666666',
};

// ── Export (default = light, components use useTheme() for dynamic) ────
export const COLORS = LIGHT;
export const COLORS_DARK = DARK;

export type ColorPalette = typeof LIGHT;

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
  { key: 'skill', labelKey: 'semanticType.skill' },
  { key: 'interest', labelKey: 'semanticType.interest' },
  { key: 'social', labelKey: 'semanticType.social' },
  { key: 'meta', labelKey: 'semanticType.meta' },
  { key: 'relation', labelKey: 'semanticType.relation' },
] as const;
