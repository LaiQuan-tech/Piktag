import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import {
  Globe, Link, Phone, Mail, MessageSquare, Send, Music, Video,
  Twitch, Github, Twitter, Youtube, ShoppingBag, Podcast,
  Camera, Hash, Calendar, DollarSign, Heart, Coffee, BookOpen,
  Briefcase, Palette, AtSign, MessageCircle,
} from 'lucide-react-native';
import { BRAND_PATHS } from './brandPaths';

// Unified monochrome icon color
const ICON_COLOR = '#374151'; // gray700

type Props = {
  platform: string;
  size?: number;
  color?: string;
  iconUrl?: string | null; // Favicon URL from DB
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
  stripe: DollarSign,
  patreon: Heart,
  kofi: Coffee,
  buymeacoffee: Coffee,

  // Generic web
  blog: BookOpen,
  portfolio: Briefcase,

  // Shopping / misc legacy
  shopee: ShoppingBag,
};

export default function PlatformIcon({ platform, size = 24, color = ICON_COLOR, iconUrl }: Props) {
  const key = platform?.toLowerCase();

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

  if (iconUrl) {
    return (
      <Image
        source={{ uri: iconUrl }}
        style={[styles.faviconImage, { width: size, height: size, borderRadius: size / 4 }]}
        resizeMode="contain"
      />
    );
  }

  // ── Default: generic link icon ──
  return <Link size={size} color={color} />;
}

const styles = StyleSheet.create({
  faviconImage: {
    backgroundColor: '#f9fafb',
  },
});
