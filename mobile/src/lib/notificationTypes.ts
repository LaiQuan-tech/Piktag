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
  'contact_sync_nudge', // growth nudge: find friends from your contacts
  'contact_joined', // your saved local contact registered — auto-connected, tags carried over
  'ask_web_reply', // non-member replied to your Ask via the pikt.ag/a/<id> share page
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
  'tag_suggest_nudge', // every-3-days AI profile tag-suggestion push
  'reminder', // legacy memory type, kept in memories tab for older rows
] as const;

export type KnownNotificationType = (typeof KNOWN_NOTIFICATION_TYPES)[number];

/**
 * Types whose feature was taken off this client (2026-11-18 tool
 * simplification, docs/PLAN-2026-11-tool-simplification.md): chat, Ask,
 * stranger-discovery via Ask. The SERVER still writes these rows and still
 * sends their pushes, because older app versions in the wild still have
 * the features — the backend was deliberately left untouched.
 *
 * On this client they are hidden from the notification feed, excluded
 * from every unread signal (app-icon badge, header-bell dot), and their
 * banners are suppressed while the app is in the foreground. There is
 * nothing to open behind them any more, so showing them would be a
 * dead end.
 *
 * Why they are NOT deleted from KNOWN_NOTIFICATION_TYPES: that list is
 * the auditable record of every type the backend can emit, and pushes of
 * these types can still arrive (a background push is shown by the OS
 * before any JS runs). Keeping them "known but retired" makes it explicit
 * that they are handled on purpose — routed safely by notificationRouter,
 * hidden here — rather than orphans someone forgot. 'chat' was never in
 * KNOWN (it never had a feed row of its own on this client) but is listed
 * here so the foreground-banner and unread filters cover it too.
 */
export const RETIRED_NOTIFICATION_TYPES: readonly string[] = [
  'chat',
  'ask_posted',
  'ask_bridge',
  'ask_prompt',
  'ask_web_reply',
];

const RETIRED_SET = new Set<string>(RETIRED_NOTIFICATION_TYPES);

export function isRetiredNotificationType(type: string | null | undefined): boolean {
  return !!type && RETIRED_SET.has(type);
}

/**
 * KNOWN minus RETIRED: the types this client actually surfaces. This is
 * what unread counts (badge RPC / fallback count) must be restricted to.
 */
export const ACTIVE_NOTIFICATION_TYPES: readonly string[] =
  KNOWN_NOTIFICATION_TYPES.filter((t) => !RETIRED_SET.has(t));

/**
 * PostgREST value for `.not('type', 'in', ...)` — excludes retired rows
 * from queries that are not otherwise restricted by type.
 */
export const RETIRED_NOTIFICATION_TYPES_PGRST = `(${RETIRED_NOTIFICATION_TYPES.join(',')})`;
