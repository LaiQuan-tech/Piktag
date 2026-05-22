import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, type ColorPalette } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import type { InboxTab } from '../../types/chat';

type Props = {
  active: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts?: { primary: number; requests: number; general: number };
};

const TAB_ORDER: InboxTab[] = ['primary', 'requests', 'general'];

const ChatTabs = React.memo(({ active, onChange, counts }: Props) => {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // flexGrow: 0 is critical: a horizontal ScrollView without a
      // height constraint expands to fill the parent's remaining
      // vertical space, which was pushing the FlatList below it all
      // the way to the bottom of the screen, leaving a giant empty
      // gap between the tabs and the first conversation row.
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      {TAB_ORDER.map((tab) => {
        const isActive = tab === active;
        const count = counts ? counts[tab] : 0;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[
              styles.tab,
              // Active bg switched from gray900 → piktag500 so the tab
              // indicator matches the rest of the app's accent color
              // (purple). White label stays readable on both.
              { backgroundColor: isActive ? colors.piktag500 : 'transparent' },
            ]}
          >
            <View style={styles.tabInner}>
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? '#FFFFFF' : colors.gray500,
                    fontWeight: isActive ? '700' : '400',
                  },
                ]}
              >
                {t(`chat.tabs.${tab}`)}
              </Text>
              {count > 0 ? (
                <Text
                  style={[
                    styles.count,
                    { color: isActive ? '#FFFFFF' : colors.gray400 },
                  ]}
                >
                  {`  ·  ${count}`}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

ChatTabs.displayName = 'ChatTabs';

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  scroll: {
    // Cap vertical growth so the ScrollView only takes the height of
    // its pills (paddingV 12 + tab 12 + label lineHeight ≈ 56). Without
    // this, the ScrollView inherits flex behavior and eats every
    // remaining pixel between itself and the bottom of the screen.
    flexGrow: 0,
    flexShrink: 0,
  },
  container: {
    gap: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
  },
  count: {
    fontSize: 12,
  },
  });
}

export default ChatTabs;
