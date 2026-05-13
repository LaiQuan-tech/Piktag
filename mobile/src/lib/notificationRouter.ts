// notificationRouter.ts
//
// Single source of truth for "given a notification, where do we land?".
// Two callers share this:
//   1. NotificationsScreen.handleNotificationPress — in-app tap on a row.
//   2. App.tsx push response listener — OS-level push banner tap (cold
//      start or background → foreground).
//
// Before this helper existed, App.tsx's push handler only routed
// `type === 'chat'` and silently dropped every other type, so a tap on
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
    navigation.navigate('QrGroupDetail', { groupId: data.scan_session_id });
    return;
  }

  // ask_bridge — "Bob 認識 #律師 的朋友". The press should land
  // somewhere the user can actually act: their own active Ask's
  // detail page, where they can read the full bridge list and tap
  // a bridge friend to message them. For v1 we don't have a
  // dedicated Ask detail screen, so route to Connections (home)
  // — the bridge list is in `data.bridge_names`, and the
  // long-press handler already lets users dig in.
  if (type === 'ask_bridge') {
    navigation.navigate('HomeTab' as any);
    return;
  }

  // ask_prompt — "今天想要什麼？". Tapping it should open the
  // Ask create modal directly. The AskCreateModal lives inside
  // AskStoryRow on the connections screen and on the profile
  // screen; rather than coupling routing to the modal lifecycle,
  // route to HomeTab and let the user tap the "+ Ask" circle on
  // the rail. (A future polish: deep-link straight to the modal.)
  if (type === 'ask_prompt') {
    navigation.navigate('HomeTab' as any);
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
  // The whole magic moment is the "wait, I forgot we had this in
  // common" jolt + the friction-free path to actually message
  // them. data.friend_id points to the forgotten friend; route
  // straight to their FriendDetail (or fall through to the
  // userId-based branch below, which also handles unknown-
  // connection-id resolution).
  if (type === 'reconnect_suggest' && typeof data.friend_id === 'string') {
    // Let the generic user-id branch below handle the resolve
    // — it knows how to look up connection_id and pick
    // FriendDetail vs UserDetail. We just hint userId via data.
    data.connected_user_id = data.friend_id;
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
    data.connected_user_id,
    data.friend_user_id,
    data.recommended_user_id,
    data.clicker_user_id,
    data.redeemer_id,
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
