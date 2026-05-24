import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Wifi, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNetInfo } from '../hooks/useNetInfo';

// How long the green "back online" confirmation stays visible after a
// reconnect before fading. Long enough to register, short enough not to
// linger when everything's fine.
const RECONNECT_TOAST_MS = 2000;
// Slide / fade durations for the in/out animations.
const TRANSITION_MS = 220;

type Mode = 'hidden' | 'offline' | 'reconnected';

/**
 * App-wide network status banner. Three visual states:
 *  - hidden: connected and steady, nothing rendered.
 *  - offline: red bar with WifiOff icon + "目前離線" + "部分功能需要
 *    網路". Persists for as long as we're disconnected.
 *  - reconnected: green bar with Wifi icon + "已重新連線", auto-hides
 *    after RECONNECT_TOAST_MS so the user gets positive confirmation
 *    that connectivity is back without permanent visual noise.
 *
 * The banner itself is purely informational — the actual auto-refetch
 * logic lives in `useNetInfoReconnect()` consumed by individual
 * screens, so the banner doesn't need to coordinate any data work.
 */
export default function OfflineBanner(): React.ReactElement | null {
  const { isConnected } = useNetInfo();
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>('hidden');
  const slide = useRef(new Animated.Value(-40)).current; // off-screen up
  const opacity = useRef(new Animated.Value(0)).current;
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we've actually been offline at some point. Without
  // this, the very first mount (which may briefly show isConnected=true
  // before NetInfo's first event) could trigger a misleading
  // "reconnected" toast on cold start.
  const hasBeenOfflineRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isConnected) {
      hasBeenOfflineRef.current = true;
      setMode('offline');
      return;
    }
    // Connected — show the green confirmation only if we were
    // previously offline. Otherwise stay hidden.
    if (hasBeenOfflineRef.current) {
      setMode('reconnected');
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        setMode('hidden');
        reconnectTimerRef.current = null;
      }, RECONNECT_TOAST_MS);
    } else {
      setMode('hidden');
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [isConnected]);

  // Drive the slide+fade based on the resolved mode.
  useEffect(() => {
    const targets =
      mode === 'hidden'
        ? { slide: -40, opacity: 0 }
        : { slide: 0, opacity: 1 };
    Animated.parallel([
      Animated.timing(slide, {
        toValue: targets.slide,
        duration: TRANSITION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: targets.opacity,
        duration: TRANSITION_MS,
        useNativeDriver: true,
      }),
    ]).start();
  }, [mode, slide, opacity]);

  if (mode === 'hidden') return null;

  const isOffline = mode === 'offline';
  const Icon = isOffline ? WifiOff : Wifi;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bar,
        isOffline ? styles.barOffline : styles.barOnline,
        { opacity, transform: [{ translateY: slide }] },
      ]}
    >
      <Icon size={14} color="#fff" strokeWidth={2.4} />
      <View style={styles.textBlock}>
        <Text style={styles.headline}>
          {isOffline ? t('app.offline') : t('app.backOnline')}
        </Text>
        {isOffline ? (
          <Text style={styles.sub}>{t('app.offlineHint')}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  barOffline: {
    backgroundColor: '#dc2626',
  },
  barOnline: {
    backgroundColor: '#16a34a',
  },
  textBlock: {
    flexDirection: 'column',
    flex: 1,
  },
  headline: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
  },
  sub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: 1,
  },
});
