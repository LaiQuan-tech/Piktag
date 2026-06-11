/**
 * IcebreakerSuggestions — a VERTICAL stack of 1-3 first-message
 * options that sits just above the Composer when:
 *   - the conversation is empty (new chat) OR
 *   - the conversation is dormant (no message in 90+ days)
 *
 * Founder design constraint (2026-05-29): "must NOT feel AI." So:
 *   - no "AI 建議" label anywhere
 *   - no sparkle icon, no robot
 *   - tap → text drops into Composer, user can edit, send is manual
 *   - dismiss × (top-right) when user wants to silence it
 *
 * 2026-06-11 (founder, real-device + App Store screenshot review): the
 * old horizontal swipe row showed ~1.5 truncated cards and hid the rest
 * behind a gesture — the user couldn't COMPARE the three options. Now a
 * plain vertical list: all options fully visible, full text, no swipe.
 */
import React, { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ColorPalette } from '../../constants/theme';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';

type Props = {
  suggestions: string[];
  loading?: boolean;
  onPick: (text: string) => void;
  onDismiss: () => void;
};

const IcebreakerSuggestions = React.memo(function IcebreakerSuggestions({
  suggestions,
  loading,
  onPick,
  onDismiss,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();

  // Nothing to render when no suggestions AND not loading.
  if (!loading && suggestions.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.headerText}>
          {t('chat.icebreakerHeader', { defaultValue: 'Easier ways to start' })}
        </Text>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.6}
        >
          <X size={16} color={colors.gray400} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.piktag500} />
          <Text style={styles.loadingText}>
            {t('chat.icebreakerLoading', { defaultValue: 'Thinking of something specific…' })}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {suggestions.slice(0, 3).map((s, i) => (
            <TouchableOpacity
              key={`${i}-${s.slice(0, 20)}`}
              style={styles.option}
              onPress={() => onPick(s)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

export default IcebreakerSuggestions;

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    wrap: {
      borderTopWidth: 1,
      borderTopColor: c.gray100,
      paddingTop: 8,
      paddingBottom: 4,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    headerText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.gray500,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    loadingText: {
      fontSize: 13,
      color: c.gray500,
    },
    list: {
      paddingHorizontal: 12,
      gap: 8,
      paddingBottom: 6,
    },
    option: {
      backgroundColor: c.piktag50,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    optionText: {
      fontSize: 14,
      lineHeight: 19,
      color: c.gray900,
    },
  });
}
