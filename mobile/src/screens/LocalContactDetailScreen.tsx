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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, Mail, Calendar } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useLocalContacts } from '../hooks/useLocalContacts';
import ProfileIdentityHeader from '../components/ProfileIdentityHeader';
import TagChip from '../components/TagChip';
import BrandSpinner from '../components/loaders/BrandSpinner';

type Props = { navigation: any; route: any };

export default function LocalContactDetailScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
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
        <ArrowLeft size={24} color={COLORS.gray900} strokeWidth={2.2} />
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

  // Contact methods rendered as FriendDetail-style ringed-circle
  // icons in a horizontal row (the contact analog of a member's
  // social biolinks). Tappable where actionable: Phone → tel:,
  // Email → mailto:. Birthday is display-only → tap reveals the
  // value (icon alone won't tell you the date).
  const contactItems: {
    key: string;
    icon: React.ReactNode;
    onPress: () => void;
    label: string;
  }[] = [];
  if (existing.phone_normalized) {
    const v = existing.phone_normalized;
    contactItems.push({
      key: 'phone',
      icon: <Phone size={26} color={COLORS.gray700} />,
      onPress: () => Linking.openURL(`tel:${v}`).catch(() => {}),
      label: v,
    });
  }
  if (existing.email_lower) {
    const v = existing.email_lower;
    contactItems.push({
      key: 'email',
      icon: <Mail size={26} color={COLORS.gray700} />,
      onPress: () => Linking.openURL(`mailto:${v}`).catch(() => {}),
      label: v,
    });
  }
  if (existing.birthday) {
    const v = existing.birthday;
    contactItems.push({
      key: 'birthday',
      icon: <Calendar size={26} color={COLORS.gray700} />,
      onPress: () =>
        Alert.alert(
          t('localContact.fieldBirthday', { defaultValue: '生日' }),
          v,
        ),
      label: v,
    });
  }

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
              // Shared TagChip, read-only: toggle variant + NOT selected
              // = gray pill, no ×, not pressable. Detail/view screens
              // intentionally render ALL chips gray — purple is reserved
              // for the screen's primary CTA (matches the friend page
              // design contract; founder, definitive).
              <TagChip key={tg} label={tg} variant="toggle" />
            ))}
          </View>
        )}

        {contactItems.length > 0 && (
          <View style={styles.socialSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.socialScrollContent}
            >
              {contactItems.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={styles.socialCircleItem}
                  onPress={c.onPress}
                  activeOpacity={0.7}
                  accessibilityLabel={c.label}
                  accessibilityRole="button"
                >
                  <View style={styles.socialCircleRing}>
                    <View style={styles.socialCircleInner}>{c.icon}</View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
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
    color: COLORS.gray900,
  },
  editBtn: {
    width: 52,
    height: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 16, fontWeight: '600', color: COLORS.piktag600 },
  gateCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  gateMsg: {
    fontSize: 14,
    color: COLORS.gray500,
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
  // ── Contact methods as a FriendDetail-style ringed-circle icon
  // row (the contact analog of a member's social biolinks). Tokens
  // mirror FriendDetailScreen.socialSection/Scroll/CircleItem/Ring/
  // Inner 1:1 so the two surfaces feel like the same component
  // family. Extraction into a shared <CircleIconRow> is a flagged
  // follow-up (FriendDetail still hand-rolls its own copy of these
  // styles — same as the ProfileIdentityHeader debt).
  socialSection: {
    marginTop: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  socialScrollContent: {
    paddingHorizontal: 4,
    gap: 16,
  },
  socialCircleItem: {
    alignItems: 'center',
    width: 68,
  },
  socialCircleRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCircleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
