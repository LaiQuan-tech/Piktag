-- 20260527000000_admin_growth_notifications.sql
--
-- Two real-time admin-push triggers for the launch-day growth pulse:
--
--   1. New signup           — a new piktag_profiles row appears
--      (handle_new_user fires this on every fresh auth.users INSERT)
--                          → push to admins: "🎉 N joined PikTag"
--
--   2. Magic moment         — a user's FIRST piktag_connections row
--      (their first outgoing friend-add — the product-market-fit
--      signal: someone got enough value out of PikTag to add
--      another human to it)
--                          → push to admins: "✨ N just added their first friend"
--
-- Both call the SAME edge function endpoint pattern:
--   POST /functions/v1/notify-admin-growth
--   Body: { event: 'signup' | 'magic_moment', user_id, ... }
--
-- A single edge function handler keeps the surface small (one
-- secret config, one deploy artefact). The handler branches on
-- `event` to compose the right title/body, then delivers via the
-- existing get_admin_notification_recipients + Expo push pipeline.
--
-- Vault secrets reused (same ones the search digest uses):
--   • piktag_supabase_url  — base URL for /functions/v1/*
--   • piktag_cron_secret   — Bearer auth between DB trigger and fn
--
-- Failure mode: pg_net.http_post errors are CAUGHT inside an
-- EXCEPTION block. A notification miss MUST NOT roll back the
-- triggering INSERT — losing a "user signed up" event is fine;
-- losing the user's profile row is catastrophic.

-- ── 1. Trigger function: new signup ─────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url     text;
  cron_secret  text;
BEGIN
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'piktag_cron_secret' LIMIT 1;

  IF base_url IS NULL OR cron_secret IS NULL THEN
    RAISE WARNING 'notify_admin_new_signup: vault secrets missing — skipping';
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := base_url || '/functions/v1/notify-admin-growth',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cron_secret
      ),
      body    := jsonb_build_object(
        'event',    'signup',
        'user_id',  NEW.id,
        'name',     NEW.full_name,
        'username', NEW.username
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_admin_new_signup http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_new_signup ON public.piktag_profiles;
CREATE TRIGGER trg_notify_admin_new_signup
  AFTER INSERT ON public.piktag_profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_signup();

-- ── 2. Trigger function: magic moment (first connection) ────────
-- Fires only when COUNT(*) = 1 right after the INSERT — i.e., this
-- is the row that took the user from 0 → 1 outgoing friend-add.
-- "user_id" semantics: the SEARCHER's id (who clicked "add"); we
-- intentionally don't fire on connected_user_id matches because
-- "someone added me as a friend" is a different (good but separate)
-- signal — it doesn't tell us THIS user has activated.
CREATE OR REPLACE FUNCTION public.notify_admin_first_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url       text;
  cron_secret    text;
  v_count        int;
  v_searcher     record;
  v_friend       record;
BEGIN
  -- AFTER INSERT, so count already includes NEW.
  SELECT COUNT(*) INTO v_count
    FROM public.piktag_connections
    WHERE user_id = NEW.user_id;

  IF v_count <> 1 THEN
    -- Not the first outgoing connection — skip.
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets WHERE name = 'piktag_cron_secret' LIMIT 1;

  IF base_url IS NULL OR cron_secret IS NULL THEN
    RAISE WARNING 'notify_admin_first_connection: vault secrets missing — skipping';
    RETURN NEW;
  END IF;

  -- Pull display names from piktag_profiles for the push body.
  SELECT full_name, username INTO v_searcher
    FROM public.piktag_profiles WHERE id = NEW.user_id LIMIT 1;
  SELECT full_name, username INTO v_friend
    FROM public.piktag_profiles WHERE id = NEW.connected_user_id LIMIT 1;

  BEGIN
    PERFORM net.http_post(
      url     := base_url || '/functions/v1/notify-admin-growth',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cron_secret
      ),
      body    := jsonb_build_object(
        'event',           'magic_moment',
        'user_id',         NEW.user_id,
        'name',            v_searcher.full_name,
        'username',        v_searcher.username,
        'friend_name',     v_friend.full_name,
        'friend_username', v_friend.username
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_admin_first_connection http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_first_connection ON public.piktag_connections;
CREATE TRIGGER trg_notify_admin_first_connection
  AFTER INSERT ON public.piktag_connections
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_first_connection();

-- ── Grants ──────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.notify_admin_new_signup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admin_first_connection() FROM PUBLIC;
-- Triggers run as the table owner (postgres / service_role context).
-- No GRANT EXECUTE needed for trigger-only functions.
