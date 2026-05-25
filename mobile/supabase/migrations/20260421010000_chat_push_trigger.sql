-- 20260421_chat_push_trigger.sql
--
-- Wire DB-level push notification for new chat messages.
--
-- On every INSERT into piktag_messages, this trigger calls the
-- send-chat-push Edge Function via pg_net, which resolves the recipient's
-- expo push_token and forwards the payload to Expo's push service.
--
-- The chat_messaging.sql migration intentionally left the push wiring out
-- because it requires:
--   1. pg_net extension enabled (non-default; manual step once per project)
--   2. A service-role key in a place pg_net can read at runtime
--   3. The send-chat-push Edge Function to be deployed with verify_jwt=false
--      (configured in mobile/supabase/config.toml) because Supabase's new
--      sb_secret_* keys are opaque tokens, not JWTs, and would fail the
--      platform-level JWT verifier
--
-- One-time operator setup (not automated in this migration):
--   Dashboard -> Database -> Extensions -> enable `pg_net`
--   Dashboard -> Database -> Settings -> Custom Postgres config:
--     app.settings.service_role_key = <project service_role secret>
--     app.settings.supabase_url      = https://<project>.supabase.co
--
-- Without those settings the trigger logs a warning per INSERT but never
-- blocks the message send.

-- =============================================================================

CREATE OR REPLACE FUNCTION public.piktag_notify_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_key   text;
  func_url   text;
BEGIN
  auth_key := NULLIF(current_setting('app.settings.service_role_key', true), '');
  func_url := COALESCE(
    NULLIF(current_setting('app.settings.supabase_url', true), '') || '/functions/v1/send-chat-push',
    ''
  );

  IF auth_key IS NULL OR func_url = '' THEN
    -- Mis-configured project (superuser hasn't set the GUCs).
    -- Don't fail the message INSERT — just warn. Messages still get stored,
    -- realtime still notifies connected clients; only push delivery is lost.
    RAISE WARNING
      'piktag_notify_message_push: missing app.settings.service_role_key or app.settings.supabase_url';
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_msg_push ON public.piktag_messages;
CREATE TRIGGER trg_msg_push
AFTER INSERT ON public.piktag_messages
FOR EACH ROW
EXECUTE FUNCTION public.piktag_notify_message_push();

-- Clean up the exploratory earlier trigger name if it exists
DROP TRIGGER IF EXISTS trg_notify_new_chat_message ON public.piktag_messages;
DROP FUNCTION IF EXISTS public.notify_new_chat_message() CASCADE;
