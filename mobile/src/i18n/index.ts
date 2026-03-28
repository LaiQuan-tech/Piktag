import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import bn from './locales/bn.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import ko from './locales/ko.json';
import id from './locales/id.json';
import th from './locales/th.json';
import tr from './locales/tr.json';

const resources = {
  'zh-TW': { translation: zhTW },
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  ja: { translation: ja },
  es: { translation: es },
  fr: { translation: fr },
  ar: { translation: ar },
  hi: { translation: hi },
  bn: { translation: bn },
  pt: { translation: pt },
  ru: { translation: ru },
  ko: { translation: ko },
  id: { translation: id },
  th: { translation: th },
  tr: { translation: tr },
};

// Detect user's preferred language from device
const deviceLanguage = getLocales()?.[0]?.languageTag ?? 'zh-TW';

// Map device language to supported language
function getSupportedLanguage(lang: string): string {
  // Exact match
  if (resources[lang as keyof typeof resources]) return lang;

  // Match by language code (e.g., 'zh-Hant-TW' -> 'zh-TW', 'en-US' -> 'en')
  const langCode = lang.split('-')[0];

  if (langCode === 'zh') {
    // Handle Chinese variants
    if (lang.includes('Hant') || lang.includes('TW') || lang.includes('HK')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  if (resources[langCode as keyof typeof resources]) return langCode;

  return 'zh-TW'; // Default fallback
}

i18n.use(initReactI18next).init({
  resources,
  lng: getSupportedLanguage(deviceLanguage),
  fallbackLng: 'zh-TW',
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

export default i18n;
