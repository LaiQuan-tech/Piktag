const SUPABASE_URL = 'https://kbwfdskulxnhjckdvghj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtid2Zkc2t1bHhuaGpja2R2Z2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTgwNTAsImV4cCI6MjA4Njk3NDA1MH0.q1wxMahfity_5An5I_PPSoxglJeKHXX6ohYeGvsaIC8';

const BRAND_COLOR = '#aa00ff';
const BRAND_ACCENT = '#8c52ff';
const BRAND_DARK = '#360066';
const BRAND_BG = '#faf5ff';
const BRAND_GRADIENT = 'linear-gradient(90deg, #ff5757 0%, #8c52ff 100%)';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

module.exports = async function handler(req, res) {
  const { tagname } = req.query;
  const tagStr = Array.isArray(tagname) ? tagname[0] : tagname;

  if (!tagStr) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(notFoundPage('找不到標籤'));
  }

  const cleanTag = tagStr.replace(/^#/, '');

  try {
    // 1. Find tag
    const tagRes = await fetch(
      `${SUPABASE_URL}/rest/v1/piktag_tags?name=eq.${encodeURIComponent(cleanTag)}&select=id,name,usage_count`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const tags = await tagRes.json();

    if (!tags || tags.length === 0) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(notFoundPage(`#${escapeHtml(cleanTag)}`));
    }

    const tag = tags[0];

    // 2. Get users with this tag (with their profiles and ALL tags)
    const utRes = await fetch(
      `${SUPABASE_URL}/rest/v1/piktag_user_tags?tag_id=eq.${tag.id}&select=user_id&limit=60`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const userTags = await utRes.json();
    const userIds = (userTags || []).map(ut => ut.user_id);

    if (userIds.length === 0) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderPage(cleanTag, tag.usage_count || 0, []));
    }

    // 3. Fetch profiles
    const idsFilter = userIds.map(id => `"${id}"`).join(',');
    const profilesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/piktag_profiles?id=in.(${idsFilter})&select=id,username,full_name,avatar_url,is_verified`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const profiles = await profilesRes.json();

    // 4. Fetch all tags for these users
    const allUserTagsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/piktag_user_tags?user_id=in.(${idsFilter})&select=user_id,piktag_tags(name)&order=position.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const allUserTags = await allUserTagsRes.json();

    // Group tags by user_id
    const tagsByUser = {};
    (allUserTags || []).forEach(ut => {
      if (!tagsByUser[ut.user_id]) tagsByUser[ut.user_id] = [];
      if (ut.piktag_tags?.name) tagsByUser[ut.user_id].push(ut.piktag_tags.name);
    });

    // Build member list
    const members = (profiles || []).map(p => ({
      username: p.username,
      name: p.full_name || p.username || '',
      avatar: p.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.full_name || 'U')}&background=f3e8ff&color=8c52ff&size=200`,
      verified: p.is_verified || false,
      tags: tagsByUser[p.id] || [],
    }));

    // Shuffle for variety
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }

    const html = renderPage(cleanTag, tag.usage_count || members.length, members);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Tag page error:', err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(notFoundPage('發生錯誤'));
  }
};

function renderPage(tagName, usageCount, members) {
  const title = `#${escapeHtml(tagName)} — 在 #piktag 上的人`;
  const description = `${usageCount} 人使用 #${escapeHtml(tagName)} 標籤。在 #piktag 認識志同道合的人。`;
  const url = `https://pikt.ag/tag/${encodeURIComponent(tagName)}`;

  const memberCards = members.map(m => {
    const verifiedSvg = m.verified
      ? '<svg viewBox="0 0 24 24" width="14" height="14" style="margin-left:3px;vertical-align:middle;flex-shrink:0"><circle cx="12" cy="12" r="10" fill="#3b82f6"/><path d="M9 12l2 2 4-4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '';
    const tagsHtml = m.tags
      .map(t => `<span class="mtag">#${escapeHtml(t)}</span>`)
      .join(' ');
    return `<a href="/${escapeHtml(m.username)}" class="card">
      <div class="card-avatar-wrap">
        <img class="card-avatar" src="${escapeHtml(m.avatar)}" alt="${escapeHtml(m.name)}" loading="lazy" onerror="this.src='https://ui-avatars.com/api/?name=U&background=f3e8ff&color=8c52ff&size=200'">
      </div>
      <div class="card-name">${escapeHtml(m.name)}${verifiedSvg}</div>
      <div class="card-tags">${tagsHtml}</div>
    </a>`;
  }).join('');

  const emptyState = members.length === 0
    ? '<div class="empty">還沒有人使用這個標籤，成為第一個！</div>'
    : '';

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="#piktag">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@700;800&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(160deg,#faf5ff 0%,#fff5f5 50%,#f5f0ff 100%);color:#1a1a1a;min-height:100vh}

    /* Header */
    .header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(0,0,0,.06);padding:16px 20px}
    .header-inner{max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
    .header-left{display:flex;align-items:center;gap:12px}
    .logo{font-family:'Poppins',sans-serif;font-size:20px;font-weight:800;color:${BRAND_COLOR};text-decoration:none}
    .tag-title{font-size:22px;font-weight:800;color:${BRAND_DARK};letter-spacing:-0.3px}
    .tag-count{font-size:13px;color:#888;font-weight:500}
    .header-cta{background:${BRAND_GRADIENT};color:#fff;font-weight:700;border:none;border-radius:24px;padding:10px 24px;font-size:14px;cursor:pointer;text-decoration:none;transition:all .2s;box-shadow:0 2px 12px rgba(170,0,255,.25)}
    .header-cta:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(170,0,255,.35)}

    /* Masonry Grid */
    .masonry{max-width:960px;margin:24px auto;padding:0 12px;columns:2;column-gap:12px}
    @media(min-width:640px){.masonry{columns:3;column-gap:16px}}
    @media(min-width:900px){.masonry{columns:4;column-gap:16px}}

    /* Card */
    .card{display:block;break-inside:avoid;background:#fff;border-radius:16px;padding:20px 16px;margin-bottom:12px;text-decoration:none;color:#1a1a1a;transition:all .2s;border:1px solid rgba(0,0,0,.04);box-shadow:0 1px 4px rgba(0,0,0,.04)}
    .card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(170,0,255,.12);border-color:${BRAND_COLOR}}
    .card-avatar-wrap{display:flex;justify-content:center;margin-bottom:12px}
    .card-avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;border:2.5px solid #f3e8ff}
    .card-name{font-size:15px;font-weight:700;text-align:center;margin-bottom:8px;display:flex;align-items:center;justify-content:center;line-height:1.3}
    .card-tags{font-size:12.5px;color:${BRAND_ACCENT};line-height:1.8;text-align:center;word-break:break-word}
    .mtag{display:inline;margin:0 2px;white-space:nowrap}

    /* Empty state */
    .empty{text-align:center;padding:60px 20px;color:#999;font-size:16px}

    /* Bottom banner */
    .banner{position:fixed;bottom:0;left:0;right:0;background:${BRAND_GRADIENT};padding:16px 20px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 -4px 24px rgba(0,0,0,.12);z-index:100;text-decoration:none}
    .banner-text{font-size:15px;font-weight:700;color:#fff}
    .banner-arrow{font-size:18px;color:#fff}

    /* Bottom padding for banner */
    .bottom-spacer{height:70px}

    /* Animations */
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    .card{animation:fadeUp .4s ease forwards;opacity:0}
    .card:nth-child(1){animation-delay:.05s}
    .card:nth-child(2){animation-delay:.1s}
    .card:nth-child(3){animation-delay:.15s}
    .card:nth-child(4){animation-delay:.2s}
    .card:nth-child(5){animation-delay:.25s}
    .card:nth-child(6){animation-delay:.3s}
    .card:nth-child(7){animation-delay:.35s}
    .card:nth-child(8){animation-delay:.4s}
    .card:nth-child(n+9){animation-delay:.45s}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <a href="/" class="logo">#piktag</a>
        <div>
          <div class="tag-title">#${escapeHtml(tagName)}</div>
          <div class="tag-count">${usageCount} 人</div>
        </div>
      </div>
      <a href="https://pikt.ag/download" class="header-cta">下載 App</a>
    </div>
  </div>

  <div class="masonry">
    ${memberCards}
    ${emptyState}
  </div>

  <div class="bottom-spacer"></div>
  <a class="banner" href="https://pikt.ag/download">
    <span class="banner-text">下載 #piktag App 認識他們</span>
    <span class="banner-arrow">→</span>
  </a>
</body>
</html>`;
}

function notFoundPage(title) {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title || '找不到標籤'} | #piktag</title>
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
    <div class="logo">#piktag</div>
    <h1>找不到這個標籤</h1>
    <p>試試其他標籤或下載 App 探索更多</p>
    <a href="https://pikt.ag/download">下載 #piktag App</a>
  </div>
</body>
</html>`;
}
