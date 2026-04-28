import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CloudOff, RotateCw, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { COLORS } from '../constants/theme';
import { useNetInfo } from '../hooks/useNetInfo';

type Props = {
  /**
   * Optional heading override. When omitted the component picks its own
   * copy based on whether we're currently offline (via NetInfo) or just
   * had a fetch fail while online — the two cases warrant different
   * wording so users know what to do next.
   */
  heading?: string;
  /**
   * Optional secondary line override. Same rule as `heading`.
   */
  subtitle?: string;
  /**
   * Retry handler. When omitted the retry button is hidden — useful for
   * places where retry is automatic on reconnect and we just want to
   * tell the user what's going on.
   */
  onRetry?: () => void;
  /**
   * `true` while the retry is in flight. Disables the button + swaps
   * the icon to spin.
   */
  retrying?: boolean;
  /**
   * Compact variant (smaller padding + icon) for use inline in a list,
   * e.g. inside a FlatList ListEmptyComponent. Default is the full
   * full-screen centred layout.
   */
  compact?: boolean;
};

/**
 * Shared "couldn't load" surface. Two-mode display:
 *  - **Offline** (NetInfo says no connection): cloud-off icon + "目前
 *    離線" copy that promises auto-recovery once the connection comes
 *    back. The retry button is still shown — tapping while offline
 *    fires a fetch immediately so the user gets a fresh attempt the
 *    moment connectivity blips back, without waiting for a NetInfo tick.
 *  - **Online** (we have connectivity but the fetch threw): wifi-off
 *    icon + "載入失敗" copy with the explicit retry CTA.
 *
 * Callers can override the copy via `heading` / `subtitle` for
 * screen-specific wording (e.g. "找不到這個人" vs the generic load
 * failure).
 */
export default function ErrorState({
  heading,
  subtitle,
  onRetry,
  retrying = false,
  compact = false,
}: Props): React.ReactElement {
  const { t } = useTranslation();
  const { isConnected } = useNetInfo();

  const Icon = isConnected ? CloudOff : WifiOff;
  const resolvedHeading =
    heading ??
    (isConnected ? t('common.loadFailed') : t('app.offline'));
  const resolvedSubtitle =
    subtitle ??
    (isConnected
      ? t('common.checkConnection')
      : t('common.willAutoRetry'));

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <Icon
        size={compact ? 40 : 56}
        color={COLORS.gray400}
        strokeWidth={1.5}
      />
      <Text style={[styles.heading, compact && styles.headingCompact]}>
        {resolvedHeading}
      </Text>
      <Text style={styles.subtitle}>{resolvedSubtitle}</Text>

      {onRetry ? (
        <Pressable
          onPress={onRetry}
          disabled={retrying}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            retrying && styles.ctaDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <RotateCw size={16} color={COLORS.white} strokeWidth={2} />
          <Text style={styles.ctaLabel}>{t('common.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  // Tighter padding for inline use inside a FlatList empty slot — keeps
  // the error surface from pushing other content way down.
  containerCompact: {
    paddingVertical: 32,
  },
  heading: {
    marginTop: 14,
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  headingCompact: {
    fontSize: 15,
    marginTop: 10,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.piktag500,
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  ctaPressed: {
    opacity: 0.8,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
