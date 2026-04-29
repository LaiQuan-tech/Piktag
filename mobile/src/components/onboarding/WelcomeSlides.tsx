/**
 * WelcomeSlides
 *
 * Three-slide concept carousel shown at the very start of OnboardingScreen,
 * before any data collection. Each slide maps to one of PikTag's three
 * core product missions (the same three that anchor every product
 * decision in this codebase):
 *
 *   1. Define yourself — tags as identity
 *   2. Activate your network — old connections become reachable
 *   3. Right people find each other — search by need, not name
 *
 * The carousel is intentionally short (3 slides, no skip per slide) and
 * the copy avoids feature-list explanations in favor of action-oriented
 * one-liners. New users finish in ~15 seconds; sophisticated users can
 * tap through in 3.
 *
 * Persistence is handled by the parent (OnboardingScreen) via the same
 * `piktag_onboarding_completed_v1` AsyncStorage flag — completing the
 * slides alone doesn't mark onboarding done; the user still has to
 * fill in the existing bio/tags/socials flow afterward.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  FlatList,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Tag, Heart, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SlideKey = 'identity' | 'activate' | 'discover';

const SLIDES: { key: SlideKey; Icon: typeof Tag }[] = [
  { key: 'identity', Icon: Tag },
  { key: 'activate', Icon: Heart },
  { key: 'discover', Icon: Search },
];

type Props = {
  /** Called when the user taps "Get Started" on the last slide. */
  onComplete: () => void;
};

export default function WelcomeSlides({ onComplete }: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (newIndex !== index) setIndex(newIndex);
  };

  const handleNext = () => {
    if (index < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: index + 1, animated: true });
      setIndex(index + 1);
    } else {
      onComplete();
    }
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => {
          const { Icon, key } = item;
          return (
            <View style={styles.slide}>
              {/* Brand gradient circle wrapping the icon. Same gradient
                  stops as the avatar ring across the app, so the
                  onboarding visual register matches the live UI the
                  user is about to land in. */}
              <LinearGradient
                colors={['#ff5757', '#c44dff', '#8c52ff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconCircle}
              >
                <Icon size={56} color="#FFFFFF" strokeWidth={2.2} />
              </LinearGradient>
              <Text style={styles.title}>
                {t(`auth.onboarding.welcome.${key}Title`)}
              </Text>
              <Text style={styles.description}>
                {t(`auth.onboarding.welcome.${key}Desc`)}
              </Text>
            </View>
          );
        }}
      />

      {/* Page dots — current dot is wider + gradient-tinted. Position
          slightly above the button for breathing room without crowding
          the safe-area on tall iPhones. */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      {/* CTA — text label flips to "開始使用" on the last slide so the
          tap feels like committing to the data-collection flow rather
          than just paginating. */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          onPress={handleNext}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <LinearGradient
            colors={isLast ? ['#ff5757', '#c44dff', '#8c52ff'] : [COLORS.piktag500, COLORS.piktag500]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.ctaButton}
          >
            <Text style={styles.ctaText}>
              {isLast
                ? t('auth.onboarding.welcome.getStarted')
                : t('auth.onboarding.welcome.next')}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    // Vertical breathing room so the dots/CTA below don't feel cramped
    // even on small devices (SE3 height ~568).
    paddingBottom: 120,
  },
  iconCircle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    shadowColor: '#8c52ff',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: 0.2,
  },
  description: {
    fontSize: 16,
    color: COLORS.gray600,
    textAlign: 'center',
    lineHeight: 24,
  },
  dotsRow: {
    position: 'absolute',
    bottom: 110,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.gray200,
  },
  dotActive: {
    width: 24,
    backgroundColor: COLORS.piktag500,
  },
  ctaRow: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
  },
  ctaButton: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});
