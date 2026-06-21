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

const BRAND_COLOR = '#8c52ff';
const BRAND_ACCENT = '#8c52ff';
const BRAND_DARK = '#360066';
const BRAND_BG = '#faf5ff';
// Single brand purple #8c52ff used everywhere — solid surfaces AND
// the gradient terminus. Aligns with the logo PNG (#ff5757 → #8c52ff,
// verified by decoding pixel data) so logo, follow button, and any
// other gradient ramp end on the exact same purple. Trial run swapped
// from the previous dual-purple scheme (#aa00ff for solids, #8c52ff
// for gradient end) — see commit history if reverting.
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
    bannerText: 'Download #PikTag App',
    toastCopied: 'Link copied',
    notFoundTitle: 'User not found',
    notFoundHeading: 'This user could not be found',
    notFoundText: 'Please check the link',
    notFoundBack: 'Back to PikTag',
    tagPageNotFoundTitle: 'Tag not found',
    tagPageError: 'Something went wrong',
    tagPageTitleSuffix: 'People on #PikTag',
    tagPageDescription: '{count} people use #{tag} on #PikTag. Meet like-minded people on #PikTag.',
    tagPageCountUnit: 'people',
    tagPageDownloadApp: 'Download App',
    tagPageEmpty: 'No one has used this tag yet — be the first!',
    tagPageBanner: 'Download the #PikTag App to meet them',
    tagPageNotFoundHeading: 'Tag not found',
    tagPageNotFoundText: 'Try another tag or download the app to explore more',
    tagPageNotFoundLink: 'Download the #PikTag App',
  },
  'zh-TW': {
    htmlLang: 'zh-TW',
    shareAria: '分享',
    follow: '追蹤',
    bannerText: '下載 #PikTag App',
    toastCopied: '已複製連結',
    notFoundTitle: '找不到使用者',
    notFoundHeading: '找不到這個使用者',
    notFoundText: '請確認連結是否正確',
    notFoundBack: '回到 PikTag',
    tagPageNotFoundTitle: '找不到標籤',
    tagPageError: '發生錯誤',
    tagPageTitleSuffix: '在 #PikTag 上的人',
    tagPageDescription: '{count} 人使用 #{tag} 標籤。在 #PikTag 認識志同道合的人。',
    tagPageCountUnit: '人',
    tagPageDownloadApp: '下載 App',
    tagPageEmpty: '還沒有人使用這個標籤，成為第一個！',
    tagPageBanner: '下載 #PikTag App 認識他們',
    tagPageNotFoundHeading: '找不到這個標籤',
    tagPageNotFoundText: '試試其他標籤或下載 App 探索更多',
    tagPageNotFoundLink: '下載 #PikTag App',
  },
  'zh-CN': {
    htmlLang: 'zh-CN',
    shareAria: '分享',
    follow: '关注',
    bannerText: '下载 #PikTag App',
    toastCopied: '已复制链接',
    notFoundTitle: '找不到用户',
    notFoundHeading: '找不到这个用户',
    notFoundText: '请确认链接是否正确',
    notFoundBack: '回到 PikTag',
    tagPageNotFoundTitle: '找不到标签',
    tagPageError: '发生错误',
    tagPageTitleSuffix: '在 #PikTag 上的人',
    tagPageDescription: '{count} 人使用 #{tag} 标签。在 #PikTag 认识志同道合的人。',
    tagPageCountUnit: '人',
    tagPageDownloadApp: '下载 App',
    tagPageEmpty: '还没有人使用这个标签，成为第一个！',
    tagPageBanner: '下载 #PikTag App 认识他们',
    tagPageNotFoundHeading: '找不到这个标签',
    tagPageNotFoundText: '试试其他标签或下载 App 探索更多',
    tagPageNotFoundLink: '下载 #PikTag App',
  },
  ja: {
    htmlLang: 'ja',
    shareAria: '共有',
    follow: 'フォロー',
    bannerText: '#PikTag アプリをダウンロード',
    toastCopied: 'リンクをコピーしました',
    notFoundTitle: 'ユーザーが見つかりません',
    notFoundHeading: 'このユーザーは見つかりませんでした',
    notFoundText: 'リンクをご確認ください',
    notFoundBack: 'PikTag に戻る',
    tagPageNotFoundTitle: 'タグが見つかりません',
    tagPageError: 'エラーが発生しました',
    tagPageTitleSuffix: '#PikTag の人々',
    tagPageDescription: '{count}人が #PikTag で #{tag} を使っています。#PikTag で気の合う人と出会おう。',
    tagPageCountUnit: '人',
    tagPageDownloadApp: 'アプリをダウンロード',
    tagPageEmpty: 'まだ誰もこのタグを使っていません。最初の一人になろう！',
    tagPageBanner: '#PikTag アプリをダウンロードして出会おう',
    tagPageNotFoundHeading: 'このタグが見つかりません',
    tagPageNotFoundText: '別のタグを試すか、アプリをダウンロードしてもっと探そう',
    tagPageNotFoundLink: '#PikTag アプリをダウンロード',
  },
  ko: {
    htmlLang: 'ko',
    shareAria: '공유',
    follow: '팔로우',
    bannerText: '#PikTag 앱 다운로드',
    toastCopied: '링크가 복사되었습니다',
    notFoundTitle: '사용자를 찾을 수 없습니다',
    notFoundHeading: '이 사용자를 찾을 수 없습니다',
    notFoundText: '링크를 확인해 주세요',
    notFoundBack: 'PikTag로 돌아가기',
    tagPageNotFoundTitle: '태그를 찾을 수 없습니다',
    tagPageError: '문제가 발생했습니다',
    tagPageTitleSuffix: '#PikTag의 사람들',
    tagPageDescription: '{count}명이 #PikTag에서 #{tag} 태그를 사용합니다. #PikTag에서 마음 맞는 사람들을 만나보세요.',
    tagPageCountUnit: '명',
    tagPageDownloadApp: '앱 다운로드',
    tagPageEmpty: '아직 이 태그를 사용한 사람이 없어요. 첫 번째가 되어보세요!',
    tagPageBanner: '#PikTag 앱을 다운로드하고 만나보세요',
    tagPageNotFoundHeading: '이 태그를 찾을 수 없습니다',
    tagPageNotFoundText: '다른 태그를 시도하거나 앱을 다운로드해 더 둘러보세요',
    tagPageNotFoundLink: '#PikTag 앱 다운로드',
  },
  es: {
    htmlLang: 'es',
    shareAria: 'Compartir',
    follow: 'Seguir',
    bannerText: 'Descargar #PikTag App',
    toastCopied: 'Enlace copiado',
    notFoundTitle: 'Usuario no encontrado',
    notFoundHeading: 'No se pudo encontrar este usuario',
    notFoundText: 'Verifica el enlace',
    notFoundBack: 'Volver a PikTag',
    tagPageNotFoundTitle: 'Etiqueta no encontrada',
    tagPageError: 'Algo salió mal',
    tagPageTitleSuffix: 'Personas en #PikTag',
    tagPageDescription: '{count} personas usan #{tag} en #PikTag. Conoce a gente con tus mismos intereses en #PikTag.',
    tagPageCountUnit: 'personas',
    tagPageDownloadApp: 'Descargar app',
    tagPageEmpty: 'Nadie ha usado esta etiqueta todavía. ¡Sé el primero!',
    tagPageBanner: 'Descarga la app #PikTag para conocerlos',
    tagPageNotFoundHeading: 'Etiqueta no encontrada',
    tagPageNotFoundText: 'Prueba otra etiqueta o descarga la app para explorar más',
    tagPageNotFoundLink: 'Descargar la app #PikTag',
  },
  fr: {
    htmlLang: 'fr',
    shareAria: 'Partager',
    follow: 'Suivre',
    bannerText: "Télécharger l'app #PikTag",
    toastCopied: 'Lien copié',
    notFoundTitle: 'Utilisateur introuvable',
    notFoundHeading: 'Cet utilisateur est introuvable',
    notFoundText: 'Veuillez vérifier le lien',
    notFoundBack: 'Retour à PikTag',
    tagPageNotFoundTitle: 'Tag introuvable',
    tagPageError: "Une erreur s'est produite",
    tagPageTitleSuffix: 'Des gens sur #PikTag',
    tagPageDescription: '{count} personnes utilisent #{tag} sur #PikTag. Rencontrez des gens qui vous ressemblent sur #PikTag.',
    tagPageCountUnit: 'personnes',
    tagPageDownloadApp: "Télécharger l'app",
    tagPageEmpty: "Personne n'a encore utilisé ce tag. Soyez le premier !",
    tagPageBanner: "Téléchargez l'app #PikTag pour les rencontrer",
    tagPageNotFoundHeading: 'Tag introuvable',
    tagPageNotFoundText: "Essayez un autre tag ou téléchargez l'app pour explorer davantage",
    tagPageNotFoundLink: "Télécharger l'app #PikTag",
  },
  pt: {
    htmlLang: 'pt',
    shareAria: 'Compartilhar',
    follow: 'Seguir',
    bannerText: 'Baixar #PikTag App',
    toastCopied: 'Link copiado',
    notFoundTitle: 'Usuário não encontrado',
    notFoundHeading: 'Este usuário não foi encontrado',
    notFoundText: 'Verifique o link',
    notFoundBack: 'Voltar ao PikTag',
    tagPageNotFoundTitle: 'Tag não encontrada',
    tagPageError: 'Algo deu errado',
    tagPageTitleSuffix: 'Pessoas no #PikTag',
    tagPageDescription: '{count} pessoas usam #{tag} no #PikTag. Conheça pessoas com os mesmos interesses no #PikTag.',
    tagPageCountUnit: 'pessoas',
    tagPageDownloadApp: 'Baixar app',
    tagPageEmpty: 'Ninguém usou esta tag ainda. Seja o primeiro!',
    tagPageBanner: 'Baixe o app #PikTag para conhecê-las',
    tagPageNotFoundHeading: 'Tag não encontrada',
    tagPageNotFoundText: 'Tente outra tag ou baixe o app para explorar mais',
    tagPageNotFoundLink: 'Baixar o app #PikTag',
  },
  ru: {
    htmlLang: 'ru',
    shareAria: 'Поделиться',
    follow: 'Подписаться',
    bannerText: 'Скачать приложение #PikTag',
    toastCopied: 'Ссылка скопирована',
    notFoundTitle: 'Пользователь не найден',
    notFoundHeading: 'Этот пользователь не найден',
    notFoundText: 'Проверьте ссылку',
    notFoundBack: 'Вернуться в PikTag',
    tagPageNotFoundTitle: 'Тег не найден',
    tagPageError: 'Что-то пошло не так',
    tagPageTitleSuffix: 'Люди в #PikTag',
    tagPageDescription: '{count} человек используют #{tag} в #PikTag. Знакомьтесь с единомышленниками в #PikTag.',
    tagPageCountUnit: 'чел.',
    tagPageDownloadApp: 'Скачать приложение',
    tagPageEmpty: 'Этот тег ещё никто не использовал. Станьте первым!',
    tagPageBanner: 'Скачайте приложение #PikTag, чтобы познакомиться с ними',
    tagPageNotFoundHeading: 'Этот тег не найден',
    tagPageNotFoundText: 'Попробуйте другой тег или скачайте приложение, чтобы узнать больше',
    tagPageNotFoundLink: 'Скачать приложение #PikTag',
  },
  ar: {
    htmlLang: 'ar',
    shareAria: 'مشاركة',
    follow: 'متابعة',
    bannerText: 'تنزيل تطبيق #PikTag',
    toastCopied: 'تم نسخ الرابط',
    notFoundTitle: 'المستخدم غير موجود',
    notFoundHeading: 'تعذر العثور على هذا المستخدم',
    notFoundText: 'يرجى التحقق من الرابط',
    notFoundBack: 'العودة إلى PikTag',
    tagPageNotFoundTitle: 'الوسم غير موجود',
    tagPageError: 'حدث خطأ ما',
    tagPageTitleSuffix: 'أشخاص على #PikTag',
    tagPageDescription: '{count} شخص يستخدمون #{tag} على #PikTag. تعرّف على أشخاص يشاركونك اهتماماتك على #PikTag.',
    tagPageCountUnit: 'شخص',
    tagPageDownloadApp: 'تنزيل التطبيق',
    tagPageEmpty: 'لم يستخدم أحد هذا الوسم بعد — كن أول من يفعل!',
    tagPageBanner: 'نزّل تطبيق #PikTag للتعرّف عليهم',
    tagPageNotFoundHeading: 'هذا الوسم غير موجود',
    tagPageNotFoundText: 'جرّب وسمًا آخر أو نزّل التطبيق لاستكشاف المزيد',
    tagPageNotFoundLink: 'تنزيل تطبيق #PikTag',
  },
  hi: {
    htmlLang: 'hi',
    shareAria: 'साझा करें',
    follow: 'फ़ॉलो करें',
    bannerText: '#PikTag ऐप डाउनलोड करें',
    toastCopied: 'लिंक कॉपी किया गया',
    notFoundTitle: 'उपयोगकर्ता नहीं मिला',
    notFoundHeading: 'यह उपयोगकर्ता नहीं मिला',
    notFoundText: 'कृपया लिंक जांचें',
    notFoundBack: 'PikTag पर वापस जाएं',
    tagPageNotFoundTitle: 'टैग नहीं मिला',
    tagPageError: 'कुछ गड़बड़ हो गई',
    tagPageTitleSuffix: '#PikTag पर लोग',
    tagPageDescription: '{count} लोग #PikTag पर #{tag} का उपयोग करते हैं। #PikTag पर समान विचार वाले लोगों से मिलें।',
    tagPageCountUnit: 'लोग',
    tagPageDownloadApp: 'ऐप डाउनलोड करें',
    tagPageEmpty: 'अभी तक किसी ने यह टैग इस्तेमाल नहीं किया — पहले बनें!',
    tagPageBanner: 'उनसे मिलने के लिए #PikTag ऐप डाउनलोड करें',
    tagPageNotFoundHeading: 'यह टैग नहीं मिला',
    tagPageNotFoundText: 'कोई दूसरा टैग आज़माएं या और जानने के लिए ऐप डाउनलोड करें',
    tagPageNotFoundLink: '#PikTag ऐप डाउनलोड करें',
  },
  id: {
    htmlLang: 'id',
    shareAria: 'Bagikan',
    follow: 'Ikuti',
    bannerText: 'Unduh aplikasi #PikTag',
    toastCopied: 'Tautan disalin',
    notFoundTitle: 'Pengguna tidak ditemukan',
    notFoundHeading: 'Pengguna ini tidak ditemukan',
    notFoundText: 'Silakan periksa tautan',
    notFoundBack: 'Kembali ke PikTag',
    tagPageNotFoundTitle: 'Tag tidak ditemukan',
    tagPageError: 'Terjadi kesalahan',
    tagPageTitleSuffix: 'Orang-orang di #PikTag',
    tagPageDescription: '{count} orang menggunakan #{tag} di #PikTag. Temui orang-orang yang sepaham di #PikTag.',
    tagPageCountUnit: 'orang',
    tagPageDownloadApp: 'Unduh aplikasi',
    tagPageEmpty: 'Belum ada yang menggunakan tag ini — jadilah yang pertama!',
    tagPageBanner: 'Unduh aplikasi #PikTag untuk bertemu mereka',
    tagPageNotFoundHeading: 'Tag ini tidak ditemukan',
    tagPageNotFoundText: 'Coba tag lain atau unduh aplikasi untuk menjelajahi lebih banyak',
    tagPageNotFoundLink: 'Unduh aplikasi #PikTag',
  },
  th: {
    htmlLang: 'th',
    shareAria: 'แชร์',
    follow: 'ติดตาม',
    bannerText: 'ดาวน์โหลดแอป #PikTag',
    toastCopied: 'คัดลอกลิงก์แล้ว',
    notFoundTitle: 'ไม่พบผู้ใช้',
    notFoundHeading: 'ไม่พบผู้ใช้นี้',
    notFoundText: 'โปรดตรวจสอบลิงก์',
    notFoundBack: 'กลับไปที่ PikTag',
    tagPageNotFoundTitle: 'ไม่พบแท็ก',
    tagPageError: 'เกิดข้อผิดพลาด',
    tagPageTitleSuffix: 'ผู้คนบน #PikTag',
    tagPageDescription: '{count} คนใช้ #{tag} บน #PikTag พบปะผู้คนที่มีความสนใจเหมือนกันบน #PikTag',
    tagPageCountUnit: 'คน',
    tagPageDownloadApp: 'ดาวน์โหลดแอป',
    tagPageEmpty: 'ยังไม่มีใครใช้แท็กนี้ — มาเป็นคนแรกกันเถอะ!',
    tagPageBanner: 'ดาวน์โหลดแอป #PikTag เพื่อพบกับพวกเขา',
    tagPageNotFoundHeading: 'ไม่พบแท็กนี้',
    tagPageNotFoundText: 'ลองแท็กอื่นหรือดาวน์โหลดแอปเพื่อสำรวจเพิ่มเติม',
    tagPageNotFoundLink: 'ดาวน์โหลดแอป #PikTag',
  },
  tr: {
    htmlLang: 'tr',
    shareAria: 'Paylaş',
    follow: 'Takip et',
    bannerText: '#PikTag uygulamasını indir',
    toastCopied: 'Bağlantı kopyalandı',
    notFoundTitle: 'Kullanıcı bulunamadı',
    notFoundHeading: 'Bu kullanıcı bulunamadı',
    notFoundText: 'Lütfen bağlantıyı kontrol edin',
    notFoundBack: "PikTag'e dön",
    tagPageNotFoundTitle: 'Etiket bulunamadı',
    tagPageError: 'Bir şeyler ters gitti',
    tagPageTitleSuffix: "#PikTag'teki kişiler",
    tagPageDescription: "{count} kişi #PikTag'te #{tag} etiketini kullanıyor. #PikTag'te benzer ilgi alanlarına sahip kişilerle tanış.",
    tagPageCountUnit: 'kişi',
    tagPageDownloadApp: 'Uygulamayı indir',
    tagPageEmpty: 'Bu etiketi henüz kimse kullanmadı — ilk sen ol!',
    tagPageBanner: 'Onlarla tanışmak için #PikTag uygulamasını indir',
    tagPageNotFoundHeading: 'Bu etiket bulunamadı',
    tagPageNotFoundText: 'Başka bir etiket dene veya daha fazlasını keşfetmek için uygulamayı indir',
    tagPageNotFoundLink: '#PikTag uygulamasını indir',
  },
  bn: {
    htmlLang: 'bn',
    shareAria: 'শেয়ার',
    follow: 'ফলো',
    bannerText: '#PikTag অ্যাপ ডাউনলোড',
    toastCopied: 'লিঙ্ক কপি হয়েছে',
    notFoundTitle: 'ব্যবহারকারী পাওয়া যায়নি',
    notFoundHeading: 'এই ব্যবহারকারীকে পাওয়া যায়নি',
    notFoundText: 'লিঙ্কটি পরীক্ষা করুন',
    notFoundBack: 'PikTag এ ফিরে যান',
    tagPageNotFoundTitle: 'ট্যাগ পাওয়া যায়নি',
    tagPageError: 'কিছু একটা ভুল হয়েছে',
    tagPageTitleSuffix: '#PikTag এ মানুষজন',
    tagPageDescription: '{count} জন #PikTag এ #{tag} ব্যবহার করেন। #PikTag এ সমমনা মানুষদের সাথে পরিচিত হন।',
    tagPageCountUnit: 'জন',
    tagPageDownloadApp: 'অ্যাপ ডাউনলোড',
    tagPageEmpty: 'এখনও কেউ এই ট্যাগটি ব্যবহার করেননি — আপনিই প্রথম হোন!',
    tagPageBanner: 'তাদের সাথে পরিচিত হতে #PikTag অ্যাপ ডাউনলোড করুন',
    tagPageNotFoundHeading: 'এই ট্যাগটি পাওয়া যায়নি',
    tagPageNotFoundText: 'অন্য একটি ট্যাগ চেষ্টা করুন অথবা আরও জানতে অ্যাপ ডাউনলোড করুন',
    tagPageNotFoundLink: '#PikTag অ্যাপ ডাউনলোড করুন',
  },
  de: {
    htmlLang: 'de',
    shareAria: 'Teilen',
    follow: 'Folgen',
    bannerText: '#PikTag App herunterladen',
    toastCopied: 'Link kopiert',
    notFoundTitle: 'Benutzer nicht gefunden',
    notFoundHeading: 'Dieser Benutzer konnte nicht gefunden werden',
    notFoundText: 'Bitte überprüfen Sie den Link',
    notFoundBack: 'Zurück zu PikTag',
    tagPageNotFoundTitle: 'Tag nicht gefunden',
    tagPageError: 'Etwas ist schiefgelaufen',
    tagPageTitleSuffix: 'Leute auf #PikTag',
    tagPageDescription: '{count} Leute verwenden #{tag} auf #PikTag. Triff Gleichgesinnte auf #PikTag.',
    tagPageCountUnit: 'Leute',
    tagPageDownloadApp: 'App herunterladen',
    tagPageEmpty: 'Diesen Tag hat noch niemand verwendet – sei der Erste!',
    tagPageBanner: 'Lade die #PikTag App herunter, um sie kennenzulernen',
    tagPageNotFoundHeading: 'Dieser Tag wurde nicht gefunden',
    tagPageNotFoundText: 'Probiere einen anderen Tag oder lade die App herunter, um mehr zu entdecken',
    tagPageNotFoundLink: 'Die #PikTag App herunterladen',
  },
  it: {
    htmlLang: 'it',
    shareAria: 'Condividi',
    follow: 'Segui',
    bannerText: 'Scarica #PikTag App',
    toastCopied: 'Link copiato',
    notFoundTitle: 'Utente non trovato',
    notFoundHeading: 'Impossibile trovare questo utente',
    notFoundText: 'Per favore controlla il link',
    notFoundBack: 'Torna a PikTag',
    tagPageNotFoundTitle: 'Tag non trovato',
    tagPageError: 'Qualcosa è andato storto',
    tagPageTitleSuffix: 'Persone su #PikTag',
    tagPageDescription: '{count} persone usano #{tag} su #PikTag. Incontra persone con i tuoi stessi interessi su #PikTag.',
    tagPageCountUnit: 'persone',
    tagPageDownloadApp: "Scarica l'app",
    tagPageEmpty: 'Nessuno ha ancora usato questo tag — sii il primo!',
    tagPageBanner: "Scarica l'app #PikTag per incontrarle",
    tagPageNotFoundHeading: 'Questo tag non è stato trovato',
    tagPageNotFoundText: "Prova un altro tag o scarica l'app per esplorare di più",
    tagPageNotFoundLink: "Scarica l'app #PikTag",
  },
  vi: {
    htmlLang: 'vi',
    shareAria: 'Chia sẻ',
    follow: 'Theo dõi',
    bannerText: 'Tải ứng dụng #PikTag',
    toastCopied: 'Đã sao chép liên kết',
    notFoundTitle: 'Không tìm thấy người dùng',
    notFoundHeading: 'Không thể tìm thấy người dùng này',
    notFoundText: 'Vui lòng kiểm tra liên kết',
    notFoundBack: 'Quay lại PikTag',
    tagPageNotFoundTitle: 'Không tìm thấy thẻ',
    tagPageError: 'Đã xảy ra lỗi',
    tagPageTitleSuffix: 'Mọi người trên #PikTag',
    tagPageDescription: '{count} người dùng #{tag} trên #PikTag. Gặp gỡ những người cùng chí hướng trên #PikTag.',
    tagPageCountUnit: 'người',
    tagPageDownloadApp: 'Tải ứng dụng',
    tagPageEmpty: 'Chưa có ai dùng thẻ này — hãy là người đầu tiên!',
    tagPageBanner: 'Tải ứng dụng #PikTag để gặp gỡ họ',
    tagPageNotFoundHeading: 'Không tìm thấy thẻ này',
    tagPageNotFoundText: 'Thử một thẻ khác hoặc tải ứng dụng để khám phá thêm',
    tagPageNotFoundLink: 'Tải ứng dụng #PikTag',
  },
  ur: {
    htmlLang: 'ur',
    shareAria: 'شیئر کریں',
    follow: 'فالو کریں',
    bannerText: '#PikTag ایپ ڈاؤن لوڈ کریں',
    toastCopied: 'لنک کاپی ہو گیا',
    notFoundTitle: 'صارف نہیں ملا',
    notFoundHeading: 'یہ صارف نہیں مل سکا',
    notFoundText: 'براہ کرم لنک چیک کریں',
    notFoundBack: 'PikTag پر واپس جائیں',
    tagPageNotFoundTitle: 'ٹیگ نہیں ملا',
    tagPageError: 'کچھ غلط ہو گیا',
    tagPageTitleSuffix: '#PikTag پر لوگ',
    tagPageDescription: '{count} لوگ #PikTag پر #{tag} استعمال کرتے ہیں۔ #PikTag پر ہم خیال لوگوں سے ملیں۔',
    tagPageCountUnit: 'لوگ',
    tagPageDownloadApp: 'ایپ ڈاؤن لوڈ کریں',
    tagPageEmpty: 'ابھی تک کسی نے یہ ٹیگ استعمال نہیں کیا — پہلے بنیں!',
    tagPageBanner: 'ان سے ملنے کے لیے #PikTag ایپ ڈاؤن لوڈ کریں',
    tagPageNotFoundHeading: 'یہ ٹیگ نہیں ملا',
    tagPageNotFoundText: 'کوئی اور ٹیگ آزمائیں یا مزید دریافت کرنے کے لیے ایپ ڈاؤن لوڈ کریں',
    tagPageNotFoundLink: '#PikTag ایپ ڈاؤن لوڈ کریں',
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

// resolveLocale — like detectLocale, but lets an explicit ?lang=<code>
// query param win over the Accept-Language header. Used by the share/home
// fns so a shared link can pin its card language regardless of the
// crawler's Accept-Language. Precedence: ?lang (recognized) → detectLocale
// (Accept-Language → en). Returns the SAME translation-object shape as
// detectLocale (with .htmlLang). Normalization mirrors detectLocale
// exactly: case-insensitive, zh-tw/zh-hk→zh-TW, zh-cn/zh-sg→zh-CN,
// exact TRANSLATIONS-key match, base-language match, bare 'zh'→zh-TW.
// detectLocale itself is intentionally left untouched.
function resolveLocale(req) {
  try {
    const raw = req && req.query ? req.query.lang : undefined;
    const langParam = Array.isArray(raw) ? raw[0] : raw;
    if (langParam) {
      const code = String(langParam).trim().toLowerCase();
      if (code) {
        if (code === 'zh-tw' || code === 'zh-hk') return TRANSLATIONS['zh-TW'];
        if (code === 'zh-cn' || code === 'zh-sg') return TRANSLATIONS['zh-CN'];
        // Exact TRANSLATIONS-key match (case-insensitive). Keys are
        // lowercase ('en','ja') or 'zh-TW'/'zh-CN' — compare lowercased.
        for (const key of Object.keys(TRANSLATIONS)) {
          if (key.toLowerCase() === code) return TRANSLATIONS[key];
        }
        // Base language match (e.g. 'en-us' → 'en').
        const base = code.split('-')[0];
        if (TRANSLATIONS[base]) return TRANSLATIONS[base];
        if (base === 'zh') return TRANSLATIONS['zh-TW'];
      }
    }
  } catch { /* fall through to Accept-Language */ }
  return detectLocale(req);
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
  resolveLocale,
  trackShareLinkViewed,
  buildAnalyticsSnippet,
};
