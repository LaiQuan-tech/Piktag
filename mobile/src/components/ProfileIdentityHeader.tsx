// ProfileIdentityHeader.tsx
//
// THE one "person identity" header — avatar + name + headline — used
// at the top of a profile-style surface. Extracted so a contact /
// member / friend identity block is ONE component, never a per-screen
// style copy (founder design contract). Design tokens (avatar size,
// gaps, type scale) live here once; they mirror FriendDetailScreen's
// profileRow so a local contact reads like a member friend.
//
// DISPLAY ONLY — do not add editing back.
// This used to have an "editable" mode: pass onChangeName /
// onChangeHeadline and the same slots became borderless TextInputs
// "that read as profile TEXT, not form boxes". That was the bug. On
// EditLocalContactScreen the name was one of those inputs, and nobody
// could tell — the founder, who wrote the app, reported the name as
// impossible to edit after a card scan misread "Racheil" as "Rachei".
// An input that renders as a title is an input nobody uses.
//
// 職稱 had already been pulled out of this header for exactly the same
// reason. Both now live in the form below as labeled, bordered inputs,
// per the founder rule that edit-form fields must look like proper iOS
// form inputs so users can see they are editable. This header shows the
// name; it updates live as the field below is typed.
//
// FriendDetailScreen still has its own inline header; adopting this
// there is a deliberate follow-up (that screen is 2.5k lines and a
// read-only view — out of scope to refactor here).

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import EditableName from './EditableName';
import RingedAvatar, { BadgeKind } from './RingedAvatar';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type Props = {
  name: string;
  /** Small line under the name (e.g. "尚未加入 PikTag"). */
  subtitle?: string;
  headline?: string;
  avatarUrl?: string | null;
  /** Tap-the-avatar handler (e.g. open image picker). When set, the
   *  avatar becomes pressable and shows the chosen badge. */
  onAvatarPress?: () => void;
  /** Decoration badge in the avatar's bottom-right corner. Only
   *  meaningful with onAvatarPress; 'pencil' = edit, 'plus' = add. */
  avatarBadge?: BadgeKind;
  /**
   * Rename in place. When given, the name becomes tap-to-edit with a
   * pencil beside it (shared EditableName) instead of a plain <Text>.
   *
   * This is NOT the editable mode that was deleted from this component in
   * September: that one made the name look like a label and behave like a
   * field, which is the trap the founder rule 可編輯的東西必須看起來可編輯
   * exists to stop. The pencil is the difference.
   */
  onNameSave?: (next: string) => void;
  /** Placeholder + hint for the rename field, when onNameSave is set. */
  namePlaceholder?: string;
  nameHint?: string;
};

export default function ProfileIdentityHeader({
  name,
  subtitle,
  headline,
  avatarUrl,
  onAvatarPress,
  avatarBadge,
  onNameSave,
  namePlaceholder,
  nameHint,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.root}>
      <View style={[styles.row, { marginBottom: headline ? 10 : 2 }]}>
        <RingedAvatar
          size={64}
          ringStyle="subtle"
          name={name || '?'}
          avatarUrl={avatarUrl ?? null}
          onPress={onAvatarPress}
          badge={avatarBadge ?? null}
        />
        <View style={styles.nameSection}>
          {onNameSave ? (
            <EditableName
              value={name}
              onSave={onNameSave}
              textStyle={styles.name}
              placeholder={namePlaceholder}
              hint={nameHint}
              maxLength={60}
            />
          ) : (
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
          )}
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {headline ? <Text style={styles.headline}>{headline}</Text> : null}
    </View>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  root: { paddingTop: 4, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  nameSection: { flex: 1, gap: 2 },
  // Bigger than FriendDetail's 16 on purpose: a contact has no
  // @username, so the name IS the identity → it's the page title.
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: c.gray900,
    padding: 0,
  },
  subtitle: { fontSize: 14, color: c.gray500 },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: c.piktag600,
    padding: 0,
  },
  });
}
