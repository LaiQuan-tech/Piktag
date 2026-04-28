-- 20260428q_notification_follow.sql
--
-- Reactive notification: type='follow'.
-- Spec card: docs/notification-types-spec.md §2.1.
--
-- This migration:
--   1. Creates the new base table piktag_followers (with RLS, indexes,
--      uniqueness + self-follow guard).
--   2. Creates trigger function public.notify_follow() —
--      SECURITY DEFINER, search_path=public — that:
--        a. Skips self-follows (defensive; CHECK already blocks them).
--        b. Performs a 24h dedup-SELECT against piktag_notifications
--           (user_id=following, type='follow', data->>'actor_user_id'=follower).
--        c. Resolves the follower's display name + avatar from
--           piktag_profiles.
--        d. INSERTs a piktag_notifications row with title='', a rendered
--           en body, and a data JSONB carrying the routing keys the
--           mobile app reads (actor_user_id, username, avatar_url,
--           follow_id).
--        e. Looks up the recipient's expo push token and POSTs to
--           https://exp.host/--/api/v2/push/send via pg_net, using the
--           Vault secrets piktag_service_role_key + piktag_supabase_url
--           seeded by 20260422_chat_push_trigger_vault.sql. Wrapped in
--           an EXCEPTION block so push failure never blocks the insert.
--   3. Binds trg_notify_follow AFTER INSERT on piktag_followers.
--   4. GRANTs EXECUTE on the function to postgres + service_role only;
--      REVOKEs from PUBLIC.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS / CREATE TRIGGER, CREATE INDEX IF NOT EXISTS.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- 1. piktag_followers — new base table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.piktag_followers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT piktag_followers_unique UNIQUE (follower_id, following_id),
  CONSTRAINT piktag_followers_no_self CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_followers_following
  ON public.piktag_followers (following_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_followers_follower
  ON public.piktag_followers (follower_id, created_at DESC);

ALTER TABLE public.piktag_followers ENABLE ROW LEVEL SECURITY;

-- RLS: spec §2.1
--   select  : either party can read the row
--   insert  : authenticated user can only insert rows where they are the follower
--   delete  : authenticated user can only unfollow themselves (delete their own row)

DROP POLICY IF EXISTS piktag_followers_select ON public.piktag_followers;
CREATE POLICY piktag_followers_select
  ON public.piktag_followers
  FOR SELECT
  TO authenticated
  USING (auth.uid() IN (follower_id, following_id));

DROP POLICY IF EXISTS piktag_followers_insert ON public.piktag_followers;
CREATE POLICY piktag_followers_insert
  ON public.piktag_followers
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS piktag_followers_delete ON public.piktag_followers;
CREATE POLICY piktag_followers_delete
  ON public.piktag_followers
  FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);

GRANT SELECT, INSERT, DELETE ON public.piktag_followers TO authenticated;
GRANT ALL                    ON public.piktag_followers TO postgres, service_role;

-- =============================================================================
-- 2. notify_follow() trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient      uuid;
  v_actor          uuid;
  v_actor_username text;
  v_actor_avatar   text;
  v_already_exists boolean;
  v_body           text := 'started following you';
  v_dedup_window   interval := interval '24 hours';
  v_push_token     text;
  v_auth_key       text;
  v_base_url       text;
BEGIN
  v_recipient := NEW.following_id;
  v_actor     := NEW.follower_id;

  -- Defensive: never notify a user about themselves.
  IF v_recipient IS NULL OR v_actor IS NULL OR v_recipient = v_actor THEN
    RETURN NEW;
  END IF;

  -- Dedup: skip if the same actor followed this recipient within last 24h.
  SELECT EXISTS (
    SELECT 1
      FROM public.piktag_notifications
     WHERE user_id   = v_recipient
       AND type      = 'follow'
       AND data->>'actor_user_id' = v_actor::text
       AND created_at > now() - v_dedup_window
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN NEW;
  END IF;

  -- Resolve actor display fields for the data payload + push title.
  SELECT COALESCE(p.username, p.full_name, ''),
         p.avatar_url
    INTO v_actor_username,
         v_actor_avatar
    FROM public.piktag_profiles p
   WHERE p.id = v_actor;

  -- Insert the in-app notification.
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  VALUES (
    v_recipient,
    'follow',
    '',
    v_body,
    jsonb_build_object(
      'actor_user_id', v_actor,
      'username',      COALESCE(v_actor_username, ''),
      'avatar_url',    v_actor_avatar,
      'follow_id',     NEW.id
    ),
    false,
    now()
  );

  -- Push notification (best-effort). Mirrors piktag_notify_message_push:
  -- read Vault secrets, POST to Expo via pg_net, swallow any failure.
  BEGIN
    SELECT decrypted_secret INTO v_auth_key
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_service_role_key'
     LIMIT 1;

    SELECT decrypted_secret INTO v_base_url
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_supabase_url'
     LIMIT 1;

    SELECT push_token INTO v_push_token
      FROM public.piktag_profiles
     WHERE id = v_recipient
     LIMIT 1;

    IF v_auth_key IS NULL OR v_base_url IS NULL THEN
      RAISE WARNING
        'notify_follow: vault secrets missing (piktag_service_role_key / piktag_supabase_url)';
    ELSIF v_push_token IS NOT NULL AND length(v_push_token) > 0 THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Accept',        'application/json',
          'Authorization', 'Bearer ' || v_auth_key
        ),
        body    := jsonb_build_object(
          'to',       v_push_token,
          'title',    COALESCE(NULLIF(v_actor_username, ''), 'PikTag'),
          'body',     v_body,
          'data',     jsonb_build_object(
            'type',          'follow',
            'actor_user_id', v_actor,
            'follow_id',     NEW.id
          ),
          'sound',    'default',
          'priority', 'high'
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_follow push dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_follow() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_follow() TO postgres, service_role;

-- =============================================================================
-- 3. Trigger binding
-- =============================================================================

DROP TRIGGER IF EXISTS trg_notify_follow ON public.piktag_followers;
CREATE TRIGGER trg_notify_follow
AFTER INSERT ON public.piktag_followers
FOR EACH ROW EXECUTE FUNCTION public.notify_follow();
