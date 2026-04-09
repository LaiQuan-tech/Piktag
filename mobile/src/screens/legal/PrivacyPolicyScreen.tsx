import React from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { COLORS } from '../../constants/theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = { navigation: NativeStackNavigationProp<any> };

export default function PrivacyPolicyScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><ArrowLeft size={24} color={COLORS.gray900} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.updated}>Last updated: March 30, 2026</Text>

        <Text style={styles.h2}>1. Information We Collect</Text>
        <Text style={styles.p}>PikTag Inc. ("we", "us") collects the following information when you use our app:</Text>
        <Text style={styles.li}>• Account information: email, phone number, name, username, profile photo</Text>
        <Text style={styles.li}>• Profile data: bio, tags, social links, biolinks</Text>
        <Text style={styles.li}>• Contacts: with your permission, we access your device contacts to help you find friends on PikTag</Text>
        <Text style={styles.li}>• Location: with your permission, approximate location for nearby features</Text>
        <Text style={styles.li}>• Usage data: interactions, QR scans, tag activity</Text>

        <Text style={styles.h2}>2. How We Use Your Information</Text>
        <Text style={styles.li}>• Provide and improve #piktag services</Text>
        <Text style={styles.li}>• Connect you with other users through tags and QR codes</Text>
        <Text style={styles.li}>• Send notifications about friend activity and reminders</Text>
        <Text style={styles.li}>• Generate AI-powered tag suggestions (using anonymized data)</Text>
        <Text style={styles.li}>• Ensure safety and prevent abuse</Text>

        <Text style={styles.h2}>3. Information Sharing</Text>
        <Text style={styles.p}>We do NOT sell your personal information. We share data only:</Text>
        <Text style={styles.li}>• With other #piktag users according to your privacy settings (public/friends/close friends/private)</Text>
        <Text style={styles.li}>• With service providers (Supabase for database, Google for AI features)</Text>
        <Text style={styles.li}>• When required by law</Text>

        <Text style={styles.h2}>4. Your Privacy Controls</Text>
        <Text style={styles.li}>• Each social link/contact has 4 visibility levels: Public, Friends, Close Friends, Only Me</Text>
        <Text style={styles.li}>• Tags can be set as public or private</Text>
        <Text style={styles.li}>• Hidden tags on connections are visible only to you</Text>
        <Text style={styles.li}>• You can block and report users at any time</Text>

        <Text style={styles.h2}>5. Data Retention</Text>
        <Text style={styles.p}>We retain your data while your account is active. You can deactivate or delete your account at any time from Settings. Upon deletion, we remove your data within 30 days.</Text>

        <Text style={styles.h2}>6. Security</Text>
        <Text style={styles.p}>We use industry-standard encryption and security measures. Data is stored on Supabase (PostgreSQL) with Row Level Security policies.</Text>

        <Text style={styles.h2}>7. Children</Text>
        <Text style={styles.p}>PikTag is not intended for users under 13. We do not knowingly collect data from children.</Text>

        <Text style={styles.h2}>8. Changes</Text>
        <Text style={styles.p}>We may update this policy. We will notify you of significant changes through the app.</Text>

        <Text style={styles.h2}>9. Contact</Text>
        <Text style={styles.p}>PikTag Inc.{'\n'}Email: privacy@pikt.ag</Text>

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
