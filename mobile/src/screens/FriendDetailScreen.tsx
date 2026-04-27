import React, { useState, useCallback, useReducer, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { shareProfile } from '../lib/shareProfile';
import { Image } from 'expo-image';
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
  Share2,
  MoreHorizontal,
  X,
  AlertTriangle,
  MessageCircle,
  Hash,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import PlatformIcon from '../components/PlatformIcon';
import InitialsAvatar from '../components/InitialsAvatar';
import OverlappingAvatars from '../components/OverlappingAvatars';
import HiddenTagEditor from '../components/HiddenTagEditor';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { Connection, PiktagProfile, Biolink } from '../types';
import { getViewerRelation, filterBiolinksByVisibility } from '../lib/biolinkVisibility';
import { calculateStrength, getStrengthLabel } from '../lib/connectionStrength';

type ReminderField = 'birthday';
const REMINDER_LABEL_KEYS: Record<ReminderField, string> = {
  birthday: 'friendDetail.reminderBirthday',
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

type FriendTag = {
  tagId: string;
  name: string;
  isPicked: boolean;    // I picked this tag for this friend
  isHidden: boolean;    // My private tag for this friend
  pickCount: number;    // How many people picked this tag on this friend
  isMutual: boolean;    // We share this tag
  isPinned: boolean;    // Friend pinned this tag
  position: number;     // Friend's own tag order
};

type FriendData = {
  connection: Connection | null;
  profile: PiktagProfile | null;
  tags: FriendTag[];
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
  | { type: 'SET_TAGS'; tags: FriendTag[] };

function friendDataReducer(state: FriendData, action: FriendDataAction): FriendData {
  switch (action.type) {
    case 'SET_INITIAL':
      return { ...state, ...action.payload };
    case 'SET_SCAN_EVENT_TAGS':
      return { ...state, scanEventTags: action.scanEventTags };
    case 'SET_MUTUAL_TAGS':
      return { ...state, mutualTags: action.mutualTags };
    case 'SET_TAGS':
      return { ...state, tags: action.tags };
    default:
      return state;
  }
}

export default function FriendDetailScreen({ navigation, route }: FriendDetailScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { connectionId, friendId } = route.params || {};

  // Analytics: track friend detail page view
  useEffect(() => {
    require('../lib/analytics').trackFriendDetailViewed();
  }, []);

  const [loading, setLoading] = useState(true);
  const [friendData, dispatchFriendData] = useReducer(friendDataReducer, initialFriendData);
  const { connection, profile, tags, biolinks, mutualFriends, mutualTags, followerCount, scanEventTags } = friendData;

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  // Message-button state — parallels UserDetailScreen.handleOpenChat.
  // The button sits between "追蹤中" and "標籤" so users can jump
  // straight into a 1:1 thread with this friend without bouncing
  // through the chat inbox first.
  const [messageLoading, setMessageLoading] = useState(false);

  // Unfollow confirm modal
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);

  // Pick Tag Modal state (shown after follow, or via "標籤" button)
  const [pickTagModalVisible, setPickTagModalVisible] = useState(false);
  const [friendPublicTags, setFriendPublicTags] = useState<{ id: string; name: string }[]>([]);
  const [pickedTagIds, setPickedTagIds] = useState<Set<string>>(new Set());

  // Close friend + more menu state
  const [isCloseFriend, setIsCloseFriend] = useState(false);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);

  // Mutual tags detail modal
  const [mutualTagNames, setMutualTagNames] = useState<{ id: string; name: string }[]>([]);
  const [mutualTagModalVisible, setMutualTagModalVisible] = useState(false);
  const [mutualFriendProfiles, setMutualFriendProfiles] = useState<any[]>([]);

  // Hidden tags state (private tags only I can see).
  // Add/remove logic lives in <HiddenTagEditor>; this component only owns the
  // list and refetches via fetchHiddenTags after any change.
  const [hiddenTags, setHiddenTags] = useState<{ id: string; tagId: string; name: string }[]>([]);

  // CRM reminder state
  const [birthday, setBirthday] = useState<string>('');
  const [editingReminder, setEditingReminder] = useState<ReminderField | null>(null);
  const [reminderInput, setReminderInput] = useState('');

  // Cancels the inflight fetchData when the screen blurs / the
  // friendId changes, so a slow network on a prior screen doesn't
  // write state for the wrong friend.
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!user || !friendId) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      setLoading(true);

      // Phase 1: all independent queries in parallel
      const [
        connResult,
        profileResult,
        biolinksResult,
        connTagsResult,
        myConnectionsResult,
        friendConnectionsResult,
      ] = await Promise.all([
        // `.maybeSingle()` — an invalid/expired connectionId shouldn't
        // throw, it should just fall through to "no connection found".
        connectionId
          ? supabase.from('piktag_connections').select('*').eq('id', connectionId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        // Profile can be missing if the user was deleted; the 404
        // render-path below expects a null, not a throw.
        supabase.from('piktag_profiles').select('*').eq('id', friendId).maybeSingle(),
        supabase
          .from('piktag_biolinks')
          .select('*')
          .eq('user_id', friendId)
          .eq('is_active', true)
          .order('position', { ascending: true }),
        supabase
          .from('piktag_user_tags')
          .select('*, tag:piktag_tags!tag_id(*)')
          .eq('user_id', friendId)
          .eq('is_private', false)
          .limit(500),
        supabase.from('piktag_connections').select('connected_user_id').eq('user_id', user.id).limit(2000),
        supabase.from('piktag_connections').select('id, connected_user_id').eq('user_id', friendId).limit(2000),
      ]);

      const connData = connResult.data;

      // Batch all phase-1 state into a single dispatch (1 re-render instead of 8)
      const mutualFriendsCount = (() => {
        if (!myConnectionsResult.data || !friendConnectionsResult.data) return 0;
        const myFriendIds = new Set(myConnectionsResult.data.map((c: any) => c.connected_user_id));
        const mutualIds = friendConnectionsResult.data
          .filter((c: any) => myFriendIds.has(c.connected_user_id))
          .map((c: any) => c.connected_user_id);
        // Fetch mutual friend profiles in background
        if (mutualIds.length > 0) {
          supabase
            .from('piktag_profiles')
            .select('id, username, full_name, avatar_url')
            .in('id', mutualIds.slice(0, 20))
            .then(({ data }) => { if (data) setMutualFriendProfiles(data); });
        }
        return mutualIds.length;
      })();

      // Fetch friend's follower count + check if following
      const [followerResult, followingResult] = await Promise.all([
        supabase.from('piktag_follows').select('id', { count: 'exact', head: true }).eq('following_id', friendId),
        supabase.from('piktag_follows').select('id').eq('follower_id', user!.id).eq('following_id', friendId).maybeSingle(),
      ]);
      const fFollowerCount = followerResult.count;
      setIsFollowing(!!followingResult.data);

      dispatchFriendData({
        type: 'SET_INITIAL',
        payload: {
          connection: connData ?? null,
          profile: profileResult.data ?? null,
          biolinks: filterBiolinksByVisibility(
            biolinksResult.data ?? [],
            await getViewerRelation(user?.id, friendId)
          ),
          tags: [], // will be set in phase 2 after pick data is fetched
          mutualFriends: mutualFriendsCount,
          followerCount: fFollowerCount ?? 0,
        },
      });

      if (connData) {
        setBirthday(connData.birthday || '');
      }

      // Check close friend status
      const { data: cfData } = await supabase
        .from('piktag_close_friends')
        .select('id')
        .eq('user_id', user.id)
        .eq('close_friend_id', friendId)
        .maybeSingle();
      setIsCloseFriend(!!cfData);

      // Phase 2: queries that depend on phase 1 results (run in parallel)
      const phase2: Promise<void>[] = [];

      // Scan session tags (depends on connData.scan_session_id)
      if (connData?.scan_session_id) {
        phase2.push(
          Promise.resolve(supabase
            .from('piktag_scan_sessions')
            .select('event_tags')
            .eq('id', connData.scan_session_id)
            .maybeSingle()
          ).then(({ data }) => {
            if (data?.event_tags)
              dispatchFriendData({ type: 'SET_SCAN_EVENT_TAGS', scanEventTags: data.event_tags });
          }),
        );
      }

      // Build enriched tags: friend's public user_tags + pick data + mutual check
      if (user && friendId && connTagsResult.data) {
        phase2.push((async () => {
          // 1. Get my tag_ids for mutual check
          const { data: myUserTags } = await supabase
            .from('piktag_user_tags')
            .select('tag_id')
            .eq('user_id', user.id)
            .eq('is_private', false)
            .limit(500);
          const myTagIds = new Set((myUserTags || []).map((t: any) => t.tag_id));

          // 2. Get my picked tags for this connection
          const myPickedTagIds = new Set<string>();
          if (connectionId) {
            const { data: myPicks } = await supabase
              .from('piktag_connection_tags')
              .select('tag_id')
              .eq('connection_id', connectionId)
              .eq('is_private', false);
            (myPicks || []).forEach((p: any) => myPickedTagIds.add(p.tag_id));
          }

          // 3. Get how many people picked each of friend's tags
          //    (count connection_tags referencing each tag for connections TO this friend)
          //
          // Previously this fetched ALL public picks for ALL tags on every
          // connection-to-friend row — for a popular user with 500 followers
          // and 100 tags-per-follower that's 50k rows we then threw 99% away.
          //
          // Optimization: scope the picks query to ONLY the friend's own tags
          // via .in('tag_id', friendTagIds). We don't care about any other tag.
          const friendTagIds = (connTagsResult.data || [])
            .map((ut: any) => ut.tag?.id || ut.tag_id)
            .filter(Boolean);

          const pickCountMap = new Map<string, number>();
          if (friendTagIds.length > 0) {
            const { data: allConnsToFriend } = await supabase
              .from('piktag_connections')
              .select('id')
              .eq('connected_user_id', friendId)
              .limit(2000);
            const connIdsToFriend = (allConnsToFriend || []).map((c: any) => c.id);

            if (connIdsToFriend.length > 0) {
              const { data: allPicks } = await supabase
                .from('piktag_connection_tags')
                .select('tag_id')
                .in('connection_id', connIdsToFriend)
                .in('tag_id', friendTagIds)
                .eq('is_private', false)
                .limit(5000);
              (allPicks || []).forEach((p: any) => {
                pickCountMap.set(p.tag_id, (pickCountMap.get(p.tag_id) || 0) + 1);
              });
            }
          }

          // 4. Build FriendTag array from friend's user_tags
          const friendTags: FriendTag[] = connTagsResult.data
            .filter((ut: any) => ut.tag?.name)
            .map((ut: any) => ({
              tagId: ut.tag.id || ut.tag_id,
              name: ut.tag.name,
              isPicked: myPickedTagIds.has(ut.tag.id || ut.tag_id),
              isHidden: false,
              pickCount: pickCountMap.get(ut.tag.id || ut.tag_id) || 0,
              isMutual: myTagIds.has(ut.tag.id || ut.tag_id),
              isPinned: ut.is_pinned || false,
              position: ut.position ?? 0,
            }));

          // 5a. Append hidden tags (my private tags for this friend)
          if (connectionId) {
            const { data: hiddenData } = await supabase
              .from('piktag_connection_tags')
              .select('tag_id, piktag_tags!inner(id, name)')
              .eq('connection_id', connectionId)
              .eq('is_private', true);
            if (hiddenData) {
              for (const ht of hiddenData) {
                const htName = (ht as any).piktag_tags?.name;
                if (!htName) continue;
                if (friendTags.some(t => t.tagId === ht.tag_id)) continue;
                friendTags.push({
                  tagId: ht.tag_id,
                  name: htName,
                  isPicked: false,
                  isHidden: true,
                  pickCount: 0,
                  isMutual: false,
                  isPinned: false,
                  position: 9999,
                });
              }
            }
          }

          // 5b. Sort: isPinned → pickCount (high→low) → position
          friendTags.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            if (a.pickCount !== b.pickCount) return b.pickCount - a.pickCount;
            return a.position - b.position;
          });

          dispatchFriendData({ type: 'SET_TAGS', tags: friendTags });

          // 6. Also set mutual tags count + names
          const mutualList = friendTags.filter(t => myTagIds.has(t.tagId));
          dispatchFriendData({ type: 'SET_MUTUAL_TAGS', mutualTags: mutualList.length });
          setMutualTagNames(mutualList.map(t => ({ id: t.tagId, name: t.name })));
        })());
      }

      if (phase2.length > 0) await Promise.all(phase2);
    } catch (err) {
      if (!signal.aborted) console.error('Error fetching friend data:', err);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [user, connectionId, friendId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      return () => {
        abortRef.current?.abort();
      };
    }, [fetchData])
  );

  // --- Note CRUD ---
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

  // --- Hidden tags (private) --- (must be before openPickTagModal)
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

  // Open pick tag modal (includes hidden tags)
  const openPickTagModal = useCallback(async () => {
    await Promise.all([fetchFriendPublicTags(), loadPickedTags(), fetchHiddenTags()]);
    setPickTagModalVisible(true);
  }, [fetchFriendPublicTags, loadPickedTags, fetchHiddenTags]);

  // Toggle a public tag pick. Writes live to the DB (INSERT on select,
  // DELETE on unselect) so there is no separate "儲存" step — the modal
  // becomes a pure live editor, matching how HiddenTagEditor already works.
  // Optimistic local update with revert-on-error.
  const togglePickTag = async (tagId: string) => {
    if (!connectionId) return;
    const wasPicked = pickedTagIds.has(tagId);
    setPickedTagIds(prev => {
      const next = new Set(prev);
      if (wasPicked) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
    try {
      if (wasPicked) {
        await supabase
          .from('piktag_connection_tags')
          .delete()
          .eq('connection_id', connectionId)
          .eq('tag_id', tagId)
          .eq('is_private', false);
      } else {
        await supabase
          .from('piktag_connection_tags')
          .insert({ connection_id: connectionId, tag_id: tagId, is_private: false });
      }
    } catch (err) {
      console.warn('togglePickTag failed:', err);
      // Revert optimistic update
      setPickedTagIds(prev => {
        const next = new Set(prev);
        if (wasPicked) next.add(tagId);
        else next.delete(tagId);
        return next;
      });
    }
  };

  // Refresh the friend page's visible tag chips + strength score after the
  // Pick Tag modal closes. Everything inside the modal is live-saved now
  // (togglePickTag + HiddenTagEditor both write on every tap), so all we need
  // is a one-shot refresh of the parent once the user dismisses the modal.
  const prevPickModalVisible = useRef(false);
  useEffect(() => {
    if (prevPickModalVisible.current && !pickTagModalVisible) {
      fetchData();
    }
    prevPickModalVisible.current = pickTagModalVisible;
  }, [pickTagModalVisible, fetchData]);

  const handleReport = async (reason: string) => {
    if (!user || !friendId) return;
    await supabase.from('piktag_reports').insert({ reporter_id: user.id, reported_id: friendId, reason });
    Alert.alert(t('friendDetail.reportedTitle') || '已檢舉', t('friendDetail.reportedMessage') || '感謝你的回報，我們會盡快處理');
  };

  const handleToggleCloseFriend = async () => {
    if (!user || !friendId) return;
    if (isCloseFriend) {
      await supabase.from('piktag_close_friends').delete()
        .eq('user_id', user.id).eq('close_friend_id', friendId);
      setIsCloseFriend(false);
    } else {
      await supabase.from('piktag_close_friends')
        .upsert({ user_id: user.id, close_friend_id: friendId }, { onConflict: 'user_id,close_friend_id' });
      setIsCloseFriend(true);
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
        const ftags = await fetchFriendPublicTags();
        if (ftags.length > 0) {
          await Promise.all([loadPickedTags(), fetchHiddenTags()]);
          setPickTagModalVisible(true);
        }
      }
    } catch (err) {
      console.error('Follow toggle error:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  // Fetch hidden tags on load
  useFocusEffect(
    useCallback(() => {
      if (connectionId) fetchHiddenTags();
    }, [connectionId, fetchHiddenTags])
  );

  const handleConfirmUnfollow = async () => {
    if (!user || !friendId) return;
    setUnfollowModalVisible(false);
    await supabase.from('piktag_follows').delete().eq('follower_id', user.id).eq('following_id', friendId);
    setIsFollowing(false);
  };

  // Resolves (or creates) a 1:1 conversation with this friend and
  // navigates to ChatThread. Mirrors the version in UserDetailScreen —
  // uses the Main → SearchTab → ChatThread nested navigation form
  // because FriendDetail, like UserDetail, lives in RootStack while
  // ChatThread is registered inside the SearchTab's SearchStack.
  const handleOpenChat = async () => {
    if (!user || !friendId || messageLoading) return;
    setMessageLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        other_user_id: friendId,
      });
      if (error) {
        const code = (error as any)?.code ?? '';
        const msg = (error.message ?? '').toLowerCase();
        if (code === 'blocked' || msg.includes('blocked')) {
          Alert.alert(t('chat.userBlocked'));
        } else if (code === 'invalid_participants' || msg.includes('invalid_participants')) {
          Alert.alert(t('chat.cannotMessageSelf'));
        } else {
          Alert.alert(error.message ?? 'Error');
        }
        return;
      }
      const conversationId =
        typeof data === 'string'
          ? data
          : (data as any)?.id ?? (data as any)?.conversation_id ?? data;
      (navigation as any).navigate('Main', {
        screen: 'SearchTab',
        params: {
          screen: 'ChatThread',
          params: {
            conversationId,
            otherUserId: friendId,
            otherDisplayName: profile?.full_name ?? profile?.username ?? '',
            otherAvatarUrl: profile?.avatar_url,
          },
        },
      });
    } catch (err) {
      console.warn('handleOpenChat error:', err);
    } finally {
      setMessageLoading(false);
    }
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

  // Connection strength (must be before any early return)
  const metDate = connection?.met_at || '';
  const strengthScore = useMemo(() => {
    const daysSinceMet = metDate ? Math.floor((Date.now() - new Date(metDate).getTime()) / 86400000) : 0;
    return calculateStrength({
      mutualTagCount: mutualTags,
      daysSinceMet,
      hasBirthday: !!birthday,
      hasAnniversary: false,
      hasContractExpiry: false,
      isCloseFriend,
      hiddenTagCount: hiddenTags.length,
      pickedTagCount: tags.filter(t => t.isPicked).length,
    });
  }, [metDate, mutualTags, birthday, isCloseFriend, hiddenTags, tags]);
  const strengthInfo = getStrengthLabel(strengthScore);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
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
  const metLocation = connection?.met_location || '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

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
        <TouchableOpacity
          style={styles.headerShareBtn}
          onPress={() => setMoreMenuVisible(true)}
          activeOpacity={0.6}
        >
          <MoreHorizontal size={24} color={COLORS.gray900} />
        </TouchableOpacity>
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
              <Image source={{ uri: avatarUrl }} style={styles.avatar} cachePolicy="memory-disk" />
            ) : (
              <InitialsAvatar name={displayName} size={56} style={styles.avatar} />
            )}
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.fullName}>{displayName}</Text>
                {/* {verified && (
                  <CheckCircle2 size={16} color={COLORS.blue500} fill={COLORS.blue500} strokeWidth={0} style={{ marginLeft: 4 }} />
                )} */}
              </View>
              <View style={styles.usernameRow}>
                <Text style={styles.usernameText}>@{username}</Text>
                <View style={[styles.strengthBadge, { backgroundColor: strengthInfo.color + '18' }]}>
                  <Text style={[styles.strengthText, { color: strengthInfo.color }]}>{strengthInfo.label}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Headline */}
          {profile?.headline ? <Text style={styles.headline}>{profile.headline}</Text> : null}

          {/* Bio (max 3 lines) */}
          {profile?.bio ? <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text> : null}

          {/* Tags — user tags + event tags combined */}
          {(tags.length > 0 || scanEventTags.length > 0) && (
            <View style={styles.tagsWrap}>
              {tags.map((tag) => (
                <TouchableOpacity
                  key={tag.tagId}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('TagDetail', { tagId: tag.tagId, tagName: tag.name, initialTab: 'explore' })}
                >
                  <Text style={styles.tagChipText}>
                    #{tag.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {scanEventTags.map((etag, i) => (
                <TouchableOpacity
                  key={`event-${i}`}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => navigation.navigate('TagDetail', { tagName: etag, initialTab: 'explore' })}
                >
                  <Text style={styles.tagChipText}>#{etag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Stats — subtle one line */}
          <View style={styles.statsLineRow}>
            {mutualTags > 0 ? (
              <TouchableOpacity onPress={() => setMutualTagModalVisible(true)} activeOpacity={0.6}>
                <Text style={styles.statTextClickable}>
                  <Text style={[styles.statNumber, { color: COLORS.piktag600 }]}>{mutualTags}</Text>
                  <Text style={{ color: COLORS.piktag600 }}>{t('friendDetail.mutualTagsLabel')}</Text>
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{mutualTags}</Text>
                <Text style={styles.statLabel}>{t('friendDetail.mutualTagsLabel')}</Text>
              </Text>
            )}
            <Text style={styles.statDot}>·</Text>
            <View style={styles.mutualAvatarsStat}>
              {mutualFriendProfiles.length > 0 && (
                <OverlappingAvatars users={mutualFriendProfiles} total={mutualFriends} size={22} max={3} />
              )}
              <Text style={[styles.statText, mutualFriendProfiles.length > 0 && { marginLeft: 6 }]}>
                <Text style={styles.statNumber}>{mutualFriends}</Text>
                <Text style={styles.statLabel}>{t('friendDetail.mutualFriendsLabel')}</Text>
              </Text>
            </View>
            <Text style={styles.statDot}>·</Text>
            <Text style={styles.statText}>
              <Text style={styles.statNumber}>{followerCount}</Text>
              <Text style={styles.statLabel}>{t('friendDetail.followersLabel')}</Text>
            </Text>
          </View>

          {/* Action buttons — IG style: [Follow] [Message] [Tag] */}
          <View style={styles.actionButtonsRow}>
            {isFollowing ? (
              <TouchableOpacity
                style={[styles.followButton, styles.followButtonFollowing]}
                onPress={handleToggleFollow}
                activeOpacity={0.8}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={COLORS.piktag600} />
                ) : (
                  <Text style={styles.followButtonTextFollowing}>
                    {t('friendDetail.following')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleToggleFollow} activeOpacity={0.8} disabled={followLoading} style={{ flex: 1 }}>
                <LinearGradient
                  colors={['#ff5757', '#c44dff', '#8c52ff']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.followButton, { borderRadius: 12 }]}
                >
                  {followLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.followButtonTextDefault}>
                      {t('friendDetail.follow')}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.messageButton}
              onPress={handleOpenChat}
              activeOpacity={0.8}
              disabled={messageLoading}
            >
              {messageLoading ? (
                <ActivityIndicator size="small" color={COLORS.gray700} />
              ) : (
                <Text style={styles.messageButtonText}>{t('friendDetail.sendMessage')}</Text>
              )}
            </TouchableOpacity>
            {isFollowing && (
              <TouchableOpacity
                style={styles.iconButton}
                activeOpacity={0.7}
                onPress={openPickTagModal}
              >
                <Hash size={18} color={COLORS.gray700} strokeWidth={2.5} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ===== NEW SECTION: Mutual Friends — FB / IG profile style horizontal avatars ===== */}
        {mutualFriendProfiles.length > 0 && (
          <View style={styles.mutualFriendsSection}>
            <Text style={styles.mutualFriendsSectionTitle}>
              {t('friendDetail.mutualFriendsSectionTitle')}
              <Text style={styles.mutualFriendsSectionCount}>  ·  {mutualFriends}</Text>
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.mutualFriendsScrollContent}
            >
              {mutualFriendProfiles.map((p) => {
                const displayName = p.full_name || p.username || '?';
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.mutualFriendTile}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('UserDetail', { userId: p.id })}
                  >
                    {p.avatar_url ? (
                      <Image
                        source={{ uri: p.avatar_url }}
                        style={styles.mutualFriendAvatar}
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={[styles.mutualFriendAvatar, styles.mutualFriendAvatarFallback]}>
                        <Text style={styles.mutualFriendAvatarFallbackText}>{displayName[0]}</Text>
                      </View>
                    )}
                    <Text style={styles.mutualFriendName} numberOfLines={1}>
                      {displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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

        {/* Event tags moved to tags section above bio */}

        {/* Birthday — read from profile (set during registration) */}
        {profile?.birthday && (
          <View style={styles.section}>
            <View style={styles.recordCard}>
              <View style={styles.reminderRow}>
                <Gift size={16} color={COLORS.pink500} />
                <Text style={styles.recordLabel}>{t('friendDetail.reminderBirthday')}</Text>
                <Text style={styles.recordValue}>{formatReminderDate(profile.birthday)}</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ====== Mutual Tags Modal ====== */}
      <Modal
        visible={mutualTagModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setMutualTagModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.mutualModalOverlay}
          activeOpacity={1}
          onPress={() => setMutualTagModalVisible(false)}
        >
          <View style={styles.mutualModalContainer}>
            <Text style={styles.mutualModalTitle}>{t('friendDetail.mutualTagsModalTitle')}</Text>
            <View style={styles.mutualModalTagsWrap}>
              {mutualTagNames.map((tag) => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.mutualModalTag}
                  activeOpacity={0.7}
                  onPress={() => {
                    setMutualTagModalVisible(false);
                    navigation.navigate('TagDetail', { tagId: tag.id, tagName: tag.name, initialTab: 'explore' });
                  }}
                >
                  <Text style={styles.mutualModalTagText}>#{tag.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

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
        <KeyboardAvoidingView
          style={styles.pickModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.pickModalContainer}>
            {/* Header (fixed) */}
            <View style={styles.pickModalHeader}>
              <Text style={styles.pickModalTitle}>{t('friendDetail.pickTagTitle')}</Text>
              <TouchableOpacity onPress={() => setPickTagModalVisible(false)} activeOpacity={0.6}>
                <Text style={styles.pickModalCloseText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
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
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Divider */}
            <View style={styles.pickModalDivider} />

            {/* Hidden tags section — tap-based editor with time / location /
                frequently-used chips to reduce keyboard friction */}
            <Text style={styles.pickModalSectionTitle}>{t('friendDetail.hiddenTagsTitle')}</Text>
            {connectionId && user && (
              <HiddenTagEditor
                connectionId={connectionId}
                userId={user.id}
                hiddenTags={hiddenTags}
                onTagsChanged={fetchHiddenTags}
              />
            )}
            </ScrollView>
            {/* No save button — all changes (public picks via togglePickTag
                and hidden tags via HiddenTagEditor) are written live on tap.
                The friend page refreshes once the modal closes. */}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* More Menu Modal */}
      <Modal visible={moreMenuVisible} transparent animationType="fade" onRequestClose={() => setMoreMenuVisible(false)}>
        <TouchableOpacity style={styles.moreOverlay} activeOpacity={1} onPress={() => setMoreMenuVisible(false)}>
          <View style={[styles.moreSheet, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => { setMoreMenuVisible(false); handleToggleCloseFriend(); }}
            >
              <Heart size={20} color={isCloseFriend ? COLORS.piktag600 : COLORS.gray600} fill={isCloseFriend ? COLORS.piktag600 : 'transparent'} />
              <Text style={[styles.moreItemText, isCloseFriend && { color: COLORS.piktag600 }]}>
                {isCloseFriend ? (t('friendDetail.closeFriendRemove') || '已設為摯友') : (t('friendDetail.closeFriendAdd') || '設為摯友')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                // Delegates to the shared helper so friend-intro shares
                // and own-profile shares use the same brand pitch +
                // download CTA template. Also avoids the iOS duplicate-
                // URL bug (rich-card preview + inline URL rendered
                // both) — the helper intentionally keeps the URL
                // inside the message body only.
                await shareProfile({
                  name: displayName || username,
                  username,
                  t,
                });
              }}
            >
              <Share2 size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('friendDetail.shareProfile') || '分享'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                if (!user || !friendId) return;
                await supabase.from('piktag_blocks')
                  .upsert({ blocker_id: user.id, blocked_id: friendId }, { onConflict: 'blocker_id,blocked_id' });
                Alert.alert(t('friendDetail.blockedTitle') || '已封鎖', t('friendDetail.blockedMessage') || '你將不再看到此用戶');
                if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main', { screen: 'HomeTab' });
              }}
            >
              <X size={20} color="#EF4444" />
              <Text style={[styles.moreItemText, { color: '#EF4444' }]}>{t('friendDetail.blockUser') || '封鎖'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setMoreMenuVisible(false);
                Alert.alert(
                  t('friendDetail.reportTitle') || '檢舉用戶',
                  t('friendDetail.reportMessage') || '請選擇檢舉原因',
                  [
                    { text: t('friendDetail.reportSpam') || '垃圾訊息', onPress: () => handleReport('spam') },
                    { text: t('friendDetail.reportHarassment') || '騷擾', onPress: () => handleReport('harassment') },
                    { text: t('friendDetail.reportFake') || '假帳號', onPress: () => handleReport('fake_account') },
                    { text: t('common.cancel') || '取消', style: 'cancel' },
                  ]
                );
              }}
            >
              <AlertTriangle size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('friendDetail.reportUser') || '檢舉'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreCancelBtn} onPress={() => setMoreMenuVisible(false)}>
              <Text style={styles.moreCancelText}>{t('common.cancel') || '取消'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
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
  headerShareBtn: {
    padding: 4,
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
    gap: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  usernameText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  strengthBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  strengthText: {
    fontSize: 11,
    fontWeight: '700',
  },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
    marginBottom: 4,
    paddingHorizontal: 20,
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
    // Bumped from 4→10 so the chip row has breathing room from the
    // stats row below. Previously the tight 4px combined with a
    // maxHeight:76 cap caused a third tag row to render under the
    // stats row, visually overlapping "0共同標籤 · 0共同朋友 · N追蹤者"
    // with the clipped tag pill.
    marginBottom: 10,
    // maxHeight + overflow removed: chip rows now grow to fit all
    // tags. Scan-driven auto-tags (event tag + date + location) plus
    // any manual picks can easily exceed 2 rows; we'd rather push the
    // stats/action buttons down than silently hide data.
  },
  tagChip: {
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tagChipPicked: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray600,
  },
  tagChipTextPicked: {
    color: COLORS.piktag600,
    fontWeight: '700',
  },
  nameSection: {
    flex: 1,
    gap: 2,
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
    borderColor: COLORS.piktag500,
  },
  followButtonTextDefault: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  followButtonTextFollowing: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  // Square icon button that sits between "追蹤中" and "標籤". Matches
  // UserDetailScreen.messageButton visually so the two screens feel
  // like the same surface when the user hops between them.
  messageButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  messageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  // More menu
  moreOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  moreSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 20 },
  moreItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.gray100 },
  moreItemText: { fontSize: 16, fontWeight: '500', color: COLORS.gray900 },
  moreCancelBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  moreCancelText: { fontSize: 16, fontWeight: '600', color: COLORS.piktag600 },
  tagButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
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
    color: '#FFFFFF',
  },
  // outlineButton kept below for other uses
  outlineButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.piktag500,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  outlineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
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
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 12,
    marginTop: 12,
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

  // Mutual Friends Section (FB/IG style horizontal avatars)
  mutualFriendsSection: {
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  mutualFriendsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    marginBottom: 12,
  },
  mutualFriendsSectionCount: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  mutualFriendsScrollContent: {
    gap: 14,
    paddingRight: 4,
  },
  mutualFriendTile: {
    alignItems: 'center',
    width: 64,
  },
  mutualFriendAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 6,
  },
  mutualFriendAvatarFallback: {
    backgroundColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutualFriendAvatarFallbackText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.gray600,
  },
  mutualFriendName: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.gray700,
    textAlign: 'center',
    maxWidth: 64,
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

  // Stats line
  statsLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  statText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  statTextClickable: {
    fontSize: 14,
  },
  mutualAvatarsStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Mutual Tags Modal
  mutualModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mutualModalContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    width: 300,
    maxWidth: '85%',
  },
  mutualModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.gray900,
    marginBottom: 16,
  },
  mutualModalTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  mutualModalTag: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.piktag500,
  },
  mutualModalTagText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.piktag600,
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
    backgroundColor: COLORS.piktag100,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.piktag200,
    gap: 4,
  },
  hiddenTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
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
    borderColor: COLORS.gray200,
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
    maxHeight: '88%',
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
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: COLORS.gray100,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  pickModalTagSelected: {
    backgroundColor: COLORS.piktag50,
    borderColor: COLORS.piktag500,
  },
  pickModalTagText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray600,
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
  pickModalDivider: {
    height: 1,
    backgroundColor: COLORS.gray100,
    marginVertical: 20,
  },
  pickModalSectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.gray500,
    marginBottom: 12,
  },
});
