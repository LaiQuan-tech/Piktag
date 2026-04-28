// Shared configuration for all web API routes
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kbwfdskulxnhjckdvghj.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtid2Zkc2t1bHhuaGpja2R2Z2hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTgwNTAsImV4cCI6MjA4Njk3NDA1MH0.q1wxMahfity_5An5I_PPSoxglJeKHXX6ohYeGvsaIC8';

const BRAND_COLOR = '#aa00ff';
const BRAND_ACCENT = '#8c52ff';
const BRAND_DARK = '#360066';
const BRAND_BG = '#faf5ff';
const BRAND_GRADIENT = 'linear-gradient(90deg, #ff5757 0%, #8c52ff 100%)';

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
};
