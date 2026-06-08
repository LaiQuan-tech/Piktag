-- 20260608020000_revoke_execute_internal_functions.sql
-- =============================================================================
-- Trim the Security Advisor "*_security_definer_function_executable" warnings
-- (founder 2026-06-08) — SAFELY. That lint flags every SECURITY DEFINER
-- function anon/authenticated can EXECUTE. For an RPC-driven app most of those
-- are BY DESIGN (the client calls them; they carry internal auth.uid() checks),
-- and revoking would break the app. So we only lock down functions that the
-- client provably never calls:
--   A. TRIGGER functions  — return type `trigger`; can't be PostgREST RPCs and
--      aren't used in RLS policies. Triggers fire regardless of EXECUTE grant,
--      so revoking from PUBLIC is 100% safe.
--   B. CRON-only functions — scheduled via pg_cron (run as the job owner =
--      postgres), verified NOT in the client/edge `.rpc()` set. Owner retains
--      execute, so cron keeps working.
-- Genuine client RPCs (search_users, get_user_detail, fetch_*, the
-- client-called enqueue_*, admin_* the dashboard calls via service-role, and
-- policy helpers like is_admin) are deliberately LEFT — their warning is the
-- accepted Supabase RPC pattern.
--
-- REVOKE is FROM PUBLIC (the default grant source) + anon + authenticated, so
-- the privilege is actually removed (a bare REVOKE from anon wouldn't, since
-- the grant comes via PUBLIC). Idempotent.
-- =============================================================================

-- A. All public TRIGGER functions (return type = trigger).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'revoke on trigger fn % failed: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;

-- B. Cron-only functions (pg_cron jobs; NOT in the client/edge .rpc() set).
DO $$
DECLARE
  r record;
  cron_only text[] := ARRAY[
    'auto_seed_search_failure_tags',
    'enqueue_ask_prompt_notifications',
    'enqueue_contact_sync_nudges',
    'enqueue_endorsement_requests',
    'enqueue_on_this_day_notifications',
    'enqueue_reconnect_notifications',
    'enqueue_tag_combo_notifications',
    'promote_search_learnings',
    'trigger_auto_link_concepts',
    'trigger_notification_search_digest',
    'warm_scan_business_card',
    'warm_suggest_tags'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(cron_only)
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'revoke on cron fn % failed: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;
