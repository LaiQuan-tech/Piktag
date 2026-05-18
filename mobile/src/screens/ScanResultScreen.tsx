import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import PlatformIcon from '../components/PlatformIcon';
import { getPlatformLabel } from '../lib/platforms';
import type { PiktagProfile, Biolink } from '../types';

type ScanResultParams = {
  sessionId: string;
  hostUserId: string;
  hostName: string;
  eventDate: string;
  eventLocation: string;
  hostTags: string[];
};

type ScanResultScreenProps = {
  navigation: any;
  route: {
    params: ScanResultParams;
  };
};

export default function ScanResultScreen({ navigation, route }: ScanResultScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    sessionId,
    hostUserId,
    hostName,
    eventDate,
    eventLocation,
    hostTags,
  } = route.params;

  const [hostProfile, setHostProfile] = useState<PiktagProfile | null>(null);
  // Host's PUBLIC biolinks only. The scanner is, at this instant, a
  // stranger who just scanned a Tag QR — public is exactly the set
  // the host chose to expose to anyone. No friends/close/private
  // ever surfaces here (privacy + App-review safe).
  const [hostBiolinks, setHostBiolinks] = useState<Biolink[]>([]);
  const [myTags, setMyTags] = useState<string[]>([]);
  const [selectedMyTags, setSelectedMyTags] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);

  const RELATION_PRESETS = [
    { key: 'friend', label: t('scanResult.relationFriend') },
    { key: 'colleague', label: t('scanResult.relationColleague') },
    { key: 'classmate', label: t('scanResult.relationClassmate') },
    { key: 'partner', label: t('scanResult.relationPartner') },
    { key: 'client', label: t('scanResult.relationClient') },
  ];

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch host profile
      const { data: profileData } = await supabase
        .from('piktag_profiles')
        .select('*')
        .eq('id', hostUserId)
        .single();

      if (profileData) {
        setHostProfile(profileData);
      }

      // Host's public biolinks → one-tap "also connect on LINE / IG
      // / WhatsApp / …" deep links. The stored url is already a
      // full openable link (prefix + handle), so Linking.openURL
      // lands the user on that person inside the other app where
      // they tap follow/add themselves (no platform lets a 3rd-party
      // app do that for them — this is the honest, compliant model).
      const { data: blData } = await supabase
        .from('piktag_biolinks')
        .select('*')
        .eq('user_id', hostUserId)
        .eq('visibility', 'public')
        // Must also be active — a host who toggled a link OFF still
        // has the row (public visibility) but it must not leak to a
        // scanner. Matches ProfileScreen's activeBiolinks filter.
        .eq('is_active', true)
        .order('position', { ascending: true });
      if (blData) setHostBiolinks(blData as Biolink[]);

      // Fetch my tags
      const { data: myTagsData } = await supabase
        .from('piktag_user_tags')
        .select('*, tag:piktag_tags(*)')
        .eq('user_id', user.id);

      if (myTagsData) {
        const tagNames = myTagsData
          .map((ut: any) => ut.tag?.name || '')
          .filter(Boolean);
        setMyTags(tagNames);
        // Pre-select all my tags
        setSelectedMyTags(new Set(tagNames));
      }

    } catch (err) {
      console.error('Error fetching scan result data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleMyTag = (tag: string) => {
    setSelectedMyTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const toggleSelectAllMyTags = () => {
    if (selectedMyTags.size === myTags.length) {
      setSelectedMyTags(new Set());
    } else {
      setSelectedMyTags(new Set(myTags));
    }
  };

  // Open the host's link AND record the tap as a biolink click —
  // the SAME piktag_biolink_clicks row a profile-screen click
  // writes. So the host "sees the reaction": it feeds their
  // Insights (totalBiolinkClicks) and fires the existing
  // "someone clicked your {{platform}} link" notification. The
  // scanner is the clicker; fire-and-forget so a tracking hiccup
  // never blocks the deep link.
  const openBiolink = (biolinkId: string, url: string) => {
    if (!url) return;
    if (user) {
      supabase
        .from('piktag_biolink_clicks')
        .insert({ biolink_id: biolinkId, clicker_user_id: user.id })
        .then(({ error }) => {
          if (error) console.warn('Biolink click tracking failed:', error.message);
        });
    }
    Linking.openURL(url).catch(() => {});
  };

  // Synchronous double-tap guard: `disabled={submitting}` lags
  // (setState is async-batched), so two fast taps previously raced
  // past the not-atomic existing-connection check and created
  // duplicate connections + duplicate tag rows.
  const confirmingRef = useRef(false);
  const handleConfirm = async () => {
    if (!user) return;
    // Can't connect to yourself (scanning your own Tag QR).
    if (hostUserId === user.id) {
      Alert.alert(
        t('scanResult.alreadyConnectedTitle', { defaultValue: '無法加自己' }),
        t('scanResult.selfScanMessage', { defaultValue: '這是你自己的 QR，沒辦法加自己為好友。' }),
      );
      return;
    }
    if (confirmingRef.current) return;
    confirmingRef.current = true;

    setSubmitting(true);
    try {
      // Helper: find or create tag by name. The insert races with other
      // clients, so a unique-constraint violation just means someone else
      // won — look the row back up instead of surfacing the error.
      const findOrCreateTag = async (tagName: string): Promise<string | null> => {
        const rawName = tagName.startsWith('#') ? tagName.slice(1) : tagName;
        const { data: existing } = await supabase
          .from('piktag_tags').select('id').eq('name', rawName).maybeSingle();
        if (existing) return existing.id;
        const { data: created, error: createErr } = await supabase
          .from('piktag_tags').insert({ name: rawName }).select('id').single();
        if (created) return created.id;
        // 23505 = unique_violation: another request created it first.
        if (createErr && (createErr as any).code === '23505') {
          const { data: raced } = await supabase
            .from('piktag_tags').select('id').eq('name', rawName).maybeSingle();
          return raced?.id || null;
        }
        return null;
      };

      // Resolve public tags (from my selected tags)
      const publicTagIds: string[] = [];
      for (const tagName of Array.from(selectedMyTags)) {
        const id = await findOrCreateTag(tagName);
        if (id) publicTagIds.push(id);
      }

      // Resolve private tags (from host's QR event tags — hidden from scanner)
      const privateTagIds: string[] = [];
      for (const tagName of hostTags) {
        const id = await findOrCreateTag(tagName);
        if (id) privateTagIds.push(id);
      }

      // Check if connection already exists
      const { data: existingConnection } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', user.id)
        .eq('connected_user_id', hostUserId)
        .maybeSingle();

      if (existingConnection) {
        Alert.alert(
          t('scanResult.alreadyConnectedTitle', { defaultValue: 'Already Connected' }),
          t('scanResult.alreadyConnectedMessage', {
            name: hostName,
            defaultValue: `You are already connected with ${hostName}.`,
          }),
        );
        setSubmitting(false);
        return;
      }

      // Insert connection
      const { data: connectionData, error: connectionError } = await supabase
        .from('piktag_connections')
        .insert({
          user_id: user.id,
          connected_user_id: hostUserId,
          met_at: new Date().toISOString(),
          met_location: eventLocation,
          note: eventDate + (eventLocation ? ' · ' + eventLocation : ''),
          scan_session_id: sessionId || null,
        })
        .select('id')
        .single();

      if (connectionError || !connectionData) {
        console.error('Error creating connection:', connectionError);
        Alert.alert(t('common.error'), t('scanResult.alertAddFriendError'));
        setSubmitting(false);
        return;
      }

      // Insert public connection tags (from scanner's own tags) with position
      if (publicTagIds.length > 0) {
        await supabase.from('piktag_connection_tags').insert(
          publicTagIds.map((tagId, i) => ({ connection_id: connectionData.id, tag_id: tagId, is_private: false, position: i }))
        );
      }

      // Insert private connection tags (from QR event tags — only scanner sees)
      // Also add event location and date as hidden tags
      const metaTagNames: string[] = [];
      if (eventLocation?.trim()) metaTagNames.push(eventLocation.trim());
      if (eventDate?.trim()) metaTagNames.push(eventDate.trim());
      for (const metaName of metaTagNames) {
        const id = await findOrCreateTag(metaName);
        if (id && !privateTagIds.includes(id)) privateTagIds.push(id);
      }

      if (privateTagIds.length > 0) {
        const publicCount = publicTagIds.length;
        await supabase.from('piktag_connection_tags').insert(
          privateTagIds.map((tagId, i) => ({ connection_id: connectionData.id, tag_id: tagId, is_private: true, position: publicCount + i }))
        );
      }

      // Also create reverse connection for host + attach private tags
      const { data: reverseConn } = await supabase
        .from('piktag_connections')
        .upsert({
          user_id: hostUserId,
          connected_user_id: user.id,
          met_at: new Date().toISOString(),
          met_location: eventLocation,
          note: eventDate + (eventLocation ? ' · ' + eventLocation : ''),
        }, { onConflict: 'user_id,connected_user_id' })
        .select('id').single();

      if (reverseConn && privateTagIds.length > 0) {
        await supabase.from('piktag_connection_tags').insert(
          privateTagIds.map(tagId => ({ connection_id: reverseConn.id, tag_id: tagId, is_private: true }))
        );
      }

      // Insert relation tag if selected
      if (selectedRelation) {
        const relationTagName = selectedRelation;
        let relationTagId: string | null = null;

        const { data: existingRelTag } = await supabase
          .from('piktag_tags')
          .select('id')
          .eq('name', relationTagName)
          .maybeSingle();

        if (existingRelTag) {
          relationTagId = existingRelTag.id;
        } else {
          const { data: newRelTag, error: relErr } = await supabase
            .from('piktag_tags')
            .insert({ name: relationTagName, semantic_type: 'relation' })
            .select('id')
            .single();
          if (newRelTag) {
            relationTagId = newRelTag.id;
          } else if (relErr && (relErr as any).code === '23505') {
            const { data: raced } = await supabase
              .from('piktag_tags')
              .select('id')
              .eq('name', relationTagName)
              .maybeSingle();
            relationTagId = raced?.id || null;
          } else {
            relationTagId = null;
          }
        }

        if (relationTagId) {
          await supabase.from('piktag_connection_tags').insert({
            connection_id: connectionData.id,
            tag_id: relationTagId,
            semantic_type: 'relation',
          });
        }
      }

      // Try to increment scan count (may fail due to RLS - that's OK)
      try {
        await supabase.rpc('increment_scan_count', { session_id: sessionId });
      } catch {
        // Ignore - scanner might not have permission
      }

      Alert.alert(t('scanResult.alertSuccessTitle'), t('scanResult.alertSuccessMessage', { name: hostName }), [
        {
          text: t('scanResult.alertSuccessConfirm'),
          onPress: () => {
            // Go to the person you just added (was dumping the user
            // on HomeTab — a different tab, no trace of who they
            // connected with). replace so back returns to the
            // originating screen, not this now-stale result page.
            navigation.replace('FriendDetail', {
              friendId: hostUserId,
              connectionId: connectionData.id,
            });
          },
        },
      ]);
    } catch (err) {
      console.error('Error confirming friend:', err);
      Alert.alert(t('common.error'), t('scanResult.alertUnexpectedError'));
    } finally {
      setSubmitting(false);
      confirmingRef.current = false;
    }
  };

  const avatarUri = hostProfile?.avatar_url
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(hostName)}&background=f3f4f6&color=6b7280`;
  const displayName = hostProfile?.full_name || hostName;
  const username = hostProfile?.username || '';

  const allMySelected = myTags.length > 0 && selectedMyTags.size === myTags.length;

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle}>{t('scanResult.headerTitle')}</Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
            activeOpacity={0.6}
          >
            <X size={24} color={COLORS.gray900} />
          </TouchableOpacity>
        </View>
        <PageLoader heading="加入朋友中…" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>{t('scanResult.headerTitle')}</Text>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
        >
          <X size={24} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Host Profile Section */}
        <View style={styles.profileSection}>
          <Image
            source={{ uri: avatarUri }}
            style={styles.avatar}
          />
          <Text style={styles.fullName}>{displayName}</Text>
          {username ? (
            <Text style={styles.usernameText}>@{username}</Text>
          ) : null}
        </View>

        {/* Connect elsewhere — host's PUBLIC biolinks as one-tap
            deep links. Tapping opens that person inside the other
            app; the user taps follow/add there (no platform allows
            a 3rd-party app to do it for them). */}
        {hostBiolinks.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {t('scanResult.connectElsewhereTitle', {
                name: displayName,
                defaultValue: '也在這些地方連上 {{name}}',
              })}
            </Text>
            <Text style={styles.connectHint}>
              {t('scanResult.connectElsewhereHint', {
                defaultValue: '點一下會開啟對方在該 App 的頁面，由你按追蹤／加好友。',
              })}
            </Text>
            <View style={styles.chipsContainer}>
              {hostBiolinks.map((bl) => (
                <TouchableOpacity
                  key={bl.id}
                  style={styles.socialBtn}
                  activeOpacity={0.7}
                  onPress={() => openBiolink(bl.id, bl.url)}
                  accessibilityRole="button"
                  accessibilityLabel={getPlatformLabel(bl.platform, t)}
                >
                  <PlatformIcon platform={bl.platform} size={18} iconUrl={bl.icon_url} />
                  <Text style={styles.socialBtnText} numberOfLines={1}>
                    {getPlatformLabel(bl.platform, t)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* My Tags Section */}
        {myTags.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('scanResult.myTagsTitle')}</Text>
              <TouchableOpacity
                onPress={toggleSelectAllMyTags}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.selectAllText,
                    allMySelected && styles.selectAllTextActive,
                  ]}
                >
                  {t('scanResult.selectAll')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.chipsContainer}>
              {myTags.map((tag) => {
                const isSelected = selectedMyTags.has(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.chip,
                      isSelected ? styles.chipSelected : styles.chipUnselected,
                    ]}
                    onPress={() => toggleMyTag(tag)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSelected ? styles.chipTextSelected : styles.chipTextUnselected,
                      ]}
                    >
                      {tag.startsWith('#') ? tag : `#${tag}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
        {/* Relation Type Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('scanResult.relationTitle')}</Text>
          <View style={styles.chipsContainer}>
            {RELATION_PRESETS.map((rel) => {
              const isSelected = selectedRelation === rel.key;
              return (
                <TouchableOpacity
                  key={rel.key}
                  style={[
                    styles.chip,
                    isSelected ? styles.chipSelected : styles.chipUnselected,
                  ]}
                  onPress={() => setSelectedRelation(isSelected ? null : rel.key)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isSelected ? styles.chipTextSelected : styles.chipTextUnselected,
                    ]}
                  >
                    {rel.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* CTA Button */}
      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={handleConfirm}
          activeOpacity={0.8}
          disabled={submitting}
        >
          <LinearGradient
            colors={['#ff5757', '#c44dff', '#8c52ff']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.ctaButton, submitting && styles.ctaButtonDisabled]}
          >
            {submitting ? (
              <BrandSpinner size={20} />
            ) : (
              <Text style={styles.ctaButtonText}>{t('scanResult.confirmButton')}</Text>
            )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray900,
    lineHeight: 32,
  },
  closeBtn: {
    padding: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  profileSection: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray100,
    borderWidth: 2,
    borderColor: COLORS.gray100,
  },
  fullName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.gray900,
    marginTop: 14,
  },
  usernameText: {
    fontSize: 15,
    color: COLORS.gray500,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray400,
  },
  selectAllTextActive: {
    color: COLORS.piktag600,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  chipSelected: {
    backgroundColor: COLORS.piktag500,
    borderWidth: 1,
    borderColor: COLORS.piktag500,
  },
  chipUnselected: {
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  chipTextUnselected: {
    color: COLORS.gray600,
  },
  connectHint: {
    fontSize: 13,
    color: COLORS.gray500,
    marginTop: 6,
    marginBottom: 14,
    lineHeight: 18,
  },
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  socialBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray700,
    maxWidth: 140,
  },
  ctaContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: COLORS.white,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  ctaButton: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonDisabled: {
    opacity: 0.7,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
