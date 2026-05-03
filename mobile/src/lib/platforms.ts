// platforms.ts
//
// Single source of truth for the biolink platform catalog. Used by:
//   * EditProfileScreen — quick-pick chip row + "browse all" modal
//   * PlatformSearchModal — categorized list + search filter
//   * PlatformIcon — icon lookup
//
// Why 50 platforms (and the structure here): 8 was too few for a
// global app — nobody saves a "Custom" link as a substitute for X /
// TikTok / WhatsApp. 50 covers the long-tail of what people actually
// link to without bloating the catalog past the point a search box
// can browse comfortably.
//
// Brand names stay verbatim per product spec; only generic words
// (Phone / Email / Website / Blog / Portfolio / Custom) are
// translated.

export type PlatformCategory =
  | 'communication'
  | 'social'
  | 'video'
  | 'music'
  | 'professional'
  | 'writing'
  | 'business'
  | 'generic';

export type Platform = {
  /** Stable persisted key — kept lowercase, never user-edited. */
  key: string;
  /** Category bucket for the search modal. */
  cat: PlatformCategory;
  /** Verbatim brand label (or generic English noun for translatable
   *  ones). UI calls getPlatformLabel(key, t) which checks an i18n
   *  override first and falls back to this. */
  label: string;
  /** URL prefix prepended to the user-typed account when saving.
   *  Empty for `custom` (user types the full URL). */
  prefix: string;
  /** Hint in the input field. Static English; UI translates only the
   *  small set of generic-word placeholders via i18n. */
  placeholder: string;
  /** Domain patterns checked in detectPlatformFromUrl. Empty array
   *  for `phone` / `email` (those use scheme detection — tel: /
   *  mailto:) and the generic web platforms (website / blog / etc.,
   *  which never auto-detect — any URL would match). */
  domains: string[];
};

export const PLATFORMS: Platform[] = [
  // ── Communication (10) ──
  { key: 'phone',      cat: 'communication', label: 'Phone',      prefix: 'tel:',                              placeholder: '+1 234 567 8900',          domains: [] },
  { key: 'email',      cat: 'communication', label: 'Email',      prefix: 'mailto:',                           placeholder: 'you@example.com',          domains: [] },
  { key: 'whatsapp',   cat: 'communication', label: 'WhatsApp',   prefix: 'https://wa.me/',                    placeholder: '12345678900',              domains: ['wa.me', 'whatsapp.com'] },
  { key: 'telegram',   cat: 'communication', label: 'Telegram',   prefix: 'https://t.me/',                     placeholder: 'username',                 domains: ['t.me', 'telegram.me', 'telegram.org'] },
  { key: 'line',       cat: 'communication', label: 'LINE',       prefix: 'https://line.me/ti/p/',             placeholder: 'your-line-id',             domains: ['line.me', 'lin.ee'] },
  { key: 'wechat',     cat: 'communication', label: 'WeChat',     prefix: 'weixin://dl/chat?',                 placeholder: 'your-wechat-id',           domains: ['weixin.qq.com'] },
  { key: 'kakaotalk',  cat: 'communication', label: 'KakaoTalk',  prefix: 'https://open.kakao.com/o/',         placeholder: 'profile-link',             domains: ['kakao.com', 'open.kakao.com'] },
  { key: 'signal',     cat: 'communication', label: 'Signal',     prefix: 'https://signal.me/#p/',             placeholder: 'phone-or-username',        domains: ['signal.me', 'signal.org'] },
  { key: 'messenger',  cat: 'communication', label: 'Messenger',  prefix: 'https://m.me/',                     placeholder: 'username',                 domains: ['m.me', 'messenger.com'] },
  { key: 'discord',    cat: 'communication', label: 'Discord',    prefix: 'https://discord.gg/',               placeholder: 'invite-code',              domains: ['discord.gg', 'discord.com'] },

  // ── Social (10) ──
  { key: 'instagram',  cat: 'social',        label: 'Instagram',  prefix: 'https://instagram.com/',            placeholder: 'username',                 domains: ['instagram.com', 'instagr.am'] },
  { key: 'x',          cat: 'social',        label: 'X',          prefix: 'https://x.com/',                    placeholder: 'username',                 domains: ['x.com', 'twitter.com'] },
  { key: 'tiktok',     cat: 'social',        label: 'TikTok',     prefix: 'https://tiktok.com/@',              placeholder: 'username',                 domains: ['tiktok.com'] },
  { key: 'threads',    cat: 'social',        label: 'Threads',    prefix: 'https://threads.net/@',             placeholder: 'username',                 domains: ['threads.net'] },
  { key: 'bluesky',    cat: 'social',        label: 'Bluesky',    prefix: 'https://bsky.app/profile/',         placeholder: 'name.bsky.social',         domains: ['bsky.app'] },
  { key: 'facebook',   cat: 'social',        label: 'Facebook',   prefix: 'https://facebook.com/',             placeholder: 'username',                 domains: ['facebook.com', 'fb.com'] },
  { key: 'snapchat',   cat: 'social',        label: 'Snapchat',   prefix: 'https://snapchat.com/add/',         placeholder: 'username',                 domains: ['snapchat.com'] },
  { key: 'reddit',     cat: 'social',        label: 'Reddit',     prefix: 'https://reddit.com/u/',             placeholder: 'username',                 domains: ['reddit.com'] },
  { key: 'pinterest',  cat: 'social',        label: 'Pinterest',  prefix: 'https://pinterest.com/',            placeholder: 'username',                 domains: ['pinterest.com'] },
  { key: 'mastodon',   cat: 'social',        label: 'Mastodon',   prefix: 'https://mastodon.social/@',         placeholder: 'username',                 domains: ['mastodon.social', 'mas.to'] },

  // ── Video (4) ──
  { key: 'youtube',    cat: 'video',         label: 'YouTube',    prefix: 'https://youtube.com/@',             placeholder: 'channel-name',             domains: ['youtube.com', 'youtu.be'] },
  { key: 'twitch',     cat: 'video',         label: 'Twitch',     prefix: 'https://twitch.tv/',                placeholder: 'username',                 domains: ['twitch.tv'] },
  { key: 'vimeo',      cat: 'video',         label: 'Vimeo',      prefix: 'https://vimeo.com/',                placeholder: 'username',                 domains: ['vimeo.com'] },
  { key: 'bilibili',   cat: 'video',         label: 'Bilibili',   prefix: 'https://space.bilibili.com/',       placeholder: 'user-id',                  domains: ['bilibili.com', 'b23.tv'] },

  // ── Music (5) ──
  { key: 'spotify',    cat: 'music',         label: 'Spotify',    prefix: 'https://open.spotify.com/user/',    placeholder: 'user-id',                  domains: ['spotify.com', 'open.spotify.com'] },
  { key: 'apple-music', cat: 'music',        label: 'Apple Music', prefix: 'https://music.apple.com/profile/', placeholder: 'profile-id',              domains: ['music.apple.com'] },
  { key: 'soundcloud', cat: 'music',         label: 'SoundCloud', prefix: 'https://soundcloud.com/',           placeholder: 'username',                 domains: ['soundcloud.com'] },
  { key: 'bandcamp',   cat: 'music',         label: 'Bandcamp',   prefix: 'https://bandcamp.com/',             placeholder: 'username',                 domains: ['bandcamp.com'] },
  { key: 'youtube-music', cat: 'music',      label: 'YouTube Music', prefix: 'https://music.youtube.com/channel/', placeholder: 'channel-id',          domains: ['music.youtube.com'] },

  // ── Professional (6) ──
  { key: 'linkedin',   cat: 'professional',  label: 'LinkedIn',   prefix: 'https://linkedin.com/in/',          placeholder: 'username',                 domains: ['linkedin.com'] },
  { key: 'github',     cat: 'professional',  label: 'GitHub',     prefix: 'https://github.com/',               placeholder: 'username',                 domains: ['github.com'] },
  { key: 'gitlab',     cat: 'professional',  label: 'GitLab',     prefix: 'https://gitlab.com/',               placeholder: 'username',                 domains: ['gitlab.com'] },
  { key: 'behance',    cat: 'professional',  label: 'Behance',    prefix: 'https://behance.net/',              placeholder: 'username',                 domains: ['behance.net'] },
  { key: 'dribbble',   cat: 'professional',  label: 'Dribbble',   prefix: 'https://dribbble.com/',             placeholder: 'username',                 domains: ['dribbble.com'] },
  { key: 'medium',     cat: 'professional',  label: 'Medium',     prefix: 'https://medium.com/@',              placeholder: 'username',                 domains: ['medium.com'] },

  // ── Writing (4) ──
  { key: 'substack',   cat: 'writing',       label: 'Substack',   prefix: 'https://',                          placeholder: 'name.substack.com',        domains: ['substack.com'] },
  { key: 'notion',     cat: 'writing',       label: 'Notion',     prefix: 'https://',                          placeholder: 'name.notion.site',         domains: ['notion.site', 'notion.so'] },
  { key: 'mirror',     cat: 'writing',       label: 'Mirror',     prefix: 'https://mirror.xyz/',               placeholder: 'name.eth',                 domains: ['mirror.xyz'] },
  { key: 'hashnode',   cat: 'writing',       label: 'Hashnode',   prefix: 'https://',                          placeholder: 'name.hashnode.dev',        domains: ['hashnode.com', 'hashnode.dev'] },

  // ── Business (7) ──
  { key: 'calendly',   cat: 'business',      label: 'Calendly',   prefix: 'https://calendly.com/',             placeholder: 'username',                 domains: ['calendly.com'] },
  { key: 'cal',        cat: 'business',      label: 'Cal.com',    prefix: 'https://cal.com/',                  placeholder: 'username',                 domains: ['cal.com'] },
  { key: 'paypal',     cat: 'business',      label: 'PayPal',     prefix: 'https://paypal.me/',                placeholder: 'username',                 domains: ['paypal.me', 'paypal.com'] },
  { key: 'patreon',    cat: 'business',      label: 'Patreon',    prefix: 'https://patreon.com/',              placeholder: 'username',                 domains: ['patreon.com'] },
  { key: 'kofi',       cat: 'business',      label: 'Ko-fi',      prefix: 'https://ko-fi.com/',                placeholder: 'username',                 domains: ['ko-fi.com'] },
  { key: 'buymeacoffee', cat: 'business',    label: 'Buy Me a Coffee', prefix: 'https://buymeacoffee.com/',    placeholder: 'username',                 domains: ['buymeacoffee.com'] },
  { key: 'stripe',     cat: 'business',      label: 'Stripe',     prefix: 'https://buy.stripe.com/',           placeholder: 'payment-link',             domains: ['stripe.com'] },

  // ── Generic (4) ──
  { key: 'website',    cat: 'generic',       label: 'Website',    prefix: 'https://',                          placeholder: 'yourdomain.com',           domains: [] },
  { key: 'blog',       cat: 'generic',       label: 'Blog',       prefix: 'https://',                          placeholder: 'blog.yourdomain.com',      domains: [] },
  { key: 'portfolio',  cat: 'generic',       label: 'Portfolio',  prefix: 'https://',                          placeholder: 'portfolio.yourdomain.com', domains: [] },
  { key: 'custom',     cat: 'generic',       label: 'Custom',     prefix: '',                                  placeholder: 'https://...',              domains: [] },
];

/** O(1) lookup by key. */
export const PLATFORM_MAP: Record<string, Platform> = PLATFORMS.reduce(
  (acc, p) => {
    acc[p.key] = p;
    return acc;
  },
  {} as Record<string, Platform>,
);

/**
 * The 8 platforms that surface as the always-visible quick-pick chip
 * row in the biolink form. Picked for global coverage of the most
 * common contact methods + top-of-mind socials. Anything not here is
 * one tap further away (the "browse all" modal) — fine for long tail.
 */
export const QUICK_PICK_KEYS = [
  'phone',
  'email',
  'instagram',
  'x',
  'linkedin',
  'line',
  'youtube',
  'website',
] as const;

export const CATEGORIES: PlatformCategory[] = [
  'communication',
  'social',
  'video',
  'music',
  'professional',
  'writing',
  'business',
  'generic',
];

/**
 * Translate a generic-noun platform via i18n; brand-name platforms
 * fall back to their verbatim label so the i18n table stays small.
 * Per spec "品牌名不翻，通用詞翻" — only the 6 generic keys here
 * have translation overrides.
 */
const TRANSLATABLE_KEYS = new Set(['phone', 'email', 'website', 'blog', 'portfolio', 'custom']);

export function getPlatformLabel(
  key: string,
  t: (k: string, opts?: any) => string,
): string {
  const p = PLATFORM_MAP[key];
  if (!p) return key;
  if (TRANSLATABLE_KEYS.has(p.key)) {
    const i18nKey = `editProfile.platform.${p.key}`;
    const translated = t(i18nKey, { defaultValue: '' });
    if (translated) return translated;
  }
  return p.label;
}

export function getCategoryLabel(
  cat: PlatformCategory,
  t: (k: string, opts?: any) => string,
): string {
  const i18nKey = `editProfile.platformCategory.${cat}`;
  const translated = t(i18nKey, { defaultValue: '' });
  return translated || cat;
}

/**
 * Best-effort: given a URL or contact string the user pasted, pick
 * the platform key. Returns null if no preset matches — caller falls
 * back to 'custom'.
 *
 * Detection layers (cheap → expensive):
 *   1. Schemes — mailto: / tel: / weixin: hit before we ever try to
 *      parse a hostname.
 *   2. Bare patterns — a "+886912345678" with no scheme is treated
 *      as a phone; an "user@host" with no scheme is treated as email.
 *   3. Hostname domain match — pull the host from the URL and check
 *      it (or any of its parents) against each platform's domains
 *      list. Subdomain-tolerant ("open.spotify.com" matches the
 *      "spotify.com" entry).
 */
export function detectPlatformFromUrl(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // 1. Scheme-based detection
  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:')) return 'email';
  if (lower.startsWith('tel:')) return 'phone';
  if (lower.startsWith('weixin:')) return 'wechat';

  // 2. Bare pattern (no scheme)
  // Phone: starts with + and is mostly digits / spaces / dashes
  if (/^\+?[\d\s().-]{6,}$/.test(raw)) return 'phone';
  // Email: bare "user@host" with no scheme
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return 'email';

  // 3. Hostname match. Strip scheme, take the host segment, lowercase.
  let host = '';
  try {
    // Add a scheme if missing so URL() doesn't choke on bare domains.
    const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;

  for (const p of PLATFORMS) {
    if (!p.domains.length) continue;
    for (const d of p.domains) {
      if (host === d || host.endsWith(`.${d}`)) {
        return p.key;
      }
    }
  }
  return null;
}

/**
 * Strip the platform's known prefix from a stored URL — used when
 * editing an existing biolink to repopulate the bare-account input.
 * Falls back to the URL as-is for `custom` and unknown platforms.
 */
export function stripPlatformPrefix(url: string, key: string): string {
  const p = PLATFORM_MAP[key];
  if (!p || !p.prefix) return url;
  return url.startsWith(p.prefix) ? url.slice(p.prefix.length) : url;
}

/**
 * Compose a full URL from (platformKey, account). For `custom` the
 * account IS the full URL. For other platforms, prepend the prefix
 * unless the user already typed a full URL that includes it.
 */
export function buildPlatformUrl(key: string, account: string): string {
  const trimmed = account.trim();
  if (!trimmed) return '';
  const p = PLATFORM_MAP[key];
  if (!p || key === 'custom') return trimmed;
  // If the user pasted something that already starts with the prefix
  // (or with any scheme), don't double-prefix.
  if (trimmed.startsWith(p.prefix)) return trimmed;
  if (/^[a-z]+:/i.test(trimmed)) return trimmed;
  return `${p.prefix}${trimmed}`;
}
