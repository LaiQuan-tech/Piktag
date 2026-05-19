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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, Mail, Calendar, MapPin } from 'lucide-react-native';
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

  const infoRows: { icon: React.ReactNode; value: string }[] = [];
  if (existing.phone_normalized)
    infoRows.push({
      icon: <Phone size={18} color={COLORS.gray400} />,
      value: existing.phone_normalized,
    });
  if (existing.email_lower)
    infoRows.push({
      icon: <Mail size={18} color={COLORS.gray400} />,
      value: existing.email_lower,
    });
  if (existing.birthday)
    infoRows.push({
      icon: <Calendar size={18} color={COLORS.gray400} />,
      value: existing.birthday,
    });
  if (existing.met_location)
    infoRows.push({
      icon: <MapPin size={18} color={COLORS.gray400} />,
      value: existing.met_location,
    });

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
        {/* Identity — shared component, READ mode (no onChange →
            rendered as Text). Same block a member friend gets. */}
        <ProfileIdentityHeader
          name={existing.name}
          headline={existing.headline ?? undefined}
          subtitle={t('connections.notJoinedBadge', {
            defaultValue: '尚未加入 PikTag',
          })}
          avatarUrl={existing.avatar_url}
        />

        {infoRows.length > 0 && (
          <View style={styles.infoCard}>
            {infoRows.map((r, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.infoDivider} />}
                <View style={styles.infoRow}>
                  {r.icon}
                  <Text style={styles.infoValue}>{r.value}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {existing.tags.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>
              {t('localContact.fieldTags', {
                defaultValue: '標籤（只有你看得到）',
              })}
            </Text>
            <View style={styles.tagWrap}>
              {existing.tags.map((tg) => (
                // Shared TagChip, read-only: toggle variant + selected
                // = purple pill, no ×, not pressable (no onPress).
                <TagChip key={tg} label={tg} variant="toggle" selected />
              ))}
            </View>
          </>
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
  // Section caption — mirrors EditLocalContact / FriendDetail
  // sectionTitle tokens (one visual language across the pair).
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 10,
  },
  infoCard: {
    backgroundColor: COLORS.gray50,
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  infoValue: { flex: 1, fontSize: 15, color: COLORS.gray900 },
  infoDivider: { height: 1, backgroundColor: COLORS.gray100 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
