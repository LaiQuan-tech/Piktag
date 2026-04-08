import React from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { COLORS } from '../../constants/theme';

type Props = { navigation: any };

export default function TermsOfServiceScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><ArrowLeft size={24} color={COLORS.gray900} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.updated}>Last updated: March 30, 2026</Text>

        <Text style={styles.h2}>1. Acceptance</Text>
        <Text style={styles.p}>By using PikTag, you agree to these Terms of Service. If you do not agree, do not use the app.</Text>

        <Text style={styles.h2}>2. Account</Text>
        <Text style={styles.li}>• You must be at least 13 years old to use PikTag</Text>
        <Text style={styles.li}>• You are responsible for maintaining the security of your account</Text>
        <Text style={styles.li}>• One person, one account. Do not create fake or duplicate accounts</Text>
        <Text style={styles.li}>• You may deactivate or delete your account at any time</Text>

        <Text style={styles.h2}>3. User Content</Text>
        <Text style={styles.li}>• You own the content you create (bio, tags, links, notes)</Text>
        <Text style={styles.li}>• You grant #piktag a license to display your public content to other users</Text>
        <Text style={styles.li}>• You must not post content that is illegal, harmful, or violates others' rights</Text>

        <Text style={styles.h2}>4. Acceptable Use</Text>
        <Text style={styles.p}>You agree NOT to:</Text>
        <Text style={styles.li}>• Harass, bully, or threaten other users</Text>
        <Text style={styles.li}>• Create fake profiles or impersonate others</Text>
        <Text style={styles.li}>• Use #piktag for spam, phishing, or fraud</Text>
        <Text style={styles.li}>• Scrape or collect user data without consent</Text>
        <Text style={styles.li}>• Attempt to reverse engineer or exploit the app</Text>

        <Text style={styles.h2}>5. QR Codes & Tags</Text>
        <Text style={styles.li}>• QR codes you generate are associated with your account</Text>
        <Text style={styles.li}>• Hidden tags attached via QR code are private and visible only to you</Text>
        <Text style={styles.li}>• Batch tag modification may require a paid subscription in the future</Text>

        <Text style={styles.h2}>6. Premium Features</Text>
        <Text style={styles.p}>Some features (pinned tags, batch tag management) may require a paid subscription. Pricing will be announced separately.</Text>

        <Text style={styles.h2}>7. Termination</Text>
        <Text style={styles.p}>We may suspend or terminate accounts that violate these terms. You may appeal by contacting support@pikt.ag.</Text>

        <Text style={styles.h2}>8. Disclaimer</Text>
        <Text style={styles.p}>PikTag is provided "as is" without warranty. We are not responsible for user-generated content or interactions between users.</Text>

        <Text style={styles.h2}>9. Limitation of Liability</Text>
        <Text style={styles.p}>PikTag Inc. shall not be liable for indirect, incidental, or consequential damages arising from your use of the service.</Text>

        <Text style={styles.h2}>10. Governing Law</Text>
        <Text style={styles.p}>These terms are governed by the laws of the Republic of China (Taiwan).</Text>

        <Text style={styles.h2}>11. Contact</Text>
        <Text style={styles.p}>PikTag Inc.{'\n'}Email: support@pikt.ag</Text>

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
