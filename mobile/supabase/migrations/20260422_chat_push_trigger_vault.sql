-- 20260422_chat_push_trigger_vault.sql
--
-- Re-point piktag_notify_message_push() at supabase_vault for secrets.
--
-- The previous migration (20260421_chat_push_trigger.sql) read the
-- service-role key and project URL from database-level GUCs
-- (app.settings.service_role_key / app.settings.supabase_url). That
-- design turned out to be impractical on Supabase managed Postgres:
--
--   1. Dashboard → Database → Custom Postgres Config (the supported UI
--      for setting custom GUCs) is behind a paid plan on this project.
--   2. The Management API SQL endpoint runs under a non-superuser role,
--      so ALTER DATABASE ... SET app.settings.* fails with 42501
--      permission denied — there is no API workaround.
--
-- supabase_vault is the Supabase-recommended pattern for exactly this
-- situation. Secrets are stored encrypted (pgsodium under the hood),
-- are invisible in pg_proc.prosrc AND in pg_dump output, and can only
-- be decrypted by the postgres role through the vault.decrypted_secrets
-- view. That materially improves on both the GUC design (GUCs leak via
-- pg_settings to any role) and the "inline the key in the function"
-- fallback (that key would sit in pg_proc.prosrc in plain text).
--
-- =============================================================================
-- One-time operator seeding (NOT in this migration — secrets stay out of git):
--
--   SELECT vault.create_secret(
--     'https://<project>.supabase.co',
--     'piktag_supabase_url',
--     'PikTag project URL for chat push trigger'
--   );
--
--   SELECT vault.create_secret(
--     '<service_role_secret>',
--     'piktag_service_role_key',
--     'PikTag service_role key for chat push trigger'
--   );
--
-- Rotate:
--
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'piktag_service_role_key'),
--     '<new-secret>'
--   );
--
-- Inspect (postgres role only):
--
--   SELECT name, decrypted_secret FROM vault.decrypted_secrets
--   WHERE name LIKE 'piktag_%';
--
-- If the two secrets aren't seeded, the trigger logs WARNING per INSERT
-- but never blocks the message — chat stays fully functional, only
-- push notification delivery is lost until the operator seeds Vault.
--
-- The trigger definition itself (trg_msg_push on piktag_messages) was
-- created in 20260421_chat_push_trigger.sql and is unchanged here —
-- only the function body is replaced.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.piktag_notify_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_key text;
  base_url text;
  func_url text;
BEGIN
  SELECT decrypted_secret INTO auth_key
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_service_role_key'
    LIMIT 1;

  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_supabase_url'
    LIMIT 1;

  IF auth_key IS NULL OR base_url IS NULL THEN
    -- Vault hasn't been seeded yet. Don't fail the INSERT — messages
    -- still get stored, realtime still notifies connected clients;
    -- only push delivery is lost until operator seeds Vault.
    RAISE WARNING
      'piktag_notify_message_push: vault secrets missing (piktag_service_role_key / piktag_supabase_url)';
    RETURN NEW;
  END IF;

  func_url := base_url || '/functions/v1/send-chat-push';

  BEGIN
    PERFORM net.http_post(
      url     := func_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || auth_key
      ),
      body    := jsonb_build_object('message_id', NEW.id::text)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'piktag_notify_message_push http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
