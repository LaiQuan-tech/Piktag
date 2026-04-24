import { getLocales } from 'expo-localization';

export type Country = {
  iso: string;     // ISO 3166-1 alpha-2 (uppercase)
  dial: string;    // Full dial code including leading "+", e.g. "+886"
  flag: string;    // Emoji flag — rendered natively on iOS + Android
  nameKey: string; // i18n key under `country.<ISO>` that resolves to localised name
};

// Curated list — targeting the platform's likely audience (Chinese-speaking
// users + major English/Japanese/Korean/Southeast Asian markets + the top
// Western/LatAm/MENA markets). Order is deliberate:
//   1. Primary Chinese-speaking regions first (TW/CN/HK/MO) — app is
//      Taiwan-first, and this puts the most likely defaults at the top of
//      the picker list for users browsing without search.
//   2. Then major English + East Asian + SEA markets.
//   3. Then rest of the world, grouped roughly by region.
// If a country's dial code is missing here, `splitTelUrl` will return
// `country: null` for stored numbers using it, which the caller falls
// back to the device default for — so missing countries are graceful.
export const COUNTRIES: Country[] = [
  // Greater China
  { iso: 'TW', dial: '+886', flag: '🇹🇼', nameKey: 'country.TW' },
  { iso: 'CN', dial: '+86',  flag: '🇨🇳', nameKey: 'country.CN' },
  { iso: 'HK', dial: '+852', flag: '🇭🇰', nameKey: 'country.HK' },
  { iso: 'MO', dial: '+853', flag: '🇲🇴', nameKey: 'country.MO' },

  // North America
  { iso: 'US', dial: '+1',   flag: '🇺🇸', nameKey: 'country.US' },
  { iso: 'CA', dial: '+1',   flag: '🇨🇦', nameKey: 'country.CA' },

  // East Asia
  { iso: 'JP', dial: '+81',  flag: '🇯🇵', nameKey: 'country.JP' },
  { iso: 'KR', dial: '+82',  flag: '🇰🇷', nameKey: 'country.KR' },

  // Southeast Asia
  { iso: 'SG', dial: '+65',  flag: '🇸🇬', nameKey: 'country.SG' },
  { iso: 'MY', dial: '+60',  flag: '🇲🇾', nameKey: 'country.MY' },
  { iso: 'TH', dial: '+66',  flag: '🇹🇭', nameKey: 'country.TH' },
  { iso: 'VN', dial: '+84',  flag: '🇻🇳', nameKey: 'country.VN' },
  { iso: 'ID', dial: '+62',  flag: '🇮🇩', nameKey: 'country.ID' },
  { iso: 'PH', dial: '+63',  flag: '🇵🇭', nameKey: 'country.PH' },

  // South Asia
  { iso: 'IN', dial: '+91',  flag: '🇮🇳', nameKey: 'country.IN' },
  { iso: 'BD', dial: '+880', flag: '🇧🇩', nameKey: 'country.BD' },
  { iso: 'PK', dial: '+92',  flag: '🇵🇰', nameKey: 'country.PK' },

  // Oceania
  { iso: 'AU', dial: '+61',  flag: '🇦🇺', nameKey: 'country.AU' },
  { iso: 'NZ', dial: '+64',  flag: '🇳🇿', nameKey: 'country.NZ' },

  // Europe
  { iso: 'GB', dial: '+44',  flag: '🇬🇧', nameKey: 'country.GB' },
  { iso: 'DE', dial: '+49',  flag: '🇩🇪', nameKey: 'country.DE' },
  { iso: 'FR', dial: '+33',  flag: '🇫🇷', nameKey: 'country.FR' },
  { iso: 'ES', dial: '+34',  flag: '🇪🇸', nameKey: 'country.ES' },
  { iso: 'IT', dial: '+39',  flag: '🇮🇹', nameKey: 'country.IT' },
  { iso: 'NL', dial: '+31',  flag: '🇳🇱', nameKey: 'country.NL' },
  { iso: 'CH', dial: '+41',  flag: '🇨🇭', nameKey: 'country.CH' },
  { iso: 'SE', dial: '+46',  flag: '🇸🇪', nameKey: 'country.SE' },
  { iso: 'NO', dial: '+47',  flag: '🇳🇴', nameKey: 'country.NO' },
  { iso: 'DK', dial: '+45',  flag: '🇩🇰', nameKey: 'country.DK' },
  { iso: 'FI', dial: '+358', flag: '🇫🇮', nameKey: 'country.FI' },
  { iso: 'IE', dial: '+353', flag: '🇮🇪', nameKey: 'country.IE' },
  { iso: 'PL', dial: '+48',  flag: '🇵🇱', nameKey: 'country.PL' },
  { iso: 'PT', dial: '+351', flag: '🇵🇹', nameKey: 'country.PT' },
  { iso: 'RU', dial: '+7',   flag: '🇷🇺', nameKey: 'country.RU' },
  { iso: 'TR', dial: '+90',  flag: '🇹🇷', nameKey: 'country.TR' },

  // Middle East
  { iso: 'AE', dial: '+971', flag: '🇦🇪', nameKey: 'country.AE' },
  { iso: 'SA', dial: '+966', flag: '🇸🇦', nameKey: 'country.SA' },
  { iso: 'IL', dial: '+972', flag: '🇮🇱', nameKey: 'country.IL' },

  // Latin America
  { iso: 'BR', dial: '+55',  flag: '🇧🇷', nameKey: 'country.BR' },
  { iso: 'MX', dial: '+52',  flag: '🇲🇽', nameKey: 'country.MX' },
  { iso: 'AR', dial: '+54',  flag: '🇦🇷', nameKey: 'country.AR' },
  { iso: 'CL', dial: '+56',  flag: '🇨🇱', nameKey: 'country.CL' },
  { iso: 'CO', dial: '+57',  flag: '🇨🇴', nameKey: 'country.CO' },

  // Africa
  { iso: 'ZA', dial: '+27',  flag: '🇿🇦', nameKey: 'country.ZA' },
  { iso: 'EG', dial: '+20',  flag: '🇪🇬', nameKey: 'country.EG' },
  { iso: 'NG', dial: '+234', flag: '🇳🇬', nameKey: 'country.NG' },
];

// Countries that use a domestic trunk prefix (a leading 0 when dialling
// locally that must be stripped for international dialling). When a
// number like "0916581787" is entered and one of these ISOs is picked,
// the leading zero is dropped so the final E.164 string is correct.
// Sources: ITU-T E.164 conventions and publicly published national
// numbering plans.
const TRUNK_PREFIX_ISOS = new Set([
  'TW', 'HK', 'GB', 'JP', 'KR', 'AU', 'NZ',
  'DE', 'FR', 'IT', 'NL', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'PL', 'PT', 'TR',
  'VN', 'TH', 'ID', 'MY', 'PH', 'BD', 'PK',
  'BR', 'AR', 'CL', 'CO',
  'ZA', 'EG', 'NG',
]);
// Intentionally NOT included (dialled as-is, no trunk-0 stripping):
//   - US / CA (NANP — no national trunk prefix)
//   - CN (mobile numbers are typically stored without leading 0)
//   - MO (8-digit numbers, no trunk)
//   - SG (8-digit, no trunk)
//   - RU (leading 8 is trunk but users usually type +7 directly)
//   - IL, AE, SA, MX, IN — keeping the digits the user typed is safer;
//     we'd rather preserve the number than silently drop a significant
//     leading zero.

// Map i18n language tag → ISO country code for the fallback default. Only
// for when `expo-localization`'s regionCode is unavailable. Covers every
// `SUPPORTED_LANGS` entry in src/i18n/index.ts.
const LANG_TO_ISO: Record<string, string> = {
  'zh-TW': 'TW',
  'zh-HK': 'HK',
  'zh-CN': 'CN',
  'ja': 'JP',
  'ko': 'KR',
  'th': 'TH',
  'id': 'ID',
  'hi': 'IN',
  'bn': 'BD',
  'ar': 'AE',
  'pt': 'BR',
  'es': 'MX',
  'fr': 'FR',
  'ru': 'RU',
  'tr': 'TR',
  'en': 'US',
};

/**
 * Split a `tel:` URL (or a bare value) back into its country + national
 * parts for pre-filling the picker + input on edit.
 *
 * - `tel:+886916581787`  → { country: TW, national: "916581787" }
 * - `tel:+15551234567`   → { country: US, national: "5551234567" }
 * - `tel:0916581787`     → { country: null, national: "0916581787" }  (legacy)
 * - ""                   → { country: null, national: "" }
 *
 * If the stored E.164 dial code doesn't appear in `COUNTRIES`, country is
 * returned null and the raw digits (with '+') are left as national so
 * callers can still display the number without losing data.
 */
export function splitTelUrl(raw: string | null | undefined): {
  country: Country | null;
  national: string;
} {
  if (!raw) return { country: null, national: '' };
  // Strip `tel:` scheme + any separators the user may have typed (spaces,
  // dashes, parens). Keep digits and the leading `+`.
  const stripped = raw.replace(/^tel:/i, '').replace(/[^\d+]/g, '');
  if (stripped.startsWith('+')) {
    // Match longest dial code first so "+1" doesn't accidentally win
    // over a hypothetical "+1787" NANP sub-region in the future.
    const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
      if (stripped.startsWith(c.dial)) {
        return { country: c, national: stripped.slice(c.dial.length) };
      }
    }
    // Unknown dial code → keep the raw "+..." so the user still sees
    // what's on file and can decide whether to rewrite it.
    return { country: null, national: stripped };
  }
  // Legacy bare number — don't guess a country (the device default is
  // applied by the caller). Preserve the original digits including any
  // leading 0 so users recognise the value they originally typed.
  return { country: null, national: stripped };
}

/**
 * Build an E.164-style `tel:` URL from a country + a national number
 * entered by the user. Non-digits are stripped; a leading `0` trunk
 * prefix is removed for countries that use one.
 *
 * `buildTelUrl(TW, "0916 581 787")` → `"tel:+886916581787"`
 * `buildTelUrl(US, "555-123-4567")` → `"tel:+15551234567"`
 * `buildTelUrl(TW, "")`             → `""` (empty — caller validates)
 */
export function buildTelUrl(country: Country, nationalRaw: string): string {
  let n = (nationalRaw ?? '').replace(/\D/g, '');
  if (!n) return '';
  if (TRUNK_PREFIX_ISOS.has(country.iso)) {
    n = n.replace(/^0+/, '');
  }
  if (!n) return '';
  return `tel:${country.dial}${n}`;
}

/**
 * Decide which country to preselect when the phone input opens. Order:
 *   1. Device regionCode from `expo-localization` (most accurate — this
 *      reflects the user's actual phone settings, not just UI language).
 *   2. Fallback: i18n current language tag → ISO via `LANG_TO_ISO`.
 *   3. Final fallback: Taiwan (app's primary market).
 *
 * The try/catch around `getLocales()` is defensive — the module works on
 * native and web, but unit-test environments without the native module
 * stub can throw.
 */
export function getDefaultCountry(i18nLang: string | null | undefined): Country {
  try {
    const region = getLocales()?.[0]?.regionCode;
    if (region) {
      const hit = COUNTRIES.find(c => c.iso === region.toUpperCase());
      if (hit) return hit;
    }
  } catch {
    // Non-fatal — fall through to lang-based detection.
  }
  const lang = (i18nLang || '').trim();
  if (lang) {
    const iso =
      LANG_TO_ISO[lang] ||
      LANG_TO_ISO[lang.split('-')[0]] ||
      LANG_TO_ISO[lang.toLowerCase()];
    if (iso) {
      const hit = COUNTRIES.find(c => c.iso === iso);
      if (hit) return hit;
    }
  }
  // Final fallback — Taiwan is the primary market for this app.
  return COUNTRIES.find(c => c.iso === 'TW') ?? COUNTRIES[0];
}
