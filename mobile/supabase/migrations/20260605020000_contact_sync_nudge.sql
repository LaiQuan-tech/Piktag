-- 20260605020000_contact_sync_nudge.sql
--
-- North-Star priority #1 (optimize every friend-add opportunity) +
-- #2 (get non-members in / build the contact graph): surface the
-- "find friends already on PikTag from your phone contacts" flow
-- (ContactSyncScreen) as an organic in-app NOTIFICATION nudge, not
-- just the cold-start home card.
--
-- Why a notification (founder ask, 2026-06-05 "可以在通知顯示可以從
-- 通訊錄找朋友嗎?"): the cold-start "好東西分享給好朋友" card only
-- shows on the friends-page empty state (session 1, zero friends).
-- A bell notification is the gentle DAY-2 reminder that reaches the
-- user even after they've left that screen — contact-matching is the
-- single highest-value early friend source, so it earns a second,
-- low-friction touch.
--
-- This follows the CLAUDE.md "organic nudge" contract exactly:
--   • The notification STATES a fact / invitation ("從通訊錄找朋友"),
--     it does NOT pose a rubber-stamp question and does NOT ask the
--     viewer to validate anyone else's claim.
--   • Tap → routes to ContactSyncScreen (passive flow), where the
--     user acts if they organically want to.
--
-- Delivery design (in-app ONLY — deliberately NO lock-screen push):
--   • Modeled on enqueue_endorsement_requests (20260529060000) which
--     also inserts a notification WITHOUT a net.http_post push. A
--     lock-screen push saying "sync your contacts" reads as naggy and
--     risks early-retention damage (founder is acutely sensitive to
--     anything that makes the app feel like a bad app). In-app bell +
--     app-icon badge only.
--
-- Targeting (strictly ONCE-EVER per user — the NOT EXISTS guard is the
-- global rate limit, there is no repeat cadence):
--   • created_at > 1 day ago   — past the first session; the cold-start
--                                card already covered session 1.
--   • created_at < 90 days ago — don't blast the entire legacy base on
--                                first deploy; this is an early-lifecycle
--                                growth nudge.
--   • < 5 outgoing connections — they haven't built their network yet,
--                                so address-book matching is high-value.
--   • never received this type — once-ever.
--
-- Tunable knobs if the founder wants to adjust later: the <5 friend
-- threshold, the 1-day / 90-day window, the daily cadence, and the
-- in-app-vs-push choice (add a net.http_post block to push).

-- ── 1. Category mapping (CLAUDE.md notification checklist #1) ──────
-- is_notification_category_enabled() must learn the new type or a user
-- who opted OUT of the 社交 category would still get it. It's a social /
-- growth event → notif_social. CREATE OR REPLACE with the full body +
-- the one new WHEN (the function lives in 20260530000000; re-stating it
-- whole keeps this migration self-contained and idempotent).
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
  v_category := CASE p_type
    WHEN 'follow'              THEN 'notif_social'
    WHEN 'friend'              THEN 'notif_social'
    WHEN 'tag_added'           THEN 'notif_social'
    WHEN 'biolink_click'       THEN 'notif_social'
    WHEN 'invite_accepted'     THEN 'notif_social'
    WHEN 'vibe_shift'          THEN 'notif_social'
    WHEN 'ask_posted'          THEN 'notif_social'
    WHEN 'tag_trending'        THEN 'notif_social'
    WHEN 'contact_sync_nudge'  THEN 'notif_social'
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

  EXECUTE format(
    'SELECT COALESCE(%I, true) FROM public.piktag_profiles WHERE id = $1',
    v_category
  ) INTO v_enabled USING p_user_id;

  RETURN COALESCE(v_enabled, true);
END;
$$;

REVOKE ALL ON FUNCTION public.is_notification_category_enabled(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_notification_category_enabled(uuid, text)
  TO authenticated, service_role;

-- ── 2. The nudge cron ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_contact_sync_nudges()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  -- Body is client-rendered via the localized
  -- notifications.types.contact_sync_nudge.body i18n key; the
  -- non-empty English string here is the legacy-client fallback
  -- (CLAUDE.md: an INSERT into piktag_notifications MUST write a
  -- non-empty body — never rely on the i18n template existing).
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  SELECT
    p.id,
    'contact_sync_nudge',
    '',
    'Find friends already on PikTag — sync your phone contacts.',
    jsonb_build_object('cta', 'contact_sync'),
    false,
    now()
  FROM public.piktag_profiles p
  WHERE p.created_at < now() - interval '1 day'
    AND p.created_at > now() - interval '90 days'
    AND (
      SELECT count(*) FROM public.piktag_connections c
      WHERE c.user_id = p.id
    ) < 5
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'contact_sync_nudge'
    )
  LIMIT 500;   -- batch cap per run; once-ever guard spreads the base over days

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_contact_sync_nudges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_contact_sync_nudges() TO postgres, service_role;

-- Daily — 17:30 UTC = 01:30 Taipei (low traffic; distinct from the
-- endorsement cron at 19:00 so the two don't pile up the same minute).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'contact-sync-nudge-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END;
$$;

SELECT cron.schedule(
  'contact-sync-nudge-daily',
  '30 17 * * *',
  $cron$ SELECT public.enqueue_contact_sync_nudges(); $cron$
);
