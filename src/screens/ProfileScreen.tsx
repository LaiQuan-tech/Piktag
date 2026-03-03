import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  QrCode,
  Settings,
  CheckCircle2,
  Phone,
  Mail,
  Link,
} from 'lucide-react-native';
import { COLORS } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import QrCodeModal from '../components/QrCodeModal';
import type { PiktagProfile, UserTag, Biolink } from '../types';

type ProfileScreenProps = {
  navigation: any;
};

export default function ProfileScreen({ navigation }: ProfileScreenProps) {
  const { user } = useAuth();
  const userId = user?.id;

  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [userTags, setUserTags] = useState<UserTag[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error && data) {
      setProfile(data as PiktagProfile);
    }
  }, [userId]);

  const fetchUserTags = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_user_tags')
      .select('*, tag:piktag_tags(*)')
      .eq('user_id', userId);
    if (!error && data) {
      setUserTags(data as UserTag[]);
    }
  }, [userId]);

  const fetchBiolinks = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('piktag_biolinks')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    if (!error && data) {
      setBiolinks(data as Biolink[]);
    }
  }, [userId]);

  const fetchFollowerCount = useCallback(async () => {
    if (!userId) return;
    const { count, error } = await supabase
      .from('piktag_follows')
      .select('id', { count: 'exact', head: true })
      .eq('following_id', userId);
    if (!error && count !== null) {
      setFollowerCount(count);
    }
  }, [userId]);

  const fetchAllData = useCallback(async () => {
    await Promise.all([
      fetchProfile(),
      fetchUserTags(),
      fetchBiolinks(),
      fetchFollowerCount(),
    ]);
  }, [fetchProfile, fetchUserTags, fetchBiolinks, fetchFollowerCount]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      await fetchAllData();
      if (isMounted) setLoading(false);
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [fetchAllData]);

  // Refetch data when navigating back from EditProfile
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchAllData();
    });
    return unsubscribe;
  }, [navigation, fetchAllData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllData();
    setRefreshing(false);
  }, [fetchAllData]);

  const formatFollowerCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (count >= 1000) {
      return count.toLocaleString();
    }
    return count.toString();
  };

  const handleOpenBiolink = (url: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {});
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{' '}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6}>
              <QrCode size={24} color={COLORS.gray900} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.6}>
              <Settings size={24} color={COLORS.gray900} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Sticky Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {profile?.full_name || '未設定姓名'}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.6}
            onPress={() => setQrVisible(true)}
          >
            <QrCode size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.6}
            onPress={() => navigation.navigate('Settings')}
          >
            <Settings size={24} color={COLORS.gray900} />
          </TouchableOpacity>
        </View>
      </View>

      <QrCodeModal
        visible={qrVisible}
        onClose={() => setQrVisible(false)}
        username={profile?.username || ''}
        fullName={profile?.full_name || ''}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.piktag500}
          />
        }
      >
        {/* Profile section: username left, avatar right */}
        <View style={styles.profileRow}>
          <View style={styles.profileLeft}>
            <View style={styles.usernameRow}>
              <Text style={styles.usernameText}>
                {profile?.username || '未設定用戶名稱'}
              </Text>
              {profile?.is_verified && (
                <CheckCircle2
                  size={18}
                  color={COLORS.blue500}
                  fill={COLORS.blue500}
                  strokeWidth={0}
                  style={styles.verifiedIcon}
                />
              )}
            </View>
          </View>
          <Image
            source={
              profile?.avatar_url
                ? { uri: profile.avatar_url }
                : { uri: 'https://picsum.photos/seed/profile/200/200' }
            }
            style={styles.avatar}
          />
        </View>

        {/* Bio */}
        <Text style={styles.bio}>
          {profile?.bio || '尚無個人簡介'}
        </Text>

        {/* Tags */}
        <View style={styles.tagsRow}>
          {userTags.length > 0 ? (
            userTags.map((ut, index) => (
              <Text
                key={ut.id}
                style={[
                  styles.tag,
                  index === 0 ? styles.tagPrimary : styles.tagSecondary,
                ]}
              >
                #{ut.tag?.name || '標籤'}
              </Text>
            ))
          ) : (
            <Text style={styles.emptyText}>尚無標籤</Text>
          )}
        </View>

        {/* Friend count */}
        <Text style={styles.friendCount}>
          {formatFollowerCount(followerCount)}位朋友
        </Text>

        {/* Two action buttons side by side */}
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={styles.shareButton}
            activeOpacity={0.7}
            onPress={() => setQrVisible(true)}
          >
            <Text style={styles.shareButtonText}>分享個人檔案</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.editButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Text style={styles.editButtonText}>編輯個人資訊</Text>
          </TouchableOpacity>
        </View>

        {/* Contact buttons */}
        <View style={styles.contactSection}>
          {profile?.phone ? (
            <TouchableOpacity
              style={styles.contactButton}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(`tel:${profile.phone}`).catch(() => {})}
            >
              <Phone size={20} color={COLORS.gray900} />
              <Text style={styles.contactButtonText}>電話</Text>
            </TouchableOpacity>
          ) : null}

          {user?.email ? (
            <TouchableOpacity
              style={styles.contactButton}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(`mailto:${user.email}`).catch(() => {})}
            >
              <Mail size={20} color={COLORS.gray900} />
              <Text style={styles.contactButtonText}>E-mail</Text>
            </TouchableOpacity>
          ) : null}

          {biolinks
            .filter((bl) => bl.is_active)
            .map((bl) => (
              <TouchableOpacity
                key={bl.id}
                style={styles.contactButton}
                activeOpacity={0.7}
                onPress={() => handleOpenBiolink(bl.url)}
              >
                {(bl as any).icon_url ? (
                  <Image source={{ uri: (bl as any).icon_url }} style={styles.biolinkIcon} />
                ) : (
                  <Link size={20} color={COLORS.gray900} />
                )}
                <Text style={styles.contactButtonText}>
                  {bl.label || bl.platform}
                </Text>
              </TouchableOpacity>
            ))}

          {!profile?.phone && !user?.email && biolinks.filter((bl) => bl.is_active).length === 0 && (
            <Text style={styles.emptyText}>尚無聯繫方式</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
    paddingTop: 12,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIconBtn: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  profileLeft: {
    flex: 1,
    marginRight: 16,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  usernameText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
    lineHeight: 22,
  },
  verifiedIcon: {
    marginLeft: 6,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray100,
  },
  bio: {
    fontSize: 14,
    color: COLORS.gray700,
    lineHeight: 22,
    marginBottom: 12,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    columnGap: 12,
    rowGap: 4,
    marginBottom: 12,
  },
  tag: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagPrimary: {
    color: COLORS.piktag600,
    fontWeight: '500',
  },
  tagSecondary: {
    color: COLORS.gray500,
  },
  friendCount: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 20,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  shareButton: {
    flex: 1,
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  editButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  contactSection: {
    gap: 12,
  },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.gray100,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 10,
  },
  contactButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  biolinkIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: COLORS.gray100,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray400,
  },
});
