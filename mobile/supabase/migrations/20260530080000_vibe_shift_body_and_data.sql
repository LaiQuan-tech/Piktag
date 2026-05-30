-- 20260530080000_vibe_shift_body_and_data.sql
--
-- Bug surfaced via @lpfrg's TestFlight screenshot 2026-05-30:
-- vibe_shift rows render as completely blank (no avatar, no name,
-- no body, just timestamp + unread dot).
--
-- Three overlapping issues in notify_vibe_shift caused this:
--
--   1) title='' AND body=''. The original design said "client
--      renders via notifications.types.vibe_shift.body i18n key",
--      but that i18n template was NEVER added to any of the 19
--      locale JSONs (companion mobile commit fixes that today).
--      Until clients ship the new i18n, the legacy render path
--      reads item.body and finds an empty string.
--   2) data jsonb stored actor fields under `actor_username` /
--      `actor_avatar_url` keys, but NotificationsScreen's
--      avatarUrl line reads `data.avatar_url` and
--      getNotificationDisplay reads `data.username`. The naming
--      mismatch hid the actor entirely. Other triggers
--      (notify_follow, notify_friend, …) use the un-prefixed
--      keys; vibe_shift was the lone divergence.
--   3) No English body fallback at the SQL level. Even with the
--      client i18n added, any client on a missing-key locale, or
--      a future client that loses the template, falls back to
--      item.body — which was empty, hence blank.
--
-- This migration closes (1) at the data layer and (3) entirely:
--
--   * Body gets a short English fallback: "<actor> added #<tag>".
--     Modern clients still prefer the localized
--     notifications.types.vibe_shift.body when present, falling
--     back to this string only when the i18n key isn't found.
--   * data jsonb now ALSO stores `username` and `avatar_url`
--     (mirroring `actor_username` / `actor_avatar_url`). Keeps
--     the actor_* keys for backward compat with any other code
--     that may have started reading them — drops them in v2
--     after a deprecation window.
--
-- All other behavior (7-day dedup, friend opt-out via
-- notif_social BEFORE INSERT gate, exception trap) preserved
-- verbatim from 20260530010000.

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
  v_actor_display   text;
  v_tag_name        text;
  v_body            text;
  rec               record;
BEGIN
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
  FROM piktag_profiles
  WHERE id = v_actor_id;

  -- Pre-compute the actor display + English fallback body once
  -- per actor (not per recipient) — saves work in the loop.
  v_actor_display := COALESCE(NULLIF(v_actor_username, ''),
                              NULLIF(v_actor_full_name, ''),
                              'A friend');
  v_body := 'added #' || v_tag_name;

  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    WHERE c.connected_user_id = v_actor_id
      AND c.user_id <> v_actor_id
  LOOP
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
      '',           -- title rendered client-side via i18n key
                    -- (no longer blank-row risk — body is now
                    -- a non-empty string regardless).
      v_body,       -- English fallback. Modern clients prefer
                    -- notifications.types.vibe_shift.body if
                    -- present, falling back to this string.
      jsonb_build_object(
        -- New canonical keys (match the other triggers' shape +
        -- what NotificationsScreen.avatarUrl + getNotification-
        -- Display read by default).
        'username',         v_actor_username,
        'avatar_url',       v_actor_avatar,
        -- Legacy keys preserved for any code path that may have
        -- started reading them. Safe to retire post-launch once
        -- backward-compat window closes.
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
  RAISE NOTICE 'notify_vibe_shift failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_vibe_shift() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_vibe_shift()
  TO postgres, service_role;

-- The trigger binding (trg_notify_vibe_shift on piktag_user_tags)
-- from 20260513030000 still points at this function — CREATE OR
-- REPLACE doesn't change the binding.
