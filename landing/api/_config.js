const crypto = require('crypto');

// Shared configuration for all web API routes (Vercel serverless functions
// under /api/u, /api/i, /api/tag — server-rendered share pages).
//
// ─────────────────────────────────────────────────────────────────────────
// SECURITY NOTE — hardcoded Supabase fallbacks below
// ─────────────────────────────────────────────────────────────────────────
// The values after `||` are FALLBACKS, kept temporarily for deploy
// stability. Production should set these in the Vercel project's
// Environment Variables instead:
//
//   Vercel Dashboard → Project → Settings → Environment Variables
//     SUPABASE_URL       = https://<project-ref>.supabase.co
//     SUPABASE_ANON_KEY  = <anon-key>
//
// Once the env vars are confirmed working in production (see
// docs/SHARE_API_DEPLOY.md for verification steps), the fallbacks
// can be removed in a follow-up change.
//
// Why this matters:
//   - Rotating the key currently requires a code change + deploy,
//     not just an env var swap.
//   - The project ref `kbwfdskulxnhjckdvghj` is enshrined in code.
//   - The anon key is RLS-gated, so leak blast radius is limited —
//     but if you suspect compromise (e.g. it was pasted somewhere
//     public), rotate it via Supabase Dashboard → Settings → API.
//
// DO NOT add a service_role key here under any circumstance — that key
// bypasses RLS and would be a critical leak. Server-only secrets belong
// in Vercel env vars only, never in source.
// ─────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kbwfdskulxnhjckdvghj.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtid2Zkc2t1bHhuaGpja2R2Z2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTgwNTAsImV4cCI6MjA4Njk3NDA1MH0.q1wxMahfity_5An5I_PPSoxglJeKHXX6ohYeGvsaIC8';

const BRAND_COLOR = '#aa00ff';
const BRAND_ACCENT = '#8c52ff';
const BRAND_DARK = '#360066';
const BRAND_BG = '#faf5ff';
// Gradient terminus aligned to BRAND_COLOR (#aa00ff = piktag500) so
// the follow button and bottom banner end on the SAME purple as the
// app's solid primary buttons. Earlier was #8c52ff (a softer
// indigo-purple) — visually it was a smoother gradient ramp on its
// own, but cross-surface (web → app or app → web) the brand purple
// shifted between contexts and users noticed the inconsistency.
// BRAND_ACCENT stays #8c52ff for headline body text where a softer
// non-vivid purple reads better.
const BRAND_GRADIENT = 'linear-gradient(90deg, #ff5757 0%, #aa00ff 100%)';

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\\/g, '\\\\');
}

// ─────────────────────────────────────────────────────────
// i18n translations for public-facing pages
// ─────────────────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    htmlLang: 'en',
    shareAria: 'Share',
    follow: 'Follow',
    bannerText: 'Download #piktag App',
    toastCopied: 'Link copied',
    notFoundTitle: 'User not found',
    notFoundHeading: 'This user could not be found',
    notFoundText: 'Please check the link',
    notFoundBack: 'Back to PikTag',
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    shareAria: '分享',
    follow: '追蹤',
    bannerText: '下載 #piktag App',
    toastCopied: '已複製連結',
    notFoundTitle: '找不到使用者',
    notFoundHeading: '找不到這個使用者',
    notFoundText: '請確認連結是否正確',
    notFoundBack: '回到 PikTag',
  },
  'zh-CN': {
    htmlLang: 'zh-CN',
    shareAria: '分享',
    follow: '关注',
    bannerText: '下载 #piktag App',
    toastCopied: '已复制链接',
    notFoundTitle: '找不到用户',
    notFoundHeading: '找不到这个用户',
    notFoundText: '请确认链接是否正确',
    notFoundBack: '回到 PikTag',
  },
  ja: {
    htmlLang: 'ja',
    shareAria: '共有',
    follow: 'フォロー',
    bannerText: '#piktag アプリをダウンロード',
    toastCopied: 'リンクをコピーしました',
    notFoundTitle: 'ユーザーが見つかりません',
    notFoundHeading: 'このユーザーは見つかりませんでした',
    notFoundText: 'リンクをご確認ください',
    notFoundBack: 'PikTag に戻る',
  },
  ko: {
    htmlLang: 'ko',
    shareAria: '공유',
    follow: '팔로우',
    bannerText: '#piktag 앱 다운로드',
    toastCopied: '링크가 복사되었습니다',
    notFoundTitle: '사용자를 찾을 수 없습니다',
    notFoundHeading: '이 사용자를 찾을 수 없습니다',
    notFoundText: '링크를 확인해 주세요',
    notFoundBack: 'PikTag로 돌아가기',
  },
  es: {
    htmlLang: 'es',
    shareAria: 'Compartir',
    follow: 'Seguir',
    bannerText: 'Descargar #piktag App',
    toastCopied: 'Enlace copiado',
    notFoundTitle: 'Usuario no encontrado',
    notFoundHeading: 'No se pudo encontrar este usuario',
    notFoundText: 'Verifica el enlace',
    notFoundBack: 'Volver a PikTag',
  },
  fr: {
    htmlLang: 'fr',
    shareAria: 'Partager',
    follow: 'Suivre',
    bannerText: "Télécharger l'app #piktag",
    toastCopied: 'Lien copié',
    notFoundTitle: 'Utilisateur introuvable',
    notFoundHeading: 'Cet utilisateur est introuvable',
    notFoundText: 'Veuillez vérifier le lien',
    notFoundBack: 'Retour à PikTag',
  },
  pt: {
    htmlLang: 'pt',
    shareAria: 'Compartilhar',
    follow: 'Seguir',
    bannerText: 'Baixar #piktag App',
    toastCopied: 'Link copiado',
    notFoundTitle: 'Usuário não encontrado',
    notFoundHeading: 'Este usuário não foi encontrado',
    notFoundText: 'Verifique o link',
    notFoundBack: 'Voltar ao PikTag',
  },
  ru: {
    htmlLang: 'ru',
    shareAria: 'Поделиться',
    follow: 'Подписаться',
    bannerText: 'Скачать приложение #piktag',
    toastCopied: 'Ссылка скопирована',
    notFoundTitle: 'Пользователь не найден',
    notFoundHeading: 'Этот пользователь не найден',
    notFoundText: 'Проверьте ссылку',
    notFoundBack: 'Вернуться в PikTag',
  },
  ar: {
    htmlLang: 'ar',
    shareAria: 'مشاركة',
    follow: 'متابعة',
    bannerText: 'تنزيل تطبيق #piktag',
    toastCopied: 'تم نسخ الرابط',
    notFoundTitle: 'المستخدم غير موجود',
    notFoundHeading: 'تعذر العثور على هذا المستخدم',
    notFoundText: 'يرجى التحقق من الرابط',
    notFoundBack: 'العودة إلى PikTag',
  },
  hi: {
    htmlLang: 'hi',
    shareAria: 'साझा करें',
    follow: 'फ़ॉलो करें',
    bannerText: '#piktag ऐप डाउनलोड करें',
    toastCopied: 'लिंक कॉपी किया गया',
    notFoundTitle: 'उपयोगकर्ता नहीं मिला',
    notFoundHeading: 'यह उपयोगकर्ता नहीं मिला',
    notFoundText: 'कृपया लिंक जांचें',
    notFoundBack: 'PikTag पर वापस जाएं',
  },
  id: {
    htmlLang: 'id',
    shareAria: 'Bagikan',
    follow: 'Ikuti',
    bannerText: 'Unduh aplikasi #piktag',
    toastCopied: 'Tautan disalin',
    notFoundTitle: 'Pengguna tidak ditemukan',
    notFoundHeading: 'Pengguna ini tidak ditemukan',
    notFoundText: 'Silakan periksa tautan',
    notFoundBack: 'Kembali ke PikTag',
  },
  th: {
    htmlLang: 'th',
    shareAria: 'แชร์',
    follow: 'ติดตาม',
    bannerText: 'ดาวน์โหลดแอป #piktag',
    toastCopied: 'คัดลอกลิงก์แล้ว',
    notFoundTitle: 'ไม่พบผู้ใช้',
    notFoundHeading: 'ไม่พบผู้ใช้นี้',
    notFoundText: 'โปรดตรวจสอบลิงก์',
    notFoundBack: 'กลับไปที่ PikTag',
  },
  tr: {
    htmlLang: 'tr',
    shareAria: 'Paylaş',
    follow: 'Takip et',
    bannerText: '#piktag uygulamasını indir',
    toastCopied: 'Bağlantı kopyalandı',
    notFoundTitle: 'Kullanıcı bulunamadı',
    notFoundHeading: 'Bu kullanıcı bulunamadı',
    notFoundText: 'Lütfen bağlantıyı kontrol edin',
    notFoundBack: "PikTag'e dön",
  },
  bn: {
    htmlLang: 'bn',
    shareAria: 'শেয়ার',
    follow: 'ফলো',
    bannerText: '#piktag অ্যাপ ডাউনলোড',
    toastCopied: 'লিঙ্ক কপি হয়েছে',
    notFoundTitle: 'ব্যবহারকারী পাওয়া যায়নি',
    notFoundHeading: 'এই ব্যবহারকারীকে পাওয়া যায়নি',
    notFoundText: 'লিঙ্কটি পরীক্ষা করুন',
    notFoundBack: 'PikTag এ ফিরে যান',
  },
};

function detectLocale(req) {
  try {
    const header = (req.headers['accept-language'] || '').toLowerCase();
    if (!header) return TRANSLATIONS.en;
    // Parse list: "zh-TW,zh;q=0.9,en;q=0.8" → ["zh-tw","zh","en"]
    const codes = header.split(',').map(s => s.split(';')[0].trim());
    for (const code of codes) {
      // Exact match first (e.g. 'zh-tw' → 'zh-TW')
      if (code === 'zh-tw' || code === 'zh-hk') return TRANSLATIONS['zh-TW'];
      if (code === 'zh-cn' || code === 'zh-sg') return TRANSLATIONS['zh-CN'];
      // Base language match
      const base = code.split('-')[0];
      if (TRANSLATIONS[base]) return TRANSLATIONS[base];
      if (base === 'zh') return TRANSLATIONS['zh-TW'];
    }
    return TRANSLATIONS.en;
  } catch {
    return TRANSLATIONS.en;
  }
}

// ─────────────────────────────────────────────────────────
// Analytics — share-link visit tracking
// ─────────────────────────────────────────────────────────
// PostHog public project key (write-only, safe to ship in source).
const POSTHOG_KEY = 'phc_CagxzXtHwJ6xXYQ2pdDGmmbh5kRiyQ7ikjFjJnSrr7Hr';
const POSTHOG_HOST = 'https://us.i.posthog.com';

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

// Try to extract PostHog's anonymous distinct_id from the request cookies.
// PostHog sets cookies named like `ph_<project_key>_posthog` whose value is
// JSON-encoded and contains a `distinct_id` field.
function readPosthogDistinctId(req) {
  try {
    const cookieHeader = req.headers.cookie || '';
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';');
    for (const raw of cookies) {
      const eq = raw.indexOf('=');
      if (eq < 0) continue;
      const name = raw.slice(0, eq).trim();
      if (!/^ph_.*_posthog$/.test(name)) continue;
      const value = decodeURIComponent(raw.slice(eq + 1).trim());
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed.distinct_id === 'string' && parsed.distinct_id) {
        return parsed.distinct_id;
      }
    }
  } catch { /* fall through */ }
  return null;
}

function deriveDistinctId(req) {
  const cookieId = readPosthogDistinctId(req);
  if (cookieId) return cookieId;
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const hash = crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
  return `srv_${hash}`;
}

// Fire-and-forget server-side capture. Never throws, never awaited by callers.
function trackShareLinkViewed(req, shareType, shareIdentifier) {
  try {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const host = req.headers['host'] || 'pikt.ag';
    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
    const url = `${proto}://${host}${req.url || ''}`;
    const distinctId = deriveDistinctId(req);

    const body = JSON.stringify({
      api_key: POSTHOG_KEY,
      event: 'share_link_viewed',
      distinct_id: distinctId,
      properties: {
        $current_url: url,
        share_type: shareType,
        share_identifier: shareIdentifier,
        $ip: ip,
        $user_agent: ua,
        referrer,
      },
      timestamp: new Date().toISOString(),
    });

    // Don't await — fire and forget. Swallow rejection so analytics
    // failures never bubble up and never block the share-page response.
    void fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  } catch { /* never break the share page on analytics errors */ }
}

// Build a snippet of <head>-injectable script tags for client-side trackers.
// All three trackers no-op when their env var / key isn't configured.
// The PostHog snippet uses the shared public key. GA4 + Meta Pixel are
// gated on env vars at build/deploy time (server-side serverless reads them
// at request time from process.env).
function buildAnalyticsSnippet(shareType, shareIdentifier) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || process.env.GA_MEASUREMENT_ID || '';
  const metaPixelId = process.env.META_PIXEL_ID || '';
  const safeType = String(shareType).replace(/[^a-z_]/gi, '');
  const safeId = String(shareIdentifier || '').replace(/[^A-Za-z0-9_\-\.]/g, '');

  const ph = `
<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${POSTHOG_KEY}',{api_host:'${POSTHOG_HOST}',person_profiles:'identified_only'});
try{posthog.capture('share_link_viewed',{share_type:'${safeType}',share_identifier:'${safeId}'});}catch(e){}
</script>`;

  const ga = gaId ? `
<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${gaId}');
gtag('event','share_link_viewed',{share_type:'${safeType}',share_identifier:'${safeId}'});
</script>` : '';

  const meta = metaPixelId ? `
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${metaPixelId}');
fbq('track','PageView');
fbq('trackCustom','share_link_viewed',{share_type:'${safeType}',share_identifier:'${safeId}'});
</script>` : '';

  return ph + ga + meta;
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  BRAND_COLOR,
  BRAND_ACCENT,
  BRAND_DARK,
  BRAND_BG,
  BRAND_GRADIENT,
  escapeHtml,
  TRANSLATIONS,
  detectLocale,
  trackShareLinkViewed,
  buildAnalyticsSnippet,
};
