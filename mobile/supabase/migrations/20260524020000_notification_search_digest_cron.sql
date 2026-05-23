-- 20260524020000_notification_search_digest_cron.sql
--
-- Weekly automated "search digest" push notification for admins.
-- Pairs with the search_telemetry table (20260524000000) and the new
-- edge function `notification-search-digest`.
--
-- WHY: the founder explicitly said "人工會忘記" — opening SQL Editor
-- every week to check search_recovery_failures is a discipline that
-- silently lapses. A push notification to their phone every Monday
-- morning closes the loop: see X, decide whether to seed tags/
-- aliases, ignore. Zero-failure weeks send nothing.
--
-- Pattern mirrors 20260519010000_auto_link_concepts_pg_cron:
--   • pg_cron fires a SECURITY DEFINER trigger function.
--   • Trigger reads Vault for CRON_SECRET + base URL.
--   • net.http_post(...) the edge function with Bearer CRON_SECRET.
--   • Soft-fails (WARNING, no throw) if Vault isn't seeded yet — same
--     defense-in-depth as the link-concepts cron.

-- ── 1. Helper RPC: admin user_ids + push_tokens ────────────────
-- Edge function calls this to find recipients. SECURITY DEFINER so
-- it can read auth.users; GRANTed only to service_role (which the
-- edge function uses) — no client exposure.
CREATE OR REPLACE FUNCTION public.get_admin_notification_recipients()
RETURNS TABLE(user_id uuid, push_token text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, p.push_token
  FROM auth.users u
  JOIN public.admins a ON LOWER(u.email) = LOWER(a.email)
  LEFT JOIN public.piktag_profiles p ON p.id = u.id;
$$;

REVOKE ALL ON FUNCTION public.get_admin_notification_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_recipients() TO postgres, service_role;

-- ── 2. Cron trigger: HTTP POST to the edge function ────────────
CREATE OR REPLACE FUNCTION public.trigger_notification_search_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url    text;
  cron_secret text;
BEGIN
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_supabase_url'
    LIMIT 1;

  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_cron_secret'
    LIMIT 1;

  IF base_url IS NULL OR cron_secret IS NULL THEN
    RAISE WARNING
      'trigger_notification_search_digest: vault secrets missing — skipping (see 20260519010000 for seeding instructions)';
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := base_url || '/functions/v1/notification-search-digest',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cron_secret
      ),
      body    := jsonb_build_object()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Network / pg_net hiccup must not fail the cron job. Next week
    -- retries automatically; missing one week's digest is OK.
    RAISE WARNING 'trigger_notification_search_digest http_post failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_notification_search_digest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_notification_search_digest() TO postgres, service_role;

-- ── 3. Schedule: every Monday 01:00 UTC (≈ 09:00 Taipei, Mon morning) ──
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'notification-search-digest-weekly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'notification-search-digest-weekly',
  '0 1 * * 1',  -- Monday 01:00 UTC = Monday 09:00 Asia/Taipei
  $cron$ SELECT public.trigger_notification_search_digest(); $cron$
);
