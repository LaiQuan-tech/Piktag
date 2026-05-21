import React, { useMemo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { COLORS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  value: string;
  onChangeText: (next: string) => void;
};

/**
 * Pill-shaped search bar that sits between the inbox header and the
 * primary/requests/general tabs. Local-only filter — never makes a
 * network call; the parent owns the `value` state and filters its
 * in-memory conversation list against it.
 */
const ChatSearchBar = React.memo(({ value, onChangeText }: Props) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasValue = value.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.pill}>
        <Search size={18} color={colors.gray400} style={styles.searchIcon} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={t('chat.searchPlaceholder')}
          placeholderTextColor={colors.gray400}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          accessibilityLabel={t('chat.searchPlaceholder')}
        />
        {hasValue ? (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={8}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Clear"
          >
            <X size={16} color={colors.gray500} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

ChatSearchBar.displayName = 'ChatSearchBar';

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: c.white,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 36,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: c.gray900,
    padding: 0, // RN Android default padding breaks vertical centering
  },
  clearBtn: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  });
}

export default ChatSearchBar;
