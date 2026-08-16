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
// SEO / discoverability primitives
// ─────────────────────────────────────────────────────────
// The one production origin. Never derive this from req.headers.host —
// that header is client-controlled and these values end up in canonical
// tags, JSON-LD @id values and the sitemap (see the cache-poisoning note
// in api/home.js).
const SITE_ORIGIN = 'https://pikt.ag';

// The username shape the public profile route accepts. Anything that
// fails this test 404s at /:username (see api/u/[username].js), so the
// sitemap MUST apply the identical test or it will list dead URLs —
// today 48 of the 112 non-test public profiles carry a legacy dotted
// handle ("karlcohen.71222") whose page is a hard 404.
// Exported so the route and the sitemap can never drift apart.
const VALID_USERNAME = /^[a-zA-Z0-9_]{2,30}$/;

// Handles that are obviously throwaway test accounts but are NOT flagged
// piktag_profiles.is_test_account = true. The DB flag is the real gate
// (see 20260705030000_test_accounts.sql); this is a belt-and-braces guard
// so a handle like "testuser12345" cannot end up in the sitemap or in an
// AI assistant's answer about who is on PikTag.
//
// PROPER FIX: flag these accounts from the admin backend
// (/users → toggle is_test_account) and delete this constant. Every name
// matched here is a data-hygiene bug, not a permanent rule.
const TEST_HANDLE_PATTERN = /^(test|demo|qa|fake|bot|dummy|sample|placeholder)/i;

// True when a profile row may be advertised to search engines and AI
// assistants. Single source of truth — used by the sitemap AND by the
// robots meta tag on the profile page itself, so the two can never
// disagree.
//
// Gates, and why each one is here:
//   is_public !== true   — the app sets is_public = false when a user
//                          DEACTIVATES their account (mobile
//                          SettingsScreen.tsx: "停用後你的個人頁將隱藏").
//                          A deactivated person must never be indexed.
//   is_test_account      — 83 of 195 rows are QA/seed accounts. Feeding
//                          fake people to Google poisons quality signals.
//   is_active === false  — reserved kill switch; today no row uses it,
//                          but if it is ever set it means "not a live
//                          account", which is not indexable.
//   VALID_USERNAME       — the profile URL would 404 (see above).
//   TEST_HANDLE_PATTERN  — unflagged obvious testers (see above).
// Deliberately NOT a gate: is_official. The @piktag account is a real,
// wanted page — it just gets Organization markup instead of Person.
function isIndexableProfile(p) {
  if (!p) return false;
  if (p.is_public !== true) return false;
  if (p.is_test_account === true) return false;
  if (p.is_active === false) return false;
  if (!p.username || !VALID_USERNAME.test(p.username)) return false;
  if (TEST_HANDLE_PATTERN.test(p.username)) return false;
  return true;
}

// Serialize a JSON-LD graph into a <script> body.
//
// JSON.stringify alone is NOT safe inside <script>: a "</script>" inside
// any user-supplied string (a bio, a tag name) would close the element
// early and turn the rest of the page into markup. Escaping "<" as the
// < JSON escape keeps the value byte-identical to a parser while
// making an early close impossible. Also drops U+2028/U+2029, which are
// legal in JSON but illegal raw in a JS string literal.
function jsonLd(graph) {
  return JSON.stringify(graph)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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
    askNotFoundTitle: 'Ask not found',
    askNotFoundHeading: 'We couldn\'t find this Ask',
    askNotFoundText: 'It may have been deleted. Check the link and try again.',
    askExpiredHeading: 'This Ask has ended',
    askExpiredText: 'Replies are no longer accepted for this Ask.',
    askFormNameLabel: 'Your name',
    askFormContactLabel: 'Email or phone (so they can reach you)',
    askFormMessageLabel: 'Your reply',
    askFormSubmit: 'Send reply',
    askFormNamePlaceholder: 'Your name',
    askFormContactPlaceholder: 'Email or phone number',
    askFormMessagePlaceholder: 'Write your reply...',
    askSuccessHeading: 'Thanks! Your reply was sent.',
    askSuccessText: 'Download PikTag so {name} can find you directly.',
    askErrorInvalid: 'Please check your name, contact, and message.',
    askErrorClosed: 'This Ask has just ended.',
    askErrorFull: 'This Ask has reached its reply limit.',
    askErrorGeneric: 'Something went wrong. Please try again.',
    askDownloadCta: 'Download PikTag',
    askAskedBy: 'asked',
    askPageTitleSuffix: 'Ask on #PikTag',
    askDemoTitle: 'React Native developer',
    askDemoBody: 'Looking for a React Native developer for a side project — who do you know?',
    askDemoTitle0: "React Native developer",
    askDemoBody0: "Looking for a React Native developer for a side project — who do you know?",
    askDemoTitle1: "Wedding photographer",
    askDemoBody1: "Getting married this fall — who's a wedding photographer worth recommending?",
    askDemoTitle2: "Technical co-founder",
    askDemoBody2: "Getting serious about my side project — looking for a technical co-founder. Who should I meet?",
    askDemoTitle3: "Personal trainer",
    askDemoBody3: "Trying to get back in shape — any personal trainers you'd recommend?",
    officialBio: "Tags are how people find you — job, skills, hobbies, MBTI, anything that's you. Tap your profile to add yours.",
    officialTagPhotography: 'Photography',
    officialTagCoffee: 'Coffee',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Foodie',
    officialTagOpenToCollab: 'OpenToCollab',
    officialTagCoffeeChat: 'CoffeeChat',
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
    askNotFoundTitle: '找不到這則 Ask',
    askNotFoundHeading: '找不到這則 Ask',
    askNotFoundText: '連結可能已失效，請確認後再試一次。',
    askExpiredHeading: '這則 Ask 已結束',
    askExpiredText: '這則 Ask 已不再接受回覆。',
    askFormNameLabel: '你的稱呼',
    askFormContactLabel: '聯絡方式（Email 或電話，讓對方找得到你）',
    askFormMessageLabel: '你想說的話',
    askFormSubmit: '送出回覆',
    askFormNamePlaceholder: '你的稱呼',
    askFormContactPlaceholder: 'Email 或電話號碼',
    askFormMessagePlaceholder: '寫下你的回覆…',
    askSuccessHeading: '謝謝！你的回覆已送出。',
    askSuccessText: '下載 PikTag，讓 {name} 能直接找到你。',
    askErrorInvalid: '請確認稱呼、聯絡方式與內容是否正確。',
    askErrorClosed: '這則 Ask 剛剛結束了。',
    askErrorFull: '這則 Ask 的回覆已額滿。',
    askErrorGeneric: '發生錯誤，請再試一次。',
    askDownloadCta: '下載 PikTag',
    askAskedBy: '提問',
    askPageTitleSuffix: '在 #PikTag 上的 Ask',
    askDemoTitle: '找 React Native 工程師',
    askDemoBody: '想找一位 React Native 工程師一起做 side project——你認識誰嗎？',
    askDemoTitle0: "React Native 工程師",
    askDemoBody0: "想找 React Native 工程師做個 side project，你認識誰嗎？",
    askDemoTitle1: "婚禮攝影師",
    askDemoBody1: "今年秋天要結婚了，有推薦的婚禮攝影師嗎？",
    askDemoTitle2: "技術共同創辦人",
    askDemoBody2: "想把 side project 認真做，在找技術共同創辦人，該認識誰？",
    askDemoTitle3: "健身教練",
    askDemoBody3: "想重新練回來，有推薦的健身教練嗎？",
    officialBio: '標籤是別人找到你的方式——職業、技能、興趣、MBTI，任何代表你的東西。點開你的檔案，加上你的標籤。',
    officialTagPhotography: '攝影',
    officialTagCoffee: '咖啡',
    officialTagPickleball: '匹克球',
    officialTagFoodie: '美食',
    officialTagOpenToCollab: '開放合作',
    officialTagCoffeeChat: '喝咖啡聊聊',
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
    askNotFoundTitle: '找不到这条 Ask',
    askNotFoundHeading: '找不到这条 Ask',
    askNotFoundText: '链接可能已失效，请确认后重试。',
    askExpiredHeading: '这条 Ask 已结束',
    askExpiredText: '这条 Ask 已不再接受回复。',
    askFormNameLabel: '你的称呼',
    askFormContactLabel: '联系方式（邮箱或电话，让对方找到你）',
    askFormMessageLabel: '你想说的话',
    askFormSubmit: '发送回复',
    askFormNamePlaceholder: '你的称呼',
    askFormContactPlaceholder: '邮箱或电话号码',
    askFormMessagePlaceholder: '写下你的回复…',
    askSuccessHeading: '谢谢！你的回复已发送。',
    askSuccessText: '下载 PikTag，让 {name} 能直接找到你。',
    askErrorInvalid: '请确认称呼、联系方式与内容是否正确。',
    askErrorClosed: '这条 Ask 刚刚结束了。',
    askErrorFull: '这条 Ask 的回复已达上限。',
    askErrorGeneric: '发生错误，请重试。',
    askDownloadCta: '下载 PikTag',
    askAskedBy: '提问',
    askPageTitleSuffix: '在 #PikTag 上的 Ask',
    askDemoTitle: '找 React Native 工程师',
    askDemoBody: '想找一位 React Native 工程师一起做 side project——你认识谁吗？',
    askDemoTitle0: "React Native 工程师",
    askDemoBody0: "想找 React Native 工程师做个 side project，你认识谁吗？",
    askDemoTitle1: "婚礼摄影师",
    askDemoBody1: "今年秋天要结婚了，有推荐的婚礼摄影师吗？",
    askDemoTitle2: "技术联合创始人",
    askDemoBody2: "想把 side project 认真做，在找技术联合创始人，该认识谁？",
    askDemoTitle3: "健身教练",
    askDemoBody3: "想重新练回来，有推荐的健身教练吗？",
    officialBio: '标签是别人找到你的方式——职业、技能、兴趣、MBTI，任何代表你的东西。点开你的档案，加上你的标签。',
    officialTagPhotography: '摄影',
    officialTagCoffee: '咖啡',
    officialTagPickleball: '匹克球',
    officialTagFoodie: '美食',
    officialTagOpenToCollab: '开放合作',
    officialTagCoffeeChat: '喝咖啡聊聊',
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
    askNotFoundTitle: 'このAskが見つかりません',
    askNotFoundHeading: 'このAskが見つかりません',
    askNotFoundText: 'リンクが無効かもしれません。確認してもう一度お試しください。',
    askExpiredHeading: 'このAskは終了しました',
    askExpiredText: 'このAskへの返信はもう受け付けていません。',
    askFormNameLabel: 'お名前',
    askFormContactLabel: '連絡先（メールまたは電話番号）',
    askFormMessageLabel: '返信内容',
    askFormSubmit: '返信を送る',
    askFormNamePlaceholder: 'お名前',
    askFormContactPlaceholder: 'メールまたは電話番号',
    askFormMessagePlaceholder: '返信を書く…',
    askSuccessHeading: 'ありがとうございます！返信を送信しました。',
    askSuccessText: 'PikTagをダウンロードして、{name}さんに直接見つけてもらいましょう。',
    askErrorInvalid: 'お名前・連絡先・内容をご確認ください。',
    askErrorClosed: 'このAskはたった今終了しました。',
    askErrorFull: 'このAskは返信数の上限に達しました。',
    askErrorGeneric: 'エラーが発生しました。もう一度お試しください。',
    askDownloadCta: 'PikTagをダウンロード',
    askAskedBy: '質問',
    askPageTitleSuffix: '#PikTagのAsk',
    askDemoTitle: 'React Nativeエンジニアを探しています',
    askDemoBody: 'サイドプロジェクトを手伝ってくれるReact Nativeエンジニアを探しています——誰か知り合いはいますか？',
    askDemoTitle0: "React Native エンジニア",
    askDemoBody0: "サイドプロジェクト向けに React Native エンジニアを探しています。どなたか知り合いはいませんか？",
    askDemoTitle1: "ウェディングフォトグラファー",
    askDemoBody1: "この秋に結婚します。おすすめのウェディングフォトグラファーはいますか？",
    askDemoTitle2: "技術系の共同創業者",
    askDemoBody2: "サイドプロジェクトを本気で進めたくて、技術系の共同創業者を探しています。誰に会うべきでしょう？",
    askDemoTitle3: "パーソナルトレーナー",
    askDemoBody3: "体を鍛え直したいのですが、おすすめのパーソナルトレーナーはいますか？",
    officialBio: "タグは、あなたが人に見つけてもらうための手がかりです——仕事、スキル、趣味、MBTIなど、あなたらしさを表すもの。プロフィールを開いて、自分のタグを追加しましょう。",
    officialTagPhotography: '写真',
    officialTagCoffee: 'コーヒー',
    officialTagPickleball: 'ピックルボール',
    officialTagFoodie: 'グルメ',
    officialTagOpenToCollab: 'コラボ募集',
    officialTagCoffeeChat: 'コーヒーチャット',
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
    askNotFoundTitle: '이 Ask를 찾을 수 없습니다',
    askNotFoundHeading: '이 Ask를 찾을 수 없습니다',
    askNotFoundText: '링크가 유효하지 않을 수 있습니다. 확인 후 다시 시도해 주세요.',
    askExpiredHeading: '이 Ask는 종료되었습니다',
    askExpiredText: '이 Ask는 더 이상 답변을 받지 않습니다.',
    askFormNameLabel: '이름',
    askFormContactLabel: '연락처 (이메일 또는 전화번호)',
    askFormMessageLabel: '답변 내용',
    askFormSubmit: '답변 보내기',
    askFormNamePlaceholder: '이름',
    askFormContactPlaceholder: '이메일 또는 전화번호',
    askFormMessagePlaceholder: '답변을 작성하세요…',
    askSuccessHeading: '감사합니다! 답변이 전송되었습니다.',
    askSuccessText: 'PikTag를 다운로드하면 {name}님이 직접 찾을 수 있어요.',
    askErrorInvalid: '이름, 연락처, 내용을 확인해 주세요.',
    askErrorClosed: '이 Ask는 방금 종료되었습니다.',
    askErrorFull: '이 Ask는 답변 한도에 도달했습니다.',
    askErrorGeneric: '문제가 발생했습니다. 다시 시도해 주세요.',
    askDownloadCta: 'PikTag 다운로드',
    askAskedBy: '질문',
    askPageTitleSuffix: '#PikTag의 Ask',
    askDemoTitle: 'React Native 개발자 찾기',
    askDemoBody: '사이드 프로젝트를 함께할 React Native 개발자를 찾고 있어요 — 아는 분 있나요?',
    askDemoTitle0: "React Native 개발자",
    askDemoBody0: "사이드 프로젝트를 함께할 React Native 개발자를 찾고 있어요. 아는 분 있나요?",
    askDemoTitle1: "웨딩 사진작가",
    askDemoBody1: "올가을에 결혼해요. 추천할 만한 웨딩 사진작가 있나요?",
    askDemoTitle2: "기술 공동창업자",
    askDemoBody2: "사이드 프로젝트를 제대로 해보려고 기술 공동창업자를 찾고 있어요. 누구를 만나면 좋을까요?",
    askDemoTitle3: "퍼스널 트레이너",
    askDemoBody3: "다시 몸을 만들고 싶은데, 추천할 만한 퍼스널 트레이너 있나요?",
    officialBio: '태그는 사람들이 당신을 찾는 방법이에요 — 직업, 스킬, 취미, MBTI 등 당신을 나타내는 무엇이든요. 프로필을 눌러 태그를 추가해 보세요.',
    officialTagPhotography: '사진',
    officialTagCoffee: '커피',
    officialTagPickleball: '피클볼',
    officialTagFoodie: '미식가',
    officialTagOpenToCollab: '협업 환영',
    officialTagCoffeeChat: '커피챗',
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
    askNotFoundTitle: 'No se encontró este Ask',
    askNotFoundHeading: 'No se encontró este Ask',
    askNotFoundText: 'El enlace puede haber caducado. Verifícalo e inténtalo de nuevo.',
    askExpiredHeading: 'Este Ask ha finalizado',
    askExpiredText: 'Ya no se aceptan respuestas para este Ask.',
    askFormNameLabel: 'Tu nombre',
    askFormContactLabel: 'Correo o teléfono (para que puedan contactarte)',
    askFormMessageLabel: 'Tu respuesta',
    askFormSubmit: 'Enviar respuesta',
    askFormNamePlaceholder: 'Tu nombre',
    askFormContactPlaceholder: 'Correo o número de teléfono',
    askFormMessagePlaceholder: 'Escribe tu respuesta...',
    askSuccessHeading: '¡Gracias! Tu respuesta fue enviada.',
    askSuccessText: 'Descarga PikTag para que {name} pueda encontrarte directamente.',
    askErrorInvalid: 'Verifica tu nombre, contacto y mensaje.',
    askErrorClosed: 'Este Ask acaba de finalizar.',
    askErrorFull: 'Este Ask alcanzó su límite de respuestas.',
    askErrorGeneric: 'Algo salió mal. Intenta de nuevo.',
    askDownloadCta: 'Descargar PikTag',
    askAskedBy: 'pregunta',
    askPageTitleSuffix: 'Ask en #PikTag',
    askDemoTitle: 'Desarrollador de React Native',
    askDemoBody: 'Busco un desarrollador de React Native para un proyecto paralelo — ¿conoces a alguien?',
    askDemoTitle0: "Desarrollador de React Native",
    askDemoBody0: "Busco un desarrollador de React Native para un proyecto paralelo. ¿A quién conoces?",
    askDemoTitle1: "Fotógrafo de bodas",
    askDemoBody1: "Me caso este otoño. ¿Conoces a algún fotógrafo de bodas que valga la pena?",
    askDemoTitle2: "Cofundador técnico",
    askDemoBody2: "Quiero llevar en serio mi proyecto paralelo y busco un cofundador técnico. ¿A quién debería conocer?",
    askDemoTitle3: "Entrenador personal",
    askDemoBody3: "Quiero volver a ponerme en forma. ¿Me recomiendas algún entrenador personal?",
    officialBio: "Las etiquetas son cómo la gente te encuentra — trabajo, habilidades, hobbies, MBTI, cualquier cosa que te represente. Toca tu perfil para agregar las tuyas.",
    officialTagPhotography: 'Fotografía',
    officialTagCoffee: 'Café',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Foodie',
    officialTagOpenToCollab: 'Abierto a colaborar',
    officialTagCoffeeChat: 'Café y charla',
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
    askNotFoundTitle: 'Cet Ask est introuvable',
    askNotFoundHeading: 'Cet Ask est introuvable',
    askNotFoundText: 'Le lien a peut-être expiré. Vérifiez-le et réessayez.',
    askExpiredHeading: 'Cet Ask est terminé',
    askExpiredText: 'Cet Ask n\'accepte plus de réponses.',
    askFormNameLabel: 'Votre nom',
    askFormContactLabel: 'Email ou téléphone (pour qu\'on puisse vous contacter)',
    askFormMessageLabel: 'Votre réponse',
    askFormSubmit: 'Envoyer la réponse',
    askFormNamePlaceholder: 'Votre nom',
    askFormContactPlaceholder: 'Email ou numéro de téléphone',
    askFormMessagePlaceholder: 'Écrivez votre réponse...',
    askSuccessHeading: 'Merci ! Votre réponse a été envoyée.',
    askSuccessText: 'Téléchargez PikTag pour que {name} puisse vous trouver directement.',
    askErrorInvalid: 'Vérifiez votre nom, contact et message.',
    askErrorClosed: 'Cet Ask vient de se terminer.',
    askErrorFull: 'Cet Ask a atteint sa limite de réponses.',
    askErrorGeneric: 'Une erreur s\'est produite. Réessayez.',
    askDownloadCta: 'Télécharger PikTag',
    askAskedBy: 'question',
    askPageTitleSuffix: 'Ask sur #PikTag',
    askDemoTitle: 'Développeur React Native',
    askDemoBody: "Je cherche un développeur React Native pour un projet perso — tu connais quelqu'un ?",
    askDemoTitle0: "Développeur React Native",
    askDemoBody0: "Je cherche un développeur React Native pour un projet perso. Tu connais quelqu'un ?",
    askDemoTitle1: "Photographe de mariage",
    askDemoBody1: "Je me marie cet automne. Tu connais un bon photographe de mariage à recommander ?",
    askDemoTitle2: "Cofondateur technique",
    askDemoBody2: "Je veux prendre mon projet perso au sérieux et je cherche un cofondateur technique. Qui devrais-je rencontrer ?",
    askDemoTitle3: "Coach sportif",
    askDemoBody3: "J'aimerais me remettre en forme. Tu aurais un coach sportif à recommander ?",
    officialBio: "Les tags, c'est ce qui permet aux autres de te trouver — métier, compétences, loisirs, MBTI, tout ce qui te définit. Touche ton profil pour ajouter les tiens.",
    officialTagPhotography: 'Photographie',
    officialTagCoffee: 'Café',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Gourmet',
    officialTagOpenToCollab: 'Ouvert aux collabs',
    officialTagCoffeeChat: 'Pause café',
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
    askNotFoundTitle: 'Este Ask não foi encontrado',
    askNotFoundHeading: 'Este Ask não foi encontrado',
    askNotFoundText: 'O link pode ter expirado. Verifique e tente novamente.',
    askExpiredHeading: 'Este Ask terminou',
    askExpiredText: 'Este Ask não aceita mais respostas.',
    askFormNameLabel: 'Seu nome',
    askFormContactLabel: 'Email ou telefone (para que possam te encontrar)',
    askFormMessageLabel: 'Sua resposta',
    askFormSubmit: 'Enviar resposta',
    askFormNamePlaceholder: 'Seu nome',
    askFormContactPlaceholder: 'Email ou número de telefone',
    askFormMessagePlaceholder: 'Escreva sua resposta...',
    askSuccessHeading: 'Obrigado! Sua resposta foi enviada.',
    askSuccessText: 'Baixe o PikTag para que {name} possa te encontrar diretamente.',
    askErrorInvalid: 'Verifique seu nome, contato e mensagem.',
    askErrorClosed: 'Este Ask acabou de terminar.',
    askErrorFull: 'Este Ask atingiu o limite de respostas.',
    askErrorGeneric: 'Algo deu errado. Tente novamente.',
    askDownloadCta: 'Baixar PikTag',
    askAskedBy: 'pergunta',
    askPageTitleSuffix: 'Ask no #PikTag',
    askDemoTitle: 'Desenvolvedor React Native',
    askDemoBody: 'Procuro um desenvolvedor React Native para um projeto paralelo — você conhece alguém?',
    askDemoTitle0: "Desenvolvedor React Native",
    askDemoBody0: "Procuro um desenvolvedor React Native para um projeto paralelo. Você conhece alguém?",
    askDemoTitle1: "Fotógrafo de casamento",
    askDemoBody1: "Vou me casar neste outono. Conhece algum fotógrafo de casamento que valha a pena?",
    askDemoTitle2: "Cofundador técnico",
    askDemoBody2: "Quero levar meu projeto paralelo a sério e procuro um cofundador técnico. Quem eu deveria conhecer?",
    askDemoTitle3: "Personal trainer",
    askDemoBody3: "Quero voltar à forma. Você recomenda algum personal trainer?",
    officialBio: "As tags são a forma como as pessoas te encontram — trabalho, habilidades, hobbies, MBTI, qualquer coisa que seja você. Toque no seu perfil para adicionar as suas.",
    officialTagPhotography: 'Fotografia',
    officialTagCoffee: 'Café',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Foodie',
    officialTagOpenToCollab: 'Aberto a colaborar',
    officialTagCoffeeChat: 'Bate-papo com café',
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
    askNotFoundTitle: 'Этот Ask не найден',
    askNotFoundHeading: 'Этот Ask не найден',
    askNotFoundText: 'Возможно, ссылка недействительна. Проверьте и попробуйте снова.',
    askExpiredHeading: 'Этот Ask завершён',
    askExpiredText: 'Этот Ask больше не принимает ответы.',
    askFormNameLabel: 'Ваше имя',
    askFormContactLabel: 'Email или телефон (чтобы с вами могли связаться)',
    askFormMessageLabel: 'Ваш ответ',
    askFormSubmit: 'Отправить ответ',
    askFormNamePlaceholder: 'Ваше имя',
    askFormContactPlaceholder: 'Email или номер телефона',
    askFormMessagePlaceholder: 'Напишите ваш ответ...',
    askSuccessHeading: 'Спасибо! Ваш ответ отправлен.',
    askSuccessText: 'Скачайте PikTag, чтобы {name} мог найти вас напрямую.',
    askErrorInvalid: 'Проверьте имя, контакт и сообщение.',
    askErrorClosed: 'Этот Ask только что завершился.',
    askErrorFull: 'Этот Ask достиг лимита ответов.',
    askErrorGeneric: 'Что-то пошло не так. Попробуйте снова.',
    askDownloadCta: 'Скачать PikTag',
    askAskedBy: 'вопрос',
    askPageTitleSuffix: 'Ask в #PikTag',
    askDemoTitle: 'Ищу React Native разработчика',
    askDemoBody: 'Ищу React Native разработчика для проекта на стороне — знаешь кого-нибудь?',
    askDemoTitle0: "Разработчик React Native",
    askDemoBody0: "Ищу разработчика React Native для сайд-проекта. Кого посоветуете?",
    askDemoTitle1: "Свадебный фотограф",
    askDemoBody1: "Этой осенью у меня свадьба. Посоветуете хорошего свадебного фотографа?",
    askDemoTitle2: "Технический сооснователь",
    askDemoBody2: "Хочу серьёзно взяться за свой сайд-проект и ищу технического сооснователя. С кем стоит познакомиться?",
    askDemoTitle3: "Персональный тренер",
    askDemoBody3: "Хочу снова прийти в форму. Посоветуете персонального тренера?",
    officialBio: "Теги — это то, как тебя находят другие: работа, навыки, увлечения, MBTI, всё, что тебя описывает. Открой свой профиль и добавь свои теги.",
    officialTagPhotography: 'Фотография',
    officialTagCoffee: 'Кофе',
    officialTagPickleball: 'Пиклбол',
    officialTagFoodie: 'Гурман',
    officialTagOpenToCollab: 'Открыт к сотрудничеству',
    officialTagCoffeeChat: 'Кофе и беседа',
  },
  ar: {
    htmlLang: 'ar',
    dir: 'rtl',
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
    askNotFoundTitle: 'لم يتم العثور على هذا الـ Ask',
    askNotFoundHeading: 'لم يتم العثور على هذا الـ Ask',
    askNotFoundText: 'قد يكون الرابط غير صالح. يرجى التحقق والمحاولة مرة أخرى.',
    askExpiredHeading: 'انتهى هذا الـ Ask',
    askExpiredText: 'لم يعد هذا الـ Ask يقبل الردود.',
    askFormNameLabel: 'اسمك',
    askFormContactLabel: 'البريد الإلكتروني أو الهاتف (ليتمكنوا من التواصل معك)',
    askFormMessageLabel: 'ردك',
    askFormSubmit: 'إرسال الرد',
    askFormNamePlaceholder: 'اسمك',
    askFormContactPlaceholder: 'البريد الإلكتروني أو رقم الهاتف',
    askFormMessagePlaceholder: 'اكتب ردك...',
    askSuccessHeading: 'شكرًا! تم إرسال ردك.',
    askSuccessText: 'نزّل PikTag ليتمكن {name} من العثور عليك مباشرة.',
    askErrorInvalid: 'يرجى التحقق من الاسم وبيانات الاتصال والرسالة.',
    askErrorClosed: 'انتهى هذا الـ Ask للتو.',
    askErrorFull: 'وصل هذا الـ Ask إلى الحد الأقصى للردود.',
    askErrorGeneric: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    askDownloadCta: 'تنزيل PikTag',
    askAskedBy: 'سؤال',
    askPageTitleSuffix: 'Ask على #PikTag',
    askDemoTitle: 'مطوّر React Native',
    askDemoBody: 'أبحث عن مطوّر React Native لمشروع جانبي — هل تعرف أحدًا؟',
    askDemoTitle0: "مطوّر React Native",
    askDemoBody0: "أبحث عن مطوّر React Native لمشروع جانبي. من تعرف؟",
    askDemoTitle1: "مصوّر أعراس",
    askDemoBody1: "سأتزوّج هذا الخريف. هل تعرف مصوّر أعراس تنصح به؟",
    askDemoTitle2: "شريك مؤسّس تقني",
    askDemoBody2: "أريد أن آخذ مشروعي الجانبي على محمل الجدّ وأبحث عن شريك مؤسّس تقني. بمن ينبغي أن ألتقي؟",
    askDemoTitle3: "مدرّب لياقة شخصي",
    askDemoBody3: "أريد أن أستعيد لياقتي. هل تنصح بمدرّب لياقة شخصي؟",
    officialBio: 'الوسوم هي الطريقة التي يجدك بها الآخرون — الوظيفة، المهارات، الهوايات، MBTI، أي شيء يمثّلك. اضغط على ملفك الشخصي لإضافة وسومك.',
    officialTagPhotography: 'التصوير',
    officialTagCoffee: 'قهوة',
    officialTagPickleball: 'بيكل بول',
    officialTagFoodie: 'عاشق الطعام',
    officialTagOpenToCollab: 'منفتح على التعاون',
    officialTagCoffeeChat: 'قهوة ودردشة',
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
    askNotFoundTitle: 'यह Ask नहीं मिला',
    askNotFoundHeading: 'यह Ask नहीं मिला',
    askNotFoundText: 'हो सकता है लिंक अमान्य हो। कृपया जांचें और फिर कोशिश करें।',
    askExpiredHeading: 'यह Ask समाप्त हो चुका है',
    askExpiredText: 'इस Ask के लिए अब जवाब स्वीकार नहीं किए जा रहे।',
    askFormNameLabel: 'आपका नाम',
    askFormContactLabel: 'ईमेल या फ़ोन (ताकि वे आपसे संपर्क कर सकें)',
    askFormMessageLabel: 'आपका जवाब',
    askFormSubmit: 'जवाब भेजें',
    askFormNamePlaceholder: 'आपका नाम',
    askFormContactPlaceholder: 'ईमेल या फ़ोन नंबर',
    askFormMessagePlaceholder: 'अपना जवाब लिखें…',
    askSuccessHeading: 'धन्यवाद! आपका जवाब भेज दिया गया है।',
    askSuccessText: 'PikTag डाउनलोड करें ताकि {name} सीधे आपको ढूंढ सके।',
    askErrorInvalid: 'कृपया अपना नाम, संपर्क और संदेश जांचें।',
    askErrorClosed: 'यह Ask अभी समाप्त हुआ है।',
    askErrorFull: 'इस Ask की जवाब सीमा पूरी हो गई है।',
    askErrorGeneric: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',
    askDownloadCta: 'PikTag डाउनलोड करें',
    askAskedBy: 'सवाल',
    askPageTitleSuffix: '#PikTag पर Ask',
    askDemoTitle: 'React Native डेवलपर की तलाश',
    askDemoBody: 'एक साइड प्रोजेक्ट के लिए React Native डेवलपर ढूंढ रहा हूँ — क्या आप किसी को जानते हैं?',
    askDemoTitle0: "React Native डेवलपर",
    askDemoBody0: "एक साइड प्रोजेक्ट के लिए React Native डेवलपर की तलाश है। आप किसे जानते हैं?",
    askDemoTitle1: "वेडिंग फोटोग्राफर",
    askDemoBody1: "इस साल मेरी शादी है। कोई अच्छा वेडिंग फोटोग्राफर बता सकते हैं?",
    askDemoTitle2: "टेक्निकल को-फाउंडर",
    askDemoBody2: "अपने साइड प्रोजेक्ट को गंभीरता से करना चाहता हूँ और एक टेक्निकल को-फाउंडर की तलाश है। मुझे किससे मिलना चाहिए?",
    askDemoTitle3: "पर्सनल ट्रेनर",
    askDemoBody3: "फिर से फिट होना चाहता हूँ। कोई अच्छा पर्सनल ट्रेनर बता सकते हैं?",
    officialBio: "टैग ही वह तरीका है जिससे लोग आपको ढूंढ पाते हैं — नौकरी, स्किल्स, शौक, MBTI, जो भी आप हैं। अपनी प्रोफ़ाइल खोलकर अपने टैग जोड़ें।",
    officialTagPhotography: 'फोटोग्राफी',
    officialTagCoffee: 'कॉफ़ी',
    officialTagPickleball: 'पिकलबॉल',
    officialTagFoodie: 'खाने का शौकीन',
    officialTagOpenToCollab: 'सहयोग के लिए तैयार',
    officialTagCoffeeChat: 'कॉफ़ी पर बातचीत',
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
    askNotFoundTitle: 'Ask ini tidak ditemukan',
    askNotFoundHeading: 'Ask ini tidak ditemukan',
    askNotFoundText: 'Tautan mungkin tidak valid. Periksa dan coba lagi.',
    askExpiredHeading: 'Ask ini telah berakhir',
    askExpiredText: 'Ask ini tidak lagi menerima balasan.',
    askFormNameLabel: 'Nama Anda',
    askFormContactLabel: 'Email atau telepon (agar mereka bisa menghubungi Anda)',
    askFormMessageLabel: 'Balasan Anda',
    askFormSubmit: 'Kirim balasan',
    askFormNamePlaceholder: 'Nama Anda',
    askFormContactPlaceholder: 'Email atau nomor telepon',
    askFormMessagePlaceholder: 'Tulis balasan Anda...',
    askSuccessHeading: 'Terima kasih! Balasan Anda telah terkirim.',
    askSuccessText: 'Unduh PikTag agar {name} bisa menemukan Anda langsung.',
    askErrorInvalid: 'Periksa nama, kontak, dan pesan Anda.',
    askErrorClosed: 'Ask ini baru saja berakhir.',
    askErrorFull: 'Ask ini telah mencapai batas balasan.',
    askErrorGeneric: 'Terjadi kesalahan. Coba lagi.',
    askDownloadCta: 'Unduh PikTag',
    askAskedBy: 'pertanyaan',
    askPageTitleSuffix: 'Ask di #PikTag',
    askDemoTitle: 'Developer React Native',
    askDemoBody: 'Sedang mencari developer React Native untuk proyek sampingan — ada yang kamu kenal?',
    askDemoTitle0: "Developer React Native",
    askDemoBody0: "Mencari developer React Native untuk proyek sampingan. Kamu kenal siapa?",
    askDemoTitle1: "Fotografer pernikahan",
    askDemoBody1: "Aku akan menikah akhir tahun ini. Ada fotografer pernikahan yang layak direkomendasikan?",
    askDemoTitle2: "Co-founder teknis",
    askDemoBody2: "Ingin menekuni proyek sampinganku dengan serius dan mencari co-founder teknis. Siapa yang sebaiknya kutemui?",
    askDemoTitle3: "Personal trainer",
    askDemoBody3: "Ingin kembali bugar. Ada personal trainer yang kamu rekomendasikan?",
    officialBio: "Tag adalah cara orang lain menemukanmu — pekerjaan, skill, hobi, MBTI, apa pun yang mencerminkan dirimu. Ketuk profilmu untuk menambahkan tag.",
    officialTagPhotography: 'Fotografi',
    officialTagCoffee: 'Kopi',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Pecinta kuliner',
    officialTagOpenToCollab: 'Terbuka untuk kolaborasi',
    officialTagCoffeeChat: 'Ngobrol sambil ngopi',
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
    askNotFoundTitle: 'ไม่พบ Ask นี้',
    askNotFoundHeading: 'ไม่พบ Ask นี้',
    askNotFoundText: 'ลิงก์อาจไม่ถูกต้อง โปรดตรวจสอบแล้วลองใหม่',
    askExpiredHeading: 'Ask นี้สิ้นสุดแล้ว',
    askExpiredText: 'Ask นี้ไม่รับคำตอบอีกต่อไป',
    askFormNameLabel: 'ชื่อของคุณ',
    askFormContactLabel: 'อีเมลหรือเบอร์โทร (เพื่อให้ติดต่อคุณได้)',
    askFormMessageLabel: 'คำตอบของคุณ',
    askFormSubmit: 'ส่งคำตอบ',
    askFormNamePlaceholder: 'ชื่อของคุณ',
    askFormContactPlaceholder: 'อีเมลหรือเบอร์โทรศัพท์',
    askFormMessagePlaceholder: 'เขียนคำตอบของคุณ...',
    askSuccessHeading: 'ขอบคุณ! ส่งคำตอบของคุณแล้ว',
    askSuccessText: 'ดาวน์โหลด PikTag เพื่อให้ {name} ติดต่อคุณได้โดยตรง',
    askErrorInvalid: 'โปรดตรวจสอบชื่อ ข้อมูลติดต่อ และข้อความของคุณ',
    askErrorClosed: 'Ask นี้เพิ่งสิ้นสุดลง',
    askErrorFull: 'Ask นี้มีคำตอบครบตามจำนวนแล้ว',
    askErrorGeneric: 'เกิดข้อผิดพลาด โปรดลองใหม่',
    askDownloadCta: 'ดาวน์โหลด PikTag',
    askAskedBy: 'คำถาม',
    askPageTitleSuffix: 'Ask บน #PikTag',
    askDemoTitle: 'หานักพัฒนา React Native',
    askDemoBody: 'กำลังหานักพัฒนา React Native มาช่วยทำโปรเจกต์เสริม — รู้จักใครไหม?',
    askDemoTitle0: "นักพัฒนา React Native",
    askDemoBody0: "กำลังหานักพัฒนา React Native มาช่วยทำโปรเจกต์เสริม รู้จักใครไหม?",
    askDemoTitle1: "ช่างภาพงานแต่ง",
    askDemoBody1: "ปลายปีนี้จะแต่งงาน มีช่างภาพงานแต่งที่น่าแนะนำไหม?",
    askDemoTitle2: "ผู้ร่วมก่อตั้งฝ่ายเทคนิค",
    askDemoBody2: "อยากทำโปรเจกต์เสริมอย่างจริงจัง เลยกำลังหาผู้ร่วมก่อตั้งฝ่ายเทคนิค ควรรู้จักใครดี?",
    askDemoTitle3: "เทรนเนอร์ส่วนตัว",
    askDemoBody3: "อยากกลับมาฟิตอีกครั้ง มีเทรนเนอร์ส่วนตัวที่แนะนำไหม?",
    officialBio: "แท็กคือวิธีที่คนอื่นจะเจอคุณ — งาน ทักษะ งานอดิเรก MBTI หรืออะไรก็ตามที่เป็นคุณ แตะโปรไฟล์ของคุณเพื่อเพิ่มแท็กของคุณเอง",
    officialTagPhotography: 'การถ่ายภาพ',
    officialTagCoffee: 'กาแฟ',
    officialTagPickleball: 'พิกเกิลบอล',
    officialTagFoodie: 'สายกิน',
    officialTagOpenToCollab: 'พร้อมร่วมงาน',
    officialTagCoffeeChat: 'จิบกาแฟคุยกัน',
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
    askNotFoundTitle: 'Bu Ask bulunamadı',
    askNotFoundHeading: 'Bu Ask bulunamadı',
    askNotFoundText: 'Bağlantı geçersiz olabilir. Kontrol edip tekrar deneyin.',
    askExpiredHeading: 'Bu Ask sona erdi',
    askExpiredText: 'Bu Ask artık yanıt kabul etmiyor.',
    askFormNameLabel: 'Adınız',
    askFormContactLabel: 'E-posta veya telefon (size ulaşabilmeleri için)',
    askFormMessageLabel: 'Yanıtınız',
    askFormSubmit: 'Yanıtı gönder',
    askFormNamePlaceholder: 'Adınız',
    askFormContactPlaceholder: 'E-posta veya telefon numarası',
    askFormMessagePlaceholder: 'Yanıtınızı yazın...',
    askSuccessHeading: 'Teşekkürler! Yanıtınız gönderildi.',
    askSuccessText: '{name} sizi doğrudan bulabilsin diye PikTag\'i indirin.',
    askErrorInvalid: 'Adınızı, iletişim bilginizi ve mesajınızı kontrol edin.',
    askErrorClosed: 'Bu Ask az önce sona erdi.',
    askErrorFull: 'Bu Ask yanıt sınırına ulaştı.',
    askErrorGeneric: 'Bir şeyler ters gitti. Tekrar deneyin.',
    askDownloadCta: 'PikTag\'i indir',
    askAskedBy: 'soru',
    askPageTitleSuffix: '#PikTag\'te Ask',
    askDemoTitle: 'React Native geliştirici arıyorum',
    askDemoBody: 'Yan proje için bir React Native geliştirici arıyorum — tanıdığın biri var mı?',
    askDemoTitle0: "React Native geliştirici",
    askDemoBody0: "Bir yan proje için React Native geliştirici arıyorum. Kimi tanıyorsun?",
    askDemoTitle1: "Düğün fotoğrafçısı",
    askDemoBody1: "Bu sonbahar evleniyorum. Önerebileceğin iyi bir düğün fotoğrafçısı var mı?",
    askDemoTitle2: "Teknik kurucu ortak",
    askDemoBody2: "Yan projemi ciddiye almak istiyorum ve teknik bir kurucu ortak arıyorum. Kiminle tanışmalıyım?",
    askDemoTitle3: "Kişisel antrenör",
    askDemoBody3: "Yeniden forma girmek istiyorum. Önereceğin bir kişisel antrenör var mı?",
    officialBio: "Etiketler, insanların seni bulma yoludur — iş, yetenekler, hobiler, MBTI, seni sen yapan her şey. Profiline dokunup kendi etiketlerini ekle.",
    officialTagPhotography: 'Fotoğrafçılık',
    officialTagCoffee: 'Kahve',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Yemek tutkunu',
    officialTagOpenToCollab: 'İşbirliğine açık',
    officialTagCoffeeChat: 'Kahve sohbeti',
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
    askNotFoundTitle: 'এই Ask পাওয়া যায়নি',
    askNotFoundHeading: 'এই Ask পাওয়া যায়নি',
    askNotFoundText: 'লিঙ্কটি হয়তো সঠিক নয়। পরীক্ষা করে আবার চেষ্টা করুন।',
    askExpiredHeading: 'এই Ask শেষ হয়ে গেছে',
    askExpiredText: 'এই Ask এ আর উত্তর গ্রহণ করা হচ্ছে না।',
    askFormNameLabel: 'আপনার নাম',
    askFormContactLabel: 'ইমেইল বা ফোন (যাতে তারা আপনার সাথে যোগাযোগ করতে পারে)',
    askFormMessageLabel: 'আপনার উত্তর',
    askFormSubmit: 'উত্তর পাঠান',
    askFormNamePlaceholder: 'আপনার নাম',
    askFormContactPlaceholder: 'ইমেইল বা ফোন নম্বর',
    askFormMessagePlaceholder: 'আপনার উত্তর লিখুন…',
    askSuccessHeading: 'ধন্যবাদ! আপনার উত্তর পাঠানো হয়েছে।',
    askSuccessText: 'PikTag ডাউনলোড করুন যাতে {name} সরাসরি আপনাকে খুঁজে পেতে পারে।',
    askErrorInvalid: 'আপনার নাম, যোগাযোগ ও বার্তা পরীক্ষা করুন।',
    askErrorClosed: 'এই Ask এইমাত্র শেষ হয়েছে।',
    askErrorFull: 'এই Ask এর উত্তর সীমা পূর্ণ হয়ে গেছে।',
    askErrorGeneric: 'কিছু ভুল হয়েছে। আবার চেষ্টা করুন।',
    askDownloadCta: 'PikTag ডাউনলোড করুন',
    askAskedBy: 'প্রশ্ন',
    askPageTitleSuffix: '#PikTag এ Ask',
    askDemoTitle: 'React Native ডেভেলপার খুঁজছি',
    askDemoBody: 'একটা সাইড প্রজেক্টের জন্য React Native ডেভেলপার খুঁজছি — আপনি কাউকে চেনেন?',
    askDemoTitle0: "React Native ডেভেলপার",
    askDemoBody0: "একটি সাইড প্রজেক্টের জন্য React Native ডেভেলপার খুঁজছি। আপনি কাকে চেনেন?",
    askDemoTitle1: "বিয়ের ফটোগ্রাফার",
    askDemoBody1: "এ বছরের শেষ দিকে আমার বিয়ে। ভালো কোনো বিয়ের ফটোগ্রাফার সুপারিশ করতে পারেন?",
    askDemoTitle2: "টেকনিক্যাল কো-ফাউন্ডার",
    askDemoBody2: "আমার সাইড প্রজেক্টটা সিরিয়াসভাবে করতে চাই, একজন টেকনিক্যাল কো-ফাউন্ডার খুঁজছি। কার সঙ্গে দেখা করা উচিত?",
    askDemoTitle3: "পার্সোনাল ট্রেইনার",
    askDemoBody3: "আবার ফিট হতে চাই। ভালো কোনো পার্সোনাল ট্রেইনার সুপারিশ করবেন?",
    officialBio: "ট্যাগ হলো মানুষ যেভাবে আপনাকে খুঁজে পায় — চাকরি, দক্ষতা, শখ, MBTI, আপনার যা কিছু। আপনার প্রোফাইলে ট্যাপ করে নিজের ট্যাগ যোগ করুন।",
    officialTagPhotography: 'ফটোগ্রাফি',
    officialTagCoffee: 'কফি',
    officialTagPickleball: 'পিকলবল',
    officialTagFoodie: 'ভোজনরসিক',
    officialTagOpenToCollab: 'সহযোগিতায় আগ্রহী',
    officialTagCoffeeChat: 'কফি আড্ডা',
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
    askNotFoundTitle: 'Dieser Ask wurde nicht gefunden',
    askNotFoundHeading: 'Dieser Ask wurde nicht gefunden',
    askNotFoundText: 'Der Link ist möglicherweise ungültig. Bitte prüfen und erneut versuchen.',
    askExpiredHeading: 'Dieser Ask ist beendet',
    askExpiredText: 'Dieser Ask nimmt keine Antworten mehr an.',
    askFormNameLabel: 'Ihr Name',
    askFormContactLabel: 'E-Mail oder Telefon (damit man Sie erreichen kann)',
    askFormMessageLabel: 'Ihre Antwort',
    askFormSubmit: 'Antwort senden',
    askFormNamePlaceholder: 'Ihr Name',
    askFormContactPlaceholder: 'E-Mail oder Telefonnummer',
    askFormMessagePlaceholder: 'Schreiben Sie Ihre Antwort...',
    askSuccessHeading: 'Danke! Ihre Antwort wurde gesendet.',
    askSuccessText: 'Laden Sie PikTag herunter, damit {name} Sie direkt finden kann.',
    askErrorInvalid: 'Bitte überprüfen Sie Name, Kontakt und Nachricht.',
    askErrorClosed: 'Dieser Ask ist gerade beendet.',
    askErrorFull: 'Dieser Ask hat sein Antwortlimit erreicht.',
    askErrorGeneric: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.',
    askDownloadCta: 'PikTag herunterladen',
    askAskedBy: 'Frage',
    askPageTitleSuffix: 'Ask auf #PikTag',
    askDemoTitle: 'React-Native-Entwickler gesucht',
    askDemoBody: 'Ich suche einen React-Native-Entwickler für ein Nebenprojekt — kennst du jemanden?',
    askDemoTitle0: "React-Native-Entwickler",
    askDemoBody0: "Ich suche einen React-Native-Entwickler für ein Nebenprojekt. Wen kennst du?",
    askDemoTitle1: "Hochzeitsfotograf",
    askDemoBody1: "Ich heirate diesen Herbst. Kennst du einen empfehlenswerten Hochzeitsfotografen?",
    askDemoTitle2: "Technischer Mitgründer",
    askDemoBody2: "Ich will mein Nebenprojekt ernsthaft angehen und suche einen technischen Mitgründer. Wen sollte ich kennenlernen?",
    askDemoTitle3: "Personal Trainer",
    askDemoBody3: "Ich will wieder in Form kommen. Kennst du einen guten Personal Trainer?",
    officialBio: "Tags sind der Weg, wie dich andere finden — Job, Fähigkeiten, Hobbys, MBTI, alles, was dich ausmacht. Tippe auf dein Profil, um deine eigenen hinzuzufügen.",
    officialTagPhotography: 'Fotografie',
    officialTagCoffee: 'Kaffee',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Foodie',
    officialTagOpenToCollab: 'Offen für Zusammenarbeit',
    officialTagCoffeeChat: 'Kaffee-Plausch',
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
    askNotFoundTitle: 'Questo Ask non è stato trovato',
    askNotFoundHeading: 'Questo Ask non è stato trovato',
    askNotFoundText: 'Il link potrebbe non essere valido. Verifica e riprova.',
    askExpiredHeading: 'Questo Ask è terminato',
    askExpiredText: 'Questo Ask non accetta più risposte.',
    askFormNameLabel: 'Il tuo nome',
    askFormContactLabel: 'Email o telefono (per poterti contattare)',
    askFormMessageLabel: 'La tua risposta',
    askFormSubmit: 'Invia risposta',
    askFormNamePlaceholder: 'Il tuo nome',
    askFormContactPlaceholder: 'Email o numero di telefono',
    askFormMessagePlaceholder: 'Scrivi la tua risposta...',
    askSuccessHeading: 'Grazie! La tua risposta è stata inviata.',
    askSuccessText: 'Scarica PikTag così {name} può trovarti direttamente.',
    askErrorInvalid: 'Controlla nome, contatto e messaggio.',
    askErrorClosed: 'Questo Ask è appena terminato.',
    askErrorFull: 'Questo Ask ha raggiunto il limite di risposte.',
    askErrorGeneric: 'Qualcosa è andato storto. Riprova.',
    askDownloadCta: 'Scarica PikTag',
    askAskedBy: 'domanda',
    askPageTitleSuffix: 'Ask su #PikTag',
    askDemoTitle: 'Sviluppatore React Native',
    askDemoBody: 'Cerco uno sviluppatore React Native per un progetto secondario — conosci qualcuno?',
    askDemoTitle0: "Sviluppatore React Native",
    askDemoBody0: "Cerco uno sviluppatore React Native per un progetto secondario. Chi conosci?",
    askDemoTitle1: "Fotografo di matrimoni",
    askDemoBody1: "Mi sposo questo autunno. Conosci un bravo fotografo di matrimoni da consigliare?",
    askDemoTitle2: "Cofondatore tecnico",
    askDemoBody2: "Voglio dedicarmi sul serio al mio progetto secondario e cerco un cofondatore tecnico. Chi dovrei conoscere?",
    askDemoTitle3: "Personal trainer",
    askDemoBody3: "Voglio rimettermi in forma. Mi consigli un personal trainer?",
    officialBio: "I tag sono il modo in cui gli altri ti trovano — lavoro, competenze, hobby, MBTI, tutto ciò che ti rappresenta. Tocca il tuo profilo per aggiungere i tuoi.",
    officialTagPhotography: 'Fotografia',
    officialTagCoffee: 'Caffè',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Buongustaio',
    officialTagOpenToCollab: 'Aperto a collaborare',
    officialTagCoffeeChat: 'Chiacchiere al caffè',
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
    askNotFoundTitle: 'Không tìm thấy Ask này',
    askNotFoundHeading: 'Không tìm thấy Ask này',
    askNotFoundText: 'Liên kết có thể không hợp lệ. Vui lòng kiểm tra và thử lại.',
    askExpiredHeading: 'Ask này đã kết thúc',
    askExpiredText: 'Ask này không còn nhận câu trả lời nữa.',
    askFormNameLabel: 'Tên của bạn',
    askFormContactLabel: 'Email hoặc số điện thoại (để họ liên hệ với bạn)',
    askFormMessageLabel: 'Câu trả lời của bạn',
    askFormSubmit: 'Gửi câu trả lời',
    askFormNamePlaceholder: 'Tên của bạn',
    askFormContactPlaceholder: 'Email hoặc số điện thoại',
    askFormMessagePlaceholder: 'Viết câu trả lời của bạn...',
    askSuccessHeading: 'Cảm ơn! Câu trả lời của bạn đã được gửi.',
    askSuccessText: 'Tải PikTag để {name} có thể tìm thấy bạn trực tiếp.',
    askErrorInvalid: 'Vui lòng kiểm tra tên, liên hệ và nội dung.',
    askErrorClosed: 'Ask này vừa kết thúc.',
    askErrorFull: 'Ask này đã đạt giới hạn câu trả lời.',
    askErrorGeneric: 'Đã xảy ra lỗi. Vui lòng thử lại.',
    askDownloadCta: 'Tải PikTag',
    askAskedBy: 'câu hỏi',
    askPageTitleSuffix: 'Ask trên #PikTag',
    askDemoTitle: 'Tìm lập trình viên React Native',
    askDemoBody: 'Đang tìm một lập trình viên React Native để làm dự án tay trái — bạn có quen ai không?',
    askDemoTitle0: "Lập trình viên React Native",
    askDemoBody0: "Đang tìm một lập trình viên React Native cho dự án phụ. Bạn quen ai không?",
    askDemoTitle1: "Thợ chụp ảnh cưới",
    askDemoBody1: "Cuối năm nay mình cưới. Bạn có thợ chụp ảnh cưới nào đáng giới thiệu không?",
    askDemoTitle2: "Đồng sáng lập kỹ thuật",
    askDemoBody2: "Mình muốn làm dự án phụ một cách nghiêm túc và đang tìm một đồng sáng lập kỹ thuật. Nên gặp ai nhỉ?",
    askDemoTitle3: "Huấn luyện viên cá nhân",
    askDemoBody3: "Mình muốn lấy lại vóc dáng. Bạn có huấn luyện viên cá nhân nào để giới thiệu không?",
    officialBio: "Tag là cách người khác tìm thấy bạn — công việc, kỹ năng, sở thích, MBTI, bất cứ điều gì thuộc về bạn. Nhấn vào hồ sơ của bạn để thêm tag nhé.",
    officialTagPhotography: 'Nhiếp ảnh',
    officialTagCoffee: 'Cà phê',
    officialTagPickleball: 'Pickleball',
    officialTagFoodie: 'Tín đồ ẩm thực',
    officialTagOpenToCollab: 'Sẵn sàng hợp tác',
    officialTagCoffeeChat: 'Cà phê tán gẫu',
  },
  ur: {
    htmlLang: 'ur',
    dir: 'rtl',
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
    askNotFoundTitle: 'یہ Ask نہیں ملا',
    askNotFoundHeading: 'یہ Ask نہیں ملا',
    askNotFoundText: 'ہو سکتا ہے لنک غلط ہو۔ براہ کرم چیک کریں اور دوبارہ کوشش کریں۔',
    askExpiredHeading: 'یہ Ask ختم ہو چکا ہے',
    askExpiredText: 'اس Ask کے لیے اب جوابات قبول نہیں کیے جا رہے۔',
    askFormNameLabel: 'آپ کا نام',
    askFormContactLabel: 'ای میل یا فون (تاکہ وہ آپ سے رابطہ کر سکیں)',
    askFormMessageLabel: 'آپ کا جواب',
    askFormSubmit: 'جواب بھیجیں',
    askFormNamePlaceholder: 'آپ کا نام',
    askFormContactPlaceholder: 'ای میل یا فون نمبر',
    askFormMessagePlaceholder: 'اپنا جواب لکھیں…',
    askSuccessHeading: 'شکریہ! آپ کا جواب بھیج دیا گیا ہے۔',
    askSuccessText: 'PikTag ڈاؤن لوڈ کریں تاکہ {name} براہ راست آپ کو تلاش کر سکے۔',
    askErrorInvalid: 'براہ کرم اپنا نام، رابطہ اور پیغام چیک کریں۔',
    askErrorClosed: 'یہ Ask ابھی ختم ہوا ہے۔',
    askErrorFull: 'یہ Ask جوابات کی حد تک پہنچ گیا ہے۔',
    askErrorGeneric: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔',
    askDownloadCta: 'PikTag ڈاؤن لوڈ کریں',
    askAskedBy: 'سوال',
    askPageTitleSuffix: '#PikTag پر Ask',
    askDemoTitle: 'React Native ڈویلپر کی تلاش',
    askDemoBody: 'ایک سائیڈ پراجیکٹ کے لیے React Native ڈویلپر ڈھونڈ رہا ہوں — کیا آپ کسی کو جانتے ہیں؟',
    askDemoTitle0: "React Native ڈویلپر",
    askDemoBody0: "ایک سائیڈ پراجیکٹ کے لیے React Native ڈویلپر کی تلاش ہے۔ آپ کسے جانتے ہیں؟",
    askDemoTitle1: "ویڈنگ فوٹوگرافر",
    askDemoBody1: "اس سال میری شادی ہے۔ کوئی اچھا ویڈنگ فوٹوگرافر تجویز کر سکتے ہیں؟",
    askDemoTitle2: "ٹیکنیکل کو-فاؤنڈر",
    askDemoBody2: "اپنے سائیڈ پراجیکٹ کو سنجیدگی سے کرنا چاہتا ہوں اور ایک ٹیکنیکل کو-فاؤنڈر کی تلاش ہے۔ مجھے کس سے ملنا چاہیے؟",
    askDemoTitle3: "پرسنل ٹرینر",
    askDemoBody3: "دوبارہ فٹ ہونا چاہتا ہوں۔ کوئی اچھا پرسنل ٹرینر تجویز کریں گے؟",
    officialBio: "ٹیگز وہ طریقہ ہیں جن سے لوگ آپ کو ڈھونڈتے ہیں — نوکری، ہنر، شوق، MBTI، جو کچھ بھی آپ ہیں۔ اپنی پروفائل کھول کر اپنے ٹیگز شامل کریں۔",
    officialTagPhotography: 'فوٹوگرافی',
    officialTagCoffee: 'کافی',
    officialTagPickleball: 'پکل بال',
    officialTagFoodie: 'کھانے کا شوقین',
    officialTagOpenToCollab: 'تعاون کے لیے تیار',
    officialTagCoffeeChat: 'کافی پر گپ شپ',
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
  SITE_ORIGIN,
  VALID_USERNAME,
  TEST_HANDLE_PATTERN,
  isIndexableProfile,
  jsonLd,
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
