// TabTooltipOverlay
//
// One-shot, full-screen dim + 5 tooltip bubbles that appear above each
// bottom tab the very first time a freshly-onboarded user lands on
// MainTabs. Self-contained: reads/writes its own AsyncStorage flag so
// the parent (AppNavigator's MainTabs) just unconditionally mounts it.
//
// Backfill for existing users (avoid showing this to people who already
// finished onboarding before this feature shipped) lives in
// AppNavigator.decideOnboarding — when that function detects an
// already-onboarded user, it writes TAB_TOOLTIPS_SEEN_KEY = 'true'
// alongside the existing onboarding-completed flag.
//
// Tap anywhere (including the tab bar area) dismisses everything: we
// don't want a stray tab tap to navigate away mid-tour and lose the
// teaching moment.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants/theme';

// Bumping the version invalidates older flags if we ever redesign the
// overlay. Keep in lockstep with the backfill key in AppNavigator.
export const TAB_TOOLTIPS_SEEN_KEY = 'piktag_tab_tooltips_seen_v1';

// Mirrors the tabBarStyle in AppNavigator MainTabs: height 80, paddingBottom
// 28, paddingTop 10. The icon row sits at roughly `height - paddingBottom`
// from the bottom of the bar, so we anchor tooltips above that.
const TAB_BAR_HEIGHT = 80;
const TAB_COUNT = 5;

type TabKey = 'home' | 'search' | 'addTag' | 'notifications' | 'profile';
const TAB_KEYS: TabKey[] = ['home', 'search', 'addTag', 'notifications', 'profile'];

export default function TabTooltipOverlay() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState<boolean>(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const screenWidth = Dimensions.get('window').width;

  // Decide whether to render. AsyncStorage read is async, so we start
  // with visible=false and flip to true only if the flag is unset. The
  // brief "frame with no overlay then overlay appears" pop is fine —
  // it's <100ms in practice and the dim fade-in covers it.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TAB_TOOLTIPS_SEEN_KEY)
      .then((val) => {
        if (cancelled) return;
        if (val !== 'true') {
          setVisible(true);
          Animated.timing(opacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }).start();
        }
      })
      .catch(() => {
        // If AsyncStorage itself fails, err on the side of NOT showing
        // the overlay — better to miss a teaching moment than to render
        // it on every cold start.
      });
    return () => {
      cancelled = true;
    };
  }, [opacity]);

  if (!visible) return null;

  const handleDismiss = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setVisible(false));
    AsyncStorage.setItem(TAB_TOOLTIPS_SEEN_KEY, 'true').catch(() => {});
  };

  const tabSlotWidth = screenWidth / TAB_COUNT;
  // Vertical anchor: top of the tab bar (above all icons), then add a
  // small visual gap so the tooltip arrow doesn't kiss the bar.
  const tooltipBottom = TAB_BAR_HEIGHT + 8;

  return (
    <Animated.View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFillObject, styles.layer, { opacity }]}
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleDismiss}>
        {TAB_KEYS.map((key, i) => {
          const centerX = tabSlotWidth * (i + 0.5);
          return (
            <View
              key={key}
              pointerEvents="none"
              style={[
                styles.tooltip,
                {
                  bottom: tooltipBottom,
                  // Width-aware centering: shift left by half the
                  // intended tooltip width so the chip sits centered
                  // over the tab slot regardless of label length.
                  left: centerX - tabSlotWidth / 2,
                  width: tabSlotWidth,
                  alignItems: 'center',
                },
              ]}
            >
              <View style={styles.tooltipChip}>
                <Text style={styles.tooltipText} numberOfLines={1}>
                  {t(`tabTooltips.${key}`) || fallbackLabel(key)}
                </Text>
              </View>
              <View style={styles.tooltipArrow} />
            </View>
          );
        })}

        {/* Dismiss hint at the top — quietly tells the user this is
            tappable. No CTA button: tap anywhere works. */}
        <View style={[styles.hintWrap, { top: insets.top + 24 }]} pointerEvents="none">
          <Text style={styles.hintText}>
            {t('tabTooltips.dismissHint') || '點任意處關閉'}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function fallbackLabel(key: TabKey): string {
  switch (key) {
    case 'home': return '朋友列表';
    case 'search': return '找人 / 訊息';
    case 'addTag': return '掃 QR / 建立活動';
    case 'notifications': return '通知';
    case 'profile': return '你的個人頁';
  }
}

const styles = StyleSheet.create({
  layer: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 9999,
    elevation: Platform.OS === 'android' ? 12 : undefined,
  },
  tooltip: {
    position: 'absolute',
  },
  tooltipChip: {
    backgroundColor: COLORS.gray900,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    maxWidth: 140,
  },
  tooltipText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  tooltipArrow: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.gray900,
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
});
