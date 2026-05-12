const { SUPABASE_URL, SUPABASE_ANON_KEY, BRAND_COLOR, BRAND_ACCENT, BRAND_DARK, BRAND_BG, BRAND_GRADIENT, escapeHtml, detectLocale, trackShareLinkViewed, buildAnalyticsSnippet } = require('../_config');

const PLATFORM_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
  twitter: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>',
  github: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>',
  website: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>',
  // Phone + email were missing — they're the two biolink platforms
  // the mobile OnboardingScreen actually writes (alongside facebook /
  // instagram / linkedin), so without them every "phone" link
  // silently fell back to the website (globe) icon below. Phone:
  // lucide-style handset. Email: lucide-style envelope.
  phone: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  email: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
};

function getIconSvg(platform) {
  const key = (platform || '').toLowerCase();
  return PLATFORM_ICONS[key] || PLATFORM_ICONS['website'] || '';
}

// escapeHtml imported from _config.js

module.exports = async function handler(req, res) {
  const { username, sid } = req.query;
  const usernameStr = Array.isArray(username) ? username[0] : username;
  const sidStr = Array.isArray(sid) ? sid[0] : (sid || '');
  const tagsStr = Array.isArray(req.query.tags) ? req.query.tags[0] : (req.query.tags || '');
  const dateStr = Array.isArray(req.query.date) ? req.query.date[0] : (req.query.date || '');
  const locStr = Array.isArray(req.query.loc) ? req.query.loc[0] : (req.query.loc || '');
  const locale = detectLocale(req);

  if (!usernameStr) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(notFoundPage(locale));
  }

  // Reject anything that doesn't look like a valid PikTag username BEFORE
  // we fire analytics. The catch-all rewrite `/:username` in vercel.json
  // routes every otherwise-unhandled path here — including browsers'
  // implicit /favicon.ico, /robots.txt, /sitemap.xml requests, plus any
  // crawler probe. Without this guard those generated bogus
  // share_link_viewed events that polluted PostHog funnels.
  //
  // Username rule: alphanumeric + underscore, 2-30 chars. Tightened in
  // step with the mobile app's signup validator.
  const VALID_USERNAME = /^[a-zA-Z0-9_]{2,30}$/;
  if (!VALID_USERNAME.test(usernameStr)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(notFoundPage(locale));
  }

  // Fire-and-forget analytics — never awaited, never throws.
  trackShareLinkViewed(req, 'user', usernameStr);

  try {
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/piktag_profiles?username=eq.${encodeURIComponent(usernameStr)}&select=id,username,full_name,avatar_url,bio,headline,is_verified,website,location`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );
    const profiles = await profileRes.json();

    if (!profiles || profiles.length === 0) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(notFoundPage(locale));
    }

    const profile = profiles[0];

    // Active-Ask check is added to the parallel fetch chain so the
    // gradient avatar ring stays consistent with the mobile app: the
    // ring is the visual signal for "this person has an active Ask
    // right now". Empty result → subtle ring, non-empty → gradient.
    // `is_active=eq.true&expires_at=gt.now` covers both flags Postgres
    // uses to mark a live ask. `limit=1` because we only need to know
    // existence, not which one.
    const nowIso = new Date().toISOString();
    const [biolinksRes, userTagsRes, activeAsksRes, tribeSizeRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/piktag_biolinks?user_id=eq.${profile.id}&is_active=eq.true&select=platform,url,label,position&order=position.asc`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/piktag_user_tags?user_id=eq.${profile.id}&select=tag_id,piktag_tags(name)`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/piktag_asks?author_id=eq.${profile.id}&is_active=eq.true&expires_at=gt.${encodeURIComponent(nowIso)}&select=id&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      ),
      // Tribe size — single integer, transitive descendant count
      // via the get_tribe_size RPC. Same anon key as everything
      // else here. The RPC has no auth guard for reads (public),
      // so this works for visitors who aren't logged in.
      fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_tribe_size`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_user_id: profile.id }),
        }
      ),
    ]);

    const biolinks = await biolinksRes.json();
    const userTags = await userTagsRes.json();
    const activeAsks = await activeAsksRes.json();
    const hasActiveAsk = Array.isArray(activeAsks) && activeAsks.length > 0;

    // get_tribe_size is a scalar SQL function, so PostgREST returns
    // the bare number as the response body. Defensive: a missing
    // RPC (PGRST202) or any non-number falls to 0.
    let tribeSize = 0;
    try {
      const tribeBody = await tribeSizeRes.json();
      if (typeof tribeBody === 'number') tribeSize = tribeBody;
    } catch {
      tribeSize = 0;
    }

    const tags = (userTags || [])
      .map((ut) => ut.piktag_tags?.name)
      .filter(Boolean);

    // Record pending connection if sid is present (non-member scanned QR)
    if (sidStr) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/piktag_pending_connections`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            host_user_id: profile.id,
            scan_session_id: sidStr,
          }),
        });
      } catch { /* ignore — table may not exist yet */ }
    }

    const analyticsSnippet = buildAnalyticsSnippet('user', usernameStr);
    const html = renderProfilePage(profile, biolinks || [], tags, sidStr, locale, { tags: tagsStr, date: dateStr, location: locStr }, analyticsSnippet, hasActiveAsk, tribeSize);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Error rendering profile:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(notFoundPage(locale));
  }
};

function renderProfilePage(profile, biolinks, tags, sid, locale, eventInfo, analyticsSnippet, hasActiveAsk, tribeSize = 0) {
  const name = escapeHtml(profile.full_name || profile.username || '#piktag User');
  const username = escapeHtml(profile.username || '');
  const headline = profile.headline ? escapeHtml(profile.headline) : '';
  const bio = profile.bio ? escapeHtml(profile.bio) : '';
  const avatarUrl =
    profile.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f3f4f6&color=6b7280&size=200`;
  const isVerified = profile.is_verified;
  const ogDescription = bio || `@${username} on PikTag`;
  const pageTitle = `${name} (@${username}) | #piktag`;
  const pageUrl = `https://pikt.ag/${username}`;

  const verifiedBadge = isVerified
    ? '<svg viewBox="0 0 24 24" width="18" height="18" style="margin-left:4px;vertical-align:middle"><circle cx="12" cy="12" r="10" fill="#8c52ff"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '';

  // Event-info card (🎪 活動資訊) was removed per user feedback —
  // every tag should attach to the person, not the event. The
  // route params (?tags=&date=&loc=) are still consumed by the
  // mobile-side scan flow to seed the post-scan tag picker, but
  // they no longer get their own special card on the public
  // profile page.

  const tagsHtml = tags.length > 0
    ? `<div class="tags">${tags.map((t) => `<a href="/tag/${encodeURIComponent(t)}" class="tag">#${escapeHtml(t)}</a>`).join('')}</div>`
    : '';

  const biolinksHtml = biolinks.length > 0
    ? biolinks
        .map((link) => {
          const label = escapeHtml(link.label || link.platform || 'Link');
          const rawUrl = link.url || '#';
          const safeUrl = (/^https?:\/\//i.test(rawUrl) || /^mailto:/i.test(rawUrl)) ? rawUrl : '#';
          const url = escapeHtml(safeUrl);
          const icon = getIconSvg(link.platform || 'website');
          return `<a href="${url}" class="biolink" target="_blank" rel="noopener noreferrer">${icon}<span>${label}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></a>`;
        })
        .join('')
    : '';

  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeHtml(ogDescription)}">
  <meta name="keywords" content="${escapeHtml(tags.map(t => t.name || t).join(', '))}, #piktag, ${escapeHtml(name)}, networking">
  <meta name="author" content="${escapeHtml(name)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:image" content="${escapeHtml(avatarUrl)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:site_name" content="#piktag">
  <meta property="profile:username" content="${username}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  <meta name="twitter:image" content="${escapeHtml(avatarUrl)}">
  <script type="application/ld+json">
  ${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Person",
    name: name,
    url: pageUrl,
    image: avatarUrl,
    description: ogDescription,
    sameAs: biolinks.map(l => l.url).filter(u => u && (/^https?:\/\//i.test(u) || /^mailto:/i.test(u))),
  }).replace(/</g, '\\u003c')}
  </script>
  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@700;800&display=swap" rel="stylesheet">
  ${analyticsSnippet || ''}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(160deg,#faf5ff 0%,#fff5f5 50%,#f5f0ff 100%);color:#1a1a1a;min-height:100vh;display:flex;flex-direction:column;align-items:center}
    .container{max-width:480px;width:100%;padding:32px 20px 140px;display:flex;flex-direction:column;align-items:center;position:relative}

    /* Logo — pinned top-left, mirrors the share-btn at top-right.
       Visual-weight balanced with share-btn: that one is a 40×40
       circle with a soft white-ish backdrop and a slim stroke icon
       inside — overall "soft and small" presence. A solid 40×40
       gradient logo at the same outer size would visually dominate
       the share button. So: keep the 40×40 invisible tap area
       (same finger target as share-btn), but the visible logo is
       only 28×28 — roughly the same perceived weight as share-btn's
       18px stroke + light background. */
    .logo{position:absolute;top:20px;left:20px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;text-decoration:none;opacity:0;animation:fadeDown .5s ease forwards;z-index:10}
    .logo img{width:28px;height:28px;border-radius:7px;display:block}

    /* Avatar — gradient ring iff this user has an active Ask, subtle
       gray ring otherwise. Same conditional rule as the mobile app's
       RingedAvatar so the brand-purple gradient means the same thing
       on every surface ("this person is asking for something now"). */
    .avatar-wrapper{position:relative;margin-bottom:18px;opacity:0;animation:scaleIn .5s ease .1s forwards}
    .avatar-ring{width:108px;height:108px;border-radius:54px;padding:3px;background:linear-gradient(90deg,#ff5757,#c44dff,#8c52ff,#ff5757);background-size:300% 300%;animation:gradientFlow 6s ease infinite}
    .avatar-ring-subtle{width:108px;height:108px;border-radius:54px;padding:3px;background:#e5e7eb}
    .avatar{width:102px;height:102px;border-radius:51px;object-fit:cover;border:3px solid #fff}

    /* Name & username */
    .name-row{display:flex;align-items:center;gap:4px;margin-bottom:4px;opacity:0;animation:fadeUp .5s ease .2s forwards}
    .name{font-size:26px;font-weight:800;letter-spacing:-0.5px}
    .username{font-size:15px;color:${BRAND_DARK};font-weight:600;margin-bottom:8px;opacity:0;animation:fadeUp .5s ease .25s forwards}
    /* Tribe stat — small pill below username, replaces the old gift
       icon's reward symbology with a public, glanceable count. */
    .tribe-stat{display:inline-block;font-size:12px;font-weight:700;color:${BRAND_ACCENT};background:rgba(140,82,255,.08);padding:3px 10px;border-radius:12px;margin-bottom:10px;opacity:0;animation:fadeUp .5s ease .27s forwards;letter-spacing:.2px}
    .headline{font-size:14px;font-weight:600;color:${BRAND_ACCENT};text-align:center;margin-bottom:10px;opacity:0;animation:fadeUp .5s ease .28s forwards}
    .bio{font-size:15px;color:#555;text-align:center;line-height:1.7;margin-bottom:18px;max-width:360px;opacity:0;animation:fadeUp .5s ease .3s forwards}
    /* event-card styles removed — see comment in renderProfilePage */

    /* Follow button */
    .follow-btn{background:${BRAND_GRADIENT};color:#fff;font-weight:700;border-radius:28px;padding:13px 52px;font-size:16px;border:none;cursor:pointer;margin-bottom:20px;box-shadow:0 4px 16px rgba(170,0,255,.3);transition:all .2s;opacity:0;animation:fadeUp .5s ease .35s forwards}
    .follow-btn:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(170,0,255,.4)}
    .follow-btn:active{transform:translateY(0);opacity:0.9}

    /* Tags */
    .tags{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-bottom:24px;opacity:0;animation:fadeUp .5s ease .4s forwards}
    .tag{background:rgba(255,255,255,.8);backdrop-filter:blur(8px);border:1.5px solid ${BRAND_COLOR};color:${BRAND_DARK};font-size:13px;font-weight:600;padding:6px 14px;border-radius:20px;transition:all .15s;text-decoration:none;cursor:pointer}
    .tag:hover{background:${BRAND_COLOR};color:#fff;transform:translateY(-1px)}

    /* Bio links */
    .biolinks{width:100%;display:flex;flex-direction:column;gap:10px;opacity:0;animation:fadeUp .5s ease .45s forwards}
    .biolink{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border:1px solid rgba(229,229,229,.6);border-radius:16px;padding:16px 20px;text-decoration:none;color:#333;font-size:15px;font-weight:500;transition:all .2s;box-shadow:0 1px 4px rgba(0,0,0,.04)}
    .biolink:hover{transform:translateY(-2px);border-color:${BRAND_COLOR};box-shadow:0 4px 16px rgba(170,0,255,.12)}
    .biolink span{flex:1}
    .biolink svg{flex-shrink:0;color:#aaa;transition:color .15s}
    .biolink svg:first-child{color:${BRAND_COLOR}}
    .biolink:hover svg{color:${BRAND_DARK}}

    /* Share button */
    .share-btn{position:absolute;top:20px;right:20px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.85);backdrop-filter:blur(8px);border:1px solid rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;opacity:0;animation:fadeDown .5s ease .1s forwards;z-index:10}
    .share-btn:hover{background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.1);transform:scale(1.05)}
    .share-btn:active{transform:scale(.95)}
    .share-toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:#333;color:#fff;padding:10px 20px;border-radius:24px;font-size:14px;font-weight:600;opacity:0;transition:all .3s;pointer-events:none;z-index:200}
    .share-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

    /* Banner */
    .banner{position:fixed;bottom:0;left:0;right:0;background:${BRAND_GRADIENT};padding:16px 20px;display:flex;align-items:center;justify-content:center;box-shadow:0 -4px 24px rgba(0,0,0,.12);z-index:100;cursor:pointer;text-decoration:none;gap:8px}
    .banner-text{font-size:15px;font-weight:700;color:#fff}
    .banner-arrow{font-size:18px;color:#fff}

    /* Animations */
    @keyframes gradientFlow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    @keyframes fadeDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
    @keyframes scaleIn{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
  </style>
</head>
<body>
  <div class="container">
    <a class="logo" href="https://pikt.ag" aria-label="PikTag">
      <img src="/logo.png" alt="PikTag">
    </a>
    <button class="share-btn" onclick="handleShare()" aria-label="${locale.shareAria}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${BRAND_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
    </button>
    <div class="avatar-wrapper">
      <div class="${hasActiveAsk ? 'avatar-ring' : 'avatar-ring-subtle'}">
        <img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${name}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=f3f4f6&color=6b7280&size=200'">
      </div>
    </div>
    <div class="name-row">
      <span class="name">${name}</span>
      ${verifiedBadge}
    </div>
    <div class="username">@${username}</div>
    ${tribeSize > 0 ? `<div class="tribe-stat" title="Tribe size">🌀 Tribe ${tribeSize}</div>` : ''}
    ${headline ? `<div class="headline">${headline}</div>` : ''}
    ${bio ? `<div class="bio">${bio}</div>` : ''}
    <button class="follow-btn" onclick="handleFollow()">${locale.follow}</button>
    ${tagsHtml}
    ${biolinksHtml ? `<div class="biolinks">${biolinksHtml}</div>` : ''}
  </div>
  <a class="banner" href="https://pikt.ag/download?username=${username}${sid ? '&sid=' + escapeHtml(sid) : ''}">
    <span class="banner-text">${locale.bannerText}</span>
    <span class="banner-arrow">→</span>
  </a>
  <div class="share-toast" id="share-toast">${locale.toastCopied}</div>
  <script>
function handleShare() {
  var url = 'https://pikt.ag/${username}';
  var title = '${name} (@${username}) | #piktag';
  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(function(){});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      var toast = document.getElementById('share-toast');
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2000);
    }).catch(function(){});
  }
}
function handleFollow() {
  var username = '${username}';
  var name = encodeURIComponent('${name}');
  var sid = '${escapeHtml(sid || '')}';
  var sidParam = sid ? '?sid=' + sid : '';
  var appUrl = 'piktag://' + username + sidParam;
  var downloadUrl = 'https://pikt.ag/download?name=' + name + '&username=' + username + (sid ? '&sid=' + sid : '');
  var timer = setTimeout(function() { window.location = downloadUrl; }, 600);
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) clearTimeout(timer);
  });
  window.location = appUrl;
}
</script>
</body>
</html>`;
}

function notFoundPage(locale) {
  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${locale.notFoundTitle} | #piktag</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${BRAND_BG};display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
    .logo{font-size:24px;font-weight:700;color:${BRAND_COLOR};margin-bottom:16px}
    h1{font-size:20px;color:#333;margin-bottom:8px}
    p{font-size:15px;color:#666;margin-bottom:24px}
    a{color:${BRAND_COLOR};text-decoration:none;font-weight:600}
  </style>
</head>
<body>
  <div>
    <div class="logo"># PikTag</div>
    <h1>${locale.notFoundHeading}</h1>
    <p>${locale.notFoundText}</p>
    <a href="https://pikt.ag">${locale.notFoundBack}</a>
  </div>
</body>
</html>`;
}
