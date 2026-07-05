// EventAttendeesScreen — "這場的人" room list (event-tag rework 方向三,
// founder 2026-07-03). Scanning an event QR used to connect you to the
// HOST only; the real multiplier is attendee↔attendee (a 20-person room
// is 190 potential edges, not 19). Reached from the post-connect offer in
// UserDetailScreen after the viewer explicitly opted in (privacy opt-in;
// set_event_visibility validates real membership server-side).
//
// Data comes exclusively from the event_attendees RPC, which enforces:
// reciprocity (you must be visible to see the room), ranking-checklist #4
// (is_official excluded) and #3 (anyone the viewer dismissed on ANY
// surface never resurfaces here). Connecting reuses the established
// shapes: both connection rows + the session's event tags as private
// connection tags on both sides + an auto-follow.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Users } from 'lucide-react-native';
import { type ColorPalette } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { resolveTagIdsByName, attachPrivateTagsToConnections } from '../lib/userTags';
import { trackFriendAdded } from '../lib/analytics';
import InitialsAvatar from '../components/InitialsAvatar';

type Attendee = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_connected: boolean;
};

type Props = {
  navigation: any;
  route: { params?: { sessionId?: string } };
};

export default function EventAttendeesScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const sessionId = route.params?.sessionId;
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [sessionMeta, setSessionMeta] = useState<{
    tags: string[];
    date: string;
    location: string;
  }>({ tags: [], date: '', location: '' });

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const [{ data: rows }, { data: session }] = await Promise.all([
          supabase.rpc('event_attendees', { p_session_id: sessionId }),
          supabase
            .from('piktag_scan_sessions')
            .select('event_tags, event_date, event_location')
            .eq('id', sessionId)
            .maybeSingle(),
        ]);
        setAttendees(((rows ?? []) as Attendee[]));
        setSessionMeta({
          tags: ((session as any)?.event_tags ?? []) as string[],
          date: String((session as any)?.event_date ?? ''),
          location: String((session as any)?.event_location ?? ''),
        });
      } catch {
        /* list stays empty; the empty state explains itself */
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Insert-or-fetch one direction of the connection pair. ignoreDuplicates
  // (NOT a plain upsert) so an existing row's met_at/note are never
  // clobbered — e.g. when they already added the viewer first.
  const ensureConnRow = useCallback(
    async (ownerId: string, otherId: string, note: string): Promise<string | null> => {
      const { data: inserted } = await supabase
        .from('piktag_connections')
        .upsert(
          {
            user_id: ownerId,
            connected_user_id: otherId,
            met_at: new Date().toISOString(),
            met_location: sessionMeta.location || null,
            note: note || null,
          },
          { onConflict: 'user_id,connected_user_id', ignoreDuplicates: true },
        )
        .select('id')
        .maybeSingle();
      if ((inserted as any)?.id) return (inserted as any).id as string;
      const { data: existing } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', ownerId)
        .eq('connected_user_id', otherId)
        .maybeSingle();
      return ((existing as any)?.id as string | undefined) ?? null;
    },
    [sessionMeta.location],
  );

  const handleConnect = useCallback(
    async (p: Attendee) => {
      if (!user?.id || busyIds.has(p.user_id)) return;
      setBusyIds((cur) => new Set(cur).add(p.user_id));
      try {
        const note = [sessionMeta.date, sessionMeta.location].filter(Boolean).join(' · ');
        const fwdId = await ensureConnRow(user.id, p.user_id, note);
        const revId = await ensureConnRow(p.user_id, user.id, note);

        // The occasion travels with the pair: session tags + date +
        // location as private connection tags on BOTH rows (the same
        // treatment the host↔scanner pair already gets).
        const tagNames = [...sessionMeta.tags];
        if (sessionMeta.date.trim()) tagNames.push(sessionMeta.date.trim());
        if (sessionMeta.location.trim()) tagNames.push(sessionMeta.location.trim());
        const connIds = [fwdId, revId].filter((x): x is string => !!x);
        if (tagNames.length > 0 && connIds.length > 0) {
          // Shared resolve + idempotent attach (lib/userTags ONE-source rule).
          const tagIds = await resolveTagIdsByName(tagNames);
          await attachPrivateTagsToConnections(connIds, tagIds);
        }

        try {
          await supabase.from('piktag_follows').upsert(
            { follower_id: user.id, following_id: p.user_id },
            { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
          );
        } catch {
          /* best-effort */
        }

        trackFriendAdded({ source: 'event_room' });
        setAttendees((cur) =>
          cur.map((a) => (a.user_id === p.user_id ? { ...a, is_connected: true } : a)),
        );
      } catch (e) {
        console.warn('[EventAttendees] connect failed:', e);
      } finally {
        setBusyIds((cur) => {
          const next = new Set(cur);
          next.delete(p.user_id);
          return next;
        });
      }
    },
    [user?.id, busyIds, ensureConnRow, sessionMeta],
  );

  const renderItem = ({ item }: { item: Attendee }) => (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.rowIdentity}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('UserDetail', { userId: item.user_id })}
      >
        {/* Shared avatar component (consistency rule: never hand-roll a
            fallback the app already owns). */}
        <InitialsAvatar
          name={item.full_name || item.username}
          avatarUrl={item.avatar_url}
          size={44}
        />
        <View style={styles.nameWrap}>
          <Text style={styles.name} numberOfLines={1}>
            {item.full_name || item.username || ''}
          </Text>
          {item.username ? (
            <Text style={styles.username} numberOfLines={1}>
              @{item.username}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {item.is_connected ? (
        <View style={styles.connectedPill}>
          <Check size={14} color={colors.gray500} />
          <Text style={styles.connectedText}>
            {t('eventRoom.connected', { defaultValue: '已是好友' })}
          </Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.connectBtn, busyIds.has(item.user_id) && styles.connectBtnBusy]}
          activeOpacity={0.85}
          disabled={busyIds.has(item.user_id)}
          onPress={() => handleConnect(item)}
        >
          <Text style={styles.connectBtnText}>
            {t('eventRoom.connect', { defaultValue: '加好友' })}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.6}
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
        >
          <ArrowLeft size={24} color={colors.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('eventRoom.title', { defaultValue: '這場的人' })}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={attendees}
        keyExtractor={(item) => item.user_id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Users size={28} color={colors.piktag500} />
              </View>
              <Text style={styles.emptyText}>
                {t('eventRoom.empty', {
                  defaultValue: '還沒有其他人加入名單 — 晚點再回來看看。',
                })}
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    backBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: c.gray900,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingBottom: 24,
      flexGrow: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      gap: 12,
    },
    rowIdentity: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minWidth: 0,
    },
    nameWrap: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      fontSize: 15,
      fontWeight: '600',
      color: c.gray900,
    },
    username: {
      fontSize: 13,
      color: c.gray400,
      marginTop: 1,
    },
    connectBtn: {
      backgroundColor: c.piktag500,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    connectBtnBusy: {
      opacity: 0.5,
    },
    connectBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
    connectedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    connectedText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.gray500,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 14,
    },
    emptyIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: c.piktag50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: c.gray500,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
}
