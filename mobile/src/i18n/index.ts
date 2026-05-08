import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

// Eager-load only the two most common locales at boot:
//   * zh-TW — default fallback for this app
//   * en    — universal fallback for non-CJK users
// The other 13 locales are lazy-loaded via loadLocale() only when actually needed.
// This avoids parsing ~440KB of JSON at boot that most users will never see.
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';

const eagerResources = {
  'zh-TW': { translation: zhTW },
  en: { translation: en },
};

// All supported locale codes (must match filenames in ./locales/)
const SUPPORTED_LANGS: ReadonlyArray<string> = [
  'zh-TW', 'en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ar',
  'hi', 'bn', 'pt', 'ru', 'ko', 'id', 'th', 'tr',
];

// Map device language to one of our supported codes.
function getSupportedLanguage(lang: string): string {
  // Exact match
  if (SUPPORTED_LANGS.includes(lang)) return lang;

  // Match by language code (e.g. 'zh-Hant-TW' -> 'zh-TW', 'en-US' -> 'en')
  const langCode = lang.split('-')[0];

  if (langCode === 'zh') {
    if (lang.includes('Hant') || lang.includes('TW') || lang.includes('HK')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  if (SUPPORTED_LANGS.includes(langCode)) return langCode;

  return 'zh-TW'; // Final fallback
}

// Track which locales have been loaded (initially: the eager ones).
const loadedLocales = new Set<string>(['zh-TW', 'en']);

/**
 * Dynamically load a locale's JSON and register it with i18n.
 * No-op if the locale is already loaded or unknown.
 * The dynamic `import()` lets Metro defer JSON parse cost until first access.
 */
export async function loadLocale(lang: string): Promise<void> {
  if (loadedLocales.has(lang)) return;

  let translation: any;
  try {
    switch (lang) {
      case 'zh-CN': translation = (await import('./locales/zh-CN.json')).default; break;
      case 'ja':    translation = (await import('./locales/ja.json')).default; break;
      case 'es':    translation = (await import('./locales/es.json')).default; break;
      case 'fr':    translation = (await import('./locales/fr.json')).default; break;
      case 'de':    translation = (await import('./locales/de.json')).default; break;
      case 'ar':    translation = (await import('./locales/ar.json')).default; break;
      case 'hi':    translation = (await import('./locales/hi.json')).default; break;
      case 'bn':    translation = (await import('./locales/bn.json')).default; break;
      case 'pt':    translation = (await import('./locales/pt.json')).default; break;
      case 'ru':    translation = (await import('./locales/ru.json')).default; break;
      case 'ko':    translation = (await import('./locales/ko.json')).default; break;
      case 'id':    translation = (await import('./locales/id.json')).default; break;
      case 'th':    translation = (await import('./locales/th.json')).default; break;
      case 'tr':    translation = (await import('./locales/tr.json')).default; break;
      default:      return; // unknown — caller will fall back via i18n fallbackLng
    }
  } catch (err) {
    console.warn('[i18n] Failed to lazy-load locale', lang, err);
    return;
  }
  i18n.addResourceBundle(lang, 'translation', translation, true, true);
  loadedLocales.add(lang);
}

/**
 * Change the active language. Lazy-loads the locale bundle first if needed.
 * Use this instead of calling i18n.changeLanguage() directly so that
 * language switches for non-eager locales actually show translated text.
 */
export async function changeLanguageSafe(lang: string): Promise<void> {
  const supported = getSupportedLanguage(lang);
  if (!loadedLocales.has(supported)) {
    await loadLocale(supported);
  }
  await i18n.changeLanguage(supported);
}

// Detect device language synchronously via expo-localization.
const deviceLanguage = getLocales()?.[0]?.languageTag ?? 'zh-TW';
const initialLang = getSupportedLanguage(deviceLanguage);

i18n.use(initReactI18next).init({
  resources: eagerResources,
  lng: initialLang,
  fallbackLng: {
    'zh-CN': ['zh-TW', 'en'],
    default: ['en'],
  },
  interpolation: {
    escapeValue: false,
  },
  compatibilityJSON: 'v4',
});

// If the detected device language isn't already in the eager bundle,
// kick off an async load in the background. Until it resolves, i18n will
// fall back to 'zh-TW' (which is always available), giving users a brief
// period of zh-TW text rather than a crash or blank strings.
if (initialLang !== 'zh-TW' && initialLang !== 'en') {
  loadLocale(initialLang)
    .then(() => {
      // Re-trigger changeLanguage so React components consuming useTranslation
      // re-render with the now-available translations.
      i18n.changeLanguage(initialLang);
    })
    .catch((err) => {
      console.warn('[i18n] Initial locale load failed', initialLang, err);
    });
}

export default i18n;
