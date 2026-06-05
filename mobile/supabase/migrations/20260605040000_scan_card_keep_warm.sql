-- 20260605040000_scan_card_keep_warm.sql
-- =============================================================================
-- Keep the scan-business-card edge function HOT.
--
-- Why: business-card scan is a commodity flow on the CRITICAL path
-- (CLAUDE.md: "Commodity features must feel instant — speed is a STRATEGIC
-- red line"). The single biggest *actual-time* tax left on the path is the
-- Deno edge-function cold start: at low pre-launch traffic the isolate is
-- evicted between scans, so the FIRST scan of a session eats a multi-hundred-
-- ms (sometimes seconds) spin-up before any OCR text even reaches Gemini.
--
-- A periodic warm-up ping keeps the isolate resident, so a real scan lands on
-- an already-running function. The ping carries `{ warmup: true }`, which the
-- function short-circuits the instant it parses the body — BEFORE any Gemini
-- call — so the warm-up costs no model tokens, just the cold-start prevention.
--
-- Idempotent: CREATE OR REPLACE + unschedule-then-schedule. Re-running on CI
-- replaces the entry cleanly.
--
-- Vault secrets reused (seeded by 20260422_chat_push_trigger_vault.sql):
--   * piktag_service_role_key
--   * piktag_supabase_url
-- If either is missing the function warns and no-ops — never throws (a failed
-- keep-warm must never surface as a cron error).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.warm_scan_business_card()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_auth_key  text;
  v_base_url  text;
  v_func_url  text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_auth_key
      FROM vault.decrypted_secrets
      WHERE name = 'piktag_service_role_key'
      LIMIT 1;

    SELECT decrypted_secret INTO v_base_url
      FROM vault.decrypted_secrets
      WHERE name = 'piktag_supabase_url'
      LIMIT 1;

    IF v_auth_key IS NULL OR v_base_url IS NULL THEN
      RAISE WARNING
        'warm_scan_business_card: vault secrets missing — keep-warm skipped';
      RETURN;
    END IF;

    v_func_url := v_base_url || '/functions/v1/scan-business-card';

    PERFORM net.http_post(
      url     := v_func_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_auth_key
      ),
      body    := jsonb_build_object('warmup', true)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let a keep-warm hiccup register as a cron failure.
    RAISE WARNING 'warm_scan_business_card failed: %', SQLERRM;
  END;
END;
$$;

-- -----------------------------------------------------------------------------
-- Schedule: every 4 minutes. Supabase evicts idle isolates after a few minutes
-- of inactivity; 4 min stays comfortably inside that window with headroom.
-- The ping is model-free, so frequency cost is negligible (one tiny HTTP round
-- trip + a pg_net response row).
-- -----------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.unschedule('scan-business-card-keep-warm');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" — fine on first install.
  NULL;
END
$cron$;

SELECT cron.schedule(
  'scan-business-card-keep-warm',
  '*/4 * * * *',
  $cmd$ SELECT public.warm_scan_business_card(); $cmd$
);
