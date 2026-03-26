import React, { useState, useCallback, useReducer } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  CheckCircle2,

  Tag,
  Calendar,
  MapPin,
  FileText,
  Globe,
  Instagram,
  Facebook,
  Linkedin,
  Twitter,
  Youtube,
  Plus,
  Edit3,
  Trash2,
  Pin,
  Gift,
  Heart,
  Clock,
  Bell,
  ExternalLink,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import PlatformIcon from '../components/PlatformIcon';
import InitialsAvatar from '../components/InitialsAvatar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Connection, PiktagProfile, Note, Biolink } from '../types';

type ReminderField = 'birthday' | 'anniversary' | 'contract_expiry';
const REMINDER_LABEL_KEYS: Record<ReminderField, string> = {
  birthday: 'friendDetail.reminderBirthday',
  anniversary: 'friendDetail.reminderAnniversary',
  contract_expiry: 'friendDetail.reminderContractExpiry',
};

type BiolinkType = 'instagram' | 'facebook' | 'youtube' | 'twitter' | 'linkedin' | 'website' | 'other';

type FriendDetailScreenProps = {
  navigation: any;
  route: any;
};

function getBiolinkIcon(type: BiolinkType) {
  const iconProps = { size: 20, color: COLORS.gray600 };
  switch (type) {
    case 'instagram':
      return <Instagram {...iconProps} />;
    case 'facebook':
      return <Facebook {...iconProps} />;
    case 'youtube':
      return <Youtube {...iconProps} />;
    case 'twitter':
      return <Twitter {...iconProps} />;
    case 'linkedin':
      return <Linkedin {...iconProps} />;
    default:
      return <Globe {...iconProps} />;
  }
}

const NOTE_COLORS = ['#FEF3C7', '#DBEAFE', '#D1FAE5', '#FCE7F3', '#EDE9FE', '#FEE2E2'];

type FriendData = {
  connection: Connection | null;
  profile: PiktagProfile | null;
  tags: string[];
  notes: Note[];
  biolinks: Biolink[];
  mutualFriends: number;
  mutualTags: number;
  followerCount: number;
  scanEventTags: string[];
};

const initialFriendData: FriendData = {
  connection: null,
  profile: null,
  tags: [],
  notes: [],
  biolinks: [],
  mutualFriends: 0,
  mutualTags: 0,
  followerCount: 0,
  scanEventTags: [],
};

type FriendDataAction =
  | { type: 'SET_INITIAL'; payload: Partial<FriendData> }
  | { type: 'SET_SCAN_EVENT_TAGS'; scanEventTags: string[] }
  | { type: 'SET_MUTUAL_TAGS'; mutualTags: number }
  | { type: 'SET_NOTES'; notes: Note[] };

function friendDataReducer(state: FriendData, action: FriendDataAction): FriendData {
  switch (action.type) {
    case 'SET_INITIAL':
      return { ...state, ...action.payload };
    case 'SET_SCAN_EVENT_TAGS':
      return { ...state, scanEventTags: action.scanEventTags };
    case 'SET_MUTUAL_TAGS':
      return { ...state, mutualTags: action.mutualTags };
    case 'SET_NOTES':
      return { ...state, notes: action.notes };
    default:
      return state;
  }
}

export default function FriendDetailScreen({ navigation, route }: FriendDetailScreenProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { connectionId, friendId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [friendData, dispatchFriendData] = useReducer(friendDataReducer, initialFriendData);
  const { connection, profile, tags, notes, biolinks, mutualFriends, mutualTags, followerCount, scanEventTags } = friendData;

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // Unfollow confirm modal
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);

  // Pick Tag Modal state (shown after follow, or via "標籤" button)
  const [pickTagModalVisible, setPickTagModalVisible] = useState(false);
  const [friendPublicTags, setFriendPublicTags] = useState<{ id: string; name: string }[]>([]);
  const [pickedTagIds, setPickedTagIds] = useState<Set<string>>(new Set());
  const [pickTagLoading, setPickTagLoading] = useState(false);

  // Hidden tags state (private tags only I can see)
  const [hiddenTags, setHiddenTags] = useState<{ id: string; tagId: string; name: string }[]>([]);
  const [hiddenTagInput, setHiddenTagInput] = useState('');
  const [addingHiddenTag, setAddingHiddenTag] = useState(false);

  // CRM reminder state
  const [birthday, setBirthday] = useState<string>('');
  const [anniversary, setAnniversary] = useState<string>('');
  const [contractExpiry, setContractExpiry] = useState<string>('');
  const [editingReminder, setEditingReminder] = useState<ReminderField | null>(null);
  const [reminderInput, setReminderInput] = useState('');

  // Note editing state
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);

  const fetchData = useCallback(async () => {
    if (!user || !friendId) return;

    try {
      setLoading(true);

      // Phase 1: all independent queries in parallel
      const [
        connResult,
        profileResult,
        notesResult,
        biolinksResult,
        connTagsResult,
        myConnectionsResult,
        friendConnectionsResult,
      ] = await Promise.all([
        connectionId
          ? supabase.from('piktag_connections').select('*').eq('id', connectionId).single()
          : Promise.resolve({ data: null, error: null }),
        supabase.from('piktag_profiles').select('*').eq('id', friendId).single(),
        supabase
          .from('piktag_notes')
          .select('*')
          .eq('user_id', user.id)
          .eq('target_user_id', friendId)
          .order('is_pinned', { ascending: false })
          .order('updated_at', { ascending: false }),
        supabase
          .from('piktag_biolinks')
          .select('*')
          .eq('user_id', friendId)
          .eq('is_active', true)
          .order('position', { ascending: true }),
        connectionId
          ? supabase
              .from('piktag_connection_tags')
              .select('*, tag:piktag_tags!tag_id(*)')
              .eq('connection_id', connectionId)
          : Promise.resolve({ data: null, error: null }),
        supabase.from('piktag_connections').select('connected_user_id').eq('user_id', user.id),
        supabase.from('piktag_connections').select('id, connected_user_id').eq('user_id', friendId),
      ]);

      const connData = connResult.data;

      // Batch all phase-1 state into a single dispatch (1 re-render instead of 8)
      const mutualFriendsCount = (() => {
        if (!myConnectionsResult.data || !friendConnectionsResult.data) return 0;
        const myFriendIds = new Set(myConnectionsResult.data.map((c: any) => c.connected_user_id));
        return friendConnectionsResult.data.filter((c: any) =>
          myFriendIds.has(c.connected_user_id),
        ).length;
      })();

      // Fetch friend's follower count + check if following
      const [followerResult, followingResult] = await Promise.all([
        supabase.from('piktag_follows').select('id', { count: 'exact', head: true }).eq('following_id', friendId),
        supabase.from('piktag_follows').select('id').eq('follower_id', user!.id).eq('following_id', friendId).single(),
      ]);
      const fFollowerCount = followerResult.count;
      setIsFollowing(!!followingResult.data);

      dispatchFriendData({
        type: 'SET_INITIAL',
        payload: {
          connection: connData ?? null,
          profile: profileResult.data ?? null,
          notes: notesResult.data ?? [],
          biolinks: biolinksResult.data ?? [],
          tags: connTagsResult.data
            ? connTagsResult.data
                .map((ct: any) => (ct.tag?.name ? `#${ct.tag.name}` : ''))
                .filter(Boolean)
            : [],
          mutualFriends: mutualFriendsCount,
          followerCount: fFollowerCount ?? 0,
        },
      });

      if (connData) {
        setBirthday(connData.birthday || '');
        setAnniversary(connData.anniversary || '');
        setContractExpiry(connData.contract_expiry || '');
      }

      // Phase 2: queries that depend on phase 1 results (run in parallel)
      const phase2: Promise<void>[] = [];

      // Scan session tags (depends on connData.scan_session_id)
      if (connData?.scan_session_id) {
        phase2.push(
          supabase
            .from('piktag_scan_sessions')
            .select('event_tags')
            .eq('id', connData.scan_session_id)
            .single()
            .then(({ data }) => {
              if (data?.event_tags)
                dispatchFriendData({ type: 'SET_SCAN_EVENT_TAGS', scanEventTags: data.event_tags });
            }),
        );
      }

      // Mutual tags — compare user_tags (public tags), not connection_tags
      if (user && friendId) {
        phase2.push(
          Promise.all([
            supabase
              .from('piktag_user_tags')
              .select('tag_id')
              .eq('user_id', user.id)
              .eq('is_private', false),
            supabase
              .from('piktag_user_tags')
              .select('tag_id')
              .eq('user_id', friendId)
              .eq('is_private', false),
          ]).then(([myTagsResult, friendTagsResult]) => {
            if (myTagsResult.data && friendTagsResult.data) {
              const myTagIds = new Set(myTagsResult.data.map((t: any) => t.tag_id));
              dispatchFriendData({
                type: 'SET_MUTUAL_TAGS',
                mutualTags: new Set(
                  friendTagsResult.data
                    .filter((t: any) => myTagIds.has(t.tag_id))
                    .map((t: any) => t.tag_id),
                ).size,
              });
            }
          }),
        );
      }

      if (phase2.length > 0) await Promise.all(phase2);
    } catch (err) {
      console.error('Error fetching friend data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, connectionId, friendId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  // --- Note CRUD ---
  const handleAddNote = async () => {
    if (!user || !friendId || !noteContent.trim()) return;

    const { data, error } = await supabase
      .from('piktag_notes')
      .insert({
        user_id: user.id,
        target_user_id: friendId,
        content: noteContent.trim(),
        color: noteColor,
        is_pinned: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding note:', error);
      Alert.alert(t('common.error'), t('friendDetail.alertNoteAddError'));
      return;
    }

    if (data) {
      dispatchFriendData({ type: 'SET_NOTES', notes: [data, ...notes] });
    }
    setNoteContent('');
    setNoteColor(NOTE_COLORS[0]);
    setIsAddingNote(false);
  };

  const handleUpdateNote = async () => {
    if (!editingNoteId || !noteContent.trim()) return;

    const { data, error } = await supabase
      .from('piktag_notes')
      .update({
        content: noteContent.trim(),
        color: noteColor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingNoteId)
      .select()
      .single();

    if (error) {
      console.error('Error updating note:', error);
      Alert.alert(t('common.error'), t('friendDetail.alertNoteUpdateError'));
      return;
    }

    if (data) {
      dispatchFriendData({ type: 'SET_NOTES', notes: notes.map((n) => (n.id === editingNoteId ? data : n)) });
    }
    setNoteContent('');
    setNoteColor(NOTE_COLORS[0]);
    setEditingNoteId(null);
  };

  const handleDeleteNote = (noteId: string) => {
    Alert.alert(t('friendDetail.alertDeleteNoteTitle'), t('friendDetail.alertDeleteNoteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('piktag_notes')
            .delete()
            .eq('id', noteId);

          if (error) {
            console.error('Error deleting note:', error);
            Alert.alert(t('common.error'), t('friendDetail.alertNoteDeleteError'));
            return;
          }
          dispatchFriendData({ type: 'SET_NOTES', notes: notes.filter((n) => n.id !== noteId) });
        },
      },
    ]);
  };

  const handleTogglePin = async (note: Note) => {
    const { data, error } = await supabase
      .from('piktag_notes')
      .update({ is_pinned: !note.is_pinned })
      .eq('id', note.id)
      .select()
      .single();

    if (error) {
      console.error('Error toggling pin:', error);
      return;
    }

    if (data) {
      dispatchFriendData({
        type: 'SET_NOTES',
        notes: notes
          .map((n) => (n.id === note.id ? data : n))
          .sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          }),
      });
    }
  };

  const startEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setNoteContent(note.content);
    setNoteColor(note.color);
    setIsAddingNote(false);
  };

  // Fetch friend's public tags for the pick modal — returns tags array
  const fetchFriendPublicTags = useCallback(async (): Promise<{ id: string; name: string }[]> => {
    if (!friendId) return [];
    const { data } = await supabase
      .from('piktag_user_tags')
      .select('tag_id, piktag_tags!inner(id, name)')
      .eq('user_id', friendId)
      .eq('is_private', false);

    if (data) {
      const tags = data
        .map((ut: any) => ({ id: ut.piktag_tags?.id, name: ut.piktag_tags?.name }))
        .filter((t: any) => t.id && t.name);
      setFriendPublicTags(tags);
      return tags;
    }
    return [];
  }, [friendId]);

  // Load already-picked tags for this connection
  const loadPickedTags = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase
      .from('piktag_connection_tags')
      .select('tag_id')
      .eq('connection_id', connectionId);
    if (data) {
      setPickedTagIds(new Set(data.map((ct: any) => ct.tag_id)));
    }
  }, [connectionId]);

  // Open pick tag modal
  const openPickTagModal = useCallback(async () => {
    await fetchFriendPublicTags();
    await loadPickedTags();
    setPickTagModalVisible(true);
  }, [fetchFriendPublicTags, loadPickedTags]);

  // Toggle a tag selection in the modal
  const togglePickTag = (tagId: string) => {
    setPickedTagIds(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  // Save picked tags
  const handleSavePickedTags = async () => {
    if (!connectionId || !user) return;
    setPickTagLoading(true);
    try {
      // Delete existing connection_tags for this connection
      await supabase.from('piktag_connection_tags').delete().eq('connection_id', connectionId);

      // Insert picked ones
      if (pickedTagIds.size > 0) {
        const rows = Array.from(pickedTagIds).map(tagId => ({
          connection_id: connectionId,
          tag_id: tagId,
        }));
        await supabase.from('piktag_connection_tags').insert(rows);
      }

      setPickTagModalVisible(false);
    } catch (err) {
      console.error('Save picked tags error:', err);
      Alert.alert(t('common.error'), t('friendDetail.alertPickTagError'));
    } finally {
      setPickTagLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!user || !friendId || followLoading) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        setFollowLoading(false);
        setUnfollowModalVisible(true);
        return;
      } else {
        await supabase.from('piktag_follows').insert({ follower_id: user.id, following_id: friendId });
        setIsFollowing(true);

        // After follow success → show Pick Tag modal only if friend has public tags
        const tags = await fetchFriendPublicTags();
        if (tags.length > 0) {
          await loadPickedTags();
          setPickTagModalVisible(true);
        }
      }
    } catch (err) {
      console.error('Follow toggle error:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  // --- Hidden tags (private) ---
  const fetchHiddenTags = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase
      .from('piktag_connection_tags')
      .select('id, tag_id, piktag_tags!inner(name)')
      .eq('connection_id', connectionId)
      .eq('is_private', true);
    if (data) {
      setHiddenTags(data.map((ct: any) => ({
        id: ct.id,
        tagId: ct.tag_id,
        name: ct.piktag_tags?.name || '',
      })));
    }
  }, [connectionId]);

  // Fetch hidden tags on load
  useFocusEffect(
    useCallback(() => {
      if (connectionId) fetchHiddenTags();
    }, [connectionId, fetchHiddenTags])
  );

  const handleAddHiddenTag = async () => {
    const name = hiddenTagInput.trim().replace(/^#/, '');
    if (!name || !connectionId || !user) return;
    setAddingHiddenTag(true);
    try {
      // Find or create tag
      let tagId: string;
      const { data: existing } = await supabase.from('piktag_tags').select('id').eq('name', name).single();
      if (existing) {
        tagId = existing.id;
      } else {
        const { data: newTag } = await supabase.from('piktag_tags').insert({ name }).select('id').single();
        if (!newTag) { setAddingHiddenTag(false); return; }
        tagId = newTag.id;
      }

      // Insert as private connection tag
      await supabase.from('piktag_connection_tags').insert({
        connection_id: connectionId,
        tag_id: tagId,
        is_private: true,
      });

      setHiddenTagInput('');
      fetchHiddenTags();
    } catch (err) {
      console.error('Add hidden tag error:', err);
    } finally {
      setAddingHiddenTag(false);
    }
  };

  const handleRemoveHiddenTag = async (ctId: string) => {
    await supabase.from('piktag_connection_tags').delete().eq('id', ctId);
    setHiddenTags(prev => prev.filter(t => t.id !== ctId));
  };

  const handleConfirmUnfollow = async () => {
    if (!user || !friendId) return;
    setUnfollowModalVisible(false);
    await supabase.from('piktag_follows').delete().eq('follower_id', user.id).eq('following_id', friendId);
    setIsFollowing(false);
  };

  const handleOpenLink = async (url: string, biolinkId: string) => {
    // Track click
    if (user) {
      supabase
        .from('piktag_biolink_clicks')
        .insert({ biolink_id: biolinkId, clicker_user_id: user.id })
        .then(({ error }) => {
          if (error) console.warn('Biolink click tracking failed:', error.message);
        });
    }
    Linking.openURL(url).catch((err) => {
      console.warn('Failed to open URL:', err);
      Alert.alert(t('common.error'), t('friendDetail.alertOpenLinkError'));
    });
  };

  // CRM Reminder handlers
  const handleSaveReminder = async (field: ReminderField) => {
    if (!connectionId || !reminderInput.trim()) {
      setEditingReminder(null);
      return;
    }

    // Validate date format (YYYY-MM-DD or MM-DD)
    let dateStr = reminderInput.trim();
    if (/^\d{1,2}-\d{1,2}$/.test(dateStr)) {
      const [mm, dd] = dateStr.split('-');
      const month = mm.padStart(2, '0');
      const day = dd.padStart(2, '0');
      const m = parseInt(month, 10);
      const d = parseInt(day, 10);
      if (m < 1 || m > 12 || d < 1 || d > 31) {
        Alert.alert(t('common.error'), t('friendDetail.alertInvalidDate'));
        return;
      }
      dateStr = `2000-${month}-${day}`;
    }

    const { error } = await supabase
      .from('piktag_connections')
      .update({ [field]: dateStr })
      .eq('id', connectionId);

    if (error) {
      Alert.alert(t('common.error'), t('friendDetail.alertSaveReminderError'));
    } else {
      if (field === 'birthday') setBirthday(dateStr);
      if (field === 'anniversary') setAnniversary(dateStr);
      if (field === 'contract_expiry') setContractExpiry(dateStr);
    }
    setEditingReminder(null);
    setReminderInput('');
  };

  const handleClearReminder = async (field: ReminderField) => {
    if (!connectionId) return;

    const { error } = await supabase
      .from('piktag_connections')
      .update({ [field]: null })
      .eq('id', connectionId);

    if (!error) {
      if (field === 'birthday') setBirthday('');
      if (field === 'anniversary') setAnniversary('');
      if (field === 'contract_expiry') setContractExpiry('');
    }
  };

  const formatReminderDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      // Parse date string safely (avoid timezone issues with date-only strings)
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length >= 3) {
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        return `${month}/${day}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerName} numberOfLines={1}>...</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.piktag500} />
        </View>
      </View>
    );
  }

  const displayName = connection?.nickname || profile?.full_name || profile?.username || 'Unknown';
  const username = profile?.username || '';
  const verified = profile?.is_verified || false;
  const avatarUrl = profile?.avatar_url || null;
  const metDate = connection?.met_at || '';
  const metLocation = connection?.met_location || '';
  const connectionNote = connection?.note || '';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>
          {username}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Threads style layout */}
        <View style={styles.profileSection}>
          {/* Avatar + Name/Username */}
          <View style={styles.profileRow}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <InitialsAvatar name={displayName} size={56} style={styles.avatar} />
            )}
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.fullName}>{displayName}</Text>
                {verified && (
                  <CheckCircle2 size={16} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
                )}
              </View>
              <Text style={styles.usernameText}>@{username}</Text>
            </View>
          </View>

          {/* Bio (max 3 lines) */}
          {profile?.bio ? <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text> : null}

          {/* Tags */}
          {tags.length > 0 && (
            <View style={styles.tagsWrap}>
              {tags.map((tag, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('TagDetail', { tagName: tag.replace('#', ''), initialTab: 'explore' })}
                >
                  <Text style={styles.tagChipText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Stats — subtle one line, doesn't steal from tags */}
          <Text style={styles.statsLine}>
            <Text style={[styles.statNumber, mutualTags > 0 && { color: COLORS.piktag600 }]}>{mutualTags}</Text>
            <Text style={styles.statLabel}>{t('friendDetail.mutualTagsLabel')}</Text>
            <Text style={styles.statDot}> · </Text>
            <Text style={styles.statNumber}>{mutualFriends}</Text>
            <Text style={styles.statLabel}>{t('friendDetail.mutualFriendsLabel')}</Text>
            <Text style={styles.statDot}> · </Text>
            <Text style={styles.statNumber}>{followerCount}</Text>
            <Text style={styles.statLabel}>{t('friendDetail.followersLabel')}</Text>
          </Text>

          {/* Action buttons — Follow logic */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity
              style={[
                styles.followButton,
                isFollowing ? styles.followButtonFollowing : styles.followButtonDefault,
              ]}
              onPress={handleToggleFollow}
              activeOpacity={0.8}
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={isFollowing ? COLORS.gray700 : COLORS.white} />
              ) : (
                <Text style={isFollowing ? styles.followButtonTextFollowing : styles.followButtonTextDefault}>
                  {isFollowing ? t('friendDetail.following') : t('friendDetail.follow')}
                </Text>
              )}
            </TouchableOpacity>
            {isFollowing && (
              <TouchableOpacity
                style={styles.tagButton}
                activeOpacity={0.7}
                onPress={openPickTagModal}
              >
                <Text style={styles.tagButtonText}>{t('friendDetail.tagAction')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ===== Hidden Tags (only I can see) ===== */}
        {isFollowing && (
          <View style={styles.hiddenTagSection}>
            <View style={styles.hiddenTagHeader}>
              <Text style={styles.hiddenTagTitle}>🔒 {t('friendDetail.hiddenTagsTitle')}</Text>
            </View>

            {/* Existing hidden tags */}
            {hiddenTags.length > 0 && (
              <View style={styles.hiddenTagsWrap}>
                {hiddenTags.map((ht) => (
                  <View key={ht.id} style={styles.hiddenTagChip}>
                    <Text style={styles.hiddenTagChipText}>#{ht.name}</Text>
                    <TouchableOpacity onPress={() => handleRemoveHiddenTag(ht.id)} activeOpacity={0.6} style={styles.hiddenTagRemove}>
                      <Text style={styles.hiddenTagRemoveText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add hidden tag input */}
            <View style={styles.hiddenTagInputRow}>
              <TextInput
                style={styles.hiddenTagInput}
                value={hiddenTagInput}
                onChangeText={setHiddenTagInput}
                placeholder={t('friendDetail.hiddenTagPlaceholder')}
                placeholderTextColor={COLORS.gray400}
                returnKeyType="done"
                onSubmitEditing={handleAddHiddenTag}
              />
              <TouchableOpacity
                style={[styles.hiddenTagAddBtn, (!hiddenTagInput.trim() || addingHiddenTag) && { opacity: 0.5 }]}
                onPress={handleAddHiddenTag}
                disabled={!hiddenTagInput.trim() || addingHiddenTag}
                activeOpacity={0.7}
              >
                <Text style={styles.hiddenTagAddText}>{t('common.add')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ===== SECTION 2: Social Links — IG Highlights style circles ===== */}
        {biolinks.length > 0 && (
          <View style={styles.socialSection}>
            <Text style={styles.sectionTitle}>{t('friendDetail.biolinksTitle')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.socialScrollContent}>
              {biolinks.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.socialCircleItem}
                  onPress={() => handleOpenLink(link.url, link.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.socialCircleRing}>
                    <View style={styles.socialCircleInner}>
                      <PlatformIcon platform={link.platform} size={28} />
                    </View>
                  </View>
                  <Text style={styles.socialCircleLabel} numberOfLines={1}>
                    {link.label || link.platform}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ===== SECTION 3: Link Bio — Linktree style cards ===== */}
        {biolinks.length > 0 && (
          <View style={styles.linkBioSection}>
            {biolinks.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.linkCard}
                onPress={() => handleOpenLink(link.url, link.id)}
                activeOpacity={0.7}
              >
                <PlatformIcon platform={link.platform} size={22} />
                <Text style={styles.linkCardText} numberOfLines={1}>
                  {link.label || link.platform}
                </Text>
                <ExternalLink size={16} color={COLORS.gray400} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ===== SECTION 4: CRM & Management (below the fold) ===== */}

        {/* Met Record Section */}
        {(metDate || metLocation || connectionNote || scanEventTags.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('friendDetail.metRecordTitle')}</Text>
            <View style={styles.recordCard}>
              {metDate ? (
                <>
                  <View style={styles.recordRow}>
                    <Calendar size={16} color={COLORS.gray400} />
                    <Text style={styles.recordLabel}>{t('friendDetail.metDateLabel')}</Text>
                    <Text style={styles.recordValue}>{metDate}</Text>
                  </View>
                  {(metLocation || connectionNote) && <View style={styles.recordDivider} />}
                </>
              ) : null}
              {metLocation ? (
                <>
                  <View style={styles.recordRow}>
                    <MapPin size={16} color={COLORS.gray400} />
                    <Text style={styles.recordLabel}>{t('friendDetail.metLocationLabel')}</Text>
                    <Text style={styles.recordValue}>{metLocation}</Text>
                  </View>
                  {connectionNote ? <View style={styles.recordDivider} /> : null}
                </>
              ) : null}
              {connectionNote ? (
                <>
                  <View style={styles.recordRow}>
                    <FileText size={16} color={COLORS.gray400} />
                    <Text style={styles.recordLabel}>{t('friendDetail.metNoteLabel')}</Text>
                    <Text style={[styles.recordValue, styles.recordNotes]}>{connectionNote}</Text>
                  </View>
                  {scanEventTags.length > 0 && <View style={styles.recordDivider} />}
                </>
              ) : null}
              {scanEventTags.length > 0 && (
                <View style={styles.recordRow}>
                  <Tag size={16} color={COLORS.gray400} />
                  <Text style={styles.recordLabel}>{t('friendDetail.eventTagsLabel')}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {scanEventTags.map((etag, i) => (
                      <TouchableOpacity key={i} style={styles.tagChip} activeOpacity={0.6}
                        onPress={() => navigation.navigate('TagDetail', { tagName: etag, initialTab: 'explore' })}>
                        <Text style={styles.tagChipText}>#{etag}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Sticky Notes Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('friendDetail.stickyNotesTitle')}</Text>
            <TouchableOpacity
              onPress={() => { setIsAddingNote(true); setEditingNoteId(null); setNoteContent(''); setNoteColor(NOTE_COLORS[0]); }}
              activeOpacity={0.7}
            >
              <Plus size={22} color={COLORS.gray600} />
            </TouchableOpacity>
          </View>

          {(isAddingNote || editingNoteId) && (
            <View style={[styles.noteForm, { backgroundColor: noteColor }]}>
              <TextInput
                style={styles.noteInput}
                placeholder={t('friendDetail.notePlaceholder')}
                placeholderTextColor={COLORS.gray400}
                value={noteContent}
                onChangeText={setNoteContent}
                multiline
                autoFocus
              />
              <View style={styles.noteColorRow}>
                {NOTE_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[styles.noteColorDot, { backgroundColor: color }, noteColor === color && styles.noteColorDotActive]}
                    onPress={() => setNoteColor(color)}
                  />
                ))}
              </View>
              <View style={styles.noteFormActions}>
                <TouchableOpacity style={styles.noteFormCancel} onPress={() => { setIsAddingNote(false); setEditingNoteId(null); setNoteContent(''); }}>
                  <Text style={styles.noteFormCancelText}>{t('friendDetail.noteCancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.noteFormSave} onPress={editingNoteId ? handleUpdateNote : handleAddNote}>
                  <Text style={styles.noteFormSaveText}>{editingNoteId ? t('friendDetail.noteUpdate') : t('friendDetail.noteAdd')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {notes.length === 0 && !isAddingNote && (
            <Text style={styles.emptyNotesText}>{t('friendDetail.noNotes')}</Text>
          )}
          {notes.map((note) => (
            <View key={note.id} style={[styles.noteCard, { backgroundColor: note.color || NOTE_COLORS[0] }]}>
              {note.is_pinned && (<View style={styles.notePinBadge}><Pin size={12} color={COLORS.gray600} /></View>)}
              <Text style={styles.noteCardText}>{note.content}</Text>
              <View style={styles.noteCardActions}>
                <TouchableOpacity onPress={() => handleTogglePin(note)} style={styles.noteActionBtn}>
                  <Pin size={16} color={note.is_pinned ? COLORS.piktag600 : COLORS.gray400} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => startEditNote(note)} style={styles.noteActionBtn}>
                  <Edit3 size={16} color={COLORS.gray400} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDeleteNote(note.id)} style={styles.noteActionBtn}>
                  <Trash2 size={16} color={COLORS.red500} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* CRM Reminders Section */}
        {connectionId && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('friendDetail.remindersTitle')}</Text>
            <View style={styles.recordCard}>
              {([
                { field: 'birthday' as ReminderField, value: birthday, icon: <Gift size={16} color={COLORS.pink500} /> },
                { field: 'anniversary' as ReminderField, value: anniversary, icon: <Heart size={16} color={COLORS.red500} /> },
                { field: 'contract_expiry' as ReminderField, value: contractExpiry, icon: <Clock size={16} color={COLORS.orange500} /> },
              ]).map((item, idx) => (
                <React.Fragment key={item.field}>
                  {idx > 0 && <View style={styles.recordDivider} />}
                  <View style={styles.reminderRow}>
                    {item.icon}
                    <Text style={styles.recordLabel}>{t(REMINDER_LABEL_KEYS[item.field])}</Text>
                    {editingReminder === item.field ? (
                      <View style={styles.reminderEditRow}>
                        <TextInput style={styles.reminderInput} placeholder={t('friendDetail.reminderPlaceholder')} placeholderTextColor={COLORS.gray400} value={reminderInput} onChangeText={setReminderInput} autoFocus onSubmitEditing={() => handleSaveReminder(item.field)} />
                        <TouchableOpacity onPress={() => handleSaveReminder(item.field)}>
                          <Text style={styles.reminderSaveBtn}>{t('friendDetail.reminderSave')}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.reminderValueRow} onPress={() => { setEditingReminder(item.field); setReminderInput(item.value || ''); }}>
                        <Text style={[styles.recordValue, !item.value && { color: COLORS.gray400 }]}>
                          {item.value ? formatReminderDate(item.value) : t('friendDetail.reminderSetPrompt')}
                        </Text>
                        {item.value && (
                          <TouchableOpacity onPress={() => handleClearReminder(item.field)} style={{ marginLeft: 8, padding: 4 }}>
                            <Text style={{ fontSize: 12, color: COLORS.red500 }}>{t('friendDetail.reminderClear')}</Text>
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </React.Fragment>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ====== Unfollow Confirm Modal ====== */}
      <Modal
        visible={unfollowModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setUnfollowModalVisible(false)}
      >
        <View style={styles.unfollowModalOverlay}>
          <View style={styles.unfollowModalContainer}>
            <Text style={styles.unfollowModalTitle}>{t('friendDetail.unfollowTitle')}</Text>
            <Text style={styles.unfollowModalMessage}>
              {t('friendDetail.unfollowMessage', { name: displayName })}
            </Text>
            <View style={styles.unfollowModalButtons}>
              <TouchableOpacity
                style={styles.unfollowModalCancelBtn}
                onPress={() => setUnfollowModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.unfollowModalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.unfollowModalConfirmBtn}
                onPress={handleConfirmUnfollow}
                activeOpacity={0.7}
              >
                <Text style={styles.unfollowModalConfirmText}>{t('friendDetail.unfollowConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ====== Pick Tag Modal ====== */}
      <Modal
        visible={pickTagModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPickTagModalVisible(false)}
      >
        <View style={styles.pickModalOverlay}>
          <View style={styles.pickModalContainer}>
            {/* Header */}
            <View style={styles.pickModalHeader}>
              <Text style={styles.pickModalTitle}>{t('friendDetail.pickTagTitle')}</Text>
              <TouchableOpacity onPress={() => setPickTagModalVisible(false)} activeOpacity={0.6}>
                <Text style={styles.pickModalCloseText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.pickModalSubtitle}>
              {t('friendDetail.pickTagSubtitle', { name: displayName })}
            </Text>

            {/* Tag list */}
            {friendPublicTags.length === 0 ? (
              <Text style={styles.pickModalEmpty}>{t('friendDetail.pickTagEmpty')}</Text>
            ) : (
              <View style={styles.pickModalTagsWrap}>
                {friendPublicTags.map((tag) => {
                  const isSelected = pickedTagIds.has(tag.id);
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      style={[styles.pickModalTag, isSelected && styles.pickModalTagSelected]}
                      onPress={() => togglePickTag(tag.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickModalTagText, isSelected && styles.pickModalTagTextSelected]}>
                        #{tag.name}
                      </Text>
                      {isSelected && <Text style={styles.pickModalCheck}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Save button */}
            <TouchableOpacity
              style={[styles.pickModalSaveBtn, pickTagLoading && { opacity: 0.7 }]}
              onPress={handleSavePickedTags}
              disabled={pickTagLoading}
              activeOpacity={0.8}
            >
              {pickTagLoading ? (
                <ActivityIndicator size="small" color={COLORS.gray900} />
              ) : (
                <Text style={styles.pickModalSaveText}>
                  {t('friendDetail.pickTagSave', { count: pickedTagIds.size })}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
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
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  backBtn: {
    padding: 4,
  },
  headerName: {
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
  },
  scrollContent: {
    paddingBottom: 100,
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.gray100,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fullName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  usernameText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  bio: {
    fontSize: 14,
    color: COLORS.gray700,
    lineHeight: 21,
    marginBottom: 12,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  tagChip: {
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray800,
  },
  nameSection: {
    flex: 1,
    gap: 2,
  },
  statsLine: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 14,
  },
  statNumber: {
    fontWeight: '700',
    color: COLORS.gray900,
  },
  statLabel: {
    color: COLORS.gray500,
  },
  statDot: {
    color: COLORS.gray400,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  followButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonDefault: {
    backgroundColor: COLORS.piktag500,
  },
  followButtonFollowing: {
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
  },
  followButtonTextDefault: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  followButtonTextFollowing: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  tagButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  // outlineButton kept below for other uses
  outlineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gray200,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 12,
  },
  recordCard: {
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    padding: 16,
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  recordLabel: {
    fontSize: 14,
    color: COLORS.gray500,
    width: 70,
  },
  recordValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray900,
    lineHeight: 20,
  },
  recordNotes: {
    fontWeight: '400',
    color: COLORS.gray700,
  },
  recordDivider: {
    height: 1,
    backgroundColor: COLORS.gray200,
    marginVertical: 10,
  },
  // Sticky Notes
  noteForm: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  noteInput: {
    fontSize: 15,
    color: COLORS.gray900,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  noteColorRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  noteColorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  noteColorDotActive: {
    borderColor: COLORS.gray700,
  },
  noteFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  noteFormCancel: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  noteFormCancelText: {
    fontSize: 14,
    color: COLORS.gray500,
    fontWeight: '600',
  },
  noteFormSave: {
    backgroundColor: COLORS.piktag500,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  noteFormSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  emptyNotesText: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 20,
  },
  noteCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  notePinBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  noteCardText: {
    fontSize: 15,
    color: COLORS.gray900,
    lineHeight: 22,
  },
  noteCardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 10,
  },
  noteActionBtn: {
    padding: 4,
  },
  // CRM Reminders
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  reminderEditRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reminderInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.gray900,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.piktag300,
    paddingVertical: 4,
  },
  reminderSaveBtn: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  reminderValueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Biolinks
  biolinksCard: {
    backgroundColor: COLORS.gray50,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  biolinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  biolinkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    width: 80,
  },
  biolinkUrl: {
    flex: 1,
    fontSize: 13,
    color: COLORS.gray500,
  },
  biolinkDivider: {
    height: 1,
    backgroundColor: COLORS.gray200,
  },

  // Social Section
  socialSection: {
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
    marginBottom: 6,
  },
  socialCircleInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.gray50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialCircleLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray700,
    textAlign: 'center',
  },

  // Link Bio (Linktree style)
  linkBioSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 12,
  },
  linkCardText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray900,
  },

  // Hidden Tags
  hiddenTagSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  hiddenTagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  hiddenTagTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  hiddenTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  hiddenTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 4,
  },
  hiddenTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
  },
  hiddenTagRemove: {
    paddingHorizontal: 2,
  },
  hiddenTagRemoveText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B45309',
  },
  hiddenTagInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  hiddenTagInput: {
    flex: 1,
    backgroundColor: COLORS.gray50,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.gray900,
    borderWidth: 1,
    borderColor: COLORS.gray200,
  },
  hiddenTagAddBtn: {
    backgroundColor: COLORS.gray900,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  hiddenTagAddText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Unfollow Modal
  unfollowModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  unfollowModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: 300,
    maxWidth: '85%',
    alignItems: 'center',
  },
  unfollowModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 8,
  },
  unfollowModalMessage: {
    fontSize: 15,
    color: COLORS.gray500,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  unfollowModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  unfollowModalCancelBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: COLORS.gray300,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unfollowModalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray700,
  },
  unfollowModalConfirmBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  unfollowModalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white,
  },

  // Pick Tag Modal
  pickModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickModalContainer: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '75%',
  },
  pickModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  pickModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  pickModalCloseText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  pickModalSubtitle: {
    fontSize: 14,
    color: COLORS.gray500,
    marginBottom: 20,
    lineHeight: 20,
  },
  pickModalEmpty: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    paddingVertical: 30,
  },
  pickModalTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  pickModalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.gray50,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
  },
  pickModalTagSelected: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  pickModalTagText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gray700,
  },
  pickModalTagTextSelected: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  pickModalCheck: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.piktag600,
  },
  pickModalSaveBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pickModalSaveText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.gray900,
  },
});
