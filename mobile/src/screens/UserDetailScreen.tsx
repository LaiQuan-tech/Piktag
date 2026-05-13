import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  Alert,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  CheckCircle2,
  Link as LinkIcon,
  ExternalLink,
  Share2,
  MoreHorizontal,
  Heart,
  X,
  AlertTriangle,
  UserPlus,
  MessageCircle,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import PlatformIcon from '../components/PlatformIcon';
import OverlappingAvatars from '../components/OverlappingAvatars';
import RingedAvatar from '../components/RingedAvatar';
import HiddenTagEditor from '../components/HiddenTagEditor';
import ErrorState from '../components/ErrorState';
import PageLoader from '../components/loaders/PageLoader';
import BrandSpinner from '../components/loaders/BrandSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useAskFeed } from '../hooks/useAskFeed';
import { useNetInfoReconnect } from '../hooks/useNetInfoReconnect';
import type { PiktagProfile, Biolink } from '../types';
import { getViewerRelation, filterBiolinksByVisibility } from '../lib/biolinkVisibility';
import { shareProfile } from '../lib/shareProfile';
import { followUser } from '../lib/followUser';

type UserDetailScreenProps = {
  navigation: any;
  route: any;
};

export default function UserDetailScreen({ navigation, route }: UserDetailScreenProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user: authUser } = useAuth();
  // Same conditional-gradient logic as FriendDetailScreen / ProfileScreen.
  // useAskFeed only contains asks from 1st/2nd-degree connections, so
  // strangers (who aren't in the feed) will always render with the
  // subtle ring here — that's correct: their Ask wouldn't be visible
  // to this viewer anyway because the fan-out doesn't reach them.
  // Once they connect (follow / QR scan), the friend's Ask shows up in
  // the feed on the next refresh and the gradient appears.
  const { asks: askFeedAsks } = useAskFeed();
  const paramUserId = route.params?.userId;
  const paramUsername = route.params?.username;
  const paramSid = route.params?.sid;
  const paramTags = route.params?.tags; // Fallback tags encoded in QR URL
  const paramDate = route.params?.date;
  const paramLoc = route.params?.loc;

  // Vibe context tags — the tags + date + location encoded on the
  // Vibe's QR URL that brought the viewer here. Surfaced in the
  // tag picker as a NEW opt-in section. Replaces the old auto-
  // attach (which was wrong: silently labeling the host as
  // matching the Vibe's topic was a bug — see the 專利師 example
  // in commit 4148d72). With this list now visible + tappable,
  // the scanner can deliberately pick ones that actually describe
  // the host, instead of getting them all forced on.
  const vibeContextTags = useMemo(() => {
    const out: string[] = [];
    const push = (raw: string | undefined) => {
      const cleaned = raw?.trim().replace(/^#/, '');
      if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    };
    if (paramTags) {
      paramTags.split(',').forEach((t: string) => push(t));
    }
    push(paramDate);
    push(paramLoc);
    return out;
  }, [paramTags, paramDate, paramLoc]);

  const [resolvedUserId, setResolvedUserId] = useState<string | null>(paramUserId || null);
  const [loading, setLoading] = useState(true);
  // `loadError` separates "fetch threw" from "user genuinely doesn't
  // exist". Without this both paths landed on the same `!profile`
  // branch which always rendered "user not found" — misleading when
  // the real cause was a dropped network call.
  const [loadError, setLoadError] = useState<boolean>(false);
  const [profile, setProfile] = useState<PiktagProfile | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [biolinks, setBiolinks] = useState<Biolink[]>([]);
  const iconBiolinks = useMemo(
    () => biolinks.filter(bl => bl.display_mode === 'icon' || bl.display_mode === 'both'),
    [biolinks]
  );
  const cardBiolinks = useMemo(
    () => biolinks.filter(bl => bl.display_mode === 'card' || bl.display_mode === 'both'),
    [biolinks]
  );
  const [mutualFriends, setMutualFriends] = useState(0);
  const [mutualFriendProfiles, setMutualFriendProfiles] = useState<any[]>([]);
  const [mutualTags, setMutualTags] = useState(0);
  const [mutualTagList, setMutualTagList] = useState<{ id: string; name: string }[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [unfollowModalVisible, setUnfollowModalVisible] = useState(false);
  const [mutualTagModalVisible, setMutualTagModalVisible] = useState(false);
  const [isCloseFriend, setIsCloseFriend] = useState(false);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [similarUsers, setSimilarUsers] = useState<PiktagProfile[]>([]);
  const [showSimilar, setShowSimilar] = useState(false);
  const [similarMutualFriends, setSimilarMutualFriends] = useState<Map<string, any[]>>(new Map());

  // Pick Tag Modal
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [pickTagModalVisible, setPickTagModalVisible] = useState(false);
  const [friendPublicTags, setFriendPublicTags] = useState<{ id: string; name: string }[]>([]);
  const [pickedTagIds, setPickedTagIds] = useState<Set<string>>(new Set());
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Event info for QR-scan flow (shown above the "追蹤" button before adding friend).

  // Hidden tags state (private tags only I can see).
  // Add/remove logic lives in <HiddenTagEditor>.
  const [hiddenTags, setHiddenTags] = useState<{ id: string; tagId: string; name: string }[]>([]);

  // Event tags — viewer's QR-scan-derived tags, sourced from the
  // get_viewer_event_tags RPC. Rendered as a dedicated 活動標籤 chip
  // row above the 隱藏標籤 editor; tapping a chip toggles it as a
  // hidden tag on the current connection (same write path as
  // HiddenTagEditor's frequent-tag chips).
  const [eventTags, setEventTags] = useState<{ id: string; name: string }[]>([]);

  // Tracks the inflight fetchData pass so that navigating away (or the
  // target userId changing under us) cancels the stale work before its
  // setState calls land. Prior behavior: a slow network on a prior
  // screen would keep writing into state after we'd moved on.
  const abortRef = useRef<AbortController | null>(null);

  // Reset profile-scoped state synchronously when the target user
  // changes. React Navigation reuses this screen's component instance
  // when push'ing UserDetail → UserDetail with different params, so
  // without this clear the previous user's isFollowing / connectionId /
  // hiddenTags persist into the new render until fetchData completes
  // its network round-trip. The visible symptom: the inline
  // HiddenTagEditor (gated on `isFollowing && connectionId`) flashes
  // private hidden-tag chips from a friend onto a stranger's profile
  // for ~200-500ms — exactly the bug reported on @bohan.vc.
  //
  // useEffect (not useLayoutEffect) is sufficient because the data
  // race is against an async fetch, not against another synchronous
  // render. The cleared values are committed before fetchData's
  // setState calls land.
  useEffect(() => {
    setIsFollowing(false);
    setConnectionId(null);
    setHiddenTags([]);
    setEventTags([]);
    setIsCloseFriend(false);
    setMutualTags(0);
    setMutualTagList([]);
    setMutualFriends(0);
    setMutualFriendProfiles([]);
    setFollowerCount(0);
  }, [resolvedUserId, paramUsername]);

  const fetchData = useCallback(async () => {
    if (!authUser) return;

    // Cancel any previous inflight pass.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // Resolve userId: either passed directly or looked up from username.
    // `.maybeSingle()` — a missing username shouldn't throw, it should
    // render the "user not found" state.
    let userId = resolvedUserId;
    if (!userId && paramUsername) {
      const { data: lookupData, error: lookupErr } = await supabase
        .from('piktag_profiles')
        .select('id')
        .eq('username', paramUsername)
        .maybeSingle();
      if (signal.aborted) return;
      // Distinguish "lookup itself errored" (network / supabase
      // failure) from "lookup completed and found nothing" (genuine
      // 404). Only the first should flip the retry-able error state.
      if (lookupErr) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      if (lookupData) {
        userId = lookupData.id;
        setResolvedUserId(userId);
      } else {
        setLoadError(false);
        setLoading(false);
        return;
      }
    }
    if (!userId) return;

    try {
      setLoading(true);
      setLoadError(false);

      // --- Wave 1: one consolidated RPC instead of 13+ round-trips ---
      //
      // get_user_detail packs profile + biolinks + their-tags + my-tag-ids +
      // follower-count + follow-state + connection-id + close-friend-flag +
      // mutual-friend-count + mutual-tag-ids + pick-counts into a single
      // JSON payload. This is what powers the initial paint; the
      // similar-users strip below is fetched separately because it's
      // collapsible / beneath the fold.
      // Run the main RPC and the viewer-relation fetch in parallel —
      // they're independent and both gate the initial paint.
      const [detailResp, relation] = await Promise.all([
        supabase.rpc('get_user_detail', {
          target_user_id: userId,
        }),
        getViewerRelation(authUser.id, userId),
      ]);
      const detail = detailResp.data;
      const detailErr = detailResp.error;
      if (signal.aborted) return;

      if (detailErr || !detail) {
        // RPC actually errored — flag this as a retryable load failure
        // so the screen renders <ErrorState> with a retry button rather
        // than the misleading "user not found" empty state.
        console.warn('[UserDetail] get_user_detail failed:', detailErr);
        if (detailErr) setLoadError(true);
      }

      const d = (detail as any) || {};
      if (d.profile) setProfile(d.profile);

      // Biolinks: filter by viewer relation, same as prior direct query.
      if (Array.isArray(d.biolinks)) {
        setBiolinks(filterBiolinksByVisibility(d.biolinks, relation));
      }

      // Their tags: sort client-side using pick_counts + my_tag_ids
      // returned by the RPC (no extra round-trip for pick counts).
      const myTagIds = new Set<string>(Array.isArray(d.my_tag_ids) ? d.my_tag_ids : []);
      const pickCounts: Record<string, number> = d.pick_counts || {};
      if (Array.isArray(d.their_tags)) {
        const sorted = d.their_tags
          .filter((ut: any) => ut.tag?.name)
          .slice()
          .sort((a: any, b: any) => {
            const aPinned = a.is_pinned ? 1 : 0;
            const bPinned = b.is_pinned ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            const aPicked = pickedTagIds.has(a.tag_id) ? 1 : 0;
            const bPicked = pickedTagIds.has(b.tag_id) ? 1 : 0;
            if (aPicked !== bPicked) return bPicked - aPicked;
            const aPick = Number(pickCounts[a.tag_id] || 0);
            const bPick = Number(pickCounts[b.tag_id] || 0);
            if (aPick !== bPick) return bPick - aPick;
            const aIsMutual = myTagIds.has(a.tag_id) ? 1 : 0;
            const bIsMutual = myTagIds.has(b.tag_id) ? 1 : 0;
            if (aIsMutual !== bIsMutual) return bIsMutual - aIsMutual;
            return (a.position || 0) - (b.position || 0);
          });
        setTags(sorted.map((ut: any) => `#${ut.tag.name}`));

        // Mutual-tag list with names for the clickable modal.
        const mutualList = sorted
          .filter((ut: any) => myTagIds.has(ut.tag_id))
          .map((ut: any) => ({ id: ut.tag.id || ut.tag_id, name: ut.tag.name }));
        setMutualTags(mutualList.length);
        setMutualTagList(mutualList);
      }

      setFollowerCount(Number(d.follower_count || 0));
      setIsFollowing(!!d.is_following);
      setConnectionId(d.connection_id ?? null);
      setIsCloseFriend(!!d.is_close_friend);
      setMutualFriends(Number(d.mutual_friends || 0));

      // Fetch mutual friend profiles for overlapping avatars display
      if (Number(d.mutual_friends || 0) > 0) {
        Promise.all([
          supabase.from('piktag_connections').select('connected_user_id').eq('user_id', authUser.id),
          supabase.from('piktag_connections').select('connected_user_id').eq('user_id', userId),
        ]).then(([myConns, theirConns]) => {
          if (signal.aborted) return;
          if (myConns.data && theirConns.data) {
            const myFriendIds = new Set(myConns.data.map((c: any) => c.connected_user_id));
            const mutualIds = theirConns.data
              .filter((c: any) => myFriendIds.has(c.connected_user_id))
              .map((c: any) => c.connected_user_id);
            if (mutualIds.length > 0) {
              supabase.from('piktag_profiles').select('id, username, full_name, avatar_url')
                .in('id', mutualIds.slice(0, 20))
                .then(({ data }) => { if (data && !signal.aborted) setMutualFriendProfiles(data); });
            }
          }
        });
      }

      // --- Wave 2: similar-users bundle (RPC) + viewer event tags ---
      // Fires in parallel with no client-side dependency on wave 1's
      // completion, but we await it so the section populates before we
      // flip loading=false (keeps the UI from flashing an empty row).
      // get_viewer_event_tags is independent of the target user — it's
      // viewer-scoped — so it goes in the same parallel batch.
      const [similarResp, eventTagsResp] = await Promise.all([
        supabase.rpc('get_similar_users', {
          target_user_id: userId,
          max_results: 6,
        }),
        supabase.rpc('get_viewer_event_tags', { p_user: authUser.id }),
      ]);
      if (signal.aborted) return;

      const { data: similar, error: similarErr } = similarResp;
      if (!similarErr && similar) {
        const s = similar as any;
        const users: PiktagProfile[] = Array.isArray(s.users) ? s.users : [];
        setSimilarUsers(users);
        const mutualsObj = (s.mutuals || {}) as Record<string, any[]>;
        const mutualMap = new Map<string, any[]>();
        for (const uid of Object.keys(mutualsObj)) {
          mutualMap.set(uid, mutualsObj[uid] || []);
        }
        setSimilarMutualFriends(mutualMap);
      }

      const eventTagRows = (eventTagsResp.data ?? []) as Array<{ id: string; name: string; uses: number }>;
      setEventTags(eventTagRows.map((r) => ({ id: r.id, name: r.name })));
    } catch (err) {
      if (!signal.aborted) {
        console.error('Error fetching user data:', err);
        setLoadError(true);
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [authUser, resolvedUserId, paramUsername]);

  // Auto-retry when connectivity comes back, but only if the previous
  // attempt failed. Hands the trigger over to fetchData; it does its
  // own loading-state gating.
  useNetInfoReconnect(useCallback(() => {
    if (loadError) {
      fetchData();
    }
  }, [loadError, fetchData]));

  useFocusEffect(
    useCallback(() => {
      fetchData();
      return () => {
        // When the screen blurs (or unmounts), cancel any inflight RPC
        // so its setState calls don't fire against a stale target.
        abortRef.current?.abort();
      };
    }, [fetchData])
  );

  // --- QR event data helpers ---
  //
  // Extracted out of handleAddFriendFromQr so the same resolve/attach
  // logic can also be used by the "already-connected user scans a new
  // event QR" backfill effect further down. The previous version lived
  // inline inside handleAddFriendFromQr, which is why pre-existing
  // connections never picked up event tags (the enclosing function
  // early-returned before reaching the tag loop).

  // Resolve event tags, date and location from either the scan_sessions
  // table (preferred, richer) or from the QR URL params (fallback when
  // the session is local-only or the DB row has been pruned).
  const resolveEventData = useCallback(async (): Promise<{
    eventTags: string[];
    eventDate: string;
    eventLocation: string;
  }> => {
    let eventTags: string[] = [];
    let eventDate = '';
    let eventLocation = '';

    if (paramSid && !paramSid.startsWith('local_')) {
      const { data: session } = await supabase
        .from('piktag_scan_sessions')
        .select('event_tags, event_date, event_location')
        .eq('id', paramSid)
        .maybeSingle();
      if (session) {
        eventTags = session.event_tags || [];
        eventDate = session.event_date || '';
        eventLocation = session.event_location || '';
      }
    }

    // Fallback — URL-encoded tags/date/loc (used when sid is local_ or
    // when scan_sessions lookup miss)
    if (eventTags.length === 0 && paramTags) {
      eventTags = paramTags
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (!eventDate && paramDate) eventDate = paramDate;
    if (!eventLocation && paramLoc) eventLocation = paramLoc;

    return { eventTags, eventDate, eventLocation };
  }, [paramSid, paramTags, paramDate, paramLoc]);

  // Resolve a list of tag names into their piktag_tags.id values,
  // creating missing ones. Leading `#` is stripped to match AddTagScreen
  // and HiddenTagEditor conventions.
  const ensureTagIdsByName = useCallback(
    async (names: string[]): Promise<string[]> => {
      const ids: string[] = [];
      for (const rawName of names) {
        const clean = (rawName.startsWith('#') ? rawName.slice(1) : rawName).trim();
        if (!clean) continue;
        const { data: existing } = await supabase
          .from('piktag_tags')
          .select('id')
          .eq('name', clean)
          .maybeSingle();
        if (existing?.id) {
          ids.push(existing.id);
          continue;
        }
        const { data: created } = await supabase
          .from('piktag_tags')
          .insert({ name: clean })
          .select('id')
          .single();
        if (created?.id) ids.push(created.id);
      }
      return ids;
    },
    [],
  );

  // Attach tag IDs to the given connection(s) as private tags.
  // Idempotent — the UNIQUE (connection_id, tag_id) constraint combined
  // with ignoreDuplicates:true means calling this multiple times is a
  // no-op after the first success.
  const attachTagsToConnections = useCallback(
    async (connIds: Array<string | null | undefined>, tagIds: string[]) => {
      if (tagIds.length === 0) return;
      for (const cid of connIds) {
        if (!cid) continue;
        await supabase.from('piktag_connection_tags').upsert(
          tagIds.map((tid) => ({
            connection_id: cid,
            tag_id: tid,
            is_private: true,
          })),
          { onConflict: 'connection_id,tag_id', ignoreDuplicates: true },
        );
      }
    },
    [],
  );

  // --- QR Code add friend (when sid param is present) ---
  //
  // Handles the "press 追蹤 after a QR scan" path: creates (or resolves
  // existing) scanner→host + host→scanner connections, then attaches
  // event_tags + the date + the location as hidden tags on both sides.
  //
  // We intentionally do NOT early-return when connectionId already
  // exists (the pre-existing behavior). If the user scanned a new event
  // QR for someone they already know, we still want this event's
  // context tagged onto the existing connection. The upsert calls below
  // make this safe to run against an existing row without clobbering
  // the original met_at/note metadata.
  const handleAddFriendFromQr = useCallback(async () => {
    if (!authUser || !resolvedUserId || !paramSid) return;
    setAddFriendLoading(true);
    try {
      const { eventTags, eventDate, eventLocation } = await resolveEventData();
      const note = [eventDate, eventLocation].filter(Boolean).join(' · ');

      // Scanner → host. Only set the connection metadata on first insert
      // — subsequent QR scans for the same user shouldn't rewrite the
      // original met_at / note, so we check-first then insert. We DO
      // backfill scan_session_id when it was previously NULL (see
      // below).
      const { data: existingForward } = await supabase
        .from('piktag_connections')
        .select('id, scan_session_id')
        .eq('user_id', authUser.id)
        .eq('connected_user_id', resolvedUserId)
        .maybeSingle();

      // Forward (scanner → host). Two new-build invariants below:
      //   1. ALWAYS write scan_session_id on the insert.
      //   2. If the row already existed without a scan_session_id
      //      (scanner had already followed/added the host before
      //      meeting them via this Vibe), backfill it now — first
      //      Vibe wins, never overwrite an existing attribution.
      // Without (2), this scenario stays broken: A and B already
      // are friends, A creates Vibe X, B scans X → no new insert
      // happens, the existing row has no scan_session_id, so the
      // host's qr_group_members query never finds B in Vibe X's
      // member list.
      let forwardConnId: string | null = (existingForward as any)?.id ?? null;
      const existingForwardSid = (existingForward as any)?.scan_session_id ?? null;
      if (!forwardConnId) {
        const { data: inserted } = await supabase
          .from('piktag_connections')
          .insert({
            user_id: authUser.id,
            connected_user_id: resolvedUserId,
            met_at: new Date().toISOString(),
            met_location: eventLocation,
            note,
            scan_session_id: paramSid || null,
          })
          .select('id')
          .single();
        forwardConnId = inserted?.id ?? null;
      } else if (!existingForwardSid && paramSid) {
        await supabase
          .from('piktag_connections')
          .update({ scan_session_id: paramSid })
          .eq('id', forwardConnId);
      }

      // Host → scanner (reverse). Same no-clobber + backfill logic
      // — and critically, scan_session_id MUST be set here too. The
      // host's Vibe member list queries `user_id = host AND
      // scan_session_id = vibe` and the host's row is the REVERSE
      // direction, so without this the list is always empty when
      // a host opens their Vibe.
      const { data: existingReverse } = await supabase
        .from('piktag_connections')
        .select('id, scan_session_id')
        .eq('user_id', resolvedUserId)
        .eq('connected_user_id', authUser.id)
        .maybeSingle();

      let reverseConnId: string | null = (existingReverse as any)?.id ?? null;
      const existingReverseSid = (existingReverse as any)?.scan_session_id ?? null;
      if (!reverseConnId) {
        const { data: insertedReverse } = await supabase
          .from('piktag_connections')
          .insert({
            user_id: resolvedUserId,
            connected_user_id: authUser.id,
            met_at: new Date().toISOString(),
            met_location: eventLocation,
            note,
            scan_session_id: paramSid || null,
          })
          .select('id')
          .single();
        reverseConnId = insertedReverse?.id ?? null;
      } else if (!existingReverseSid && paramSid) {
        await supabase
          .from('piktag_connections')
          .update({ scan_session_id: paramSid })
          .eq('id', reverseConnId);
      }

      // Build the private-tag set from the Vibe context.
      //
      // Crucial directionality: these tags only go on the REVERSE
      // connection (host's view of the scanner), NEVER the forward
      // (scanner's view of the host). Reason — illustrated by the
      // canonical example:
      //
      //   I create a Vibe "find a patent attorney" tagged
      //   #專利師 #商標. The attorney scans my QR. With the old
      //   both-sides attach, the attorney's view of MY profile
      //   got #專利師 #商標 silently applied — labeling me as a
      //   patent attorney even though I'm the one seeking one.
      //   Every client of the attorney scanning future Vibes
      //   would compound the same noise on his side.
      //
      // The principle that surfaced after the rename to "Vibes":
      //   Vibe tags describe the kind of PERSON the Vibe is for,
      //   not the host who created it. They belong on the
      //   scanner from the host's perspective — that's it.
      //
      // Forward-side tagging (scanner's view of host) goes back
      // to the standard manual path: the scanner can open the
      // tag picker and add whatever tags they actually want to
      // remember the host by.
      const tagNames: string[] = [...eventTags];
      if (eventDate.trim()) tagNames.push(eventDate.trim());
      if (eventLocation.trim()) tagNames.push(eventLocation.trim());

      if (tagNames.length > 0 && reverseConnId) {
        const tagIds = await ensureTagIdsByName(tagNames);
        await attachTagsToConnections([reverseConnId], tagIds);
      }

      // Increment scan count (server-side RPC, best-effort)
      await supabase.rpc('increment_scan_count', { session_id: paramSid });

      if (forwardConnId) setConnectionId(forwardConnId);

      // Auto-follow the host after QR add-friend.
      //
      // Previously chained `.catch(() => {})` directly off the upsert —
      // PostgrestBuilder is only PromiseLike (has .then, no native .catch),
      // so that swallow was a type error and didn't actually catch
      // anything; rejections still bubbled to the outer try/catch and
      // would surface the QR-add error message even when the upsert was
      // the only thing that failed. Wrap in its own try/catch so the
      // success alert is decoupled from auto-follow's best-effort outcome.
      try {
        await supabase
          .from('piktag_follows')
          .upsert(
            { follower_id: authUser.id, following_id: resolvedUserId },
            { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
          );
      } catch (followErr) {
        console.warn('[UserDetail] auto-follow on QR scan failed:', followErr);
      }

      Alert.alert(
        t('scanResult.alertSuccessTitle'),
        t('scanResult.alertSuccessMessage', { name: profile?.full_name || '' }),
      );
    } catch (err) {
      console.error('Error adding friend from QR:', err);
      Alert.alert(t('common.error'), t('scanResult.alertAddFriendError'));
    }
    setAddFriendLoading(false);
  }, [
    authUser,
    resolvedUserId,
    paramSid,
    profile,
    t,
    resolveEventData,
    ensureTagIdsByName,
    attachTagsToConnections,
  ]);

  // Track which (paramSid, connectionId) pairs we've already backfilled
  // so the auto-backfill effect below never runs twice for the same
  // scan → connection combo, even across re-renders.
  const backfilledRef = useRef<Set<string>>(new Set());

  // Auto-backfill event tags when a user arrives at this screen via a
  // new event QR scan but ALREADY had a prior connection with the host.
  //
  // Prior behavior: handleToggleFollow gated the QR-tag-attach path on
  // `!connectionId && !isFollowing`, so a re-scan or scan-of-existing-
  // friend never applied the event's tags. This effect fills that gap
  // without requiring any button press — as soon as we know the
  // connection exists and we have a scan session, we silently attach
  // the event's tags, date, and location to both sides of the
  // connection. Idempotent thanks to the UPSERT-ignoreDuplicates in
  // attachTagsToConnections.
  useEffect(() => {
    if (!authUser || !resolvedUserId || !paramSid || !connectionId) return;
    const dedupeKey = `${paramSid}:${connectionId}`;
    if (backfilledRef.current.has(dedupeKey)) return;
    backfilledRef.current.add(dedupeKey);

    void (async () => {
      try {
        // ──────────────────────────────────────────────────────
        // Critical: backfill scan_session_id on BOTH directions.
        //
        // Without this, a friend who scans a host's Vibe QR
        // never appears in the host's Vibe member list — because
        // the member-list RPC queries
        //   WHERE user_id = host AND scan_session_id = vibe_id
        // against the host→scanner (reverse) row, and the row
        // exists (they're already friends) but its
        // scan_session_id is NULL (they were added pre-Vibe via
        // Search/Follow, or a previous Vibe didn't backfill).
        //
        // handleToggleFollow's QR branch is `if (!connectionId
        // && !isFollowing)` — it skips entirely when the friend
        // already exists. This effect is the only path that
        // catches the "already-friend scans a NEW Vibe" case.
        // First Vibe wins — never overwrite an existing
        // scan_session_id.
        const { data: reverse } = await supabase
          .from('piktag_connections')
          .select('id, scan_session_id')
          .eq('user_id', resolvedUserId)
          .eq('connected_user_id', authUser.id)
          .maybeSingle();

        const reverseConnId: string | null = (reverse as any)?.id ?? null;
        const reverseSid = (reverse as any)?.scan_session_id ?? null;

        // Backfill forward (scanner → host) when missing.
        const { data: forwardRow } = await supabase
          .from('piktag_connections')
          .select('scan_session_id')
          .eq('id', connectionId)
          .maybeSingle();
        if (!(forwardRow as any)?.scan_session_id) {
          await supabase
            .from('piktag_connections')
            .update({ scan_session_id: paramSid })
            .eq('id', connectionId);
        }

        // Backfill reverse (host → scanner) when missing.
        if (reverseConnId && !reverseSid) {
          await supabase
            .from('piktag_connections')
            .update({ scan_session_id: paramSid })
            .eq('id', reverseConnId);
        }

        // ──────────────────────────────────────────────────────
        // Attach the Vibe's tags to ONLY the reverse (host's
        // view of scanner). Same principle as handleAddFriendFromQr
        // — Vibe tags describe the kind of person the Vibe is
        // FOR, not the host who created it. The forward side
        // (scanner's view of host) is left untouched; the
        // scanner can manually pick tags via the picker if they
        // want.
        const { eventTags, eventDate, eventLocation } = await resolveEventData();
        const tagNames: string[] = [...eventTags];
        if (eventDate.trim()) tagNames.push(eventDate.trim());
        if (eventLocation.trim()) tagNames.push(eventLocation.trim());

        if (tagNames.length > 0 && reverseConnId) {
          const tagIds = await ensureTagIdsByName(tagNames);
          await attachTagsToConnections([reverseConnId], tagIds);
        }

        // Bump the host's scan_count so the Vibe shows the right
        // total even when the visit was an already-friend re-scan.
        await supabase.rpc('increment_scan_count', { session_id: paramSid });
      } catch (err) {
        // Silent — this is a best-effort enrichment. The user can still
        // add the tags manually from HiddenTagEditor if it fails.
        console.warn('QR event-tag backfill failed:', err);
      }
    })();
  }, [
    authUser,
    resolvedUserId,
    paramSid,
    connectionId,
    resolveEventData,
    ensureTagIdsByName,
    attachTagsToConnections,
  ]);

  // --- Pick Tag functions ---
  const fetchFriendPublicTags = useCallback(async (): Promise<{ id: string; name: string }[]> => {
    if (!resolvedUserId) return [];
    const { data } = await supabase
      .from('piktag_user_tags')
      .select('tag_id, piktag_tags!inner(id, name)')
      .eq('user_id', resolvedUserId)
      .eq('is_private', false);
    if (data) {
      const tags = data.map((ut: any) => ({ id: ut.piktag_tags?.id, name: ut.piktag_tags?.name })).filter((t: any) => t.id && t.name);
      setFriendPublicTags(tags);
      return tags;
    }
    return [];
  }, [resolvedUserId]);

  const loadPickedTags = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase.from('piktag_connection_tags').select('tag_id').eq('connection_id', connectionId).eq('is_private', false);
    if (data) setPickedTagIds(new Set(data.map((ct: any) => ct.tag_id)));
  }, [connectionId]);

  // Hidden (private) tag fetcher — declared here, ahead of openPickTagModal,
  // because openPickTagModal references it both inside the callback body
  // AND in the useCallback dep array. The dep array is evaluated eagerly
  // at render time; if fetchHiddenTags were declared later in the body
  // (as it was originally) the const binding would still be in TDZ at that
  // point and reading it would throw `ReferenceError: Cannot access
  // 'fetchHiddenTags' before initialization` on every render. Function
  // hoisting doesn't apply to `const` arrow declarations.
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

  // Toggle a hidden (private) tag by name on the current connection.
  // Drives the 活動標籤 chip row below — tap to add as a hidden tag,
  // tap again to remove. Mirrors the same insert/select-on-conflict
  // dance HiddenTagEditor.applyHiddenTag uses, so behavior is
  // consistent regardless of which surface the user toggles from.
  const toggleHiddenTagByName = useCallback(async (rawName: string, knownTagId?: string) => {
    if (!connectionId) return;
    const name = rawName.trim().replace(/^#/, '');
    if (!name) return;
    const existing = hiddenTags.find(h => h.name === name);
    try {
      if (existing) {
        await supabase.from('piktag_connection_tags').delete().eq('id', existing.id);
      } else {
        let tagId = knownTagId;
        if (!tagId) {
          const { data: row } = await supabase
            .from('piktag_tags')
            .select('id')
            .eq('name', name)
            .maybeSingle();
          if (row?.id) {
            tagId = row.id;
          } else {
            const { data: created, error: insertErr } = await supabase
              .from('piktag_tags')
              .insert({ name })
              .select('id')
              .single();
            if (created?.id) {
              tagId = created.id;
            } else if (insertErr && (insertErr as any).code === '23505') {
              // Race-safe: another client beat us to creating the row.
              const { data: raced } = await supabase
                .from('piktag_tags')
                .select('id')
                .eq('name', name)
                .maybeSingle();
              if (!raced?.id) return;
              tagId = raced.id;
            } else {
              return;
            }
          }
        }
        await supabase.from('piktag_connection_tags').insert({
          connection_id: connectionId,
          tag_id: tagId,
          is_private: true,
        });
      }
      await fetchHiddenTags();
    } catch (err) {
      console.warn('[UserDetail] toggleHiddenTagByName failed:', err);
    }
  }, [connectionId, hiddenTags, fetchHiddenTags]);

  const openPickTagModal = useCallback(async () => {
    await Promise.all([fetchFriendPublicTags(), connectionId ? loadPickedTags() : Promise.resolve(), connectionId ? fetchHiddenTags() : Promise.resolve()]);
    setPickTagModalVisible(true);
  }, [fetchFriendPublicTags, loadPickedTags, fetchHiddenTags, connectionId]);

  // Toggle a public tag pick. Live-writes to DB — see FriendDetailScreen for
  // rationale (removes the "新增 vs 儲存" double-button confusion).
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
      setPickedTagIds(prev => {
        const next = new Set(prev);
        if (wasPicked) next.add(tagId);
        else next.delete(tagId);
        return next;
      });
    }
  };

  // Refresh user page after Pick Tag modal closes (everything inside is live).
  const prevPickModalVisible = useRef(false);
  useEffect(() => {
    if (prevPickModalVisible.current && !pickTagModalVisible) {
      fetchData();
    }
    prevPickModalVisible.current = pickTagModalVisible;
  }, [pickTagModalVisible, fetchData]);


  // Keep hiddenTags in sync whenever the connection changes — we show
  // the HiddenTagEditor inline on the profile, so the list needs to be
  // loaded without waiting for the user to open the Pick Tag modal.
  useEffect(() => {
    if (connectionId) {
      fetchHiddenTags();
    } else {
      setHiddenTags([]);
    }
  }, [connectionId, fetchHiddenTags]);

  const handleConfirmUnfollow = async () => {
    if (!authUser || !resolvedUserId) return;
    setUnfollowModalVisible(false);
    const { error } = await supabase.from('piktag_follows').delete().eq('follower_id', authUser.id).eq('following_id', resolvedUserId);
    if (error) {
      console.warn('unfollow failed:', error);
      Alert.alert(t('common.error'), t('common.unknownError'));
      return;
    }
    setIsFollowing(false);
    // Close-friend status was implicitly tied to following — once you
    // unfollow, the close-friend row is semantically stale ("X is my
    // close friend but I don't follow them"). Clear both DB row + UI
    // state so the badge / list elsewhere reflects reality.
    if (isCloseFriend) {
      await supabase
        .from('piktag_close_friends')
        .delete()
        .eq('user_id', authUser.id)
        .eq('close_friend_id', resolvedUserId);
      setIsCloseFriend(false);
    }
  };

  const reportUser = async (reason: string) => {
    if (!authUser || !resolvedUserId) return;
    const { error } = await supabase.from('piktag_reports').insert({
      reporter_id: authUser.id,
      reported_id: resolvedUserId,
      reason,
    });
    if (error) {
      console.warn('report insert failed:', error);
      Alert.alert(t('common.error'), t('common.unknownError'));
      return;
    }
    Alert.alert(t('userDetail.reportedTitle', { defaultValue: '已檢舉' }), t('userDetail.reportedMessage', { defaultValue: '感謝你的回報，我們會盡快處理' }));
  };

  const handleToggleCloseFriend = async () => {
    if (!authUser || !resolvedUserId) return;
    if (isCloseFriend) {
      const { error } = await supabase.from('piktag_close_friends').delete()
        .eq('user_id', authUser.id).eq('close_friend_id', resolvedUserId);
      if (error) {
        console.warn('close_friends delete failed:', error);
        return;
      }
      setIsCloseFriend(false);
    } else {
      // Ensure follow + connection exist first — otherwise the
      // close_friend row sits alone and the user vanishes from
      // ConnectionsScreen (which filters `connections ∩ follows`).
      // followUser() is idempotent. Same guard as FriendDetail.
      if (!isFollowing) {
        const { connectionId: connId, error: followErr } = await followUser(
          authUser.id,
          resolvedUserId,
        );
        if (followErr) {
          console.warn('close-friend pre-follow failed:', followErr);
          return;
        }
        setIsFollowing(true);
        if (connId && connId !== connectionId) setConnectionId(connId);
      }
      const { error } = await supabase.from('piktag_close_friends')
        .upsert({ user_id: authUser.id, close_friend_id: resolvedUserId }, { onConflict: 'user_id,close_friend_id' });
      if (error) {
        console.warn('close_friends upsert failed:', error);
        return;
      }
      setIsCloseFriend(true);
    }
  };

  const handleOpenChat = async () => {
    if (!authUser || !resolvedUserId || messageLoading) return;
    setMessageLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        other_user_id: resolvedUserId,
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
      const conversationId = typeof data === 'string' ? data : (data as any)?.id ?? (data as any)?.conversation_id ?? data;
      // ChatThread lives in RootStack alongside UserDetail, so a plain
      // push keeps the navigation history (TagDetail → UserDetail →
      // ChatThread → back returns to UserDetail).
      (navigation as any).navigate('ChatThread', {
        conversationId,
        otherUserId: resolvedUserId,
        otherDisplayName: profile?.full_name ?? profile?.username ?? '',
        otherAvatarUrl: profile?.avatar_url,
      });
    } catch (err) {
      console.warn('handleOpenChat error:', err);
    } finally {
      setMessageLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!authUser || !resolvedUserId || followLoading) return;

    // QR flow: follow + connection + event tags in one shot
    if (paramSid && !connectionId && !isFollowing) {
      setFollowLoading(true);
      await handleAddFriendFromQr();
      setIsFollowing(true);
      setFollowLoading(false);
      return;
    }

    setFollowLoading(true);
    try {
      if (isFollowing) {
        setFollowLoading(false);
        setUnfollowModalVisible(true);
        return;
      } else {
        // Shared helper handles both piktag_follows AND piktag_connections
        // atomically — see lib/followUser.ts. Returns the connection id
        // (existing or freshly created) so we can stash it for the
        // pickTag modal that fires below.
        const { connectionId: connId, error } = await followUser(authUser.id, resolvedUserId);
        if (error) {
          console.error('Error following:', error);
          return;
        }
        setIsFollowing(true);
        if (connId && connId !== connectionId) {
          setConnectionId(connId);
        }

        // Show Pick Tag modal if friend has public tags
        const ftags = await fetchFriendPublicTags();
        if (ftags.length > 0) {
          setPickTagModalVisible(true);
        }
      }
    } catch (err) {
      console.error('Unexpected error toggling follow:', err);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleOpenLink = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>...</Text>
          <View style={styles.headerSpacer} />
        </View>
        <PageLoader />
      </View>
    );
  }

  if (!profile) {
    // Two distinct empty cases: (1) the fetch errored and we should
    // offer retry + reassure the user that we'll auto-retry on
    // reconnect; (2) the lookup completed and the user genuinely
    // doesn't exist — keep the existing "not found" copy.
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.headerBackBtn}
            onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Connections')}
            activeOpacity={0.6}
          >
            <ArrowLeft size={24} color={COLORS.gray900} />
          </TouchableOpacity>
          <Text style={styles.headerUsername}>
            {loadError ? '' : t('userDetail.headerNotFound')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>
        {loadError ? (
          <ErrorState onRetry={fetchData} />
        ) : (
          <View style={styles.loadingContainer}>
            <Text style={styles.emptyText}>{t('userDetail.userNotFound')}</Text>
          </View>
        )}
      </View>
    );
  }

  const displayName = profile.full_name || profile.username || 'Unknown';
  const username = profile.username || '';
  const verified = profile.is_verified || false;
  const headline = profile.headline || '';
  const bio = profile.bio || '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={colors.white} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.headerBackBtn}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Connections")}
          activeOpacity={0.6}
        >
          <ArrowLeft size={24} color={COLORS.gray900} />
        </TouchableOpacity>
        <Text style={styles.headerUsername}>@{username}</Text>
        <TouchableOpacity
          style={styles.headerMoreBtn}
          onPress={() => setMoreMenuVisible(true)}
          activeOpacity={0.6}
        >
          <MoreHorizontal size={24} color={COLORS.gray900} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <View style={styles.profileRow}>
            <RingedAvatar
              size={68}
              ringStyle={
                resolvedUserId &&
                askFeedAsks.some((a) => a.author_id === resolvedUserId)
                  ? 'gradient'
                  : 'subtle'
              }
              name={displayName}
              avatarUrl={profile.avatar_url}
            />
            <View style={styles.nameSection}>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{displayName}</Text>
                {/* {verified && (
                  <CheckCircle2
                    size={16}
                    color={COLORS.blue500}
                    fill={COLORS.blue500}
                    strokeWidth={0}
                    style={styles.verifiedIcon}
                  />
                )} */}
              </View>
              <Text style={styles.usernameText}>@{username}</Text>
            </View>
          </View>

          {/* Headline */}
          {headline ? <Text style={styles.headline}>{headline}</Text> : null}

          {/* Bio */}
          {bio ? <Text style={styles.bio}>{bio}</Text> : null}

          {/* Tags — flat inline clickable chips */}
          {tags.length > 0 && (
            <View style={styles.tagsWrap}>
              {tags.map((tag, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.tagChip}
                  activeOpacity={0.6}
                  onPress={() => {
                    // Navigate to tag detail - need to find tag id first
                    navigation.navigate('TagDetail', { tagName: tag.replace('#', ''), initialTab: 'explore' });
                  }}
                >
                  <Text style={styles.tagChipText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Stats row order: mutual friends first (carries the visual
              overlapping-avatars cue, so it earns the lead spot), then
              mutual tags, then followers. Same order on FriendDetail. */}
          <View style={styles.statsRow}>
            <View style={styles.mutualAvatarsStat}>
              {mutualFriendProfiles.length > 0 && (
                <OverlappingAvatars users={mutualFriendProfiles} total={mutualFriends} size={24} max={3} />
              )}
              <Text style={[styles.statText, mutualFriendProfiles.length > 0 && { marginLeft: 6 }]}>
                <Text style={styles.statNumber}>{mutualFriends}</Text>{t('userDetail.statMutualFriends')}
              </Text>
            </View>
            <Text style={styles.statDot}>·</Text>
            {mutualTags > 0 ? (
              <TouchableOpacity onPress={() => setMutualTagModalVisible(true)} activeOpacity={0.6}>
                <Text style={styles.statTextClickable}>
                  <Text style={[styles.statNumber, { color: COLORS.piktag600 }]}>{mutualTags}</Text>
                  <Text style={{ color: COLORS.piktag600 }}>{t('userDetail.statMutualTags')}</Text>
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.statText}>
                <Text style={styles.statNumber}>{mutualTags}</Text>{t('userDetail.statMutualTags')}
              </Text>
            )}
            <Text style={styles.statDot}>·</Text>
            <Text style={styles.statText}>
              <Text style={styles.statNumber}>{followerCount}</Text>{t('userDetail.statFollowers')}
            </Text>
          </View>

          {/* Event-info card (QR scan context) was removed per user
              feedback: "all tags are attached to a person, not an
              event". Tags from the originating Vibe were displayed
              here in a distinct purple-bordered card before, but it
              created a false hierarchy — a tag on someone's
              profile should read the same whether it came from a
              scan context or the person picked it themselves. The
              tags still flow through to piktag_connection_tags via
              the post-scan picker; they just don't get a special
              banner on the profile body anymore. */}

          {/* Action buttons.
              Visual hierarchy on this screen: 「追蹤」 (when the
              viewer isn't already following) is the ONE primary
              CTA — getting the user onto your social graph is the
              moment that matters here. Once they're following the
              button collapses to a secondary "追蹤中" pill, since
              the unfollow path is just a maintenance action.
              Everything else (Message / Tag / +icon) sits on
              secondary gray. Reverted from the previous LinearGradient
              follow button + primary tag button, both of which
              competed with each other for primary attention. */}
          <View style={styles.actionButtonsRow}>
            {isFollowing ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleToggleFollow}
                activeOpacity={0.7}
                disabled={followLoading}
              >
                {followLoading ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    {t('userDetail.following')}
                  </Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryFollowBtn}
                onPress={handleToggleFollow}
                activeOpacity={0.8}
                disabled={followLoading}
              >
                {followLoading ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {t('userDetail.follow')}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            {authUser && resolvedUserId && authUser.id !== resolvedUserId && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleOpenChat}
                activeOpacity={0.7}
                disabled={messageLoading}
              >
                {messageLoading ? (
                  <BrandSpinner size={20} />
                ) : (
                  <Text style={styles.secondaryBtnText}>{t('userDetail.sendMessage')}</Text>
                )}
              </TouchableOpacity>
            )}
            {isFollowing && (
              <TouchableOpacity
                style={styles.tagBtnPrimary}
                activeOpacity={0.85}
                onPress={openPickTagModal}
                accessibilityRole="button"
                accessibilityLabel={t('userDetail.tag', { defaultValue: '標籤' })}
              >
                <Text style={styles.tagBtnPrimaryText}>{t('userDetail.tag', { defaultValue: '標籤' })}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.iconSecondaryBtn, showSimilar && styles.iconSecondaryBtnActive]}
              activeOpacity={0.7}
              onPress={() => setShowSimilar(!showSimilar)}
              accessibilityRole="button"
              accessibilityLabel={t('userDetail.recommendMembers', { defaultValue: '推薦會員' })}
            >
              <UserPlus size={18} color={showSimilar ? COLORS.piktag500 : COLORS.gray700} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Inline hidden-tag UI removed — both the event-tag shortcut
            row and the full HiddenTagEditor used to render here gated
            on isFollowing && connectionId. Reported: search for a
            user you follow and their profile body shows the entire
            tag-editing surface stuffed into the middle of the page,
            including private "隱藏標籤（只有你看得到）" sections. The
            editor is still available, but only via the explicit
            「選擇標籤」 button, which opens the pickModal below
            (HiddenTagEditor instance there is the single source of
            truth now). Profile reads cleanly; tag editing is opt-in. */}

        {/* Similar Users — IG style "Suggested for you" */}
        {showSimilar && similarUsers.length > 0 && (
          <View style={styles.similarSection}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
              <Text style={styles.similarTitle}>{t('userDetail.similarUsersTitle', { defaultValue: '為你推薦' })}</Text>
              <TouchableOpacity onPress={() => setShowSimilar(false)} activeOpacity={0.6}>
                <X size={18} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarScroll}>
              {similarUsers.map((u) => {
                const mutuals = similarMutualFriends.get(u.id) || [];
                return (
                  <View key={u.id} style={styles.similarCard}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => navigation.push('UserDetail', { userId: u.id })}
                    >
                      {u.avatar_url ? (
                        <Image source={{ uri: u.avatar_url }} style={styles.similarAvatar} />
                      ) : (
                        <View style={[styles.similarAvatar, styles.similarAvatarFallback]}>
                          <Text style={styles.similarAvatarInitial}>
                            {(u.full_name || u.username || '?').charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.similarName} numberOfLines={1}>{u.full_name || u.username}</Text>
                    </TouchableOpacity>
                    {/* Mutual friends avatars */}
                    {mutuals.length > 0 && (
                      <View style={styles.mutualAvatarsRow}>
                        {mutuals.map((m: any, i: number) => (
                          <Image
                            key={m.id}
                            source={{ uri: m.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.full_name || '?')}&size=40` }}
                            style={[styles.mutualMiniAvatar, { marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }]}
                          />
                        ))}
                        <Text style={styles.mutualCountText}>{mutuals.length} 共同好友</Text>
                      </View>
                    )}
                    {/* Follow button */}
                    <TouchableOpacity
                      style={styles.similarFollowBtn}
                      activeOpacity={0.8}
                      onPress={async () => {
                        // The auth user is destructured as `authUser` at the
                        // top of this component (we already use `user` as a
                        // generic loop variable elsewhere). Using `user` here
                        // resolved to undefined → follower_id was null →
                        // RLS rejected the insert silently.
                        if (!authUser?.id) return;
                        const { error } = await followUser(authUser.id, u.id);
                        if (error) {
                          console.warn('[UserDetail] follow similar user failed:', error);
                          Alert.alert(t('common.error'), t('common.unknownError'));
                          return;
                        }
                        setSimilarUsers(prev => prev.filter(s => s.id !== u.id));
                      }}
                    >
                      <LinearGradient
                        colors={['#ff5757', '#c44dff', '#8c52ff']}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.similarFollowGradient}
                      >
                        <Text style={styles.similarFollowText}>{t('userDetail.follow', { defaultValue: '追蹤' })}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Biolinks — matches ProfileScreen layout exactly. Section
            titles removed (universal logos speak for themselves) and
            the per-icon text label dropped (FB / phone glyph carries
            the meaning). See FriendDetailScreen for the same rationale. */}
        {iconBiolinks.length > 0 && (
          <View style={styles.socialSection}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.socialScrollContent}>
              {iconBiolinks.map((link) => (
                <TouchableOpacity
                  key={link.id}
                  style={styles.socialCircleItem}
                  onPress={() => handleOpenLink(link.url)}
                  activeOpacity={0.7}
                  accessibilityLabel={link.label || link.platform}
                  accessibilityRole="link"
                >
                  <View style={styles.socialCircleRing}>
                    <View style={styles.socialCircleInner}>
                      <PlatformIcon platform={link.platform} size={28} />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {cardBiolinks.length > 0 && (
          <View style={styles.linkBioSection}>
            {cardBiolinks.map((link) => (
              <TouchableOpacity
                key={link.id}
                style={styles.linkCard}
                onPress={() => handleOpenLink(link.url)}
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

        {/* All Tags Section removed — tags now shown inline in profile section */}
      </ScrollView>

      {/* Pick Tag Modal */}
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
            <View style={styles.pickModalHeader}>
              <Text style={styles.pickModalTitle}>{t('userDetail.pickTagTitle')}</Text>
              <TouchableOpacity onPress={() => setPickTagModalVisible(false)} activeOpacity={0.6}>
                <Text style={styles.pickModalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
            <Text style={styles.pickModalSubtitle}>
              {t('userDetail.pickTagSubtitle', { name: profile?.full_name || profile?.username || '' })}
            </Text>
            {friendPublicTags.length === 0 ? (
              <Text style={styles.pickModalEmpty}>{t('userDetail.pickTagEmpty')}</Text>
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

            {/* This Vibe's own tags — only shown when the viewer
                arrived via a Vibe QR (paramSid + paramTags/Date/Loc
                present). Opt-in: each chip is OFF until the user
                taps it, then becomes a hidden tag on the host. The
                section deliberately exists separately from the
                "viewer's past event vocabulary" block below so that
                "tags that just came from this specific scan" reads
                as a distinct concept — they're suggestions, not
                history, not auto-applied. */}
            {paramSid && vibeContextTags.length > 0 && connectionId && authUser && (
              <>
                <Text style={styles.pickModalSectionTitle}>
                  {t('userDetail.vibeContextTagsTitle', { defaultValue: '這次 Vibe 帶的標籤' })}
                </Text>
                <Text style={styles.pickModalSectionHint}>
                  {t('userDetail.vibeContextTagsHint', {
                    defaultValue: '想貼到他個人頁的點一下（只有你看得到）',
                  })}
                </Text>
                <View style={styles.eventTagsChipRow}>
                  {vibeContextTags.map((tagName) => {
                    const selected = hiddenTags.some(h => h.name === tagName);
                    return (
                      <TouchableOpacity
                        key={`vibectx-${tagName}`}
                        onPress={() => toggleHiddenTagByName(tagName)}
                        style={[styles.pickModalTag, selected && styles.pickModalTagSelected]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.pickModalTagText, selected && styles.pickModalTagTextSelected]}>
                          #{tagName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ height: 14 }} />
              </>
            )}

            {/* Event tags — viewer's QR-scan-derived event vocabulary,
                surfaced inside the picker so users can apply the same
                event context they collected from past scans without
                having to retype names. */}
            {eventTags.length > 0 && connectionId && authUser && (
              <>
                <Text style={styles.pickModalSectionTitle}>
                  {t('friendDetail.eventTagsTitle', { defaultValue: '活動標籤' })}
                </Text>
                <View style={styles.eventTagsChipRow}>
                  {eventTags.map((et) => {
                    const selected = hiddenTags.some(h => h.name === et.name);
                    return (
                      <TouchableOpacity
                        key={et.id}
                        onPress={() => toggleHiddenTagByName(et.name, et.id)}
                        style={[styles.pickModalTag, selected && styles.pickModalTagSelected]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.pickModalTagText, selected && styles.pickModalTagTextSelected]}>
                          #{et.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Hidden tags section — tap-based editor */}
            <Text style={styles.pickModalSectionTitle}>{t('friendDetail.hiddenTagsTitle', { defaultValue: '隱藏標籤' })}</Text>
            {connectionId && authUser && (
              <HiddenTagEditor
                connectionId={connectionId}
                userId={authUser.id}
                hiddenTags={hiddenTags}
                onTagsChanged={fetchHiddenTags}
              />
            )}
            </ScrollView>
            {/* No save button — live edits via togglePickTag + HiddenTagEditor */}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Mutual Tags Modal */}
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
            <Text style={styles.mutualModalTitle}>{t('userDetail.mutualTagsModalTitle')}</Text>
            <View style={styles.mutualModalTagsWrap}>
              {mutualTagList.map((tag) => (
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

      {/* Unfollow Confirm Modal */}
      <Modal
        visible={unfollowModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setUnfollowModalVisible(false)}
      >
        <View style={styles.unfollowModalOverlay}>
          <View style={styles.unfollowModalContainer}>
            <Text style={styles.unfollowModalTitle}>{t('userDetail.unfollowTitle')}</Text>
            <Text style={styles.unfollowModalMessage}>
              {t('userDetail.unfollowMessage', { name: profile?.full_name || profile?.username || '' })}
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
                <Text style={styles.unfollowModalConfirmText}>{t('userDetail.unfollowConfirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* More Menu Modal */}
      <Modal visible={moreMenuVisible} transparent animationType="fade" onRequestClose={() => setMoreMenuVisible(false)}>
        <TouchableOpacity style={styles.moreOverlay} activeOpacity={1} onPress={() => setMoreMenuVisible(false)}>
          <View style={[styles.moreSheet, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setMoreMenuVisible(false);
                handleToggleCloseFriend();
              }}
            >
              <Heart size={20} color={isCloseFriend ? COLORS.piktag600 : COLORS.gray600} fill={isCloseFriend ? COLORS.piktag600 : 'transparent'} />
              <Text style={[styles.moreItemText, isCloseFriend && { color: COLORS.piktag600 }]}>
                {isCloseFriend ? (t('userDetail.closeFriendRemove', { defaultValue: '已設為摯友' })) : (t('userDetail.closeFriendAdd', { defaultValue: '設為摯友' }))}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                // Delegates to the shared helper so the brand-pitch +
                // download CTA copy stays identical across QrCodeModal,
                // UserDetailScreen and FriendDetailScreen. Helper also
                // handles the iOS duplicate-URL gotcha (see
                // lib/shareProfile.ts for why we don't pass `url`).
                await shareProfile({
                  name: `${displayName} (@${username})`,
                  username,
                  t,
                });
              }}
            >
              <Share2 size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('userDetail.shareProfile', { defaultValue: '分享' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={async () => {
                setMoreMenuVisible(false);
                if (!authUser || !resolvedUserId) return;
                // block_user RPC does the full cascade atomically:
                // upsert block + delete bilateral follows + delete
                // bilateral close-friend rows + delete blocker's prior
                // notifications produced by the blocked user. The
                // previous direct piktag_blocks upsert left follows /
                // close-friends / notifications stale, so the blocked
                // user kept appearing in feeds and notification list.
                const { error } = await supabase.rpc('block_user', { p_blocked_id: resolvedUserId });
                if (error) {
                  console.warn('[UserDetail] block_user RPC failed:', error);
                  Alert.alert(t('common.error'), t('common.unknownError'));
                  return;
                }
                Alert.alert(t('userDetail.blockedTitle', { defaultValue: '已封鎖' }), t('userDetail.blockedMessage', { defaultValue: '你將不再看到此用戶' }));
                if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main', { screen: 'HomeTab' });
              }}
            >
              <X size={20} color="#EF4444" />
              <Text style={[styles.moreItemText, { color: '#EF4444' }]}>{t('userDetail.blockUser', { defaultValue: '封鎖' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moreItem}
              onPress={() => {
                setMoreMenuVisible(false);
                Alert.alert(
                  t('userDetail.reportTitle', { defaultValue: '檢舉用戶' }),
                  t('userDetail.reportMessage', { defaultValue: '請選擇檢舉原因' }),
                  [
                    { text: t('userDetail.reportSpam', { defaultValue: '垃圾訊息' }), onPress: () => reportUser('spam') },
                    { text: t('userDetail.reportHarassment', { defaultValue: '騷擾' }), onPress: () => reportUser('harassment') },
                    { text: t('userDetail.reportFake', { defaultValue: '假帳號' }), onPress: () => reportUser('fake_account') },
                    { text: t('common.cancel', { defaultValue: '取消' }), style: 'cancel' },
                  ]
                );
              }}
            >
              <AlertTriangle size={20} color={COLORS.gray600} />
              <Text style={styles.moreItemText}>{t('userDetail.reportUser', { defaultValue: '檢舉' })}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreCancelBtn} onPress={() => setMoreMenuVisible(false)}>
              <Text style={styles.moreCancelText}>{t('common.cancel', { defaultValue: '取消' })}</Text>
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
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  headerBackBtn: {
    padding: 4,
  },
  headerUsername: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.gray500,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  nameSection: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  verifiedIcon: {
    marginLeft: 4,
  },
  usernameText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray500,
  },
  headline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.piktag600,
    // Left-aligned to match bio + tags below it. The parent
    // profileSection already has paddingHorizontal: 20, so no
    // extra horizontal padding is needed on this element.
    // Previously textAlign: 'center' made the headline jump out
    // of the left-aligned column of the rest of the profile.
    marginTop: 6,
  },
  bio: {
    fontSize: 15,
    color: COLORS.gray700,
    lineHeight: 22,
    marginTop: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 4,
    columnGap: 12,
    rowGap: 4,
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
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 14,
    marginBottom: 4,
  },
  statText: {
    fontSize: 14,
    color: COLORS.gray500,
  },
  statNumber: {
    fontWeight: '700',
    color: COLORS.gray900,
    marginRight: 2,
  },
  mutualAvatarsStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mutualTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  mutualTagChip: {
    backgroundColor: COLORS.piktag50,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.piktag300,
  },
  mutualTagChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.piktag600,
  },
  qrAddFriendBtn: {
    backgroundColor: COLORS.piktag500,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
  },
  qrAddFriendText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.white,
  },
  // ── Unified action-button design system ─────────────────────────
  // Mirrors FriendDetailScreen — same primary/secondary contract,
  // different "which slot is primary":
  //   FriendDetail → 標籤 is primary (already-friend, tagging is the
  //                  CRM moment).
  //   UserDetail   → 追蹤 (when not following) is primary; once
  //                  following, the button collapses to a secondary
  //                  pill since unfollow is a maintenance action.
  // Two flex variants since UserDetail's row has 3-4 stretch buttons:
  // primaryFollowBtn / secondaryBtn use flex:1; secondaryBtnFixed
  // is the compact paddingHorizontal version used by the standalone
  // Tag button slot.
  primaryFollowBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.white,
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  secondaryBtnFixed: {
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
  },
  // 「標籤」is the action that defines PikTag. Other action buttons
  // (follow / message / add-friend) exist in every social app; the
  // tag flow is the unique reason a user came here. Give it solid
  // brand-purple so the eye lands on it first — the rest fall back
  // to neutral secondary.
  tagBtnPrimary: {
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.piktag500,
  },
  tagBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  iconSecondaryBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray100,
  },
  iconSecondaryBtnActive: {
    backgroundColor: COLORS.piktag50,
  },
  // Tags — flat inline clickable (matching ProfileScreen)
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  tagChip: {
    backgroundColor: COLORS.gray100,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray600,
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

  // Social Circles (IG Highlights style)
  socialSection: {
    paddingTop: 8,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  socialScrollContent: {
    paddingHorizontal: 16,
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
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
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

  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  headerMoreBtn: { padding: 4 },
  // More menu (bottom sheet style)
  moreOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  moreSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  moreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
  },
  moreItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray900,
  },
  moreCancelBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  moreCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray500,
  },
  // Similar users section
  similarSection: {
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray100,
  },
  suggestBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTagsChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  similarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.gray900,
  },
  similarScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  similarCard: {
    width: 150,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray200,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
  },
  similarAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.gray100,
  },
  similarAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  similarAvatarInitial: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray500,
  },
  similarName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray900,
    textAlign: 'center',
  },
  mutualAvatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  mutualMiniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.white,
  },
  mutualCountText: {
    fontSize: 11,
    color: COLORS.gray500,
    marginLeft: 2,
  },
  similarFollowBtn: {
    width: '100%',
    marginTop: 8,
  },
  similarFollowGradient: {
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  similarFollowText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Pick Tag Modal — full-screen takeover (was bottom-sheet). See
  // FriendDetailScreen for the rationale: the bottom-sheet's translucent
  // backdrop made users perceive the picker as inline content embedded
  // in the host page rather than a separate surface.
  pickModalOverlay: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  pickModalContainer: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  pickModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray100,
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
  pickModalSaveText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.piktag500,
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
  pickModalDivider: {
    height: 1,
    backgroundColor: COLORS.gray100,
    marginVertical: 16,
  },
  pickModalSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.gray700,
    marginBottom: 6,
  },
  // Small one-line explainer that sits between a section title and
  // its chip strip. Used for the Vibe-context-tags section to make
  // clear that tapping IS the apply action — they're not pre-
  // selected and won't get applied silently.
  pickModalSectionHint: {
    fontSize: 12,
    color: COLORS.gray500,
    marginBottom: 10,
  },
  statTextClickable: {
    fontSize: 14,
  },
  statDot: {
    fontSize: 14,
    color: COLORS.gray400,
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
});
