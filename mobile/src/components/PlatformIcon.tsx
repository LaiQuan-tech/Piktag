import React, { useState, useEffect } from 'react';
import { Image, View } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import {
  Globe, Link, Phone, Mail, MessageSquare, Send, Music, Video,
  Twitch, Github, Twitter, Youtube, ShoppingBag, Podcast,
  Camera, Hash, Calendar, DollarSign, Heart, Coffee, BookOpen,
  Briefcase, Palette, AtSign, MessageCircle,
} from 'lucide-react-native';
import { BRAND_PATHS } from './brandPaths';
import { useTheme } from '../context/ThemeContext';
import { getCustomFaviconUrl } from '../lib/platforms';

type Props = {
  platform: string;
  size?: number;
  color?: string;
  /** Explicit favicon URL stored on the biolink (DB column
   *  `icon_url`). Wins over the auto-fetch path below — left in for
   *  a future "user uploaded their own icon" affordance. */
  iconUrl?: string | null;
  /** The biolink's URL — passed in so the component can derive an
   *  auto-favicon for the generic `custom` ("Link") platform. Only
   *  consulted when (a) platform === 'custom' AND (b) no iconUrl
   *  was explicitly provided. Branded platforms (instagram / x /
   *  linkedin / etc.) ignore this and render their own SVG. */
  url?: string | null;
};

// Extended platform → lucide icon mapping for the 50-platform
// catalog. Brand glyphs aren't in lucide, so we substitute the
// closest semantic icon (e.g. all chat services → MessageCircle,
// all music → Music) — UI distinguishes them by the platform LABEL
// next to the icon, not by icon-alone. The dedicated SVG branches
// below (instagram / facebook / linkedin / line) cover the marquee
// brands where a recognizable glyph matters most.
const LUCIDE_MAP: Record<string, any> = {
  // Social / micro-blogging
  twitter: Twitter,
  x: Twitter,
  threads: AtSign,
  bluesky: AtSign,
  mastodon: AtSign,
  reddit: MessageSquare,
  pinterest: Hash,
  snapchat: Camera,
  tiktok: Music,

  // Video
  youtube: Youtube,
  twitch: Twitch,
  vimeo: Video,
  bilibili: Video,
  podcast: Podcast,

  // Music
  spotify: Music,
  'apple-music': Music,
  soundcloud: Music,
  bandcamp: Music,
  'youtube-music': Music,

  // Chat
  telegram: Send,
  whatsapp: MessageCircle,
  wechat: MessageCircle,
  kakaotalk: MessageCircle,
  signal: MessageCircle,
  messenger: MessageCircle,
  discord: MessageCircle,
  // Slack — using MessageSquare to read as a corporate-chat surface
  // (companion to discord's MessageCircle but visually distinct).
  // The picker shows the "Slack" label next to it so the icon shape
  // is secondary. Upgrade to a brand-accurate SVG when we re-run
  // scripts/extract-brand-paths.js with the slack slug.
  slack: MessageSquare,

  // Professional
  github: Github,
  gitlab: Github,
  behance: Palette,
  dribbble: Palette,
  medium: BookOpen,

  // Writing
  substack: BookOpen,
  notion: BookOpen,
  mirror: BookOpen,
  hashnode: BookOpen,

  // Business / money
  calendly: Calendar,
  cal: Calendar,
  paypal: DollarSign,
  venmo: DollarSign,
  cashapp: DollarSign,
  stripe: DollarSign,
  alipay: DollarSign,
  patreon: Heart,
  kofi: Coffee,
  buymeacoffee: Coffee,

  // Generic web
  blog: BookOpen,
  portfolio: Briefcase,

  // Shopping / misc legacy
  shopee: ShoppingBag,
};

export default function PlatformIcon({ platform, size = 24, color: colorProp, iconUrl, url }: Props) {
  // Icons render monochrome (incl. brand glyphs — deliberate, see
  // the brandPath comment). The fill must theme: gray700 is #374151
  // in light, #dbdbdb in dark — a hardcoded #374151 went invisible
  // on the dark page. Callers can still override via the `color` prop.
  const { colors } = useTheme();
  const color = colorProp ?? colors.gray700;
  const key = platform?.toLowerCase();

  // Resolve the effective favicon URL.
  //   - For `custom` ("Link") platform: ALWAYS live-derive from
  //     the current URL via getCustomFaviconUrl. Why we IGNORE the
  //     stored icon_url here: legacy rows have Google's s2/favicons
  //     URL baked in (changed to DuckDuckGo 2026-05-31), and we
  //     want the switch + any future provider swap to retroactively
  //     fix existing rows without a backfill. Live-derive also
  //     means the icon updates if the user re-edits the URL.
  //   - For other unknown platforms: fall back to the stored
  //     icon_url if one exists. Branded platforms (instagram / x /
  //     linkedin / etc.) never reach this — their SVG branches
  //     above short-circuit.
  const derivedIconUrl =
    key === 'custom' ? getCustomFaviconUrl(url) : (iconUrl ?? null);

  // Track whether the favicon Image failed to load. DuckDuckGo
  // returns a clean 404 for domains it doesn't know — onError will
  // fire and we fall through to the Link chain icon below, which
  // looks intentional rather than "blank tile rendered with nothing
  // in it". Reset when the URL changes so re-edits get a fresh try.
  const [iconLoadFailed, setIconLoadFailed] = useState(false);
  useEffect(() => {
    setIconLoadFailed(false);
  }, [derivedIconUrl]);
  const effectiveIconUrl = iconLoadFailed ? null : derivedIconUrl;

  // ── Brand SVG path (from simple-icons, CC0-licensed) ──
  // 42 platforms covered via auto-extracted path data; the brand
  // glyphs render in monochrome with our gray700 fill so they sit
  // visually with the rest of the UI rather than blasting brand
  // colors. Checked BEFORE the legacy custom-svg branches below so
  // the simple-icons authoritative shapes win when both exist.
  const brandPath = key ? BRAND_PATHS[key] : undefined;
  if (brandPath) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d={brandPath} />
      </Svg>
    );
  }

  // ── SVG custom icons (major platforms) ──

  if (key === 'instagram') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" stroke={color} strokeWidth="1.8" fill="none" />
        <Rect x="7" y="7" width="10" height="10" rx="3" stroke={color} strokeWidth="1.8" fill="none" />
        <Circle cx="12" cy="12" r="2.8" stroke={color} strokeWidth="1.8" fill="none" />
        <Circle cx="16.5" cy="7.5" r="1" fill={color} />
      </Svg>
    );
  }

  if (key === 'facebook') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" stroke={color} strokeWidth="1.8" fill="none" />
        <Path
          d="M13.5 8H15V5.5H13C11.3 5.5 10 6.8 10 8.5V10H8V12.5H10V18.5H12.5V12.5H14.5L15 10H12.5V8.5C12.5 8.2 12.7 8 13 8H13.5Z"
          fill={color}
        />
      </Svg>
    );
  }

  if (key === 'linkedin') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" stroke={color} strokeWidth="1.8" fill="none" />
        <Path d="M7 10H9.5V17H7V10Z" fill={color} />
        <Circle cx="8.25" cy="7.5" r="1.25" fill={color} />
        <Path d="M11 10H13.5V11.2C13.9 10.5 14.8 10 16 10C17.7 10 19 11.1 19 13.2V17H16.5V13.8C16.5 12.8 16 12.2 15 12.2C14 12.2 13.5 12.9 13.5 13.8V17H11V10Z" fill={color} />
      </Svg>
    );
  }

  if (key === 'line') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="2" width="20" height="20" rx="6" stroke={color} strokeWidth="1.8" fill="none" />
        <Path
          d="M12 5.5C8.4 5.5 5.5 7.9 5.5 10.8C5.5 13.4 7.8 15.6 10.9 16.1L11.4 16.9C11.6 17.2 12 17.1 12 16.8V15.8C15.1 15.3 18.5 13.3 18.5 10.8C18.5 7.9 15.6 5.5 12 5.5Z"
          fill={color}
        />
      </Svg>
    );
  }

  // ── Lucide icons (contact + common services) ──

  if (key === 'phone' || key === '電話') return <Phone size={size} color={color} />;
  if (key === 'email' || key === 'mail') return <Mail size={size} color={color} />;
  if (key === 'website' || key === '個人網站') return <Globe size={size} color={color} />;

  // Check extended lucide mapping
  const LucideIcon = LUCIDE_MAP[key];
  if (LucideIcon) return <LucideIcon size={size} color={color} />;

  // ── Favicon fallback (from DB icon_url or auto-generated) ──

  if (effectiveIconUrl) {
    return (
      <Image
        source={{ uri: effectiveIconUrl }}
        style={{
          // Tile background must theme — favicons (incl. pikt.ag's
          // gradient # on transparent) carry alpha, so a hardcoded
          // light tile lights up like a flashlight on a dark UI.
          // gray50 is #f9fafb in light, #0a0a0a in dark — the
          // gradient pops against either. (Founder caught 2026-05-31.)
          backgroundColor: colors.gray50,
          width: size,
          height: size,
          borderRadius: size / 4,
        }}
        resizeMode="contain"
        onError={() => setIconLoadFailed(true)}
      />
    );
  }

  // ── Default: generic link icon ──
  return <Link size={size} color={color} />;
}
