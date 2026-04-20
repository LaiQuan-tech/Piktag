import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import type { InboxTab } from '../../types/chat';

type Props = {
  active: InboxTab;
  onChange: (tab: InboxTab) => void;
  counts?: { primary: number; requests: number; general: number };
};

const TAB_ORDER: InboxTab[] = ['primary', 'requests', 'general'];

const ChatTabs = React.memo(({ active, onChange, counts }: Props) => {
  const { t } = useTranslation();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
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
              { backgroundColor: isActive ? COLORS.gray900 : 'transparent' },
            ]}
          >
            <View style={styles.tabInner}>
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? COLORS.white : COLORS.gray500,
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
                    { color: isActive ? COLORS.white : COLORS.gray400 },
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

const styles = StyleSheet.create({
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

export default ChatTabs;
