import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { PiktagProfile } from '../types';

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

  const handleConfirm = async () => {
    if (!user) return;

    setSubmitting(true);
    try {
      // Helper: find or create tag by name
      const findOrCreateTag = async (tagName: string): Promise<string | null> => {
        const rawName = tagName.startsWith('#') ? tagName.slice(1) : tagName;
        const { data: existing } = await supabase
          .from('piktag_tags').select('id').eq('name', rawName).maybeSingle();
        if (existing) return existing.id;
        const { data: created } = await supabase
          .from('piktag_tags').insert({ name: rawName }).select('id').single();
        return created?.id || null;
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
          .single();

        if (existingRelTag) {
          relationTagId = existingRelTag.id;
        } else {
          const { data: newRelTag } = await supabase
            .from('piktag_tags')
            .insert({ name: relationTagName, semantic_type: 'relation' })
            .select('id')
            .single();
          relationTagId = newRelTag?.id || null;
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
            navigation.navigate('HomeTab');
          },
        },
      ]);
    } catch (err) {
      console.error('Error confirming friend:', err);
      Alert.alert(t('common.error'), t('scanResult.alertUnexpectedError'));
    } finally {
      setSubmitting(false);
    }
  };

  const avatarUri = hostProfile?.avatar_url
    || `https://ui-avatars.com/api/?name=${encodeURIComponent(hostName)}&background=f3f4f6&color=6b7280`;
  const displayName = hostProfile?.full_name || hostName;
  const username = hostProfile?.username || '';

  const allMySelected = myTags.length > 0 && selectedMyTags.size === myTags.length;

  if (loading) {
    return (
      <View style={styles.container}>
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
              <ActivityIndicator size={20} color="#FFFFFF" />
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
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  chipTextUnselected: {
    color: COLORS.gray700,
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
