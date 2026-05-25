-- 20260429c_notification_ask_posted.sql
--
-- Reactive notification: type='ask_posted'.
--
-- When a user posts an ask, fan out a notification to every viewer
-- who has the author in their piktag_connections (i.e. "people who
-- have this person in their CRM"). Mirrors the relationship model
-- fetch_ask_feed already uses for the home feed — anyone who would
-- see the ask there now also gets a one-shot inbox entry.
--
-- Why: with the AskFeed dropped from the Notifications tab (Phase 1),
-- the inbox was missing the "X just posted an ask" event. This trigger
-- restores it as a regular condensed notification row, matching every
-- other system event's shape — no special-cased horizontal carousel.
--
-- Pattern mirrors notify_follow / notify_tag_added:
--   * AFTER INSERT trigger on piktag_asks.
--   * Resolve author display info from piktag_profiles.
--   * Loop over connections.user_id where connected_user_id = author.
--   * Per recipient: 24h dedup against (user_id, type, data->>'ask_id'),
--     INSERT piktag_notifications, optionally push via pg_net.
--   * SECURITY DEFINER, search_path=public, REVOKE PUBLIC.
--   * Push failures are caught — never block the trigger.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_ask_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := NEW.author_id;
  v_actor_full_name text;
  v_actor_username text;
  v_actor_avatar text;
  v_recipient record;
  v_already_exists boolean;
  v_body text;
  v_actor_label text;
  v_auth_key text;
  v_base_url text;
  v_push_token text;
BEGIN
  -- Defensive: only fire for the live author insert path.
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  -- Resolve author identity once.
  SELECT full_name, username, avatar_url
    INTO v_actor_full_name, v_actor_username, v_actor_avatar
    FROM public.piktag_profiles
   WHERE id = v_actor
   LIMIT 1;

  v_actor_label := COALESCE(
    NULLIF(v_actor_full_name, ''),
    NULLIF(v_actor_username, ''),
    'PikTag'
  );

  -- Body: `發了 Ask · {first 60 chars}`. NotificationsScreen renders
  -- `data.username` + body inline (see NotificationItem), so the body
  -- itself omits the name to avoid duplicate "Alice Alice 發了…".
  v_body := '發了 Ask · ' ||
            CASE
              WHEN char_length(NEW.body) <= 60 THEN NEW.body
              ELSE substring(NEW.body from 1 for 59) || '…'
            END;

  -- Fan out to everyone who has the author in their piktag_connections.
  -- Skip the author themselves defensively (the connection table
  -- shouldn't contain self-rows but we don't trust it).
  FOR v_recipient IN
    SELECT user_id
      FROM public.piktag_connections
     WHERE connected_user_id = v_actor
       AND user_id <> v_actor
  LOOP
    -- 24h dedup: same (user_id, type='ask_posted', ask_id) within a
    -- day means a re-fire of the same ask insertion (shouldn't happen
    -- under normal flows, but cheap to guard).
    SELECT EXISTS (
      SELECT 1 FROM public.piktag_notifications
      WHERE user_id = v_recipient.user_id
        AND type    = 'ask_posted'
        AND data->>'ask_id' = NEW.id::text
        AND created_at > now() - interval '24 hours'
    ) INTO v_already_exists;

    IF v_already_exists THEN
      CONTINUE;
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    ) VALUES (
      v_recipient.user_id,
      'ask_posted',
      '',
      v_body,
      jsonb_build_object(
        'actor_user_id', v_actor,
        -- Send the friendliest available label as `username` so the
        -- in-app NotificationItem renders the same string the push
        -- title uses (full_name preferred, falling back to handle).
        'username',      v_actor_label,
        'avatar_url',    v_actor_avatar,
        'ask_id',        NEW.id,
        'ask_body',      NEW.body
      ),
      false,
      now()
    );

    -- Best-effort push. Vault secrets seeded by 20260422_chat_push_trigger_vault.
    BEGIN
      SELECT decrypted_secret INTO v_auth_key
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_service_role_key' LIMIT 1;
      SELECT decrypted_secret INTO v_base_url
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_supabase_url' LIMIT 1;
      SELECT push_token INTO v_push_token
        FROM public.piktag_profiles
       WHERE id = v_recipient.user_id LIMIT 1;

      IF v_auth_key IS NOT NULL
         AND v_push_token IS NOT NULL
         AND length(v_push_token) > 0 THEN
        PERFORM net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Accept',        'application/json',
            'Authorization', 'Bearer ' || v_auth_key
          ),
          body := jsonb_build_object(
            'to',       v_push_token,
            'title',    v_actor_label,
            'body',     v_body,
            'data', jsonb_build_object(
              'type',          'ask_posted',
              'actor_user_id', v_actor,
              'ask_id',        NEW.id
            ),
            'sound',    'default',
            'priority', 'high'
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_ask_posted push dispatch failed: %', SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_ask_posted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_ask_posted() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_ask_posted ON public.piktag_asks;
CREATE TRIGGER trg_notify_ask_posted
AFTER INSERT ON public.piktag_asks
FOR EACH ROW EXECUTE FUNCTION public.notify_ask_posted();
