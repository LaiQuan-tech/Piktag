// PikTag Design System
// Bold typography · 8-12px radius · Dark mode ready

// ── Light palette ──────────────────────────────────────────────────────
//
// Two-purple semantic system:
//
//   * piktag500 (#8c52ff)  — PRIMARY. The stable base. Used for solid
//     buttons, tag chip backgrounds/borders, menu items, focus rings,
//     wordmark fills, AND as the gradient terminus. International,
//     calm, the "voice" of the product.
//
//   * accentPop (#aa00ff)  — ACCENT. The high-saturation pop. Used
//     ONLY for moments that should jump the eye: notification dots,
//     unread badges, live-Ask heartbeat indicators, success burst
//     animations, "currently active" tag highlights. Never the base
//     UI color — appearance should feel like punctuation, not body
//     text. If everything's accentPop, nothing is.
//
const LIGHT = {
  // Brand (Purple — #8c52ff base)
  piktag50: '#f5e6ff',
  piktag100: '#e6b3ff',
  piktag200: '#d580ff',
  piktag300: '#c44dff',
  piktag400: '#bf00ff',
  piktag500: '#8c52ff',
  piktag600: '#8800cc',

  // Accent — high-pop variant for notification dots / live indicators /
  // success bursts / current-highlight states. See header comment.
  accentPop: '#aa00ff',

  // Accent (deep purple for contrast on white)
  accent50: '#f0e6ff',
  accent100: '#d9b3ff',
  accent200: '#c280ff',
  accent300: '#aa4dff',
  accent400: '#8c52ff',
  accent500: '#7a3de8',
  accent600: '#360066',

  // Brand gradient colors (linear 90deg: #ff5757 → #8c52ff)
  gradientStart: '#ff5757',
  gradientMid: '#c44dff',
  gradientEnd: '#8c52ff',
  gradientAccent: '#360066',

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

// ── Dark palette (IG-inspired pure black) ────────────────────────────
// Pure black background, dark gray cards, white text, brand color accents
const DARK: typeof LIGHT = {
  // Brand — bright purple for dark backgrounds
  piktag50: '#1a0033',
  piktag100: '#2d0059',
  piktag200: '#4a0099',
  piktag300: '#bf00ff',
  piktag400: '#cc33ff',
  piktag500: '#d966ff',
  piktag600: '#e699ff',

  // Accent — same #aa00ff in dark mode. Pure neon already pops on
  // black backgrounds; lifting the value further (e.g. to #ff80ff)
  // would lose the brand voice.
  accentPop: '#aa00ff',

  // Accent (purple) — for dark mode
  accent50: '#1a0033',
  accent100: '#2d0059',
  accent200: '#4a0099',
  accent300: '#8c52ff',
  accent400: '#a77fff',
  accent500: '#c2a6ff',
  accent600: '#e6d9ff',

  // Brand gradient colors (same — pops more on dark)
  gradientStart: '#ff5757',
  gradientMid: '#c44dff',
  gradientEnd: '#8c52ff',
  gradientAccent: '#360066',

  // Grays — IG dark mode style
  white: '#000000',
  gray50: '#0a0a0a',
  gray100: '#1c1c1e',
  gray200: '#363636',
  gray300: '#444444',
  gray400: '#a8a8a8',
  gray500: '#8e8e8e',
  gray600: '#c7c7c7',
  gray700: '#dbdbdb',
  gray800: '#efefef',
  gray900: '#ffffff',
  black: '#ffffff',

  // Accents
  blue50: '#0a0a1a',
  blue500: '#60a5fa',
  red500: '#f87171',
  pink500: '#f472b6',
  orange500: '#fb923c',
  green500: '#4ade80',
  purple500: '#c084fc',

  // Semantic backgrounds — IG style
  background: '#000000',
  backgroundSecondary: '#1c1c1e',
  card: '#1c1c1e',
  border: '#363636',
  text: '#ffffff',
  textSecondary: '#a8a8a8',
  textTertiary: '#8e8e8e',
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
