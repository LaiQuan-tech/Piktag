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
  /** When true, the entry stays in PLATFORMS for legacy-row
   *  rendering (so a user who saved `platform='website'` six months
   *  ago still gets the right icon / label) but is HIDDEN from the
   *  picker. Founder 2026-05-31 called out that website / blog /
   *  portfolio / custom are "all the same thing — a link the user
   *  needs to name themselves" and we shouldn't show four redundant
   *  options. Only `custom` (relabeled as "Link") survives in the
   *  picker. */
  legacy?: boolean;
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
  // Slack identity is workspace-tied — the shareable "my Slack" is
  // usually a workspace invite URL or a Slack Connect DM link, not a
  // public username. Empty-ish prefix = paste-mode (same shape as
  // Website / Substack / Notion). Domain detection covers both the
  // marketing site (joins) and the app subdomain (Connect DMs).
  { key: 'slack',      cat: 'communication', label: 'Slack',      prefix: 'https://',                          placeholder: 'workspace.slack.com/...',  domains: ['slack.com', 'app.slack.com'] },

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

  // ── Generic — single "Link" entry after the 2026-05-31 consolidation ──
  // website / blog / portfolio kept here ONLY for backward-compat:
  // existing piktag_biolinks rows with these platform keys still render
  // with the right icon + label. New users only see `custom` in the
  // picker (relabeled to "Link" / "連結" via the i18n override).
  { key: 'website',    cat: 'generic',       label: 'Website',    prefix: 'https://',                          placeholder: 'yourdomain.com',           domains: [], legacy: true },
  { key: 'blog',       cat: 'generic',       label: 'Blog',       prefix: 'https://',                          placeholder: 'blog.yourdomain.com',      domains: [], legacy: true },
  { key: 'portfolio',  cat: 'generic',       label: 'Portfolio',  prefix: 'https://',                          placeholder: 'portfolio.yourdomain.com', domains: [], legacy: true },
  { key: 'custom',     cat: 'generic',       label: 'Link',       prefix: '',                                  placeholder: 'yourdomain.com',           domains: [] },
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
 * Quick-pick chip row in the biolink form. ORDER MATTERS — items
 * appear top-to-bottom in the picker.
 *
 * 2026-05-25/26 rebalance (NA primary market): swapped LINE / YouTube
 * out of the quick-row (they remain one tap away in "Browse all") and
 * promoted NA-mainstream messengers (WhatsApp / Messenger / Telegram /
 * Snapchat) plus Calendly (the work-cluster slot) and WeChat (large
 * Chinese-diaspora overlap with the NA audience).
 *
 * 2026-05-30 swap (Messenger → Reddit): Messenger usage in NA among
 * the 18-30 demographic that PikTag's cold-start targets has been
 * declining for years — iMessage and WhatsApp absorbed it. Reddit,
 * meanwhile, has NA daily-active counts above X and is the single
 * most-important "build in public" channel for the founder's
 * cold-start strategy (Gemini cold-start audit 2026-05-30). Reddit
 * was already in the social PLATFORMS catalog; promotion is just a
 * one-line swap. Placement in slot 9 (not slot 4 where Messenger
 * sat) puts it inside the social cluster — Reddit is community
 * discussion, not messaging, so the work-cluster comment below
 * stays intact.
 *
 * Slot 6 — "the work-cluster slot" — went through three iterations on
 * 2026-05-25/26: Teams (rejected: org-internal identity), then Slack
 * (rejected for the same reason — `app.slack.com/client/T…` URLs only
 * work for members of that specific workspace and aren't something
 * anyone prints on a card), and finally Calendly. Calendly is the only
 * candidate where the shareable URL (`calendly.com/<user>`) IS a real
 * portable handle — people DO put it on business cards / email sigs —
 * AND it fits the "book a meeting with me" follow-up to LinkedIn's
 * "look me up" surface. Slack/Teams remain accessible via "Browse all"
 * for the rare power user who actually wants to share a workspace
 * invite.
 *
 *   1. phone         — universal
 *   2. email         — universal
 *   3. whatsapp      — NA messenger #1
 *   4. instagram     — NA social (Meta)
 *   5. linkedin      — NA professional (CRM angle)
 *   6. calendly      — NA work cluster (companion to LinkedIn)
 *   7. telegram      — NA + intl messenger, tech crowd
 *   8. x             — NA micro-blog
 *   9. reddit        — NA community discussion (Gen Z + maker / tech)
 *  10. snapchat      — Gen Z mainstream
 *  11. wechat        — Chinese-diaspora coverage
 *  12. website       — universal essential
 */
export const QUICK_PICK_KEYS = [
  'phone',
  'email',
  'whatsapp',
  'instagram',
  'linkedin',
  'calendly',
  'telegram',
  'x',
  'reddit',
  'snapchat',
  'wechat',
  // 'custom' replaced 'website' here on 2026-05-31 — the founder
  // observed that website / blog / portfolio / custom were "all
  // saying the same thing, a link the user needs to name". One
  // generic Link entry is the truth. Marked website / blog /
  // portfolio as `legacy: true` above so existing rows keep
  // rendering correctly.
  'custom',
] as const;

// Generic ('個人網站 / 部落格 / 作品集 / 自訂連結') leads the search-
// modal section list because they cover ~60% of "I just want to add
// my homepage" cases — burying them under 6 brand categories made
// users scroll past everything to reach the most common option.
// Communication ranks second since contact methods (Phone, Email,
// LINE, WhatsApp) are the second-most-direct social signal, then the
// brand categories follow.
export const CATEGORIES: PlatformCategory[] = [
  'generic',
  'communication',
  'social',
  'video',
  'music',
  'professional',
  'writing',
  'business',
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
 * Auto-favicon helper for the `custom` ("Link") biolink platform —
 * 2026-05-31 enhancement, founder ask: "Favorites Icon 要不要讓他
 * 自動顯示，不是自訂，而且系統直接抓".
 *
 * Returns Google's s2/favicons proxy URL at 128px for the given
 * link's hostname, or null when the URL can't be parsed. The
 * platform catalog stays the source of truth for branded platforms
 * (Instagram / X / LinkedIn / etc. keep their official SVGs); this
 * helper exists ONLY to enrich the generic `custom` entry so a user
 * who picks "連結 / Link" and pastes pikt.ag automatically gets the
 * PikTag # favicon instead of the generic chain icon — making `link`
 * the only PLATFORM in the catalog with a dynamic, site-specific
 * icon, which is the founder's "unique existence" intent.
 *
 * Render-time computed (NOT stored). Two design wins:
 *   1) Zero migration. Every existing custom biolink row gets a
 *      favicon immediately, no backfill.
 *   2) Self-healing. If the user edits the URL, the favicon updates
 *      automatically on next render — no stale icon_url drift.
 *
 * Google's proxy was chosen over DuckDuckGo's for reliability +
 * resolution; if privacy becomes a launch concern we can swap to
 * our own proxy without touching any caller.
 */
export function getCustomFaviconUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    // buildPlatformUrl auto-prepends https:// on save, but legacy
    // rows + render-time paste-paths may still be scheme-less.
    // Mirror that defensive prepend here.
    const withScheme = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    const host = new URL(withScheme).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
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
  // 'custom' needs scheme-aware handling — historically the user was
  // expected to type a full URL including `https://`, but in practice
  // most paste / type bare domains like "mysite.com" and the resulting
  // Linking.openURL silently fails on iOS (no scheme → no handler).
  // Fix 2026-05-31: auto-prepend https:// when the value doesn't
  // already start with a scheme. ProfileScreen.handleOpenBiolink also
  // wraps existing legacy rows defensively, so this is the canonical
  // save-side fix.
  if (key === 'custom') {
    if (/^[a-z]+:/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
  if (!p) return trimmed;
  // If the user pasted something that already starts with the prefix
  // (or with any scheme), don't double-prefix.
  if (trimmed.startsWith(p.prefix)) return trimmed;
  if (/^[a-z]+:/i.test(trimmed)) return trimmed;
  return `${p.prefix}${trimmed}`;
}
