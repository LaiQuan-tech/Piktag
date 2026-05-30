-- Schedule daily cleanup of guest photos older than 30 days.
--
-- Architecture:
--   pg_cron (in this DB) → net.http_post → Edge Function (delete-old-photos)
--                                          → Storage API (delete files)
--
-- Schedule: 03:00 UTC daily = 11:00 Asia/Taipei. Off-hours both for guests
-- (no scans expected) and operators (post-event window).
--
-- The Edge Function is deployed with --no-verify-jwt, so no auth header is
-- needed; the call is internal to this project (cron in DB → function in
-- same project). Adding auth would mean storing the service_role key in
-- vault.secrets, which is overkill for an internal-only invocation.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule any previous version so reruns of this migration are idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('delete-old-photos');
EXCEPTION WHEN OTHERS THEN
  -- First run: nothing to unschedule. Swallow the error.
  NULL;
END
$$;

SELECT cron.schedule(
  'delete-old-photos',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$
  SELECT net.http_post(
    url := 'https://tekcfwmdtwyrshnmbwva.supabase.co/functions/v1/delete-old-photos',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
