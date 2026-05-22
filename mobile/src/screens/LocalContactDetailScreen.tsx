// LocalContactDetailScreen.tsx
//
// READ-ONLY profile view for a not-yet-on-PikTag local contact —
// the contact analog of FriendDetailScreen (a member friend's
// profile). Same identity language (shared <ProfileIdentityHeader>,
// shared <TagChip>) so a contact reads exactly like a member friend,
// MINUS the member-only action row (追蹤/訊息/標籤/推薦). Editing is
// a separate screen reached via the top-right 編輯 (mirrors the
// FriendDetail[view] ↔ EditProfile[edit] split the app already uses).
//
// Nav: ConnectionsScreen taps a local-contact row → here. 編輯 →
// EditLocalContactScreen (the form). Refetches on focus so an edit
// is reflected on return.

import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  StyleSheet,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, Mail, MapPin, Gift, ExternalLink } from 'lucide-react-native';
import { toBirthdayDate } from '../lib/birthday';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import ProfileIdentityHeader from '../components/ProfileIdentityHeader';
import TagChip from '../components/TagChip';
import BrandSpinner from '../components/loaders/BrandSpinner';

type Props = { navigation: any; route: any };

export default function LocalContactDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const contactId: string | undefined = route.params?.contactId;
  const { contacts, loading, refresh } = useLocalContacts();

  // Refetch every focus so returning from the 編輯 form shows the
  // updated data (EditLocalContact holds its own useLocalContacts
  // instance — no shared cache).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const existing = useMemo(
    () => contacts.find((c) => c.id === contactId) ?? null,
    [contacts, contactId],
  );

  // Same settle logic as EditLocalContactScreen: never flash
  // "not found" before the first fetch resolves.
  const fetchStartedRef = useRef(false);
  if (loading) fetchStartedRef.current = true;
  const settledMissing = !existing && !loading && fetchStartedRef.current;

  const goEdit = useCallback(() => {
    if (contactId) navigation.navigate('EditLocalContact', { contactId });
  }, [navigation, contactId]);

  const Header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigation.navigate('Connections')
        }
        style={styles.headerBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.back', { defaultValue: '返回' })}
      >
        <ArrowLeft size={24} color={colors.gray900} strokeWidth={2.2} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {existing?.name ?? t('localContact.editTitle', { defaultValue: '聯絡人' })}
      </Text>
      {existing ? (
        <TouchableOpacity
          onPress={goEdit}
          style={styles.editBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.edit', { defaultValue: '編輯' })}
        >
          <Text style={styles.editBtnText}>
            {t('common.edit', { defaultValue: '編輯' })}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerBtn} />
      )}
    </View>
  );

  if (!existing) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top']}
      >
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={colors.white}
        />
        {Header}
        <View style={styles.gateCenter}>
          {settledMissing ? (
            <Text style={styles.gateMsg}>
              {t('localContact.notFound', {
                defaultValue: '找不到這個聯絡人 —— 可能已接上 PikTag 或被刪除。',
              })}
            </Text>
          ) : (
            <BrandSpinner size={32} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // Birthday → "M/D" (year-agnostic) — mirrors FriendDetail's
  // inline formatReminderDate so the contact recordCard reads
  // identically to a member's birthday card.
  const birthdayDisplay = (() => {
    if (!existing.birthday) return '';
    const iso = toBirthdayDate(existing.birthday);
    if (iso) {
      const [, mm, dd] = iso.split('-');
      return `${parseInt(mm, 10)}/${parseInt(dd, 10)}`;
    }
    return existing.birthday;
  })();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.white}
      />
      {Header}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Order mirrors FriendDetailScreen's vertical layout, minus
            the member-only bits (action button row, mutuals/follower
            stats, similar-members section):
              avatar+name → 職稱 → 標籤 → 聯絡方式 icons.
            Identity = shared ProfileIdentityHeader in READ mode. */}
        <ProfileIdentityHeader
          name={existing.name}
          headline={existing.headline ?? undefined}
          subtitle={t('connections.notJoinedBadge', {
            defaultValue: '尚未加入 PikTag',
          })}
          avatarUrl={existing.avatar_url}
        />

        {existing.tags.length > 0 && (
          <View style={styles.tagWrap}>
            {existing.tags.map((tg) => (
              // Shared TagChip, read-only: toggle variant + NOT
              // selected = gray pill, no ×, not pressable. Profile
              // pages (this + FriendDetail) render ALL chips gray
              // by design — purple is reserved for tag-edit CTAs.
              // Briefly turned purple by the 2026-05-23 sweep then
              // reverted same day after the founder caught the
              // regression on FriendDetail.
              <TagChip key={tg} label={tg} variant="toggle" />
            ))}
          </View>
        )}

        {/* Contact methods → FriendDetail's linkCard pattern
            (rectangular, gray200 border, icon + label + ExternalLink
            arrow). Tap = tel: / mailto:. Mirrors what a member friend
            with biolinks looks like, 1:1. */}
        {(existing.phone_normalized || existing.email_lower || existing.address) && (
          <View style={styles.linkBioSection}>
            {existing.phone_normalized && (
              <TouchableOpacity
                style={styles.linkCard}
                activeOpacity={0.7}
                onPress={() =>
                  Linking.openURL(`tel:${existing.phone_normalized}`).catch(
                    () => {},
                  )
                }
                accessibilityLabel={existing.phone_normalized}
                accessibilityRole="link"
              >
                <Phone size={22} color={colors.gray900} strokeWidth={2.2} />
                <Text style={styles.linkCardText} numberOfLines={1}>
                  {t('localContact.linkPhone', { defaultValue: '電話' })}
                </Text>
                <ExternalLink size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}
            {existing.email_lower && (
              <TouchableOpacity
                style={styles.linkCard}
                activeOpacity={0.7}
                onPress={() =>
                  Linking.openURL(`mailto:${existing.email_lower}`).catch(
                    () => {},
                  )
                }
                accessibilityLabel={existing.email_lower}
                accessibilityRole="link"
              >
                <Mail size={22} color={colors.gray900} strokeWidth={2.2} />
                <Text style={styles.linkCardText} numberOfLines={1}>
                  {t('localContact.linkEmail', { defaultValue: 'Email' })}
                </Text>
                <ExternalLink size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}
            {existing.address && (
              <TouchableOpacity
                style={styles.linkCard}
                activeOpacity={0.7}
                onPress={() =>
                  Linking.openURL(
                    // Cross-platform Maps deep link — opens Apple Maps
                    // on iOS, Google Maps app on Android, falls back to
                    // browser web map elsewhere.
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(existing.address!)}`,
                  ).catch(() => {})
                }
                accessibilityLabel={existing.address}
                accessibilityRole="link"
              >
                <MapPin size={22} color={colors.gray900} strokeWidth={2.2} />
                <Text style={styles.linkCardText} numberOfLines={1}>
                  {t('localContact.linkAddress', { defaultValue: '地址' })}
                </Text>
                <ExternalLink size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Birthday → FriendDetail's recordCard pattern (filled bg,
            pink Gift icon, label + value). Static row, not tappable. */}
        {birthdayDisplay && (
          <View style={styles.recordCard}>
            <View style={styles.reminderRow}>
              <Gift size={16} color={colors.pink500} />
              <Text style={styles.recordLabel}>
                {t('friendDetail.reminderBirthday', { defaultValue: '生日' })}
              </Text>
              <Text style={styles.recordValue}>{birthdayDisplay}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
  },
  headerBtn: {
    width: 52,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: c.gray900,
  },
  editBtn: {
    width: 52,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 16, fontWeight: '600', color: c.piktag600 },
  gateCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  gateMsg: {
    fontSize: 14,
    color: c.gray500,
    textAlign: 'center',
    lineHeight: 21,
  },
  scroll: { padding: 20, paddingBottom: 48 },
  // Tags row immediately under the identity block — same place
  // FriendDetail puts them (after headline/bio, before everything
  // else). No section title above; the chips speak for themselves.
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  // ── Contact methods → FriendDetail's linkCard pattern (the
  // labeled rectangular card used for a member's biolinks). Tokens
  // mirror FriendDetailScreen.linkBioSection/linkCard/linkCardText
  // 1:1 so the two surfaces are visually indistinguishable. The
  // earlier circle-icon version was the WRONG biolink treatment
  // (that's the icon-only row for display_mode='icon'; the card row
  // is what's actually visible on a real friend profile). Extraction
  // into a shared <ContactLinkCard> is a flagged follow-up (same
  // outstanding debt as ProfileIdentityHeader ↔ FriendDetail).
  linkBioSection: {
    marginTop: 16,
    gap: 10,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.gray100,
    borderWidth: 1.5,
    borderColor: c.gray200,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 12,
  },
  linkCardText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: c.gray900,
  },
  // Birthday → FriendDetail's recordCard pattern.
  recordCard: {
    backgroundColor: c.gray50,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  recordLabel: {
    fontSize: 14,
    color: c.gray500,
    width: 70,
  },
  recordValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: c.gray900,
    lineHeight: 20,
  },
  });
}
