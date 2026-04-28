-- 20260428r_notification_friend.sql
--
-- Reactive notification trigger: emit `friend` notifications when a
-- bidirectional `piktag_connections` relationship is established.
--
-- Per spec card §2.2 (docs/notification-types-spec.md):
--   * Trigger model: reactive (AFTER INSERT on piktag_connections).
--   * A "friend" relationship is bidirectional. When a NEW row's reverse
--     counterpart already exists, both sides become friends — emit ONE
--     notification per side (two inserts total). Each side is dedup-checked
--     independently.
--   * Dedup window: 7 days, keyed on (user_id, type='friend',
--     data->>'friend_user_id').
--   * Push delivery: yes — dispatched via pg_net.http_post directly to the
--     Expo push endpoint, using Vault secrets piktag_service_role_key and
--     piktag_supabase_url (re-used from 20260422_chat_push_trigger_vault.sql,
--     no new Vault secrets are introduced per spec §3.6). Push failure must
--     never block the notification insert.
--
-- Idempotent: function is CREATE OR REPLACE, trigger is dropped first.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_friend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reverse_id      uuid;
  v_dedup_window    interval := interval '7 days';
  v_body_en         text     := 'you are now friends';
  v_auth_key        text;
  v_base_url        text;

  -- Per-side bindings (the trigger emits up to two notifications).
  v_recipient       uuid;
  v_actor           uuid;
  v_connection_id   uuid;
  v_username        text;
  v_full_name       text;
  v_avatar_url      text;
  v_push_token      text;
  v_already_exists  boolean;

  -- Iterator over the two sides of the handshake.
  v_side            integer;
BEGIN
  -- 1. Confirm bidirectional handshake. The reverse row must already exist.
  SELECT id
    INTO v_reverse_id
    FROM piktag_connections
   WHERE user_id           = NEW.connected_user_id
     AND connected_user_id = NEW.user_id
   LIMIT 1;

  IF v_reverse_id IS NULL THEN
    -- One-sided connection — friend status not yet reached.
    RETURN NEW;
  END IF;

  -- Defensive: never notify for self-connections (should be impossible).
  IF NEW.user_id IS NULL OR NEW.connected_user_id IS NULL
     OR NEW.user_id = NEW.connected_user_id THEN
    RETURN NEW;
  END IF;

  -- 2. Look up Vault secrets once (used by the optional push call below).
  --    A missing secret is non-fatal — the notification rows still land,
  --    only push delivery is skipped.
  BEGIN
    SELECT decrypted_secret INTO v_auth_key
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_service_role_key' LIMIT 1;
    SELECT decrypted_secret INTO v_base_url
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_supabase_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_auth_key := NULL;
    v_base_url := NULL;
  END;

  -- 3. Emit one notification per side.
  FOR v_side IN 1..2 LOOP
    IF v_side = 1 THEN
      -- Side A: recipient = NEW.user_id, friend = NEW.connected_user_id.
      v_recipient     := NEW.user_id;
      v_actor         := NEW.connected_user_id;
      v_connection_id := NEW.id;
    ELSE
      -- Side B: recipient = NEW.connected_user_id, friend = NEW.user_id.
      v_recipient     := NEW.connected_user_id;
      v_actor         := NEW.user_id;
      v_connection_id := v_reverse_id;
    END IF;

    -- 3a. Dedup: skip if this user was already told about this friend
    --     within the past 7 days (guards unfriend->refriend spam).
    SELECT EXISTS (
      SELECT 1
        FROM piktag_notifications
       WHERE user_id   = v_recipient
         AND type      = 'friend'
         AND data->>'friend_user_id' = v_actor::text
         AND created_at > now() - v_dedup_window
    ) INTO v_already_exists;

    IF v_already_exists THEN
      CONTINUE;
    END IF;

    -- 3b. Resolve the actor's display fields for the data payload + push.
    SELECT username, full_name, avatar_url
      INTO v_username, v_full_name, v_avatar_url
      FROM piktag_profiles
     WHERE id = v_actor
     LIMIT 1;

    -- 3c. Insert the notification row.
    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    ) VALUES (
      v_recipient,
      'friend',
      '',
      v_body_en,
      jsonb_build_object(
        'actor_user_id',  v_actor,
        'friend_user_id', v_actor,
        'connection_id',  v_connection_id,
        'username',       COALESCE(v_username, v_full_name, ''),
        'avatar_url',     v_avatar_url
      ),
      false,
      now()
    );

    -- 3d. Optional push delivery via Expo. Wrapped so any failure
    --     (network, missing token, missing Vault secret, ...) is
    --     swallowed — the in-app notification is the source of truth.
    IF v_auth_key IS NOT NULL AND v_base_url IS NOT NULL THEN
      BEGIN
        SELECT push_token
          INTO v_push_token
          FROM piktag_profiles
         WHERE id = v_recipient
         LIMIT 1;

        IF v_push_token IS NOT NULL AND length(v_push_token) > 0 THEN
          PERFORM net.http_post(
            url     := 'https://exp.host/--/api/v2/push/send',
            headers := jsonb_build_object(
              'Content-Type',  'application/json',
              'Accept',        'application/json',
              'Authorization', 'Bearer ' || v_auth_key
            ),
            body    := jsonb_build_object(
              'to',       v_push_token,
              'title',    COALESCE(v_username, v_full_name, 'PikTag'),
              'body',     v_body_en,
              'data',     jsonb_build_object(
                            'type',           'friend',
                            'actor_user_id',  v_actor,
                            'friend_user_id', v_actor,
                            'connection_id',  v_connection_id
                          ),
              'sound',    'default',
              'priority', 'high'
            )
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_friend push dispatch failed: %', SQLERRM;
      END;
    ELSE
      RAISE WARNING
        'notify_friend: vault secrets missing — push skipped for recipient %', v_recipient;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_friend() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_friend() TO postgres, service_role;

-- Trigger binding. AFTER INSERT per spec §2.2 — the bidirectional handshake
-- is detected by the reverse-row EXISTS check above (UPDATE is not a
-- meaningful event for this table since friend status is binary on the
-- existence of both rows, not on a status column).
DROP TRIGGER IF EXISTS trg_notify_friend ON piktag_connections;
CREATE TRIGGER trg_notify_friend
AFTER INSERT ON piktag_connections
FOR EACH ROW EXECUTE FUNCTION public.notify_friend();
