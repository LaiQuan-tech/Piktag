import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { COLORS } from '../../constants/theme';

type Props = {
  /**
   * Heading text. Caller should pick an i18n string appropriate for the
   * active tab / search state. Falls back to the generic "no messages
   * yet" line.
   */
  heading?: string;
  /**
   * Whether to render the "Discover people" CTA. Off for the
   * requests/general empty state (users can't directly go "get more
   * message requests") and for search-no-results.
   */
  showCta?: boolean;
  /**
   * Invoked when the user taps the CTA. Typically pops back to the
   * discover/search screen.
   */
  onCtaPress?: () => void;
};

const EmptyInbox = React.memo(
  ({ heading, showCta = true, onCtaPress }: Props) => {
    const { t } = useTranslation();
    const resolvedHeading = heading ?? t('chat.emptyHeading');

    return (
      <View style={styles.container}>
        <MessageCircle
          size={64}
          color={COLORS.gray300}
          strokeWidth={1.5}
        />
        <Text style={styles.heading}>{resolvedHeading}</Text>
        <Text style={styles.subtitle}>{t('chat.emptySubtitle')}</Text>

        {showCta && onCtaPress ? (
          <Pressable
            onPress={onCtaPress}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaLabel}>{t('chat.emptyCta')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  },
);

EmptyInbox.displayName = 'EmptyInbox';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  heading: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    marginTop: 20,
    backgroundColor: COLORS.piktag500,
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  ctaPressed: {
    opacity: 0.8,
  },
  ctaLabel: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '600',
  },
});

export default EmptyInbox;
