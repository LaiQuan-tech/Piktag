import React, { useEffect, useRef, useState } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { toBirthdayDate } from '../lib/birthday';

// Credit-card-style masked birthday input — MONTH + DAY only, NO YEAR.
//
// Digits auto-format with a "/" (type 0508 -> 05/08), like a card expiry
// field. The DISPLAY order follows the UI locale (MM/DD for month-first
// locales incl. CJK + en-US; DD/MM for day-first locales like en-GB / es
// / fr / de / hi / ...), so a day-first user doesn't mis-enter their
// birthday. INTERNALLY it always emits canonical month-first "MM/DD"
// (toBirthdayDate-compatible), so save logic is unchanged everywhere.
//
// Pure JS — no native date/picker module. Replaces the short-lived
// BirthdayWheel; founder call 2026-06-05 ("依信用卡的格式").

function daysInMonth(m: number): number {
  if (m === 2) return 29; // year-less: allow leap-day birthdays
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

// Smart-mask防呆: consume 1-2 digits for ONE part (month or day) with
// a max, returning the cleaned part + how many digits it used. A leading
// digit too big to be a tens digit (e.g. "5" for a max-31 day, "2" for a
// max-12 month) auto-zero-pads to "05"/"02" and completes; a value out of
// range never forms. This makes an INVALID date impossible to type, so
// no error UI is needed (and it works in any parent layout).
function consumePart(digits: string, max: number): { part: string; used: number } {
  if (digits.length === 0) return { part: '', used: 0 };
  const d0 = parseInt(digits[0], 10);
  if (d0 * 10 > max) return { part: '0' + digits[0], used: 1 }; // single high digit -> 0d
  if (digits.length === 1) return { part: digits[0], used: 1 }; // valid tens-prefix, wait
  const two = parseInt(digits.slice(0, 2), 10);
  if (two < 1) return { part: '0' + digits[0], used: 1 };       // "00" -> treat 1st as ones
  if (two > max) return { part: '0' + digits[0], used: 1 };     // e.g. month 1+5=15 -> "01", push 5
  return { part: String(two).padStart(2, '0'), used: 2 };
}

// Parse any stored/canonical birthday into month-first {month, day},
// reusing the ONE normalizer so every accepted shape (MM/DD, 2000-MM-DD,
// YYYY-MM-DD, MMDD, ...) is handled identically.
function parse(value: string | null | undefined): { month: number; day: number } | null {
  const iso = toBirthdayDate(value);
  if (!iso) return null;
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
}

// Does this UI locale write the day before the month? Uses ICU via Intl
// so it's correct per-locale; falls back to month-first on any Intl gap.
function isDayFirst(locale: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2000, 0, 2));
    const di = parts.findIndex((p) => p.type === 'day');
    const mi = parts.findIndex((p) => p.type === 'month');
    return di !== -1 && mi !== -1 && di < mi;
  } catch {
    return false;
  }
}

function canonicalToDisplay(value: string | null | undefined, dayFirst: boolean): string {
  const p = parse(value);
  if (!p) return '';
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return dayFirst ? `${dd}/${mm}` : `${mm}/${dd}`;
}

type Props = {
  value?: string | null;
  /** Emits canonical month-first "MM/DD", or '' when empty / incomplete / invalid. */
  onChange: (canonical: string) => void;
  /** Field style — pass the form's input style so it matches siblings. */
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
};

export default function BirthdayInput({ value, onChange, style, placeholderTextColor }: Props) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const dayFirst = isDayFirst(i18n.language);

  const [text, setText] = useState(() => canonicalToDisplay(value, dayFirst));
  const lastEmitted = useRef<string | null | undefined>(value);

  // Resync ONLY on EXTERNAL value changes (e.g. an async profile/contact
  // load), never when our own onChange echoes back — that would fight the
  // user's typing. dayFirst in deps so a locale flip re-orders the field.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(canonicalToDisplay(value, dayFirst));
      lastEmitted.current = value;
    }
  }, [value, dayFirst]);

  const handleChange = (raw: string) => {
    const ds = raw.replace(/\D/g, '').slice(0, 8);
    const firstMax = dayFirst ? 31 : 12;
    const secondMax = dayFirst ? 12 : 31;

    const r1 = consumePart(ds, firstMax);
    let firstPart = r1.part;
    let secondPart = '';
    if (firstPart.length === 2) {
      secondPart = consumePart(ds.slice(r1.used), secondMax).part;
    }

    // Both parts complete → clamp the day to the chosen month's length
    // (e.g. 02/31 -> 02/29, 04/31 -> 04/30) so the date is always real.
    if (firstPart.length === 2 && secondPart.length === 2) {
      const month = dayFirst ? parseInt(secondPart, 10) : parseInt(firstPart, 10);
      let day = dayFirst ? parseInt(firstPart, 10) : parseInt(secondPart, 10);
      if (day > daysInMonth(month)) {
        day = daysInMonth(month);
        if (dayFirst) firstPart = String(day).padStart(2, '0');
        else secondPart = String(day).padStart(2, '0');
      }
    }

    // Slash only once a second digit exists, so backspacing past it works.
    setText(firstPart.length === 2 && secondPart.length > 0 ? `${firstPart}/${secondPart}` : firstPart);

    let canonical = '';
    if (firstPart.length === 2 && secondPart.length === 2) {
      const month = dayFirst ? secondPart : firstPart;
      const day = dayFirst ? firstPart : secondPart;
      canonical = `${month}/${day}`; // always valid by construction
    }
    lastEmitted.current = canonical;
    onChange(canonical);
  };

  return (
    <TextInput
      style={style}
      value={text}
      onChangeText={handleChange}
      placeholder={dayFirst ? 'DD/MM' : 'MM/DD'}
      placeholderTextColor={placeholderTextColor ?? colors.gray400}
      keyboardType="number-pad"
      maxLength={5}
      returnKeyType="done"
    />
  );
}
