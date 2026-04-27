import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNetInfo } from '../hooks/useNetInfo';

export default function OfflineBanner(): React.ReactElement | null {
  const { isConnected } = useNetInfo();
  const { t } = useTranslation();
  if (isConnected) return null;
  return (
    <View style={styles.bar} pointerEvents="none">
      <Text style={styles.text}>{t('app.offline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#dc2626',
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
