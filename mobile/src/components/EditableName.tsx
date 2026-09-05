// EditableName.tsx
//
// Tap the name, it becomes a text field. A pencil sits next to it while
// idle so the name LOOKS editable — founder rule, learned the hard way:
// 可編輯的東西必須看起來可編輯. Without the glyph the affordance is
// invisible and the feature may as well not exist, which is exactly what
// happened here (founder 2026-09-03: 目前好友沒辦法編輯顯示名稱，聯絡人也
// 沒辦法 — contacts DID have an edit route, a small text button in the
// header, and it was not findable).
//
// Extracted from QrGroupDetailScreen, which invented this interaction for
// renaming an event tag. Three call sites now — friend, contact, event
// tag — so it is one component rather than three copies (founder rule:
// 共用 UI = 一個共用元件, the one that kills border-width drift).
//
// The host owns the TYPE SCALE: a friend's name is a page title, an event
// tag's is a hero line. `textStyle` is passed through to both the idle
// text and the input so the two states are the same size and the row does
// not jump when you tap it.
//
// Saving: on blur and on submit, and only when the value actually
// changed. `onSave` is fire-and-forget from this component's point of
// view — the host owns the write, the optimistic update and any failure
// message, because what "save" means differs per surface (a friend's
// nickname is a private override; a contact's name is the record itself).

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { Edit3 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import type { ColorPalette } from '../constants/theme';

type Props = {
  /** What to show when idle. Never empty — hosts pass a resolved name. */
  value: string;
  /**
   * Seed for the input when editing starts. Distinct from `value` because
   * a friend's displayed name may be their REAL name while the editable
   * field is the (empty) nickname override — starting that input with
   * their real name pre-filled would turn "add a nickname" into "rename
   * this person to what they are already called".
   */
  editValue?: string;
  onSave: (next: string) => void;
  placeholder?: string;
  /** One quiet line under the field while editing. */
  hint?: string;
  maxLength?: number;
  /** Type scale, applied to BOTH states so the row cannot jump. */
  textStyle?: StyleProp<TextStyle>;
  editable?: boolean;
  accessibilityLabel?: string;
};

export default function EditableName({
  value,
  editValue,
  onSave,
  placeholder,
  hint,
  maxLength = 40,
  textStyle,
  editable = true,
  accessibilityLabel,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editValue ?? value);
  // Blur fires after submit on some Android keyboards, so without this
  // the save would run twice and the second one would race the first.
  const savedRef = useRef(false);

  // Keep the draft in step while idle — the host may have refetched.
  useEffect(() => {
    if (!editing) setDraft(editValue ?? value);
  }, [editValue, value, editing]);

  const begin = useCallback(() => {
    setDraft(editValue ?? value);
    savedRef.current = false;
    setEditing(true);
  }, [editValue, value]);

  const commit = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    setEditing(false);
    const next = draft.trim();
    // Unchanged is not a write. Saving anyway would bump the row for
    // nothing and, on the friend surface, overwrite a nickname with an
    // identical string on every accidental tap.
    if (next === (editValue ?? value).trim()) return;
    onSave(next);
  }, [draft, editValue, value, onSave]);

  if (!editable) {
    return <Text style={[styles.text, textStyle]}>{value}</Text>;
  }

  if (editing) {
    return (
      <View style={styles.editWrap}>
        <TextInput
          style={[styles.text, textStyle, styles.input]}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={colors.gray400}
          maxLength={maxLength}
          selectTextOnFocus
        />
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.6}
      onPress={begin}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? t('common.editName', { defaultValue: '編輯名稱' })
      }
    >
      <Text style={[styles.text, textStyle]} numberOfLines={1}>
        {value}
      </Text>
      {/* Small and gray on purpose: it has to be visible enough to teach
          the tap, quiet enough not to compete with the name itself. */}
      <Edit3 size={14} color={colors.gray400} />
    </TouchableOpacity>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      // Keeps the tap target comfortable without changing the row's
      // visual height (the name's own line height dominates).
      paddingVertical: 2,
    },
    text: {
      color: c.gray900,
    },
    editWrap: {
      alignSelf: 'stretch',
    },
    input: {
      // A field the user is typing in has to read as a field. Underline
      // rather than a full box: the name sits in a hero, and a boxed
      // input there reads as a form that swallowed the header.
      borderBottomWidth: 1,
      borderBottomColor: c.piktag500,
      paddingVertical: 2,
      paddingHorizontal: 0,
      minWidth: 120,
    },
    hint: {
      fontSize: 11,
      color: c.gray400,
      marginTop: 4,
    },
  });
}
