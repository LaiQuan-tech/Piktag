-- 20260530000000_notification_category_toggles.sql
--
-- User-facing notification categorization. Adds 3 category toggles
-- + 1 badge toggle to piktag_profiles, plus a single BEFORE INSERT
-- gate on piktag_notifications that enforces them.
--
-- Category split (founder, 2026-05-29):
--   • notif_social   — follow / friend / tag_added / biolink_click /
--                      invite_accepted / vibe_shift / ask_posted /
--                      tag_trending
--   • notif_matches  — recommendation / tag_convergence / ask_bridge /
--                      reconnect_suggest / tag_combo (★ North-Star —
--                      this is the AI-tag matching layer, defaults ON
--                      and should rarely be disabled)
--   • notif_memories — birthday / anniversary / on_this_day /
--                      ask_prompt / endorsement_request
--   • notif_badge    — separate flag: should we set the app-icon
--                      badge number at all? Independent of the three
--                      category flags so a user can keep getting
--                      notifications without the home-screen badge.
--
-- Why a single BEFORE INSERT trigger and not per-function edits:
--   • Existing trigger fns (notify_follow, notify_vibe_shift, etc.)
--     each do their own INSERT into piktag_notifications. Editing
--     all ~18 to add a category check would be ~2000 lines of
--     repetitive SQL. A single BEFORE trigger here is one place
--     to maintain and naturally covers cron-driven INSERTs too.
--   • Caveat: trigger functions ALSO call net.http_post(...) for
--     OS push notifications independently of the INSERT. This
--     migration only gates the DB row (and therefore the in-app
--     NotificationsScreen + realtime feed). Push delivery
--     itself is gated in a follow-up migration that adds a
--     SELECT is_notification_category_enabled() check around
--     the net.http_post block in each push-dispatching function.
--
-- Why we do NOT delete vibe_shift_notifications_enabled column:
--   Existing users who turned it off would silently lose their
--   opt-out. The notify_vibe_shift trigger still respects it AND
--   now also respects notif_social. Both must be true for a vibe
--   shift row to land. Column will be retired post-launch once we
--   confirm no client still reads it.

-- ── 1. Category + badge columns ─────────────────────────────────
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS notif_social   boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_matches  boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_memories boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_badge    boolean DEFAULT true;

COMMENT ON COLUMN public.piktag_profiles.notif_social IS
  'Notification category opt-in: social events (follow, friend, tag-added, biolink click, invite accepted, vibe shift, ask posted, tag trending). Default true.';
COMMENT ON COLUMN public.piktag_profiles.notif_matches IS
  'Notification category opt-in: AI tag matching & discovery (recommendation, tag_convergence, ask_bridge, reconnect_suggest, tag_combo). North-Star category. Default true.';
COMMENT ON COLUMN public.piktag_profiles.notif_memories IS
  'Notification category opt-in: time-based reminders (birthday, anniversary, on_this_day, ask_prompt, endorsement_request). Default true.';
COMMENT ON COLUMN public.piktag_profiles.notif_badge IS
  'App-icon badge opt-in. When false, the client must not call setBadgeCountAsync with a non-zero value. Independent of the category flags. Default true.';

-- ── 2. Helper: is this category currently enabled for this user? ──
-- Centralized so both the BEFORE INSERT gate (below) and the
-- follow-up Phase-2 push-call wrappers use the SAME mapping. If a
-- new notification type is added later, ONLY this function changes.
CREATE OR REPLACE FUNCTION public.is_notification_category_enabled(
  p_user_id uuid,
  p_type    text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
  v_enabled  boolean;
BEGIN
  -- Map type → category column. Unknown types are allowed through
  -- (covers admin / system / future notification kinds that haven't
  -- been categorized yet — fail-open by design so a missing case
  -- never silently swallows a real notification).
  v_category := CASE p_type
    WHEN 'follow'              THEN 'notif_social'
    WHEN 'friend'              THEN 'notif_social'
    WHEN 'tag_added'           THEN 'notif_social'
    WHEN 'biolink_click'       THEN 'notif_social'
    WHEN 'invite_accepted'     THEN 'notif_social'
    WHEN 'vibe_shift'          THEN 'notif_social'
    WHEN 'ask_posted'          THEN 'notif_social'
    WHEN 'tag_trending'        THEN 'notif_social'
    WHEN 'recommendation'      THEN 'notif_matches'
    WHEN 'tag_convergence'     THEN 'notif_matches'
    WHEN 'ask_bridge'          THEN 'notif_matches'
    WHEN 'reconnect_suggest'   THEN 'notif_matches'
    WHEN 'tag_combo'           THEN 'notif_matches'
    WHEN 'birthday'            THEN 'notif_memories'
    WHEN 'anniversary'         THEN 'notif_memories'
    WHEN 'on_this_day'         THEN 'notif_memories'
    WHEN 'ask_prompt'          THEN 'notif_memories'
    WHEN 'endorsement_request' THEN 'notif_memories'
    ELSE NULL
  END;

  IF v_category IS NULL THEN
    RETURN true;
  END IF;

  -- Dynamic column read. COALESCE(..., true) so existing profile
  -- rows that pre-date this migration (column literally not yet
  -- populated for them) default to opted-in.
  EXECUTE format(
    'SELECT COALESCE(%I, true) FROM public.piktag_profiles WHERE id = $1',
    v_category
  ) INTO v_enabled USING p_user_id;

  RETURN COALESCE(v_enabled, true);
END;
$$;

REVOKE ALL ON FUNCTION public.is_notification_category_enabled(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_notification_category_enabled(uuid, text)
  TO authenticated, postgres, service_role;

-- ── 3. BEFORE INSERT gate on piktag_notifications ─────────────────
-- Returns NULL to silently drop the INSERT when the recipient has
-- opted out of the row's category. Per Postgres docs, returning
-- NULL from a BEFORE INSERT trigger cancels the insert without an
-- error — which is exactly what we want: callers (existing trigger
-- fns, edge fns) don't need to handle a rejection.
CREATE OR REPLACE FUNCTION public.gate_notification_by_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.type IS NULL THEN
    -- Malformed row — let it through so the DB's own NOT NULL
    -- constraints (if any) speak rather than this silent gate.
    RETURN NEW;
  END IF;

  IF public.is_notification_category_enabled(NEW.user_id, NEW.type) THEN
    RETURN NEW;
  END IF;

  -- Opted out → drop silently. Caller's INSERT becomes a no-op.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gate_notification_by_category() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gate_notification_by_category()
  TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_gate_notification_by_category
  ON public.piktag_notifications;
CREATE TRIGGER trg_gate_notification_by_category
  BEFORE INSERT ON public.piktag_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.gate_notification_by_category();
