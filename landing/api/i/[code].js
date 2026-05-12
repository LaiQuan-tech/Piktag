const { BRAND_COLOR, BRAND_ACCENT, BRAND_DARK, BRAND_BG, BRAND_GRADIENT, escapeHtml, detectLocale, trackShareLinkViewed, buildAnalyticsSnippet } = require('../_config');

module.exports = async function handler(req, res) {
  const { code } = req.query;
  const codeStr = Array.isArray(code) ? code[0] : code;
  const safeCode = escapeHtml((codeStr || '').toUpperCase());
  const locale = detectLocale(req);

  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isMobile = isIos || isAndroid;

  // Fire-and-forget analytics — never awaited, never throws.
  trackShareLinkViewed(req, 'invite', (codeStr || '').toUpperCase());
  const analyticsSnippet = buildAnalyticsSnippet('invite', (codeStr || '').toUpperCase());

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');

  const html = `<!DOCTYPE html>
<html lang="${locale.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PikTag Invite: ${safeCode}</title>
  <meta name="description" content="You've been invited to PikTag. Redeem code ${safeCode} to connect.">
  <meta property="og:title" content="PikTag Invite ${safeCode}">
  <meta property="og:description" content="Tap to redeem this PikTag invite code">
  <meta property="og:type" content="website">
  <link rel="icon" href="/favicon.ico">
  ${analyticsSnippet}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(160deg,#faf5ff 0%,#fff5f5 50%,#f5f0ff 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:24px;padding:48px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(170,0,255,.12)}
    .logo{font-size:32px;font-weight:800;color:${BRAND_COLOR};margin-bottom:24px}
    h1{font-size:22px;color:#111;margin-bottom:8px}
    .sub{font-size:14px;color:#666;margin-bottom:24px}
    .code{display:inline-block;font-family:'SF Mono',Menlo,monospace;font-size:28px;font-weight:800;letter-spacing:4px;background:#faf5ff;color:${BRAND_DARK};padding:16px 24px;border-radius:12px;border:2px dashed ${BRAND_COLOR};margin-bottom:32px}
    .btn{display:block;background:${BRAND_GRADIENT};color:#fff;font-weight:700;font-size:16px;text-decoration:none;padding:16px;border-radius:14px;margin-bottom:12px;box-shadow:0 4px 16px rgba(170,0,255,.3)}
    .btn-secondary{display:block;background:#fff;color:${BRAND_COLOR};font-weight:600;font-size:14px;text-decoration:none;padding:12px;border-radius:10px;border:1.5px solid ${BRAND_COLOR}}
    .hint{font-size:12px;color:#999;margin-top:16px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">PikTag</div>
    <h1>You've been invited!</h1>
    <p class="sub">Redeem this code to connect with a friend on PikTag</p>
    <div class="code">${safeCode}</div>
    ${isMobile ? `
      <a class="btn" href="piktag://invite/${safeCode}">Open in PikTag App</a>
      <a class="btn-secondary" href="https://pikt.ag/download?invite=${safeCode}">Download App</a>
    ` : `
      <a class="btn-secondary" href="https://pikt.ag/download?invite=${safeCode}">Get the PikTag App</a>
      <p class="hint">Open this link on your phone to redeem</p>
    `}
  </div>
  ${isMobile ? `
    <script>
      // Try to auto-open the app after a short delay
      setTimeout(function() {
        window.location = 'piktag://invite/${safeCode}';
      }, 300);
    </script>
  ` : ''}
</body>
</html>`;
  return res.status(200).send(html);
};
