-- 20260607000000_suggest_tags_keep_warm.sql
-- =============================================================================
-- Keep the suggest-tags edge function HOT (founder 2026-06-07).
--
-- Why: the card-scan tag suggestion (EditLocalContact → suggest-tags, fast
-- path) was already trimmed to flash-lite + a lean 1-3 person prompt, but the
-- one actual-time tax left is the Deno edge-function cold start — at low
-- pre-launch traffic the isolate is evicted between scans, so the first
-- suggestion of a session eats a multi-hundred-ms (sometimes seconds) spin-up.
-- Slimming the INPUT fields doesn't help that (LLM latency is output-tokens +
-- model + cold-start bound, not input-size bound); keeping the isolate
-- resident does.
--
-- A periodic ping carries `{ warmup: true }`, which suggest-tags short-circuits
-- the instant it parses the body — BEFORE any Gemini call — so the warm-up
-- costs no model tokens, just the cold-start prevention. Same pattern as
-- scan-business-card (20260605040000).
--
-- Idempotent: CREATE OR REPLACE + unschedule-then-schedule.
--
-- Vault secrets reused (seeded by 20260422_chat_push_trigger_vault.sql):
--   * piktag_service_role_key
--   * piktag_supabase_url
-- If either is missing the function warns and no-ops — never throws (a failed
-- keep-warm must never surface as a cron error).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.warm_suggest_tags()
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
        'warm_suggest_tags: vault secrets missing — keep-warm skipped';
      RETURN;
    END IF;

    v_func_url := v_base_url || '/functions/v1/suggest-tags';

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
    RAISE WARNING 'warm_suggest_tags failed: %', SQLERRM;
  END;
END;
$$;

-- -----------------------------------------------------------------------------
-- Schedule: every 4 minutes (same window as scan-business-card-keep-warm).
-- Supabase evicts idle isolates after a few minutes; 4 min stays inside that
-- with headroom. The ping is model-free, so frequency cost is negligible.
-- -----------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.unschedule('suggest-tags-keep-warm');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" — fine on first install.
  NULL;
END
$cron$;

SELECT cron.schedule(
  'suggest-tags-keep-warm',
  '*/4 * * * *',
  $cmd$ SELECT public.warm_suggest_tags(); $cmd$
);
