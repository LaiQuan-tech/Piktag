-- 20260513030000_notification_vibe_shift.sql
--
-- P3 of the "Vibes" feature line — Vibe Shift notifications.
--
-- Trigger: AFTER INSERT on piktag_user_tags (a friend added a
--          new tag to their profile)
-- Recipients: every "host" who has the new tag's user as a
--             connection (i.e. anyone who has shared a Vibe with
--             that user — the host scanned them, or they scanned
--             the host)
-- Dedup: 7-day window per (recipient, actor, tag_name) tuple
-- Opt-out: piktag_profiles.vibe_shift_notifications_enabled
--          (defaults true — sensible default since these are
--          people YOU added to YOUR network, not strangers)
--
-- Models exactly the notify_follow + notify_tag_added pattern in
-- earlier migrations (SECURITY DEFINER, jsonb data payload, in-
-- function dedup, never block the source INSERT on exception).

-- ── 1. Opt-out column ───────────────────────────────────────
-- Per-user toggle. Defaulted TRUE because:
--   • These notifications come from people you actively added
--     to your tribe (you scanned them or were scanned by them).
--     This is not a stranger-discovery feature; it's "someone
--     you chose to add changed something visible".
--   • The Settings screen exposes a clearly-labeled toggle so
--     users who find it noisy can flip it off in one tap.
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS vibe_shift_notifications_enabled boolean DEFAULT true;

-- ── 2. Trigger function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_vibe_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id        uuid := NEW.user_id;
  v_actor_username  text;
  v_actor_full_name text;
  v_actor_avatar    text;
  v_tag_name        text;
  rec               record;
BEGIN
  -- Resolve tag name. If the tag row vanished between insert and
  -- this trigger firing (race), skip — no useful body to render.
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Snapshot the actor's profile fields. Stored in the
  -- notification's `data` jsonb so the client can render
  -- correctly even if the actor renames / re-uploads avatar
  -- later — the notification reflects state-at-time-of-event.
  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
  FROM piktag_profiles
  WHERE id = v_actor_id;

  -- Fan-out: every connection row where this user is the
  -- `connected_user_id` represents a host who has this user in
  -- one of their Vibes. DISTINCT collapses duplicates if the
  -- same host scanned the same user across multiple Vibes.
  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    JOIN piktag_profiles p ON p.id = c.user_id
    WHERE c.connected_user_id = v_actor_id
      -- Never notify someone about their own tag changes
      AND c.user_id <> v_actor_id
      -- Respect the recipient's opt-out (COALESCE so legacy
      -- profile rows without the column default to true)
      AND COALESCE(p.vibe_shift_notifications_enabled, true)
  LOOP
    -- Dedup: don't notify the same recipient about the same
    -- (actor, tag) more than once per week. Without this, a
    -- friend who frequently re-toggles a tag would spam every
    -- one of their connections.
    IF EXISTS (
      SELECT 1
      FROM piktag_notifications
      WHERE user_id = rec.recipient_id
        AND type = 'vibe_shift'
        AND data->>'actor_user_id' = v_actor_id::text
        AND lower(data->>'tag_name') = lower(v_tag_name)
        AND created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read
    ) VALUES (
      rec.recipient_id,
      'vibe_shift',
      '',  -- title rendered client-side via i18n key
      '',  -- body  rendered client-side via i18n key
      jsonb_build_object(
        'actor_user_id',    v_actor_id,
        'actor_username',   v_actor_username,
        'actor_full_name',  v_actor_full_name,
        'actor_avatar_url', v_actor_avatar,
        'tag_name',         v_tag_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- NEVER block the user-tag insert if notification fan-out
  -- explodes. The user's actual action (adding a tag to their
  -- profile) must succeed regardless.
  RAISE NOTICE 'notify_vibe_shift failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_vibe_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_vibe_shift() TO postgres, service_role;

-- ── 3. Trigger binding ──────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_vibe_shift ON public.piktag_user_tags;
CREATE TRIGGER trg_notify_vibe_shift
  AFTER INSERT ON public.piktag_user_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_vibe_shift();
