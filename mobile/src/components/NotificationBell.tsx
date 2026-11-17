// NotificationBell — the one in-app entry to the Notifications screen.
//
// Extracted from ChatListScreen's header on 2026-11-18, when the chat UI
// was taken down (PikTag back to a personal network tool, phase 1) and the
// bell moved to the Connections (home) header. It owns its own unread
// state (useNotificationUnread) and navigation, so any header can drop it
// in without wiring.
//
// A dot, never a number — see useNotificationUnread for why.
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Bell } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useNotificationUnread } from '../hooks/useNotificationUnread';

type Props = {
  /** Icon size; defaults to the original chat-header size. */
  size?: number;
  /** Icon colour; defaults to colors.gray900 (theme-aware). */
  color?: string;
  /** Touch-target style, so the bell can match its header's siblings. */
  style?: StyleProp<ViewStyle>;
};

const NotificationBell = React.memo(function NotificationBell({ size = 22, color, style }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const { hasUnread } = useNotificationUnread();

  // Notifications is a RootStack route, so a plain navigate opens it over
  // whichever tab holds the bell.
  const handlePress = useCallback(() => {
    navigation.navigate('Notifications');
  }, [navigation]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.6}
      style={style ?? styles.btn}
      accessibilityRole="button"
      accessibilityLabel={t('tabs.notifications', { defaultValue: '通知' })}
    >
      <View>
        <Bell size={size} color={color ?? colors.gray900} />
        {hasUnread ? <View style={styles.dot} /> : null}
      </View>
    </TouchableOpacity>
  );
});

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    btn: {
      padding: 8,
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 9,
      height: 9,
      borderRadius: 9999,
      backgroundColor: c.accentPop,
    },
  });
}

export default NotificationBell;
