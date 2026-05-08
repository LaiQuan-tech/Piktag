import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhCN from './locales/zh-CN.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import pt from './locales/pt.json';
import ar from './locales/ar.json';
import bn from './locales/bn.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import ru from './locales/ru.json';
import th from './locales/th.json';
import tr from './locales/tr.json';

// Ordered by total speakers (L1 + L2, Ethnologue 2023) descending so
// the most users find their language at or near the top of the
// switcher. The previous order was Taiwan-first by founder bias —
// flipped here because the goal is "let most people find their
// language fast", not "showcase the founder's locale". Locale
// detection (browser/system) still pre-selects the user's language
// regardless of list order; this ordering only matters for the
// dropdown UX.
export const languages = [
  { code: 'en', label: 'English' },                  // ~1.5B
  { code: 'zh-CN', label: '简体中文' },               // ~1.1B
  { code: 'hi', label: 'हिन्दी' },                    // ~602M
  { code: 'es', label: 'Español' },                  // ~548M
  { code: 'fr', label: 'Français' },                 // ~274M
  { code: 'ar', label: 'العربية' },                  // ~274M
  { code: 'bn', label: 'বাংলা' },                    // ~272M
  { code: 'ru', label: 'Русский' },                  // ~258M
  { code: 'pt', label: 'Português' },                // ~257M
  { code: 'id', label: 'Bahasa Indonesia' },         // ~199M
  { code: 'de', label: 'Deutsch' },                  // ~135M
  { code: 'ja', label: '日本語' },                    // ~125M
  { code: 'tr', label: 'Türkçe' },                   // ~88M
  { code: 'ko', label: '한국어' },                    // ~81M
  { code: 'th', label: 'ไทย' },                      // ~70M
  { code: 'zh-TW', label: '繁體中文' },               // ~30M
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-TW': { translation: zhTW },
      en: { translation: en },
      ja: { translation: ja },
      ko: { translation: ko },
      'zh-CN': { translation: zhCN },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      pt: { translation: pt },
      ar: { translation: ar },
      bn: { translation: bn },
      hi: { translation: hi },
      id: { translation: id },
      ru: { translation: ru },
      th: { translation: th },
      tr: { translation: tr },
    },
    fallbackLng: 'zh-TW',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
