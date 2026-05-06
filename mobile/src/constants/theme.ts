// PikTag Design System
// Bold typography · 8-12px radius · Dark mode ready

// ── Light palette ──────────────────────────────────────────────────────
const LIGHT = {
  // Brand — anchored on:
  //   piktag500 = #8D5D9E (法國丁香 / French Lilac) — PRIMARY CTAs,
  //               white text passes WCAG AA (~5:1 contrast).
  //   piktag300 = #A47CB2 (非洲紫羅蘭 / African Violet) — SECONDARY
  //               accent for chip borders, hover states, gradient
  //               midpoints. White text fails AA on this one (~3.5:1)
  //               so don't use as a primary fill.
  // The rest of the scale is hue-locked around 285-287° with
  // lightness ramping from very pale (50) to near-black (900). Per
  // spec the brand pivots from neon violet (#aa00ff) to a mauve /
  // boutique tone — sophisticated, less "tech-bro", aligns with the
  // Vibe & Tribe positioning.
  piktag50: '#F4EBF7',
  piktag100: '#E0CCE8',
  piktag200: '#C9A7D6',
  piktag300: '#A47CB2',
  piktag400: '#966BAA',
  piktag500: '#8D5D9E',
  piktag600: '#6E4577',

  // Accent — deeper-mauve variant for components that need a
  // secondary "different from primary, still on-brand" pop. Same
  // hue family as piktag, shifted darker so it doesn't compete
  // visually with the primary. Five existing call sites (Stars on
  // AddTag, TrendingUp on Search, etc.) just want "another brand
  // color that isn't gray".
  accent50: '#F4EBF7',
  accent100: '#DDC3E5',
  accent200: '#C8A0D7',
  accent300: '#B27FC4',
  accent400: '#9D5EAE',
  accent500: '#6E4577',
  accent600: '#271828',

  // Brand gradient colors (linear 90deg: #ff5757 → #8c52ff).
  // INTENTIONALLY UNCHANGED per spec — gradients touch ~30 components
  // (avatar rings, hero CTAs, splash, app icon) and the user wants
  // the migration scoped to the flat brand colors only this round.
  // Will be revisited as a follow-up if the new mauve primary makes
  // the existing pink→purple→indigo gradient feel disconnected.
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
  // Brand — inverted scale for dark bg. The "primary" CTA color
  // (piktag500 in dark mode) needs to be LIGHTER than its light-mode
  // counterpart so it pops against a black surface — we use the
  // light-mode piktag300 (#A47CB2) as the dark-mode primary, and
  // the light-mode piktag500 (#8D5D9E) becomes a mid-tone here.
  piktag50: '#1F1428',
  piktag100: '#2D1B3D',
  piktag200: '#4F2E55',
  piktag300: '#6E4577',
  piktag400: '#8D5D9E',
  piktag500: '#A47CB2',
  piktag600: '#C9A7D6',

  // Accent — also inverted; brighter mauve for "secondary pop" on
  // dark bg.
  accent50: '#1F1428',
  accent100: '#2D1B3D',
  accent200: '#4F2E55',
  accent300: '#6E4577',
  accent400: '#966AAA',
  accent500: '#C9A7D6',
  accent600: '#F4EBF7',

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
