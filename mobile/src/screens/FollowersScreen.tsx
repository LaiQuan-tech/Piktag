// FollowersScreen.tsx
//
// A plain list of the people who follow a given user.
//
// Reachable from three places, all passing { userId, displayName }:
//   • ProfileScreen   — tapping the "追蹤者" stat (your own followers)
//   • FriendDetail     — tapping the follower count of a friend
//   • UserDetail       — tapping the follower count of a stranger
//
// Before this screen existed the whole profile stats row was a single
// button that dumped every tap onto the Tribe constellation graph —
// so "tap your follower count" landed on an unrelated invite diagram.
// This is the honest destination: followers of X = piktag_follows
// rows where following_id = X; each row is that follower's profile.
//
// Rows navigate to UserDetail (the generic profile screen that
// resolves the viewer↔target relationship itself), so it works
// whether the follower is a friend, a stranger, or yourself.

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import RingedAvatar from '../components/RingedAvatar';
import BrandSpinner from '../components/loaders/BrandSpinner';

type Props = { navigation: any; route: any };

type FollowerProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

export default function FollowersScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const userId: string | undefined = route.params?.userId;

  const [followers, setFollowers] = useState<FollowerProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFollowers = useCallback(async () => {
    if (!userId) {
      setFollowers([]);
      setLoading(false);
      return;
    }
    try {
      const { data: rows, error } = await supabase
        .from('piktag_follows')
        .select('follower_id')
        .eq('following_id', userId)
        .limit(1000);
      if (error) throw error;

      const ids = Array.from(
        new Set((rows || []).map((r: any) => r.follower_id).filter(Boolean))
      );
      if (ids.length === 0) {
        setFollowers([]);
        return;
      }

      const { data: profs, error: pErr } = await supabase
        .from('piktag_profiles')
        .select('id, full_name, username, avatar_url')
        .in('id', ids);
      if (pErr) throw pErr;

      setFollowers((profs || []) as FollowerProfile[]);
    } catch (err) {
      console.warn('[Followers] fetch failed:', err);
      setFollowers([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchFollowers();
    }, [fetchFollowers])
  );

  const handleOpenProfile = useCallback(
    (id: string) => navigation.navigate('UserDetail', { userId: id }),
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: { item: FollowerProfile }) => {
      const name =
        item.full_name?.trim() ||
        item.username?.trim() ||
        t('common.unnamed', { defaultValue: 'Unnamed' });
      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => handleOpenProfile(item.id)}
          accessibilityRole="button"
          accessibilityLabel={name}
        >
          <RingedAvatar
            size={48}
            name={name}
            avatarUrl={item.avatar_url}
            ringStyle="none"
          />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>
              {name}
            </Text>
            {!!item.username && (
              <Text style={styles.rowUsername} numberOfLines={1}>
                @{item.username}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [handleOpenProfile, t]
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.white}
      />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={22} color={colors.gray900} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>
            {t('followers.title', { defaultValue: 'Followers' })}
          </Text>
          {!loading && followers.length > 0 && (
            <Text style={styles.headerSubtitle}>
              {t('followers.count', {
                count: followers.length,
                defaultValue: '{{count}} followers',
              })}
            </Text>
          )}
        </View>
        {/* Spacer to keep the title visually centered against the back btn */}
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <BrandSpinner size={32} />
        </View>
      ) : followers.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {t('followers.empty', { defaultValue: 'No followers yet' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={followers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: c.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.gray100,
    gap: 8,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.gray900 },
  headerSubtitle: { fontSize: 12, color: c.gray500, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 15, color: c.gray500, textAlign: 'center' },
  listContent: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', color: c.gray900 },
  rowUsername: { fontSize: 13, color: c.gray500, marginTop: 1 },
  });
}
