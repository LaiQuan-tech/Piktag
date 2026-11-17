// notificationRouter.ts
//
// Single source of truth for "given a notification, where do we land?".
// Two callers share this:
//   1. NotificationsScreen.handleNotificationPress — in-app tap on a row.
//   2. App.tsx push response listener — OS-level push banner tap (cold
//      start or background → foreground).
//
// Before this helper existed, App.tsx's push handler only routed
// `type === 'chat'` (chat UI removed 2026-11-18; chat now routes here
// too, to Notifications) and silently dropped every other type, so a tap on
// a `follow` / `tag_added` / `biolink_click` push opened the app but
// went nowhere. The in-app handler (NotificationsScreen) already had
// full routing — extracting it here lets the OS-tap path reuse it.
//
// Routing rules (must match NotificationsScreen's prior inline logic):
//   * tag_trending     → TagDetail
//   * biolink_click    → SocialStats
//   * everything else  → user-centric:
//       - probe data for a user id (multiple keys; older notifications
//         use different field names);
//       - if we have a user id + connection_id (or one resolved via
//         piktag_connections lookup), → FriendDetail;
//       - else → UserDetail (also accepts a username fallback for
//         legacy rows that only stored the username).
//
// All target screens (TagDetail / SocialStats / FriendDetail /
// UserDetail) are registered at RootStack level in AppNavigator, so a
// plain `navigation.navigate('UserDetail', …)` works from both call
// sites — no need to nest inside `Main` / tab routes.

import { supabase } from './supabase';

export type NotificationLike = {
  type: string;
  data?: Record<string, any> | null;
};

// Minimal nav surface we need. Both `navigation` (screen prop) and
// `navigationRef.current` from NavigationContainer expose `.navigate`,
// so the helper accepts the lowest common denominator.
export type NavLike = {
  navigate: (screen: string, params?: any) => void;
};

export async function routeFromNotification(
  navigation: NavLike,
  notification: NotificationLike,
  currentUserId: string | null | undefined,
): Promise<void> {
  const data = (notification.data ?? {}) as Record<string, any>;
  const type = notification.type;

  // 0. Self-directed growth nudge: "find friends from your contacts".
  // No actor / target user — just open ContactSyncScreen (registered at
  // RootStack level, so this resolves from both the in-app tap and the
  // App.tsx push-tap call site).
  if (type === 'contact_sync_nudge') {
    navigation.navigate('ContactSync');
    return;
  }

  // Every-3-days AI tag-suggestion nudge → EditProfile with the pushed
  // tags preloaded into the existing AI-suggestion chip row (opt-in gray
  // chips, BoltIcon section). suggestion_ids ride along so the screen
  // can close the principle-#5 calibration loop (markAiSuggestionAccepted)
  // when a chip is added — the "shown" rows were already logged server-
  // side at send time. EditProfile is a RootStack screen, so this
  // resolves from both the in-app tap and the OS push tap.
  if (type === 'tag_suggest_nudge') {
    navigation.navigate('EditProfile', {
      suggestedTags: Array.isArray(data.tag_names) ? data.tag_names : undefined,
      suggestionIds: Array.isArray(data.suggestion_ids) ? data.suggestion_ids : undefined,
      fromTagNudge: true,
    });
    return;
  }

  // 1. Tag-centric.
  const tagId: string | undefined = data.tag_id;
  const tagName: string | undefined = data.tag_name;
  if (type === 'tag_trending' && (tagId || tagName)) {
    navigation.navigate('TagDetail', { tagId, tagName });
    return;
  }
  // tag_convergence — same tag-centric routing as tag_trending.
  // Notification body says "you tagged #X, your friends N also do" —
  // landing on the tag detail page is where they can see which
  // friends share this tag and DM them individually.
  if (type === 'tag_convergence' && (tagId || tagName)) {
    navigation.navigate('TagDetail', { tagId, tagName });
    return;
  }

  // On This Day → open the Vibe detail page. The whole "tap to
  // revisit who joined that day" sales pitch only works if the
  // press actually lands on the Vibe's member list. data carries
  // scan_session_id (added by the daily-on-this-day edge function).
  if (type === 'on_this_day' && typeof data.scan_session_id === 'string') {
    // 2026-06-03 fix: QrGroupDetail is registered ONLY inside the
    // AddTagStack (nested under AddTagTab) — NOT at RootStack level
    // like TagDetail / FriendDetail / UserDetail (see this file's
    // header note + AppNavigator). A bare navigate('QrGroupDetail')
    // from the root nav ref can't resolve it, so the on_this_day tap
    // dead-ended. As of 2026-06-24 QrGroupDetail is a RootStack screen
    // (the event-QR tab was replaced by Chat; event-QR demoted to
    // full-screen pushes), so a direct root-level navigate resolves it.
    navigation.navigate('QrGroupDetail', { groupId: data.scan_session_id });
    return;
  }

  // Ask notifications. The Ask UI (story row, create modal, view sheet)
  // was taken down from this client 2026-11-18 (phase 2 of the personal
  // network tool simplification). The server still writes these rows for
  // old app versions, so a tap must never open Ask UI or a dead route:
  //   * ask_posted    — carries data.actor_user_id (the asker). Not handled
  //                     here on purpose: it falls through to the generic
  //                     user-centric branch below and lands on the asker's
  //                     FriendDetail / UserDetail.
  //   * ask_bridge    — about the viewer's OWN Ask; data has only
  //                     bridge_names / tags, no user id to land on.
  //   * ask_prompt    — weekly "what do you need?" nudge to create an Ask.
  //   * ask_web_reply — a non-member replied to the viewer's own Ask via
  //                     pikt.ag/a/<id>; no member user id exists.
  // The last three have no person and no in-app surface left, so they land
  // on Notifications (a no-op when tapped from NotificationsScreen itself).
  if (type === 'ask_bridge' || type === 'ask_prompt' || type === 'ask_web_reply') {
    navigation.navigate('Notifications');
    return;
  }

  // tag_combo — weekly digest of over-represented tag pairs in
  // the viewer's network. Route to TagDetail of the FIRST tag
  // so the user lands somewhere they can act on the discovery.
  // (A future polish: dedicated tag-pair drill-down screen.)
  if (type === 'tag_combo' && Array.isArray(data.tag_names) && data.tag_names[0]) {
    navigation.navigate('TagDetail', { tagName: data.tag_names[0] });
    return;
  }

  // reconnect_suggest — "Eva 也標了 #X #Y — 你們很久沒聊了".
  // Used to open a ChatThread with icebreakers armed (2026-07-03). The
  // chat UI was taken down 2026-11-18 (PikTag back to a personal
  // network tool, phase 1), so ChatThread no longer exists as a route.
  // Land on the friend's profile instead: hint the user id and let the
  // generic user-id branch below resolve FriendDetail vs UserDetail.
  if (type === 'reconnect_suggest' && typeof data.friend_id === 'string') {
    data.connected_user_id = data.friend_id;
  }

  // chat — message push from send-chat-push (still sent by the server for
  // old app versions). The chat UI is gone from this client (2026-11-18),
  // so there is no thread to open. Land on Notifications rather than the
  // sender's profile or a dead route. From NotificationsScreen itself
  // this navigate is a no-op.
  if (type === 'chat') {
    navigation.navigate('Notifications');
    return;
  }

  // 2. Biolink-click → aggregate analytics, not the clicker's profile
  // (per-clicker drilldown felt voyeuristic; SocialStats has the right
  // aggregate view: which links got clicks, when, by how many people).
  if (type === 'biolink_click') {
    navigation.navigate('SocialStats');
    return;
  }

  // 3. User-centric: probe every key servers might use, dropping the
  // viewer's own id so we don't navigate to the user's own profile
  // (some legacy notifications stuff `data.user_id = me`).
  const userIdCandidates: (string | undefined)[] = [
    data.actor_user_id,
    // Dashboard-era follow rows ("新的追蹤者") carried ONLY follower_id
    // — never probed here, so their taps dead-ended (founder repro
    // 2026-07-02). The legacy trigger + rows are dropped by migration
    // 20260702160000; this probe keeps any straggler row tappable.
    data.follower_id,
    data.connected_user_id,
    data.friend_user_id,
    data.recommended_user_id,
    data.clicker_user_id,
    data.redeemer_id,
    // endorsement_request uses target_user_id (the friend whose
    // self-tag we're nudging the viewer to organically endorse).
    // Before this entry the field went unread and taps dead-ended
    // after mark-as-read — relevant after we removed the inline
    // "認同" button 2026-05-30, since now the tap IS the action.
    data.target_user_id,
    data.user_id,
  ];
  let userId = userIdCandidates.find(
    (id): id is string =>
      typeof id === 'string' && id.length > 0 && id !== currentUserId,
  );
  const username: string | undefined = data.username;
  let connectionId: string | undefined = data.connection_id;

  // Legacy fallback: pre-2026-04 birthday/anniversary notifications
  // sometimes carried `connection_id` but no direct user id. Resolve
  // through piktag_connections so taps still land somewhere instead of
  // dead-ending after mark-as-read.
  if (!userId && connectionId && currentUserId) {
    try {
      const { data: conn } = await supabase
        .from('piktag_connections')
        .select('connected_user_id')
        .eq('id', connectionId)
        .eq('user_id', currentUserId)
        .maybeSingle();
      const cid = (conn as any)?.connected_user_id;
      if (typeof cid === 'string' && cid.length > 0) {
        userId = cid;
      }
    } catch {
      /* fall through */
    }
  }

  if (!userId && !username) return;

  // 4. Friend (have a connection row) or stranger (don't)?
  // If `connection_id` was already on the notification, use it
  // directly — saves a round-trip. Otherwise query piktag_connections.
  if (userId && connectionId) {
    navigation.navigate('FriendDetail', { friendId: userId, connectionId });
    return;
  }
  if (userId && currentUserId) {
    try {
      const { data: conn } = await supabase
        .from('piktag_connections')
        .select('id')
        .eq('user_id', currentUserId)
        .eq('connected_user_id', userId)
        .maybeSingle();
      const cid = (conn as any)?.id;
      if (typeof cid === 'string' && cid.length > 0) {
        navigation.navigate('FriendDetail', { friendId: userId, connectionId: cid });
        return;
      }
    } catch {
      /* fall through to stranger path */
    }
  }

  // 5. Stranger (or no auth context — App.tsx push tap before session
  // is hydrated): UserDetail accepts userId OR username; whichever we
  // have, the screen resolves it.
  navigation.navigate('UserDetail', { userId, username });
}
