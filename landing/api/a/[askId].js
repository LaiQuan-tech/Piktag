const { SUPABASE_URL, SUPABASE_ANON_KEY, BRAND_COLOR, BRAND_ACCENT, BRAND_DARK, BRAND_BG, BRAND_GRADIENT, escapeHtml, resolveLocale, trackShareLinkViewed, buildAnalyticsSnippet } = require('../_config');

// /a/:askId — Ask share landing page. A member shares an Ask (a question)
// outside PikTag (LINE / SMS / anywhere); the recipient does NOT need an
// account to answer. The reply is written back via the anon-callable
// submit_ask_web_reply RPC and shows up as a notification + in-app list
// for the asker. Mirrors the api/u and api/tag server-rendered pattern:
// same Supabase anon-key REST/RPC calls, same locale handling, same
// brand tokens, same fire-and-forget PostHog tracking.
//
// DB contract (mobile/supabase/migrations/20260706030000_ask_web_replies.sql):
//   read:  rpc get_ask_public(p_ask_id uuid)
//          -> {title, body, author_name, author_username, author_avatar_url,
//              tag_names, expires_at, is_expired} or empty (not found/deleted)
//   write: rpc submit_ask_web_reply(p_ask_id, p_name, p_contact, p_message, p_website)
//          -> true. p_website is a honeypot (hidden form field name="website").
//          error codes: 22023 invalid input, P0002 closed, P0003 reply cap reached.
module.exports = async function handler(req, res) {
  const { askId } = req.query;
  const askIdStr = Array.isArray(askId) ? askId[0] : askId;
  const locale = resolveLocale(req);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Vary', 'Accept-Language');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!askIdStr || !UUID_RE.test(askIdStr)) {
    return res.status(404).send(notFoundPage(locale));
  }

  // Fire-and-forget analytics — never awaited, never throws.
  trackShareLinkViewed(req, 'ask', askIdStr);

  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_ask_public`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_ask_id: askIdStr }),
    });

    if (!rpcRes.ok) {
      console.error('get_ask_public non-OK status:', rpcRes.status);
      return res.status(500).send(notFoundPage(locale));
    }

    const rows = await rpcRes.json();
    // RETURNS TABLE(...) via PostgREST -> array of rows; empty = not found/deleted.
    const ask = Array.isArray(rows) ? rows[0] : rows;

    if (!ask || !ask.title) {
      return res.status(404).send(notFoundPage(locale));
    }

    const analyticsSnippet = buildAnalyticsSnippet('ask', askIdStr);
    const html = renderAskPage(askIdStr, ask, locale, analyticsSnippet);

    // Ask content can change (new replies, expiry) — short edge cache,
    // same shape as the invite page's s-maxage=60.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Error rendering Ask page:', err);
    return res.status(500).send(notFoundPage(locale));
  }
};

function renderAskPage(askId, ask, locale, analyticsSnippet) {
  const authorName = escapeHtml(ask.author_name || 'PikTag user');
  const authorUsername = ask.author_username ? escapeHtml(ask.author_username) : '';
  // The official @piktag demo Ask is seeded in English in the DB. For
  // non-English visitors it should teach-by-example in their own language,
  // unlike real users' Asks (whose DB text IS their own language and should
  // render as-is). Override title/body with the localized demo copy only
  // for the official account; everyone else keeps the raw DB text.
  const isOfficialDemoAsk = ask.author_username === 'piktag';
  const title = escapeHtml((isOfficialDemoAsk ? locale.askDemoTitle : ask.title) || '');
  const rawBody = isOfficialDemoAsk ? locale.askDemoBody : ask.body;
  const body = rawBody ? escapeHtml(rawBody) : '';
  const tagNames = Array.isArray(ask.tag_names) ? ask.tag_names : [];
  const isExpired = !!ask.is_expired;
  const avatarUrl = ask.author_avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(ask.author_name || 'U')}&background=f3e8ff&color=8c52ff&size=200`;

  const pageTitle = `${authorName} — ${title || locale.askPageTitleSuffix} | #PikTag`;
  const ogDescription = body || `${authorName} ${locale.askAskedBy ? locale.askAskedBy : ''}: ${title}`.trim();
  const pageUrl = `https://pikt.ag/a/${askId}`;

  // First-letter avatar fallback keeps parity with other share pages
  // (u/[username].js) rather than always trusting ui-avatars' network call.
  const initials = escapeHtml((ask.author_name || authorUsername || 'U').trim().slice(0, 1).toUpperCase());

  const tagsHtml = tagNames.length > 0
    ? `<div class="tags">${tagNames.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const downloadUrl = `https://pikt.ag/download?ask=${encodeURIComponent(askId)}${authorUsername ? '&ref=' + authorUsername : ''}`;

  const bodyContent = isExpired
    ? `
    <div class="state-card">
      <h2 class="state-heading">${locale.askExpiredHeading}</h2>
      <p class="state-text">${locale.askExpiredText}</p>
    </div>
    <a class="download-cta" href="${escapeHtml(downloadUrl)}">${locale.askDownloadCta}</a>
    `
    : `
    <form id="ask-reply-form" class="reply-form" autocomplete="off">
      <label class="field-label" for="f-name">${locale.askFormNameLabel}</label>
      <input class="field-input" type="text" id="f-name" name="name" maxlength="50" required placeholder="${escapeHtml(locale.askFormNamePlaceholder)}">

      <label class="field-label" for="f-contact">${locale.askFormContactLabel}</label>
      <input class="field-input" type="text" id="f-contact" name="contact" maxlength="100" required placeholder="${escapeHtml(locale.askFormContactPlaceholder)}">

      <label class="field-label" for="f-message">${locale.askFormMessageLabel}</label>
      <textarea class="field-input field-textarea" id="f-message" name="message" maxlength="500" required placeholder="${escapeHtml(locale.askFormMessagePlaceholder)}"></textarea>

      <!-- Honeypot: hidden from real users via CSS; bots that autofill every
           field will trip this and submit_ask_web_reply silently no-ops. -->
      <div class="hp-field" aria-hidden="true">
        <label for="website">Website</label>
        <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
      </div>

      <div class="form-error" id="form-error" role="alert"></div>
      <button type="submit" class="submit-btn" id="submit-btn">${locale.askFormSubmit}</button>
    </form>

    <div class="success-card" id="success-card" style="display:none">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="${BRAND_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
      <h2 class="state-heading">${locale.askSuccessHeading}</h2>
      <p class="state-text">${locale.askSuccessText.split('{name}').join(authorName)}</p>
      <a class="download-cta" href="${escapeHtml(downloadUrl)}">${locale.askDownloadCta}</a>
    </div>
    `;

  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}" dir="${locale.dir || 'ltr'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeHtml(ogDescription)}">
  <meta name="robots" content="noindex, nofollow">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:image" content="${escapeHtml(avatarUrl)}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:site_name" content="#PikTag">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${analyticsSnippet || ''}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(160deg,#faf5ff 0%,#fff5f5 50%,#f5f0ff 100%);color:#1a1a1a;min-height:100vh;display:flex;flex-direction:column;align-items:center}
    .container{max-width:440px;width:100%;padding:32px 20px 60px;display:flex;flex-direction:column;align-items:center}

    .logo{width:40px;height:40px;margin-bottom:20px}
    .logo img{width:32px;height:32px;border-radius:8px;display:block}

    .author-row{display:flex;align-items:center;gap:10px;margin-bottom:20px;width:100%}
    .avatar-wrap{width:48px;height:48px;border-radius:24px;flex-shrink:0;overflow:hidden;background:#f3e8ff;display:flex;align-items:center;justify-content:center}
    .avatar{width:100%;height:100%;object-fit:cover}
    .avatar-initials{font-size:18px;font-weight:700;color:${BRAND_COLOR}}
    .author-meta{min-width:0}
    .author-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .author-sub{font-size:12.5px;color:#999}

    .ask-card{width:100%;background:#fff;border-radius:20px;padding:24px 20px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.04)}
    .ask-title{font-size:19px;font-weight:800;letter-spacing:-.2px;margin-bottom:10px;line-height:1.35}
    .ask-body{font-size:14.5px;color:#444;line-height:1.65;white-space:pre-wrap;word-break:break-word}

    .tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
    .tag{background:rgba(140,82,255,.08);color:${BRAND_DARK};font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:16px}

    .reply-form{width:100%;display:flex;flex-direction:column;gap:6px}
    .field-label{font-size:13px;font-weight:600;color:#333;margin-top:12px}
    .field-input{width:100%;font-family:inherit;font-size:15px;padding:12px 14px;border-radius:12px;border:1.5px solid #e5e5e5;background:#fff;color:#1a1a1a;transition:border-color .15s}
    .field-input:focus{outline:none;border-color:${BRAND_COLOR}}
    .field-textarea{resize:vertical;min-height:90px;line-height:1.5}
    .hp-field{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}

    .form-error{font-size:13px;color:#e0245e;min-height:18px;margin-top:6px}

    .submit-btn{margin-top:8px;background:${BRAND_GRADIENT};color:#fff;font-weight:700;font-size:15.5px;border:none;border-radius:14px;padding:15px;cursor:pointer;box-shadow:0 4px 16px rgba(170,0,255,.28);transition:transform .15s,opacity .15s}
    .submit-btn:hover{transform:translateY(-1px)}
    .submit-btn:active{transform:translateY(0);opacity:.9}
    .submit-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}

    .state-card{width:100%;background:#fff;border-radius:20px;padding:36px 24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.04);margin-bottom:20px}
    .state-heading{font-size:18px;font-weight:800;margin:12px 0 8px}
    .state-text{font-size:14px;color:#666;line-height:1.6}

    .success-card{width:100%;background:#fff;border-radius:20px;padding:36px 24px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.04);display:flex;flex-direction:column;align-items:center}

    .download-cta{display:block;width:100%;text-align:center;margin-top:16px;background:${BRAND_GRADIENT};color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:14px;border-radius:14px;box-shadow:0 4px 16px rgba(170,0,255,.28)}
  </style>
</head>
<body>
  <div class="container">
    <a class="logo" href="https://pikt.ag" aria-label="PikTag">
      <img src="/logo.png" alt="PikTag">
    </a>
    <div class="author-row">
      <div class="avatar-wrap">
        ${ask.author_avatar_url
          ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${authorName}" onerror="this.parentElement.innerHTML='<span class=avatar-initials>${initials}</span>'">`
          : `<span class="avatar-initials">${initials}</span>`}
      </div>
      <div class="author-meta">
        <div class="author-name">${authorName}</div>
        ${authorUsername ? `<div class="author-sub">@${authorUsername}</div>` : ''}
      </div>
    </div>

    <div class="ask-card">
      <div class="ask-title">${title}</div>
      ${body ? `<div class="ask-body">${body}</div>` : ''}
      ${tagsHtml}
    </div>

    ${bodyContent}
  </div>
  <script>
(function() {
  var form = document.getElementById('ask-reply-form');
  if (!form) return; // expired state has no form
  var errorEl = document.getElementById('form-error');
  var submitBtn = document.getElementById('submit-btn');
  var successCard = document.getElementById('success-card');

  var ERR = {
    invalid: ${JSON.stringify(locale.askErrorInvalid)},
    closed: ${JSON.stringify(locale.askErrorClosed)},
    full: ${JSON.stringify(locale.askErrorFull)},
    generic: ${JSON.stringify(locale.askErrorGeneric)}
  };

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    errorEl.textContent = '';
    var name = document.getElementById('f-name').value.trim();
    var contact = document.getElementById('f-contact').value.trim();
    var message = document.getElementById('f-message').value.trim();
    var website = document.getElementById('website').value;

    if (!name || name.length > 50 || contact.length < 3 || contact.length > 100 || !message || message.length > 500) {
      errorEl.textContent = ERR.invalid;
      return;
    }

    submitBtn.disabled = true;

    fetch(${JSON.stringify(SUPABASE_URL)} + '/rest/v1/rpc/submit_ask_web_reply', {
      method: 'POST',
      headers: {
        apikey: ${JSON.stringify(SUPABASE_ANON_KEY)},
        Authorization: 'Bearer ' + ${JSON.stringify(SUPABASE_ANON_KEY)},
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_ask_id: ${JSON.stringify(askId)},
        p_name: name,
        p_contact: contact,
        p_message: message,
        p_website: website || null
      })
    }).then(function(res) {
      if (res.ok) return res.json().then(function() { return true; });
      return res.json().catch(function() { return {}; }).then(function(body) {
        var code = body && body.code;
        var err;
        if (code === '22023') err = ERR.invalid;
        else if (code === 'P0002') err = ERR.closed;
        else if (code === 'P0003') err = ERR.full;
        else err = ERR.generic;
        throw new Error(err);
      });
    }).then(function() {
      form.style.display = 'none';
      successCard.style.display = 'flex';
    }).catch(function(err) {
      errorEl.textContent = (err && err.message) || ERR.generic;
      submitBtn.disabled = false;
    });
  });
})();
  </script>
</body>
</html>`;
}

function notFoundPage(locale) {
  const downloadUrl = 'https://pikt.ag/download';
  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}" dir="${locale.dir || 'ltr'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${locale.askNotFoundTitle} | #PikTag</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${BRAND_BG};display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
    .card{max-width:400px;width:100%}
    .logo{font-size:24px;font-weight:700;color:${BRAND_COLOR};margin-bottom:16px}
    h1{font-size:20px;color:#333;margin-bottom:8px}
    p{font-size:15px;color:#666;margin-bottom:24px;line-height:1.6}
    a.btn{display:block;background:${BRAND_GRADIENT};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px;border-radius:14px;box-shadow:0 4px 16px rgba(170,0,255,.28)}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">#PikTag</div>
    <h1>${locale.askNotFoundHeading}</h1>
    <p>${locale.askNotFoundText}</p>
    <a class="btn" href="${downloadUrl}">${locale.askDownloadCta}</a>
  </div>
</body>
</html>`;
}
