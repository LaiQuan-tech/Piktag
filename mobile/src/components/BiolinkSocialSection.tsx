import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import PlatformIcon from './PlatformIcon';
import { useTheme } from '../context/ThemeContext';
import { type ColorPalette } from '../constants/theme';
import { getPlatformLabel } from '../lib/platforms';
import type { Biolink } from '../types';

/**
 * Shared social-biolink section for ProfileScreen / FriendDetailScreen /
 * UserDetailScreen. (LocalContactDetail doesn't render biolinks — local
 * contacts use phone/email cards instead — so it's intentionally not
 * a caller of this component.)
 *
 * Why this exists (CLAUDE.md task #38). Before this component, three
 * near-identical copies of the icon-row + card-section JSX lived
 * inline in three screens. Every drift caught by the founder over
 * the last week — centering inconsistency (2026-05-31), label
 * fallback drift, icon-size drift, scroll-overflow clipping — was
 * the same root cause: parallel maintenance of effectively-shared
 * UI. Per the project's "Shared UI = ONE shared component, never
 * per-screen style copies" rule, the structural fix is to centralize
 * the JSX + behavior here so the next "edit one screen, forget the
 * other two" defect can't physically happen.
 *
 * The two visual variants are NOT a rejection of unification — they
 * preserve the deliberate design distinction the screens already had:
 *   - `compact` (own profile): 48px circles, no ring, fill-bg cards.
 *     Spartan, utilitarian — it's your own data, you don't need to
 *     be sold on each platform.
 *   - `highlight` (other people, "IG Highlights style"): 60px ring +
 *     52px inner circle, gray100-bg cards. Showcases each platform
 *     for discovery.
 * The behavior (filter by display_mode, horizontal-scroll-when-
 * overflow, center-when-fits, localized label fallback, dark-mode
 * aware) is shared. The visual envelope is parameterized.
 */
export type BiolinkSocialVariant = 'compact' | 'highlight';

type Props = {
  biolinks: Biolink[];
  /** Called with the full Biolink object so callers can do their own
   *  tracking (e.g. FriendDetail logs a biolink_click event keyed on
   *  link.id; ProfileScreen just opens the URL). */
  onPress: (biolink: Biolink) => void;
  variant?: BiolinkSocialVariant;
};

export default function BiolinkSocialSection({
  biolinks,
  onPress,
  variant = 'highlight',
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => makeStyles(colors, variant), [colors, variant]);

  const iconLinks = biolinks.filter(
    (bl) => bl.display_mode === 'icon' || bl.display_mode === 'both',
  );
  const cardLinks = biolinks.filter(
    (bl) => bl.display_mode === 'card' || bl.display_mode === 'both',
  );

  if (iconLinks.length === 0 && cardLinks.length === 0) return null;

  const iconSize = variant === 'compact' ? 22 : 28;
  const cardIconSize = variant === 'compact' ? 24 : 22;

  return (
    <>
      {iconLinks.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.iconRowScroll}
          contentContainerStyle={styles.iconRowContent}
        >
          {iconLinks.map((bl) => (
            <TouchableOpacity
              key={bl.id}
              style={styles.iconItem}
              activeOpacity={0.7}
              onPress={() => onPress(bl)}
              accessibilityLabel={bl.label || bl.platform}
              accessibilityRole="link"
            >
              {variant === 'highlight' ? (
                <View style={styles.iconRing}>
                  <View style={styles.iconInner}>
                    <PlatformIcon
                      platform={bl.platform}
                      size={iconSize}
                      iconUrl={bl.icon_url}
                      url={bl.url}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.iconInner}>
                  <PlatformIcon
                    platform={bl.platform}
                    size={iconSize}
                    iconUrl={bl.icon_url}
                    url={bl.url}
                  />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {cardLinks.length > 0 && (
        <View style={styles.cardSection}>
          {cardLinks.map((bl) => (
            <TouchableOpacity
              key={bl.id}
              style={styles.linkCard}
              activeOpacity={0.7}
              onPress={() => onPress(bl)}
              accessibilityLabel={bl.label || bl.platform}
              accessibilityRole="link"
            >
              <View style={styles.linkCardIcon}>
                <PlatformIcon
                  platform={bl.platform}
                  size={cardIconSize}
                  iconUrl={bl.icon_url}
                  url={bl.url}
                />
              </View>
              <Text style={styles.linkCardLabel} numberOfLines={1}>
                {/* Locale-derive for branded platforms (mirrors the
                    save-side rule in EditProfileScreen.handleSaveBiolink).
                    `bl.label` was persisted with whatever locale's
                    getPlatformLabel was active at save time — a phone
                    saved on a zh-TW device stores "電話", and a later
                    en viewer would see Chinese verbatim if we trusted
                    that label. Only `custom` (the user-named "Link"
                    entry) keeps the stored label, since that label IS
                    the whole point (e.g. "PikTag" pointing at pikt.ag).
                    Founder caught the EN-viewer regression 2026-06-03;
                    the 2026-05-31 partial fix here used `bl.label ||
                    derived` which only helped when label was null. */}
                {bl.platform === 'custom'
                  ? (bl.label || getPlatformLabel(bl.platform, t))
                  : getPlatformLabel(bl.platform, t)}
              </Text>
              <ExternalLink size={variant === 'compact' ? 14 : 16} color={colors.gray400} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );
}

function makeStyles(c: ColorPalette, variant: BiolinkSocialVariant) {
  const isCompact = variant === 'compact';
  return StyleSheet.create({
    // Outer ScrollView owns the borderTop so the divider spans the
    // full screen width even when content scrolls. Inner content
    // owns layout with flexGrow + justifyContent: 'center' — short
    // lists center, long lists auto-align start and scroll.
    iconRowScroll: {
      borderTopWidth: 1,
      borderTopColor: c.gray100,
    },
    iconRowContent: {
      flexGrow: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 16,
      paddingHorizontal: 20,
    },
    iconItem: {
      alignItems: 'center',
      width: isCompact ? undefined : 68,
    },
    // 'highlight' variant only — the outer 60px ring that gives the
    // IG-Highlights look on other-people profiles.
    iconRing: {
      width: 60,
      height: 60,
      borderRadius: 30,
      borderWidth: 2,
      borderColor: c.gray200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconInner: {
      width: isCompact ? 48 : 52,
      height: isCompact ? 48 : 52,
      borderRadius: isCompact ? 24 : 26,
      backgroundColor: c.fill,
      borderWidth: isCompact ? 1.5 : 0,
      borderColor: c.gray200,
      alignItems: 'center',
      justifyContent: 'center',
    },

    cardSection: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 16,
      borderTopWidth: isCompact ? 1 : 0,
      borderTopColor: c.gray100,
      gap: isCompact ? 8 : 10,
    },
    linkCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isCompact ? c.fill : c.gray100,
      borderWidth: 1.5,
      borderColor: c.gray200,
      borderRadius: isCompact ? 14 : 16,
      paddingVertical: isCompact ? 14 : 16,
      paddingHorizontal: isCompact ? 16 : 18,
      gap: 12,
    },
    linkCardIcon: {
      width: isCompact ? 40 : undefined,
      height: isCompact ? 40 : undefined,
      borderRadius: isCompact ? 12 : 0,
      backgroundColor: isCompact ? c.fill : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkCardLabel: {
      flex: 1,
      fontSize: isCompact ? 15 : 16,
      fontWeight: '600',
      color: c.gray900,
    },
  });
}
