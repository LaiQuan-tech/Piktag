-- 20260703030000_notify_admin_signup_email.sql
--
-- Founder feature (2026-07-03): email lqtech2026@gmail.com whenever a
-- new user registers. Prompted by a wave of unexplained signups
-- (US-named faker-pattern gmail accounts, likely App Review testers or
-- bots) the founder only discovered days later in the admin backend —
-- real-time visibility beats archaeology.
--
-- Flow: piktag_profiles AFTER INSERT (handle_new_user creates the row
-- at signup) -> this trigger reads the auth email + vault secrets ->
-- net.http_post to the notify-admin-signup edge function -> Resend
-- (noreply@pikt.ag, RESEND_API_KEY function secret auto-provisioned by
-- the deploy workflow from the existing SMTP_PASS GitHub secret).
--
-- Safety properties:
--   * The trigger can NEVER fail the signup — everything is wrapped in
--     an exception handler that only RAISEs WARNING.
--   * Flood guard: if more than 20 profiles were created in the past
--     hour, skip the email (a bot wave would otherwise turn the
--     founder's inbox into the bot's amplifier). The admin backend
--     remains the complete record.
--   * Official account excluded (is_official insert = backfill/system).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.notify_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email     text;
  v_auth_key  text;
  v_base_url  text;
  v_last_hour int;
BEGIN
  BEGIN
    -- System/backfill rows are not signups.
    IF COALESCE(NEW.is_official, false) THEN
      RETURN NEW;
    END IF;

    -- Flood guard (bot wave -> don't amplify into the founder's inbox).
    SELECT count(*) INTO v_last_hour
    FROM public.piktag_profiles
    WHERE created_at > now() - interval '1 hour';
    IF v_last_hour > 20 THEN
      RAISE WARNING 'notify_admin_on_signup: >20 signups in the last hour — email suppressed (flood guard)';
      RETURN NEW;
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;

    SELECT decrypted_secret INTO v_auth_key
      FROM vault.decrypted_secrets WHERE name = 'piktag_service_role_key' LIMIT 1;
    SELECT decrypted_secret INTO v_base_url
      FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url' LIMIT 1;

    IF v_auth_key IS NULL OR v_base_url IS NULL THEN
      RAISE WARNING 'notify_admin_on_signup: vault secrets missing — email skipped';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_base_url || '/functions/v1/notify-admin-signup',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_auth_key
      ),
      body    := jsonb_build_object(
        'user_id',    NEW.id,
        'email',      v_email,
        'created_at', NEW.created_at
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- NEVER block a signup over an ops email.
    RAISE WARNING 'notify_admin_on_signup failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_admin_on_signup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_admin_on_signup()
  TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_admin_signup ON public.piktag_profiles;
CREATE TRIGGER trg_notify_admin_signup
  AFTER INSERT ON public.piktag_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_signup();
