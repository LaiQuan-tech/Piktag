import React from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants/theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function TermsOfServiceScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><ArrowLeft size={24} color={COLORS.gray900} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('termsOfService.headerTitle')}</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.updated}>{t('termsOfService.lastUpdated')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section1Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section1Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section2Title')}</Text>
        <Text style={styles.li}>{t('termsOfService.section2Bullet1')}</Text>
        <Text style={styles.li}>{t('termsOfService.section2Bullet2')}</Text>
        <Text style={styles.li}>{t('termsOfService.section2Bullet3')}</Text>
        <Text style={styles.li}>{t('termsOfService.section2Bullet4')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section3Title')}</Text>
        <Text style={styles.li}>{t('termsOfService.section3Bullet1')}</Text>
        <Text style={styles.li}>{t('termsOfService.section3Bullet2')}</Text>
        <Text style={styles.li}>{t('termsOfService.section3Bullet3')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section4Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section4Intro')}</Text>
        <Text style={styles.li}>{t('termsOfService.section4Bullet1')}</Text>
        <Text style={styles.li}>{t('termsOfService.section4Bullet2')}</Text>
        <Text style={styles.li}>{t('termsOfService.section4Bullet3')}</Text>
        <Text style={styles.li}>{t('termsOfService.section4Bullet4')}</Text>
        <Text style={styles.li}>{t('termsOfService.section4Bullet5')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section5Title')}</Text>
        <Text style={styles.li}>{t('termsOfService.section5Bullet1')}</Text>
        <Text style={styles.li}>{t('termsOfService.section5Bullet2')}</Text>
        <Text style={styles.li}>{t('termsOfService.section5Bullet3')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section6Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section6Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section7Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section7Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section8Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section8Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section9Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section9Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section10Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section10Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section11Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section11Body')}</Text>

        <Text style={styles.h2}>{t('termsOfService.section12Title')}</Text>
        <Text style={styles.p}>{t('termsOfService.section12Body')}</Text>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: COLORS.gray900, textAlign: 'center', marginHorizontal: 12 },
  content: { paddingHorizontal: 20, paddingTop: 20 },
  updated: { fontSize: 13, color: COLORS.gray400, marginBottom: 20 },
  h2: { fontSize: 16, fontWeight: '700', color: COLORS.gray900, marginTop: 20, marginBottom: 8 },
  p: { fontSize: 14, color: COLORS.gray700, lineHeight: 22, marginBottom: 8 },
  li: { fontSize: 14, color: COLORS.gray700, lineHeight: 22, paddingLeft: 8, marginBottom: 4 },
});
