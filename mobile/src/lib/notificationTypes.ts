/**
 * Single source of truth for which notification `type` values
 * NotificationsScreen actually surfaces to the user.
 *
 * Two callers depend on this list staying in sync with the
 * `filterNotifications()` switch in NotificationsScreen.tsx:
 *
 *   1. NotificationsScreen.fetchNotifications — feeds the FlatList.
 *      Today the filter happens client-side in filterNotifications
 *      so the FETCH itself doesn't gate by type; this list is
 *      mainly the auditable record of "types we KNOW about."
 *
 *   2. refreshBadgeFromServer — the app-icon badge query. We
 *      restrict the unread count to displayed types so the
 *      badge never counts legacy / orphan / admin-only types
 *      (e.g. 'contract_expiry') that exist as unread rows but
 *      can't be tapped from any tab. Without this, the badge
 *      gets "stuck" — user taps everything they can see, but
 *      the orphan row keeps the count > 0 forever.
 *
 * When adding a new notification `type`, add it here AND to
 * filterNotifications() (CLAUDE.md "Adding a new notification
 * type — 3-point checklist", grep-the-name sanity check).
 */
export const KNOWN_NOTIFICATION_TYPES = [
  // social
  'follow',
  'friend',
  'tag_added',
  'biolink_click',
  'invite_accepted',
  'vibe_shift',
  'ask_posted',
  'tag_trending',
  // matches (AI / discovery)
  'recommendation',
  'tag_convergence',
  'ask_bridge',
  'reconnect_suggest',
  'tag_combo',
  // memories + prompts
  'birthday',
  'anniversary',
  'on_this_day',
  'ask_prompt',
  'endorsement_request',
  'reminder', // legacy memory type, kept in memories tab for older rows
] as const;

export type KnownNotificationType = (typeof KNOWN_NOTIFICATION_TYPES)[number];
