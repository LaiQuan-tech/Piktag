// EditableName.tsx
//
// A name you can rename: the name with a pencil beside it, and a sheet to
// do the renaming in.
//
// 可編輯的東西必須看起來可編輯 — the pencil is the whole affordance. Without
// it this is an ordinary <Text> and the feature may as well not exist,
// which is exactly what had happened (founder 2026-09-03: 目前好友沒辦法
// 編輯顯示名稱，聯絡人也沒辦法 — contacts DID have an edit route, a small
// text button in the header, and it was not findable).
//
// WHY A SHEET AND NOT AN INLINE FIELD (rewritten 2026-09-03 after
// 但ui好醜). The first version morphed the header text into a bare
// underlined input in place, copying QrGroupDetailScreen. In a hero that
// sits beside a 68px avatar it produced four separate defects at once:
//
//   1. The row grew when you tapped it — the trigger's own padding plus a
//      hint line appearing — so the avatar, the @username under it and
//      everything below shifted. That jump IS the 粗糙.
//   2. A 1px purple underline under a 16px name, floating on the page
//      background, matches nothing else in the app. Every other input
//      here is a filled rounded field (gray100 / gray200 / radius 16).
//   3. selectTextOnFocus opened with the whole name highlighted, so one
//      stray keystroke wiped it.
//   4. Blur-saved. "Did that save?" is not a question a rename should
//      leave you asking, and there was no way to back out.
//
// A sheet fixes all four by construction: nothing behind it moves, it
// uses the app's own input and sheet chrome, and Save is a button you
// press. Sheet language copied from PlatformSearchModal — same backdrop,
// same 20px top corners, same card background — so it reads as part of
// this app rather than a component that arrived from somewhere else.
//
// The trigger row adds NO vertical padding, deliberately: it has to
// occupy exactly the height the plain <Text> it replaced did, or every
// header it is dropped into shifts by a few pixels. The tap target comes
// from hitSlop instead.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
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
   * Seed for the field. Distinct from `value` because a friend's
   * DISPLAYED name may be their real one while the editable thing is the
   * (empty) nickname override — seeding the field with their real name
   * would turn "add a nickname" into "rename them to what they are
   * already called", and clearing it would then look like deleting their
   * name.
   */
  editValue?: string;
  onSave: (next: string) => void;
  /** Sheet heading. Defaults to 編輯名稱. */
  title?: string;
  placeholder?: string;
  /** One quiet line under the field. */
  hint?: string;
  maxLength?: number;
  /** Type scale for the idle name, so each host keeps its own. */
  textStyle?: StyleProp<TextStyle>;
  /** Optical match to the name's size. 15 suits a 16px name. */
  pencilSize?: number;
  /**
   * May the field be saved empty? True for a friend's nickname, where
   * empty means "drop the override and show their real name again".
   * False for a contact, where the name IS the record and an unnamed
   * contact can never be found again.
   */
  allowEmpty?: boolean;
  editable?: boolean;
  accessibilityLabel?: string;
};

export default function EditableName({
  value,
  editValue,
  onSave,
  title,
  placeholder,
  hint,
  maxLength = 40,
  textStyle,
  pencilSize = 15,
  allowEmpty = false,
  editable = true,
  accessibilityLabel,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const original = (editValue ?? value).trim();

  const begin = useCallback(() => {
    setDraft(editValue ?? value);
    setOpen(true);
  }, [editValue, value]);

  const close = useCallback(() => setOpen(false), []);

  const trimmed = draft.trim();
  // Nothing to do is not a save. Without this the row is bumped, and on
  // the friend surface an identical nickname is rewritten, on every
  // accidental open-and-confirm.
  const canSave = trimmed !== original && (allowEmpty || trimmed.length > 0);

  const commit = useCallback(() => {
    if (!canSave) return;
    setOpen(false);
    onSave(trimmed);
  }, [canSave, trimmed, onSave]);

  if (!editable) {
    return (
      <Text style={[styles.name, textStyle]} numberOfLines={1}>
        {value}
      </Text>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        activeOpacity={0.6}
        onPress={begin}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityLabel ?? t('common.editName', { defaultValue: '編輯名稱' })
        }
      >
        <Text style={[styles.name, textStyle]} numberOfLines={1}>
          {value}
        </Text>
        {/* Quiet enough not to compete with the name, present enough to
            teach the tap. */}
        <Edit3 size={pencilSize} color={colors.gray400} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
        statusBarTranslucent
      >
        {/* Tapping outside cancels — the same escape every other sheet in
            the app offers. */}
        <Pressable style={styles.backdrop} onPress={close} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
          pointerEvents="box-none"
        >
          <View style={styles.sheet}>
            <Text style={styles.title}>
              {title ?? t('common.editName', { defaultValue: '編輯名稱' })}
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                autoFocus
                placeholder={placeholder}
                placeholderTextColor={colors.gray400}
                maxLength={maxLength}
                returnKeyType="done"
                onSubmitEditing={commit}
              />
            </View>

            {hint ? <Text style={styles.hint}>{hint}</Text> : null}

            <View style={styles.actions}>
              {/* Tier 3 outline / tier 2 solid. Renaming is a mundane
                  commit, not this page's signature action, so the
                  gradient stays where it belongs. */}
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                activeOpacity={0.7}
                onPress={close}
                accessibilityRole="button"
              >
                <Text style={styles.btnGhostText}>
                  {t('common.cancel', { defaultValue: '取消' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnSave, !canSave && styles.btnDisabled]}
                activeOpacity={0.85}
                onPress={commit}
                disabled={!canSave}
                accessibilityRole="button"
              >
                <Text style={styles.btnSaveText}>
                  {t('common.save', { defaultValue: '儲存' })}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    // NO vertical padding: this replaces a plain <Text> inside other
    // people's headers and must not change their height by a pixel.
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    name: {
      color: c.gray900,
      flexShrink: 1,
    },

    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheetWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    sheet: {
      backgroundColor: c.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingTop: 20,
      // Room for the home indicator without a safe-area subscription in
      // a component that may be mounted inside another modal.
      paddingBottom: 28,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: c.gray900,
      marginBottom: 14,
    },
    // The app's standard field. Same tokens as EditProfile / the event
    // tag composer, so a rename looks like every other thing you type.
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.gray100,
      borderWidth: 1,
      borderColor: c.gray200,
      borderRadius: 16,
      paddingHorizontal: 16,
      height: 48,
    },
    input: {
      flex: 1,
      fontSize: 16,
      color: c.gray900,
      padding: 0,
    },
    hint: {
      fontSize: 12,
      color: c.gray400,
      marginTop: 8,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
    },
    btn: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhost: {
      borderWidth: 1,
      borderColor: c.piktag500,
    },
    btnGhostText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.piktag500,
    },
    btnSave: {
      backgroundColor: c.piktag500,
    },
    btnDisabled: {
      opacity: 0.4,
    },
    btnSaveText: {
      fontSize: 16,
      fontWeight: '700',
      // Fixed white on a fixed purple fill — never colors.white, which
      // flips in dark mode and would put white text on white.
      color: '#FFFFFF',
    },
  });
}
