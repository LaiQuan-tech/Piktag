import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { COLORS } from '../../constants/theme';
import LogoLoader from './LogoLoader';

/**
 * Drop-in replacement for the bare `<ActivityIndicator size="large" />`
 * pattern that was used as a generic page-loading state. Renders the
 * logo loader centred in its parent with optional heading + subtitle
 * underneath.
 *
 * Usage:
 *   if (loading) return <PageLoader heading={t('foo.loading')} />;
 *
 * The flex:1 wrapper ensures it fills the available space, so the
 * caller doesn't need to worry about additional centring scaffolding.
 */

export type PageLoaderProps = {
  /** Primary line of context (e.g. "Loading your connections…"). */
  heading?: string;
  /** Secondary line of context (e.g. "This usually takes a second."). */
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
};

function PageLoaderImpl({ heading, subtitle, style }: PageLoaderProps) {
  return (
    <View style={[styles.container, style]}>
      <LogoLoader size={64} />
      {heading ? <Text style={styles.heading}>{heading}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const PageLoader = React.memo(PageLoaderImpl);
PageLoader.displayName = 'PageLoader';

export default PageLoader;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  heading: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
    marginTop: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 6,
    textAlign: 'center',
  },
});
