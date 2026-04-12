import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Contacts from 'expo-contacts';
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

  const loadContacts = useCallback(async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Emails,
        ],
        sort: Contacts.SortTypes.FirstName,
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

  const handleImportContact = async (contact: PhoneContact) => {
    if (!user) return;

    setImportingIds((prev) => new Set(prev).add(contact.id));

    try {
      // Check if a profile with matching phone or email exists
      let matchedUserId: string | null = null;

      if (contact.phone) {
        const normalizedPhone = contact.phone.replace(/[\s\-\(\)]/g, '');
        const { data: phoneMatch } = await supabase
          .from('piktag_profiles')
          .select('id')
          .eq('phone', normalizedPhone)
          .single();
        if (phoneMatch) matchedUserId = phoneMatch.id;
      }

      if (!matchedUserId && contact.email) {
        // Check auth users by email via profile lookup
        const { data: emailMatch } = await supabase
          .from('piktag_profiles')
          .select('id')
          .ilike('username', contact.email.split('@')[0])
          .single();
        if (emailMatch) matchedUserId = emailMatch.id;
      }

      if (matchedUserId && matchedUserId !== user.id) {
        // Create a connection to the matched user
        const { error } = await supabase
          .from('piktag_connections')
          .upsert(
            {
              user_id: user.id,
              connected_user_id: matchedUserId,
              nickname: contact.name,
              note: contact.phone ? `電話: ${contact.phone}` : '',
            },
            { onConflict: 'user_id,connected_user_id' }
          );

        if (error) {
          console.error('Error importing contact:', error);
          Alert.alert(t('common.error'), t('contactSync.alertImportError'));
        } else {
          setImportedIds((prev) => new Set(prev).add(contact.id));
        }
      } else {
        // No match found — offer invite
        handleInvite(contact);
      }
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
    }
  };

  const handleImportAll = async () => {
    if (contacts.length === 0) return;
    Alert.alert(
      t('contactSync.alertBatchImportTitle'),
      t('contactSync.alertBatchImportMessage', { count: contacts.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contactSync.alertBatchImportConfirm'),
          onPress: async () => {
            for (const c of contacts) {
              if (!importedIds.has(c.id)) {
                await handleImportContact(c);
              }
            }
          },
        },
      ]
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
          <ActivityIndicator size="small" color={COLORS.piktag500} />
        ) : (
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => handleImportContact(item)}
            activeOpacity={0.7}
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
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('contactSync.headerTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
          <Text style={styles.loadingText}>{t('contactSync.loadingText')}</Text>
        </View>
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
          {/* Import All button */}
          <View style={styles.importAllBar}>
            <Text style={styles.contactCountText}>
              {t('contactSync.contactCount', { count: contacts.length })}
            </Text>
            <TouchableOpacity
              onPress={handleImportAll}
              activeOpacity={0.7}
            >
              <LinearGradient
                colors={['#ff5757', '#c44dff', '#8c52ff']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.importAllBtn}
              >
                <Text style={styles.importAllBtnText}>{t('contactSync.importAll')}</Text>
              </LinearGradient>
            </TouchableOpacity>
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
    padding: 4,
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
    padding: 8,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: 8,
  },
  importedBadge: {
    padding: 8,
  },
});
