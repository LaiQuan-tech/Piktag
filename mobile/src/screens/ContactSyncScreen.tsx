import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Platform,
  Share,
} from 'react-native';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { requestPermissionsAsync, getContactsAsync, Fields, SortTypes } from 'expo-contacts';
import {
  ArrowLeft,
  Users,
  UserPlus,
  Check,
  Search,
  Phone,
  Mail,
  Send,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

type ContactSyncScreenProps = {
  navigation: any;
};

type PhoneContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  imported: boolean;
};

export default function ContactSyncScreen({ navigation }: ContactSyncScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; matched: number } | null>(null);

  const loadContacts = useCallback(async () => {
    try {
      const { status } = await requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }

      const { data } = await getContactsAsync({
        fields: [
          Fields.Name,
          Fields.PhoneNumbers,
          Fields.Emails,
        ],
        sort: SortTypes.FirstName,
      });

      if (data && data.length > 0) {
        const mapped: PhoneContact[] = data
          .filter((c) => c.name)
          .map((c) => ({
            id: c.id || c.name || Math.random().toString(),
            name: c.name || 'Unknown',
            phone: c.phoneNumbers?.[0]?.number || null,
            email: c.emails?.[0]?.email || null,
            imported: false,
          }));
        setContacts(mapped);
      }
    } catch (err) {
      console.error('Error loading contacts:', err);
      // On web, expo-contacts is not supported
      if (Platform.OS === 'web') {
        setPermissionDenied(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const handleInvite = async (contact: PhoneContact) => {
    try {
      await Share.share({
        message: t('contactSync.inviteMessage', { name: contact.name }) ||
          `${contact.name}，我在用 PikTag，一起來交換標籤吧！下載：https://pikt.ag`,
      });
    } catch { /* cancelled */ }
  };

  // Server-side matching via the match_contacts_against_profiles RPC.
  //
  // Replaces the old client-side strategy that did:
  //   * .eq('phone', stripped_input) — broken because stored phone is
  //     E.164 ("+886...") while iOS contacts are local format ("0...")
  //   * username ILIKE email_prefix — false-positive prone substitute
  //     for a real email lookup
  //
  // The RPC normalizes phone to last-9-digits on both sides, exact-matches
  // email against auth.users.email (only reachable via SECURITY DEFINER),
  // and skips self / users who have blocked the viewer.
  //
  // Returns a Map keyed by the contact's id (NOT the input array index)
  // so callers can look up matches without juggling indices.
  const matchAgainstProfiles = useCallback(
    async (
      list: PhoneContact[],
    ): Promise<Map<string, { user_id: string; match_type: 'phone' | 'email' }>> => {
      const out = new Map<string, { user_id: string; match_type: 'phone' | 'email' }>();
      if (list.length === 0) return out;
      const phones = list.map((c) => c.phone ?? '');
      const emails = list.map((c) => c.email ?? '');
      const { data, error } = await supabase.rpc('match_contacts_against_profiles', {
        p_phones: phones,
        p_emails: emails,
      });
      if (error) {
        console.warn('[ContactSync] RPC error:', error.message);
        return out;
      }
      const rows = (data ?? []) as Array<{
        input_index: number;
        matched_user_id: string;
        match_type: 'phone' | 'email';
      }>;
      // RPC orders phone matches before email matches, so first-write-wins
      // gives phone priority when both happen to match the same contact.
      for (const row of rows) {
        const c = list[row.input_index];
        if (!c) continue;
        if (out.has(c.id)) continue;
        out.set(c.id, { user_id: row.matched_user_id, match_type: row.match_type });
      }
      return out;
    },
    [],
  );

  // After contacts load, hydrate `importedIds` from the server so contacts
  // who are ALREADY a piktag_connections row don't keep showing up as
  // "available to import" forever. Without this, deleting + reinstalling
  // the app (or just navigating away) wipes the local Set and the screen
  // re-prompts the user to import people they previously imported — even
  // people they later unfollowed/disconnected from.
  //
  // Runs the match RPC + an existing-connections query in parallel and
  // intersects: a contact is "already imported" iff its matched user id
  // is in the viewer's piktag_connections. Errors degrade gracefully —
  // the Set stays empty and the user sees the old behaviour, no crash.
  useEffect(() => {
    if (!user || contacts.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const [matches, connectionsRes] = await Promise.all([
          matchAgainstProfiles(contacts),
          supabase
            .from('piktag_connections')
            .select('connected_user_id')
            .eq('user_id', user.id),
        ]);
        if (cancelled) return;

        const existing = new Set<string>(
          ((connectionsRes.data ?? []) as Array<{ connected_user_id: string }>).map(
            (r) => r.connected_user_id,
          ),
        );
        const alreadyImported = new Set<string>();
        for (const c of contacts) {
          const m = matches.get(c.id);
          if (m && existing.has(m.user_id)) alreadyImported.add(c.id);
        }
        if (alreadyImported.size > 0) {
          setImportedIds((prev) => {
            const next = new Set(prev);
            for (const id of alreadyImported) next.add(id);
            return next;
          });
        }
      } catch (err) {
        console.warn('[ContactSync] hydrate importedIds failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, contacts, matchAgainstProfiles]);

  // Upsert a single piktag_connections row for a matched contact.
  // Returns true on success.
  const upsertConnection = async (
    contact: PhoneContact,
    matchedUserId: string,
  ): Promise<boolean> => {
    if (!user) return false;
    const { error } = await supabase.from('piktag_connections').upsert(
      {
        user_id: user.id,
        connected_user_id: matchedUserId,
        nickname: contact.name,
        note: contact.phone ? `電話: ${contact.phone}` : '',
      },
      { onConflict: 'user_id,connected_user_id' },
    );
    if (error) {
      console.warn('[ContactSync] upsert error:', error.message, error.code);
      return false;
    }
    return true;
  };

  // Individual '+' button: server match → if matched, upsert; if not, fall
  // back to invite sheet so the user can share PikTag with that contact.
  const handleImportContact = async (contact: PhoneContact) => {
    if (!user) return;
    setImportingIds((prev) => new Set(prev).add(contact.id));
    try {
      const matches = await matchAgainstProfiles([contact]);
      const m = matches.get(contact.id);
      if (m) {
        const ok = await upsertConnection(contact, m.user_id);
        if (ok) {
          setImportedIds((prev) => new Set(prev).add(contact.id));
        } else {
          handleInvite(contact);
        }
      } else {
        handleInvite(contact);
      }
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
    }
  };

  // '全部匯入': single-RPC server match for the whole pending set, then
  // upserts in parallel for everyone matched. Never opens share sheet
  // during processing. Inline progress + summary alert at end.
  const handleImportAll = async () => {
    if (!user || contacts.length === 0 || batchProgress) return;
    const pending = contacts.filter((c) => !importedIds.has(c.id));
    if (pending.length === 0) return;

    Alert.alert(
      t('contactSync.alertBatchImportTitle'),
      t('contactSync.alertBatchImportMessage', { count: pending.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contactSync.alertBatchImportConfirm'),
          onPress: async () => {
            setBatchProgress({ current: 0, total: pending.length, matched: 0 });

            // 1. Match all contacts against the server in one round-trip.
            const matches = await matchAgainstProfiles(pending);

            // 2. Upsert connections for matched contacts. Run in parallel
            //    in chunks of 10 so we don't pummel the API; tracks matched
            //    count for the progress UI.
            const newImported = new Set(importedIds);
            let matched = 0;
            const CHUNK = 10;
            const matchedContacts = pending.filter((c) => matches.has(c.id));
            for (let i = 0; i < matchedContacts.length; i += CHUNK) {
              const slice = matchedContacts.slice(i, i + CHUNK);
              const results = await Promise.all(
                slice.map((c) => upsertConnection(c, matches.get(c.id)!.user_id)),
              );
              for (let k = 0; k < slice.length; k++) {
                if (results[k]) {
                  matched++;
                  newImported.add(slice[k].id);
                }
              }
              setBatchProgress({
                current: Math.min(i + slice.length, matchedContacts.length),
                total: pending.length,
                matched,
              });
            }
            // Bump progress to 100% (covers the unmatched bulk too).
            setBatchProgress({ current: pending.length, total: pending.length, matched });

            setImportedIds(newImported);
            setBatchProgress(null);

            const inviteable = pending.length - matched;
            Alert.alert(
              t('contactSync.alertBatchDoneTitle') || '匯入完成',
              t('contactSync.alertBatchDoneMessage', {
                matched,
                notOnApp: inviteable,
              }) || `已加入 ${matched} 位 PikTag 朋友。剩下 ${inviteable} 位可邀請使用 PikTag。`,
            );
          },
        },
      ],
    );
  };

  const renderContact = ({ item }: { item: PhoneContact }) => {
    const isImporting = importingIds.has(item.id);
    const isImported = importedIds.has(item.id);
    const initials = item.name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return (
      <View style={styles.contactItem}>
        <View style={styles.contactAvatar}>
          <Text style={styles.contactInitials}>{initials}</Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.contactDetails}>
            {item.phone && (
              <View style={styles.contactDetailRow}>
                <Phone size={12} color={COLORS.gray400} />
                <Text style={styles.contactDetailText}>{item.phone}</Text>
              </View>
            )}
            {item.email && (
              <View style={styles.contactDetailRow}>
                <Mail size={12} color={COLORS.gray400} />
                <Text style={styles.contactDetailText} numberOfLines={1}>{item.email}</Text>
              </View>
            )}
          </View>
        </View>
        {isImported ? (
          <View style={styles.importedBadge}>
            <Check size={16} color={COLORS.piktag600} />
          </View>
        ) : isImporting ? (
          <BrandSpinner size={20} />
        ) : (
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => handleImportContact(item)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('contactSync.importBtn')}
          >
            <UserPlus size={18} color={COLORS.piktag600} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('contactSync.headerTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <PageLoader heading={t('contactSync.loadingText')} />
      ) : permissionDenied ? (
        <View style={styles.emptyContainer}>
          <Users size={48} color={COLORS.gray200} />
          <Text style={styles.emptyTitle}>{t('contactSync.permissionDeniedTitle')}</Text>
          <Text style={styles.emptyText}>
            {Platform.OS === 'web'
              ? t('contactSync.permissionDeniedWeb')
              : t('contactSync.permissionDeniedNative')}
          </Text>
        </View>
      ) : contacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Users size={48} color={COLORS.gray200} />
          <Text style={styles.emptyTitle}>{t('contactSync.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('contactSync.emptyText')}</Text>
        </View>
      ) : (
        <>
          {/* Import All button / progress */}
          <View style={styles.importAllBar}>
            <Text style={styles.contactCountText}>
              {batchProgress
                ? t('contactSync.batchProgress', {
                    current: batchProgress.current,
                    total: batchProgress.total,
                  }) || `處理中 ${batchProgress.current}/${batchProgress.total}`
                : t('contactSync.contactCount', { count: contacts.length })}
            </Text>
            {batchProgress ? (
              <View style={styles.importAllBtn}>
                <BrandSpinner size={20} />
              </View>
            ) : (
              <TouchableOpacity onPress={handleImportAll} activeOpacity={0.7}>
                <LinearGradient
                  colors={['#ff5757', '#c44dff', '#8c52ff']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.importAllBtn}
                >
                  <Text style={styles.importAllBtnText}>{t('contactSync.importAll')}</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={contacts}
            renderItem={renderContact}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    padding: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
    marginHorizontal: 12,
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: COLORS.gray500,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray700,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 20,
  },
  importAllBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  contactCountText: {
    fontSize: 14,
    color: COLORS.gray500,
    fontWeight: '500',
  },
  importAllBtn: {
    backgroundColor: COLORS.piktag500,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  importAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listContent: {
    paddingBottom: 100,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactInitials: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray600,
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  contactDetails: {
    marginTop: 2,
    gap: 2,
  },
  contactDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  contactDetailText: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  importBtn: {
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: 8,
  },
  importedBadge: {
    padding: 8,
  },
});
