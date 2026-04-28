-- 20260428s_notification_tag_added.sql
--
-- Reactive notification: tag_added.
--
-- Fires when someone tags another user's profile by inserting a row into
-- piktag_user_tags where the actor (auth.uid()) is not the profile owner
-- (NEW.user_id). Spec: docs/notification-types-spec.md §2.3.
--
-- Behavior:
--   1. Resolve actor via current_setting('request.jwt.claim.sub', true).
--      If NULL (e.g. service-role insert, seed scripts), skip silently.
--   2. Skip self-tagging (actor == profile owner).
--   3. Dedup-SELECT against piktag_notifications: skip if a row with the
--      same (user_id, type='tag_added', actor_user_id, tag_id) exists in
--      the last 24 hours. (Re-tag spam guard.)
--   4. INSERT a row into piktag_notifications with:
--        title  = ''
--        body   = 'tagged you as #<tag_name>'
--        data   = { actor_user_id, username, avatar_url, tag_id, tag_name,
--                   user_tag_id }
--   5. Fire an Expo push directly via pg_net to the recipient's push_token,
--      reading service-role / project-url from supabase_vault (re-using the
--      existing piktag_service_role_key / piktag_supabase_url secrets).
--      Push failures are swallowed — notification persistence is not blocked.
--
-- All conventions follow docs/notification-types-spec.md §3:
--   * Function name: notify_tag_added (not piktag_notify_*).
--   * SECURITY DEFINER, SET search_path = public.
--   * GRANT EXECUTE only to postgres + service_role.
--   * Trigger name: trg_notify_tag_added on piktag_user_tags AFTER INSERT.
--   * Idempotent (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_tag_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient        uuid;
  v_actor            uuid;
  v_actor_username   text;
  v_actor_full_name  text;
  v_actor_avatar     text;
  v_tag_name         text;
  v_already_exists   boolean;
  v_body             text;
  v_data             jsonb;
  v_recipient_token  text;
  v_auth_key         text;
  v_base_url         text;
  v_display_name     text;
BEGIN
  -- 1. Recipient is the profile owner being tagged.
  v_recipient := NEW.user_id;

  -- 2. Resolve actor from JWT claim. Trigger runs SECURITY DEFINER so
  --    auth.uid() may not be reliable; the documented Supabase pattern
  --    uses the request.jwt.claim.sub setting. NULL means service-role
  --    or backend insert — skip the notification entirely per spec.
  BEGIN
    v_actor := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Defensive: never notify a user about their own action.
  IF v_recipient IS NULL OR v_recipient = v_actor THEN
    RETURN NEW;
  END IF;

  -- 4. Dedup check (24h window per spec §2.3).
  SELECT EXISTS (
    SELECT 1 FROM piktag_notifications
     WHERE user_id   = v_recipient
       AND type      = 'tag_added'
       AND data->>'actor_user_id' = v_actor::text
       AND data->>'tag_id'        = NEW.tag_id::text
       AND created_at > now() - interval '24 hours'
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN NEW;
  END IF;

  -- 5. Resolve actor profile fields needed by mobile UI / push payload.
  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
    FROM piktag_profiles
   WHERE id = v_actor
   LIMIT 1;

  v_display_name := COALESCE(NULLIF(v_actor_username, ''), NULLIF(v_actor_full_name, ''), '');

  -- 6. Resolve tag name.
  SELECT name
    INTO v_tag_name
    FROM piktag_tags
   WHERE id = NEW.tag_id
   LIMIT 1;

  v_tag_name := COALESCE(v_tag_name, '');
  v_body := 'tagged you as #' || v_tag_name;

  v_data := jsonb_build_object(
    'actor_user_id', v_actor,
    'username',      v_display_name,
    'avatar_url',    v_actor_avatar,
    'tag_id',        NEW.tag_id,
    'tag_name',      v_tag_name,
    'user_tag_id',   NEW.id
  );

  -- 7. Insert notification row (mobile realtime fan-out picks it up via
  --    postgres_changes filtered on user_id).
  INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
  VALUES (
    v_recipient,
    'tag_added',
    '',
    v_body,
    v_data,
    false,
    now()
  );

  -- 8. Best-effort Expo push. Read recipient's push_token; if missing,
  --    skip push but keep the in-app notification.
  SELECT push_token
    INTO v_recipient_token
    FROM piktag_profiles
   WHERE id = v_recipient
   LIMIT 1;

  IF v_recipient_token IS NULL OR v_recipient_token = '' THEN
    RETURN NEW;
  END IF;

  -- 9. Service-role / URL come from supabase_vault — reuse the secrets
  --    seeded by 20260422_chat_push_trigger_vault.sql. We don't actually
  --    need them for a direct Expo POST, but per spec §3.6 we keep the
  --    Vault read here so a future relay-via-edge-function refactor can
  --    swap in the relay URL without touching the trigger contract.
  SELECT decrypted_secret INTO v_auth_key
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_service_role_key'
    LIMIT 1;

  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_supabase_url'
    LIMIT 1;

  -- Vault not seeded → notification persisted, push lost. Do not block.
  IF v_auth_key IS NULL OR v_base_url IS NULL THEN
    RAISE WARNING
      'notify_tag_added: vault secrets missing (piktag_service_role_key / piktag_supabase_url) — push skipped';
    RETURN NEW;
  END IF;

  -- 10. Direct Expo push. Inline is acceptable for low-volume reactive
  --     types (spec §3.10). Wrap in EXCEPTION block so push failure
  --     never bubbles up to abort the original tag insertion.
  BEGIN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Accept',       'application/json'
      ),
      body    := jsonb_build_object(
        'to',       v_recipient_token,
        'title',    COALESCE(NULLIF(v_display_name, ''), 'PikTag'),
        'body',     v_body,
        'data',     jsonb_build_object(
                      'type',          'tag_added',
                      'actor_user_id', v_actor,
                      'tag_id',        NEW.tag_id,
                      'tag_name',      v_tag_name,
                      'user_tag_id',   NEW.id
                    ),
        'sound',    'default',
        'priority', 'high'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_tag_added expo push failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_tag_added() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_tag_added() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_tag_added ON piktag_user_tags;
CREATE TRIGGER trg_notify_tag_added
AFTER INSERT ON piktag_user_tags
FOR EACH ROW EXECUTE FUNCTION public.notify_tag_added();
