import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Modal,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';

// Birthday picker — MONTH + DAY only, NO YEAR.
//
// PikTag only uses month/day (birthday reminders); the year is never
// stored (lib/birthday.ts fills the sentinel year 2000). iOS's native
// date wheel always includes a year — which would make users reveal
// their birth year (age) for an OPTIONAL field — so this is a custom
// 2-wheel (month, day) picker instead. Founder call 2026-06-05.
//
// Emits "MM/DD" (zero-padded) on confirm, or '' on clear. lib/birthday
// .toBirthdayDate() normalises "MM/DD" -> "2000-MM-DD" at save time.

function daysInMonth(m: number): number {
  // Year-less: February allows 29 so leap-day birthdays are pickable.
  if (m === 2) return 29;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

function parse(value?: string | null): { month: number; day: number } | null {
  if (!value) return null;
  const m =
    value.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/) ||
    value.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

type Props = {
  value?: string | null;
  onChange: (value: string) => void;
  /** Box style for the tappable field — pass the form's input style. */
  boxStyle?: StyleProp<ViewStyle>;
  placeholder?: string;
};

export default function BirthdayWheel({ value, onChange, boxStyle, placeholder }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [open, setOpen] = useState(false);
  const [draftMonth, setDraftMonth] = useState(1);
  const [draftDay, setDraftDay] = useState(1);

  const parsed = parse(value);

  // Localised "month day" with no year (e.g. 5月8日 / May 8 / 8 мая).
  const formatDisplay = (month: number, day: number): string => {
    try {
      return new Date(2000, month - 1, day).toLocaleDateString(i18n.language, {
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return `${month}/${day}`;
    }
  };

  const openSheet = () => {
    const p = parse(value);
    setDraftMonth(p?.month ?? 1);
    setDraftDay(p?.day ?? 1);
    setOpen(true);
  };

  const confirm = () => {
    const mm = String(draftMonth).padStart(2, '0');
    const dd = String(Math.min(draftDay, daysInMonth(draftMonth))).padStart(2, '0');
    onChange(`${mm}/${dd}`);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const dayMax = daysInMonth(draftMonth);
  const days = Array.from({ length: dayMax }, (_, i) => i + 1);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <>
      <TouchableOpacity
        style={boxStyle}
        activeOpacity={0.7}
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={t('auth.register.birthdayLabel', { defaultValue: '生日（選填）' })}
      >
        <Text style={[styles.fieldText, !parsed && styles.fieldPlaceholder]}>
          {parsed
            ? formatDisplay(parsed.month, parsed.day)
            : (placeholder ?? t('auth.register.birthdayLabel', { defaultValue: '生日（選填）' }))}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          {/* Backdrop is a SEPARATE sibling layer behind the sheet —
              tapping the dimmed area closes. The sheet/pickers are NOT
              wrapped in any touchable, so the native wheel scrolls
              freely (a TouchableOpacity around a Picker can swallow the
              pan gesture and freeze the wheel). */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={clear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.clearBtn}>{t('common.clear', { defaultValue: '清除' })}</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>
                {t('auth.register.birthdayLabel', { defaultValue: '生日（選填）' })}
              </Text>
              <TouchableOpacity onPress={confirm} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.doneBtn}>{t('common.done', { defaultValue: '完成' })}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.colHeaderRow}>
              <Text style={styles.colHeader}>{t('common.month', { defaultValue: '月' })}</Text>
              <Text style={styles.colHeader}>{t('common.day', { defaultValue: '日' })}</Text>
            </View>

            <View style={styles.wheelRow}>
              <Picker
                style={styles.wheel}
                itemStyle={styles.wheelItem}
                selectedValue={draftMonth}
                onValueChange={(v) => setDraftMonth(Number(v))}
              >
                {months.map((m) => (
                  <Picker.Item key={m} label={String(m)} value={m} color={colors.text} />
                ))}
              </Picker>
              <Picker
                style={styles.wheel}
                itemStyle={styles.wheelItem}
                selectedValue={Math.min(draftDay, dayMax)}
                onValueChange={(v) => setDraftDay(Number(v))}
              >
                {days.map((d) => (
                  <Picker.Item key={d} label={String(d)} value={d} color={colors.text} />
                ))}
              </Picker>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    // Matches the wizard's single-line inputs (fontSize 18, left-aligned).
    fieldText: {
      fontSize: 18,
      color: c.gray900,
    },
    fieldPlaceholder: {
      color: c.gray400,
    },
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
      backgroundColor: c.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
    },
    clearBtn: {
      fontSize: 15,
      color: c.gray500,
    },
    doneBtn: {
      fontSize: 16,
      fontWeight: '700',
      color: c.piktag500,
    },
    colHeaderRow: {
      flexDirection: 'row',
      paddingTop: 10,
    },
    colHeader: {
      flex: 1,
      textAlign: 'center',
      fontSize: 13,
      fontWeight: '600',
      color: c.gray500,
    },
    wheelRow: {
      flexDirection: 'row',
      height: 196,
    },
    wheel: {
      flex: 1,
    },
    wheelItem: {
      fontSize: 22,
    },
  });
}
