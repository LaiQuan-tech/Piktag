// QuickStartTour
//
// Step 3 of OnboardingScreen used to be a vanity "you're all set" card —
// no actionable info, just a checkmark. We replace it with the same step
// rendering 4 lucide-icon-and-copy cards that teach the user the four
// actions that matter most on day one:
//
//   1. 加朋友          — QR / contact sync / username search
//   2. 幫朋友加標籤    — the tagging CRM core
//   3. 用標籤找人      — the tag-based discovery loop
//   4. 發 Ask 求助     — broadcast a question to your network
//
// The CTA button at the bottom of OnboardingScreen ("開始使用 PikTag",
// see line 470 enterPikTag label) drives `goNext()` → `handleComplete()`,
// which writes the AsyncStorage onboarding flag and triggers the burst.
// This component is purely presentational — no callbacks, no state.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Users, Tag, Search, MessageCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

type CardProps = {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  body: string;
};

function Card({ Icon, title, body }: CardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIconWrap}>
        <Icon size={28} color={COLORS.piktag600} strokeWidth={2} />
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
      </View>
    </View>
  );
}

export default function QuickStartTour() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>
        {t('auth.onboarding.quickStart.title') || '開始使用 PikTag'}
      </Text>
      <Text style={styles.subheading}>
        {t('auth.onboarding.quickStart.subtitle') || '這 4 件事讓你最快上手'}
      </Text>

      <View style={styles.cardList}>
        <Card
          Icon={Users}
          title={t('auth.onboarding.quickStart.card1.title') || '加朋友'}
          body={
            t('auth.onboarding.quickStart.card1.body') ||
            '用 QR 掃描、同步通訊錄，或搜 username 找朋友'
          }
        />
        <Card
          Icon={Tag}
          title={t('auth.onboarding.quickStart.card2.title') || '幫朋友加標籤'}
          body={
            t('auth.onboarding.quickStart.card2.body') ||
            '例如「咖啡控」「北美業務」「客戶」，之後用標籤找人'
          }
        />
        <Card
          Icon={Search}
          title={t('auth.onboarding.quickStart.card3.title') || '用標籤找人'}
          body={
            t('auth.onboarding.quickStart.card3.body') ||
            '在搜尋頁輸入標籤名稱，看誰跟你有相同興趣'
          }
        />
        <Card
          Icon={MessageCircle}
          title={t('auth.onboarding.quickStart.card4.title') || '發 Ask 求助'}
          body={
            t('auth.onboarding.quickStart.card4.body') ||
            '一句話，全網絡來幫你'
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: SPACING.lg,
    paddingBottom: 80,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
    marginBottom: SPACING.xxl,
  },
  cardList: {
    gap: SPACING.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 18,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: BORDER_RADIUS.lg,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray900,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 14,
    color: COLORS.gray500,
    lineHeight: 20,
  },
});
