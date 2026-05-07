import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  StatusBar,
  Alert,
  Platform,
  Share,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
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
  Phone,
  Mail,
  Send,
  Hash,
  X,
  Plus,
  Lock,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import {
  useLocalContacts,
  normalizePhone,
} from '../hooks/useLocalContacts';
import type { Tag } from '../types';

const MAX_TAGS_PER_CONTACT = 8;

type ContactSyncScreenProps = {
  navigation: any;
};

type PhoneContact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

type MatchInfo = {
  user_id: string;
  match_type: 'phone' | 'email';
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

type SectionVariant = 'on-piktag' | 'not-on-piktag';

type ContactSection = {
  variant: SectionVariant;
  title: string;
  data: PhoneContact[];
};

export default function ContactSyncScreen({ navigation }: ContactSyncScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Server-classified state. `matches` is contactId → matched profile info
  // (only contacts that resolve to a PikTag account appear here).
  // `importedIds` tracks contacts whose matched user is already in the
  // viewer's piktag_connections (i.e. green ✓ instead of "+追蹤").
  const [matches, setMatches] = useState<Map<string, MatchInfo>>(new Map());
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState(true);

  // Per-row spinner (individual + tap) and bulk-mode progress.
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<
    { current: number; total: number } | null
  >(null);

  // Phase 4: tag + invite for non-PikTag contacts. We piggy-back on
  // useLocalContacts so a PhoneContact tagged here becomes a row in
  // piktag_local_contacts, and the AFTER INSERT trigger on profiles
  // will auto-promote it to a real connection once the invitee signs up.
  const { contacts: localContacts, add: addLocalContact } = useLocalContacts();

  // Tag-picker modal state. `tagTarget` is the PhoneContact the user
  // is tagging right now; null means modal is closed.
  const [tagTarget, setTagTarget] = useState<PhoneContact | null>(null);
  const [pickedTags, setPickedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [savingTag, setSavingTag] = useState(false);

  // Popular tags — same source EditProfile + LocalContacts use, so the
  // chip suggestions feel consistent.
  const [popularTags, setPopularTags] = useState<Tag[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('piktag_tags')
        .select('id, name, usage_count, semantic_type')
        .order('usage_count', { ascending: false })
        .limit(15);
      if (data) setPopularTags(data as Tag[]);
    })();
  }, []);

  // Build a Set<string> of "phone-or-email keys" for non-PikTag contacts
  // that already exist as local_contacts. Used to render the "已加入名單"
  // badge instead of the "標籤+邀請" CTA so the user doesn't double-add.
  // Key precedence mirrors normalizePhone / lower(email) to match what
  // useLocalContacts.add() actually wrote, and falls back to the lowercase
  // name (matching the DB UNIQUE constraint shape).
  const taggedKeys = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    for (const lc of localContacts) {
      if (lc.phone_normalized) keys.add(`p:${lc.phone_normalized}`);
      if (lc.email_lower) keys.add(`e:${lc.email_lower}`);
      if (lc.name) keys.add(`n:${lc.name.trim().toLowerCase()}`);
    }
    return keys;
  }, [localContacts]);

  const isContactTagged = useCallback(
    (c: PhoneContact): boolean => {
      const phoneKey = c.phone ? `p:${normalizePhone(c.phone) ?? ''}` : null;
      const emailKey = c.email ? `e:${c.email.trim().toLowerCase()}` : null;
      const nameKey = c.name ? `n:${c.name.trim().toLowerCase()}` : null;
      if (phoneKey && taggedKeys.has(phoneKey)) return true;
      if (emailKey && taggedKeys.has(emailKey)) return true;
      if (nameKey && taggedKeys.has(nameKey)) return true;
      return false;
    },
    [taggedKeys],
  );

  // ---------------------------------------------------------------------
  // Load device contacts (after permission). Independent of server state.
  // ---------------------------------------------------------------------
  const loadContacts = useCallback(async () => {
    try {
      const { status } = await requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoadingContacts(false);
        return;
      }

      const { data } = await getContactsAsync({
        fields: [Fields.Name, Fields.PhoneNumbers, Fields.Emails],
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
          }));
        setContacts(mapped);
      }
    } catch (err) {
      console.error('Error loading contacts:', err);
      if (Platform.OS === 'web') {
        setPermissionDenied(true);
      }
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // ---------------------------------------------------------------------
  // Classify: in parallel run match RPC + connections query, then derive
  // matches map and importedIds set. Handles the "I deleted + reinstalled
  // the app, but the screen still shows people I unfollowed" case because
  // importedIds is hydrated from the server, not from local state.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    if (loadingContacts) return;
    if (contacts.length === 0) {
      setClassifying(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const phones = contacts.map((c) => c.phone ?? '');
        const emails = contacts.map((c) => c.email ?? '');

        const [matchRes, connRes] = await Promise.all([
          supabase.rpc('match_contacts_against_profiles', {
            p_phones: phones,
            p_emails: emails,
          }),
          supabase
            .from('piktag_connections')
            .select('connected_user_id')
            .eq('user_id', user.id),
        ]);

        if (cancelled) return;

        if (matchRes.error) {
          console.warn('[ContactSync] RPC error:', matchRes.error.message);
        }

        const rows = (matchRes.data ?? []) as Array<{
          input_index: number;
          matched_user_id: string;
          match_type: 'phone' | 'email';
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
        }>;

        // RPC orders phone matches before email matches; first-write-wins
        // gives phone priority for a contact whose phone+email both match
        // different profiles (rare but possible).
        const nextMatches = new Map<string, MatchInfo>();
        for (const r of rows) {
          const c = contacts[r.input_index];
          if (!c) continue;
          if (nextMatches.has(c.id)) continue;
          nextMatches.set(c.id, {
            user_id: r.matched_user_id,
            match_type: r.match_type,
            full_name: r.full_name,
            username: r.username,
            avatar_url: r.avatar_url,
          });
        }

        const existingConnections = new Set<string>(
          ((connRes.data ?? []) as Array<{ connected_user_id: string }>).map(
            (r) => r.connected_user_id,
          ),
        );

        const nextImported = new Set<string>();
        for (const c of contacts) {
          const m = nextMatches.get(c.id);
          if (m && existingConnections.has(m.user_id)) {
            nextImported.add(c.id);
          }
        }

        setMatches(nextMatches);
        setImportedIds(nextImported);
      } catch (err) {
        console.warn('[ContactSync] classify failed:', err);
      } finally {
        if (!cancelled) setClassifying(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, contacts, loadingContacts]);

  // ---------------------------------------------------------------------
  // Sections derived from contacts + matches. PikTag users come first,
  // un-followed before already-followed inside that section. Non-PikTag
  // contacts go in the second section in original (alphabetical) order.
  // ---------------------------------------------------------------------
  const sections = useMemo<ContactSection[]>(() => {
    const onPiktag: PhoneContact[] = [];
    const notOnPiktag: PhoneContact[] = [];
    for (const c of contacts) {
      if (matches.has(c.id)) onPiktag.push(c);
      else notOnPiktag.push(c);
    }
    onPiktag.sort((a, b) => {
      const ai = importedIds.has(a.id) ? 1 : 0;
      const bi = importedIds.has(b.id) ? 1 : 0;
      return ai - bi;
    });
    const out: ContactSection[] = [];
    if (onPiktag.length > 0) {
      out.push({
        variant: 'on-piktag',
        title: t('contactSync.sectionOnPiktag', { count: onPiktag.length }) ||
          `已在 PikTag · ${onPiktag.length} 位`,
        data: onPiktag,
      });
    }
    if (notOnPiktag.length > 0) {
      out.push({
        variant: 'not-on-piktag',
        title: t('contactSync.sectionNotOnPiktag', { count: notOnPiktag.length }) ||
          `尚未加入 · ${notOnPiktag.length} 位`,
        data: notOnPiktag,
      });
    }
    return out;
  }, [contacts, matches, importedIds, t]);

  const onPiktagCount = useMemo(
    () => contacts.reduce((acc, c) => acc + (matches.has(c.id) ? 1 : 0), 0),
    [contacts, matches],
  );
  const notOnPiktagCount = contacts.length - onPiktagCount;
  const followablePiktagCount = useMemo(() => {
    let n = 0;
    for (const c of contacts) {
      if (matches.has(c.id) && !importedIds.has(c.id)) n++;
    }
    return n;
  }, [contacts, matches, importedIds]);

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------
  const handleInvite = async (contact: PhoneContact) => {
    try {
      await Share.share({
        message:
          t('contactSync.inviteMessage', { name: contact.name }) ||
          `${contact.name}，我在用 PikTag，一起來交換標籤吧！下載：https://pikt.ag`,
      });
    } catch {
      /* cancelled */
    }
  };

  // Phase 4: open the tag-picker modal pre-filled. If the user already
  // tagged this contact in a previous session, surface a toast-style
  // alert instead of re-opening (the row's "已加入名單" badge handles
  // the visible state).
  const openTagPicker = useCallback((contact: PhoneContact) => {
    setTagTarget(contact);
    setPickedTags([]);
    setCustomTagInput('');
  }, []);

  const closeTagPicker = useCallback(() => {
    setTagTarget(null);
    setPickedTags([]);
    setCustomTagInput('');
    setSavingTag(false);
  }, []);

  const togglePickedTag = useCallback((name: string) => {
    setPickedTags((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= MAX_TAGS_PER_CONTACT) return prev;
      return [...prev, name];
    });
  }, []);

  const addCustomTag = useCallback(() => {
    const raw = customTagInput.trim();
    if (!raw) return;
    setPickedTags((prev) => {
      if (prev.includes(raw)) return prev;
      if (prev.length >= MAX_TAGS_PER_CONTACT) return prev;
      return [...prev, raw];
    });
    setCustomTagInput('');
  }, [customTagInput]);

  // Submit handler: write a piktag_local_contacts row with the picked
  // tags, then immediately open the system Share sheet with a tagged
  // invite message. Both steps are independent — if the share is
  // cancelled, the local_contact row still persists (good — user can
  // re-share from LocalContactsScreen later).
  const handleSubmitTagAndInvite = useCallback(async () => {
    if (!tagTarget || pickedTags.length === 0) return;
    setSavingTag(true);
    const target = tagTarget;
    const tags = [...pickedTags];

    const created = await addLocalContact({
      name: target.name,
      phone: target.phone,
      email: target.email,
      tags,
    });

    setSavingTag(false);

    if (!created) {
      Alert.alert(
        t('contactSync.tagInviteFailedTitle') || '加入名單失敗',
        t('contactSync.tagInviteFailedMessage') ||
          '請稍後再試，或在「聯絡人名單」中手動新增。',
      );
      return;
    }

    closeTagPicker();

    // CRITICAL: never put the tag names into the share message.
    // Tags entered here promote to is_private=true (hidden tags) on
    // the server — owner-only forever. Users may type sensitive
    // private notes ("前女友", "欠錢", "黑名單"); leaking those via
    // SMS to the tagged person would kill app trust. Generic invite
    // copy only.
    const message =
      t('contactSync.tagInviteMessage', { name: target.name }) ||
      `嗨！我在用 PikTag — 一起來交換標籤吧：\nhttps://pikt.ag/download`;
    try {
      await Share.share({ message });
    } catch {
      /* cancelled — local_contact row is already saved */
    }
  }, [tagTarget, pickedTags, addLocalContact, closeTagPicker, t]);

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

  // Single "+追蹤" tap on the on-piktag section.
  const handleFollowOne = async (contact: PhoneContact) => {
    const m = matches.get(contact.id);
    if (!m) return;
    setImportingIds((prev) => new Set(prev).add(contact.id));
    try {
      const ok = await upsertConnection(contact, m.user_id);
      if (ok) {
        setImportedIds((prev) => new Set(prev).add(contact.id));
      }
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(contact.id);
        return next;
      });
    }
  };

  // "全部追蹤 PikTag 朋友" — only operates on the on-piktag section
  // (matched but not-yet-imported). No share-sheet side effects.
  const handleFollowAllPiktag = async () => {
    if (!user || batchProgress) return;
    const targets: Array<{ contact: PhoneContact; userId: string }> = [];
    for (const c of contacts) {
      const m = matches.get(c.id);
      if (m && !importedIds.has(c.id)) {
        targets.push({ contact: c, userId: m.user_id });
      }
    }
    if (targets.length === 0) return;

    Alert.alert(
      t('contactSync.alertFollowAllTitle') || '全部追蹤',
      t('contactSync.alertFollowAllMessage', { count: targets.length }) ||
        `要把 ${targets.length} 位 PikTag 朋友加入嗎？`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('contactSync.alertFollowAllConfirm') || '加入',
          onPress: async () => {
            setBatchProgress({ current: 0, total: targets.length });
            const newImported = new Set(importedIds);
            let added = 0;
            const CHUNK = 10;
            for (let i = 0; i < targets.length; i += CHUNK) {
              const slice = targets.slice(i, i + CHUNK);
              const results = await Promise.all(
                slice.map((t) => upsertConnection(t.contact, t.userId)),
              );
              for (let k = 0; k < slice.length; k++) {
                if (results[k]) {
                  added++;
                  newImported.add(slice[k].contact.id);
                }
              }
              setBatchProgress({
                current: Math.min(i + slice.length, targets.length),
                total: targets.length,
              });
            }
            setImportedIds(newImported);
            setBatchProgress(null);

            Alert.alert(
              t('contactSync.alertFollowAllDoneTitle') || '完成',
              t('contactSync.alertFollowAllDoneMessage', { count: added }) ||
                `已加入 ${added} 位 PikTag 朋友 🎉`,
            );
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------
  const renderInitialsAvatar = (name: string) => {
    const initials = name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <View style={styles.contactAvatar}>
        <Text style={styles.contactInitials}>{initials}</Text>
      </View>
    );
  };

  const renderOnPiktagRow = (item: PhoneContact) => {
    const m = matches.get(item.id)!;
    const isImporting = importingIds.has(item.id);
    const isImported = importedIds.has(item.id);

    const displayName = m.full_name?.trim() || m.username || item.name;
    const handle = m.username ? `@${m.username}` : null;
    const showContactSubtitle =
      item.name &&
      item.name !== m.full_name &&
      item.name !== m.username;

    return (
      <View style={styles.contactItem}>
        {m.avatar_url ? (
          <Image
            source={{ uri: m.avatar_url }}
            style={styles.contactAvatarImage}
            contentFit="cover"
            transition={120}
          />
        ) : (
          renderInitialsAvatar(displayName)
        )}
        <View style={styles.contactInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.contactName} numberOfLines={1}>
              {displayName}
            </Text>
            {handle ? (
              <Text style={styles.handle} numberOfLines={1}>
                {handle}
              </Text>
            ) : null}
          </View>
          {showContactSubtitle ? (
            <Text style={styles.contactSubtitle} numberOfLines={1}>
              {t('contactSync.fromContact', { name: item.name }) ||
                `通訊錄：${item.name}`}
            </Text>
          ) : null}
        </View>
        {isImported ? (
          <View style={styles.importedBadge}>
            <Check size={16} color={COLORS.piktag600} />
          </View>
        ) : isImporting ? (
          <View style={styles.actionBtn}>
            <BrandSpinner size={20} />
          </View>
        ) : (
          <TouchableOpacity
            style={styles.actionBtnPrimary}
            onPress={() => handleFollowOne(item)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('contactSync.followBtn') || '追蹤'}
          >
            <UserPlus size={16} color={COLORS.piktag600} />
            <Text style={styles.actionBtnText}>
              {t('contactSync.followBtn') || '追蹤'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderNotOnPiktagRow = (item: PhoneContact) => {
    const alreadyTagged = isContactTagged(item);
    return (
      <View style={styles.contactItem}>
        {renderInitialsAvatar(item.name)}
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={styles.contactDetails}>
            {item.phone ? (
              <View style={styles.contactDetailRow}>
                <Phone size={12} color={COLORS.gray400} />
                <Text style={styles.contactDetailText}>{item.phone}</Text>
              </View>
            ) : null}
            {item.email ? (
              <View style={styles.contactDetailRow}>
                <Mail size={12} color={COLORS.gray400} />
                <Text style={styles.contactDetailText} numberOfLines={1}>
                  {item.email}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {alreadyTagged ? (
          <View style={styles.taggedBadge}>
            <Check size={14} color={COLORS.piktag600} />
            <Text style={styles.taggedBadgeText}>
              {t('contactSync.taggedBadge') || '已加入名單'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.actionBtnTagInvite}
            onPress={() => openTagPicker(item)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              t('contactSync.tagInviteBtn') || '記下並邀請'
            }
          >
            <Hash size={14} color="#FFFFFF" />
            <Text style={styles.actionBtnTagInviteText}>
              {t('contactSync.tagInviteBtn') || '記下並邀請'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ---------------------------------------------------------------------
  // Body content
  // ---------------------------------------------------------------------
  const showLoader = loadingContacts || (contacts.length > 0 && classifying);

  let body: React.ReactNode;
  if (showLoader) {
    body = (
      <PageLoader
        heading={
          loadingContacts
            ? t('contactSync.loadingText')
            : t('contactSync.classifyingText') || '對比中…'
        }
      />
    );
  } else if (permissionDenied) {
    body = (
      <View style={styles.emptyContainer}>
        <Users size={48} color={COLORS.gray200} />
        <Text style={styles.emptyTitle}>
          {t('contactSync.permissionDeniedTitle')}
        </Text>
        <Text style={styles.emptyText}>
          {Platform.OS === 'web'
            ? t('contactSync.permissionDeniedWeb')
            : t('contactSync.permissionDeniedNative')}
        </Text>
      </View>
    );
  } else if (contacts.length === 0) {
    body = (
      <View style={styles.emptyContainer}>
        <Users size={48} color={COLORS.gray200} />
        <Text style={styles.emptyTitle}>{t('contactSync.emptyTitle')}</Text>
        <Text style={styles.emptyText}>{t('contactSync.emptyText')}</Text>
      </View>
    );
  } else {
    // Summary card + sticky-section list. Empty PikTag section is hidden;
    // empty non-PikTag section also hidden (handled in `sections` memo).
    body = (
      <SectionList<PhoneContact, ContactSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLine}>
              {t('contactSync.summaryHeading', {
                onCount: onPiktagCount,
                offCount: notOnPiktagCount,
              }) ||
                `${onPiktagCount} 位已在 PikTag · ${notOnPiktagCount} 位可邀請`}
            </Text>
            {batchProgress ? (
              <View style={styles.summaryProgress}>
                <BrandSpinner size={20} />
                <Text style={styles.summaryProgressText}>
                  {t('contactSync.batchProgress', {
                    current: batchProgress.current,
                    total: batchProgress.total,
                  }) || `處理中 ${batchProgress.current}/${batchProgress.total}`}
                </Text>
              </View>
            ) : followablePiktagCount > 0 ? (
              <TouchableOpacity
                onPress={handleFollowAllPiktag}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#ff5757', '#c44dff', '#8c52ff']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.summaryCta}
                >
                  <Text style={styles.summaryCtaText}>
                    {t('contactSync.followAllCta', {
                      count: followablePiktagCount,
                    }) ||
                      `全部追蹤 PikTag 朋友 (${followablePiktagCount})`}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : onPiktagCount > 0 ? (
              <View style={[styles.summaryCta, styles.summaryCtaDone]}>
                <Check size={16} color={COLORS.piktag600} />
                <Text
                  style={[styles.summaryCtaText, styles.summaryCtaDoneText]}
                >
                  {t('contactSync.allConnected') ||
                    '通訊錄裡的 PikTag 朋友都已加入'}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, section }) =>
          section.variant === 'on-piktag'
            ? renderOnPiktagRow(item)
            : renderNotOnPiktagRow(item)
        }
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.white}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() =>
            navigation.canGoBack()
              ? navigation.goBack()
              : navigation.navigate('Connections')
          }
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('contactSync.headerTitle')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {body}

      {/* ----------------------------------------------------------------
          Phase 4: tag-picker modal for non-PikTag contacts.
          Submit creates a piktag_local_contacts row (tags pre-attached)
          and immediately opens the system Share sheet.
          ---------------------------------------------------------------- */}
      <Modal
        visible={tagTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeTagPicker}
      >
        <Pressable style={styles.tagModalBackdrop} onPress={closeTagPicker}>
          <Pressable style={styles.tagModalCard} onPress={(e) => e.stopPropagation()}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={styles.tagModalHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.tagModalTitleRow}>
                    <Lock size={16} color={COLORS.gray700} />
                    <Text style={styles.tagModalTitle}>
                      {t('contactSync.tagModalTitle') || '私人標籤'}
                    </Text>
                  </View>
                  <Text style={styles.tagModalSubtitle} numberOfLines={1}>
                    {tagTarget?.name || ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.tagModalCloseBtn}
                  onPress={closeTagPicker}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                >
                  <X size={20} color={COLORS.gray600} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.tagModalBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.tagModalHintRow}>
                  <Lock size={12} color={COLORS.gray600} />
                  <Text style={styles.tagModalHint}>
                    {t('contactSync.tagModalHint', {
                      max: MAX_TAGS_PER_CONTACT,
                    }) ||
                      `只有你看得到的私人標籤（最多 ${MAX_TAGS_PER_CONTACT} 個）— 對方註冊 PikTag 後，這些標籤會出現在你的好友頁的「隱藏標籤」區，永遠不會被對方或其他人看到。`}
                  </Text>
                </View>

                {/* Picked tags strip */}
                {pickedTags.length > 0 ? (
                  <View style={styles.pickedRow}>
                    {pickedTags.map((tag) => (
                      <Pressable
                        key={`picked-${tag}`}
                        style={styles.pickedChip}
                        onPress={() => togglePickedTag(tag)}
                        accessibilityRole="button"
                        accessibilityLabel={`移除 ${tag}`}
                      >
                        <Text style={styles.pickedChipText}>{tag}</Text>
                        <X size={12} color="#FFFFFF" />
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {/* Custom tag input */}
                <View style={styles.customTagRow}>
                  <TextInput
                    style={styles.customTagInput}
                    value={customTagInput}
                    onChangeText={setCustomTagInput}
                    placeholder={t('contactSync.tagModalCustomPlaceholder') || '自訂標籤'}
                    placeholderTextColor={COLORS.gray400}
                    onSubmitEditing={addCustomTag}
                    returnKeyType="done"
                    maxLength={20}
                  />
                  <TouchableOpacity
                    style={[
                      styles.customTagAddBtn,
                      !customTagInput.trim() && styles.customTagAddBtnDisabled,
                    ]}
                    onPress={addCustomTag}
                    disabled={!customTagInput.trim()}
                    accessibilityRole="button"
                    accessibilityLabel={t('contactSync.tagModalAddCustom') || '新增'}
                  >
                    <Plus size={18} color={customTagInput.trim() ? '#FFFFFF' : COLORS.gray400} />
                  </TouchableOpacity>
                </View>

                {/* Popular tags chip grid */}
                {popularTags.length > 0 ? (
                  <View style={styles.popularSection}>
                    <Text style={styles.popularLabel}>
                      {t('contactSync.tagModalPopular') || '熱門標籤'}
                    </Text>
                    <View style={styles.popularGrid}>
                      {popularTags.map((tag) => {
                        const selected = pickedTags.includes(tag.name);
                        return (
                          <Pressable
                            key={tag.id}
                            style={[
                              styles.popularChip,
                              selected && styles.popularChipSelected,
                            ]}
                            onPress={() => togglePickedTag(tag.name)}
                            accessibilityRole="button"
                            accessibilityLabel={tag.name}
                          >
                            <Text
                              style={[
                                styles.popularChipText,
                                selected && styles.popularChipTextSelected,
                              ]}
                            >
                              {tag.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </ScrollView>

              {/* Footer: cancel + submit */}
              <View style={styles.tagModalFooter}>
                <TouchableOpacity
                  style={styles.tagModalCancelBtn}
                  onPress={closeTagPicker}
                  disabled={savingTag}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                >
                  <Text style={styles.tagModalCancelText}>
                    {t('common.cancel') || '取消'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tagModalSubmitBtn,
                    (pickedTags.length === 0 || savingTag) &&
                      styles.tagModalSubmitBtnDisabled,
                  ]}
                  onPress={handleSubmitTagAndInvite}
                  disabled={pickedTags.length === 0 || savingTag}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={
                    t('contactSync.tagModalSubmit') || '存私人標籤並邀請'
                  }
                >
                  {savingTag ? (
                    <BrandSpinner size={16} />
                  ) : (
                    <>
                      <Send size={14} color="#FFFFFF" />
                      <Text style={styles.tagModalSubmitText}>
                        {t('contactSync.tagModalSubmit') || '存私人標籤並邀請'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
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

  // Summary card (above sections)
  summaryCard: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.white,
    gap: 10,
  },
  summaryLine: {
    fontSize: 14,
    color: COLORS.gray500,
    fontWeight: '500',
  },
  summaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    gap: 8,
  },
  summaryCtaText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  summaryCtaDone: {
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
  },
  summaryCtaDoneText: {
    color: COLORS.piktag600,
  },
  summaryProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  summaryProgressText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
  },

  // Section header
  sectionHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: COLORS.gray50 || '#F7F7F8',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.gray100,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray600,
    letterSpacing: 0.2,
  },

  listContent: {
    paddingBottom: 100,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
    backgroundColor: COLORS.white,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.gray100,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    flexShrink: 1,
  },
  handle: {
    fontSize: 13,
    color: COLORS.gray500,
    flexShrink: 1,
  },
  contactSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.gray500,
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

  // Action buttons
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: 8,
    backgroundColor: COLORS.piktag50,
  },
  actionBtnInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  importedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.piktag50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Phase 4 — non-PikTag row primary CTA (filled purple, not the
  // gray-bordered invite chip from before).
  actionBtnTagInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.piktag600,
  },
  actionBtnTagInviteText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  taggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.piktag50,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
  },
  taggedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.piktag600,
  },

  // Phase 4 — tag picker modal
  tagModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  tagModalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    maxHeight: '85%',
  },
  tagModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  tagModalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tagModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  tagModalSubtitle: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 2,
  },
  tagModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  tagModalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  tagModalHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 14,
  },
  tagModalHint: {
    flex: 1,
    fontSize: 13,
    color: COLORS.gray600,
    lineHeight: 18,
  },
  pickedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  pickedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.piktag600,
  },
  pickedChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  customTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  customTagInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
    fontSize: 14,
    color: COLORS.gray900,
  },
  customTagAddBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag600,
  },
  customTagAddBtnDisabled: {
    backgroundColor: COLORS.gray100,
  },
  popularSection: {
    marginBottom: 8,
  },
  popularLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray600,
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  popularGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  popularChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    backgroundColor: COLORS.white,
  },
  popularChipSelected: {
    borderColor: COLORS.piktag600,
    backgroundColor: COLORS.piktag50,
  },
  popularChipText: {
    fontSize: 13,
    color: COLORS.gray700,
    fontWeight: '500',
  },
  popularChipTextSelected: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  tagModalFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  tagModalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  tagModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  tagModalSubmitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.piktag600,
  },
  tagModalSubmitBtnDisabled: {
    opacity: 0.5,
  },
  tagModalSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
