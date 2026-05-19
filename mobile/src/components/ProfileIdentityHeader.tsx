// ProfileIdentityHeader.tsx
//
// THE one "person identity" header — avatar + name + headline — used
// at the top of a profile-style surface. Extracted so a contact /
// member / friend identity block is ONE component, never a per-screen
// style copy (founder design contract). Design tokens (avatar size,
// gaps, type scale) live here once; they mirror FriendDetailScreen's
// profileRow so a local contact reads like a member friend.
//
// Presentational + dual-mode:
//   • read    — pass name/headline → rendered as Text.
//   • editable — also pass onChangeName / onChangeHeadline → the
//     same slots become borderless TextInputs that read as profile
//     TEXT, not form boxes (that's the whole point: an edit screen
//     that looks like a profile card, editing is secondary).
//
// FriendDetailScreen still has its own inline header; adopting this
// there is a deliberate follow-up (that screen is 2.5k lines and a
// read-only view — out of scope to refactor here).

import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import RingedAvatar from './RingedAvatar';
import { COLORS } from '../constants/theme';

type Props = {
  name: string;
  onChangeName?: (v: string) => void;
  namePlaceholder?: string;
  autoFocusName?: boolean;
  nameMaxLength?: number;
  /** Small line under the name (e.g. "尚未加入 PikTag"). Read-only. */
  subtitle?: string;
  headline?: string;
  onChangeHeadline?: (v: string) => void;
  headlinePlaceholder?: string;
  headlineMaxLength?: number;
  avatarUrl?: string | null;
};

export default function ProfileIdentityHeader({
  name,
  onChangeName,
  namePlaceholder,
  autoFocusName,
  nameMaxLength,
  subtitle,
  headline,
  onChangeHeadline,
  headlinePlaceholder,
  headlineMaxLength,
  avatarUrl,
}: Props) {
  const headlineShown = onChangeHeadline !== undefined || !!headline;
  return (
    <View style={styles.root}>
      <View
        style={[styles.row, { marginBottom: headlineShown ? 10 : 2 }]}
      >
        <RingedAvatar
          size={64}
          ringStyle="subtle"
          name={name || '?'}
          avatarUrl={avatarUrl ?? null}
        />
        <View style={styles.nameSection}>
          {onChangeName ? (
            <TextInput
              style={styles.name}
              value={name}
              onChangeText={onChangeName}
              placeholder={namePlaceholder}
              placeholderTextColor={COLORS.gray400}
              autoFocus={autoFocusName}
              maxLength={nameMaxLength}
              returnKeyType="next"
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

      {headlineShown ? (
        onChangeHeadline ? (
          <TextInput
            style={styles.headline}
            value={headline ?? ''}
            onChangeText={onChangeHeadline}
            placeholder={headlinePlaceholder}
            placeholderTextColor={COLORS.gray400}
            maxLength={headlineMaxLength}
          />
        ) : (
          <Text style={styles.headline}>{headline}</Text>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: 4, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  nameSection: { flex: 1, gap: 2 },
  // Bigger than FriendDetail's 16 on purpose: a contact has no
  // @username, so the name IS the identity → it's the page title.
  // Borderless + no bg so the editable variant reads as a title,
  // not a form box.
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
    padding: 0,
  },
  subtitle: { fontSize: 14, color: COLORS.gray500 },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
    padding: 0,
  },
});
