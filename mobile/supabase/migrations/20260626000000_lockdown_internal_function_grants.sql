-- 20260626000000_lockdown_internal_function_grants.sql
-- =============================================================================
-- Security-Advisor "*_security_definer_function_executable" cleanup, round 2
-- (founder 2026-06-26, from the Supabase lint export). Follows the same SAFE
-- doctrine as 20260608020000: only lock down functions the client PROVABLY
-- never calls, leaving genuine client RPCs (search/fetch/chat/asks/scan flow)
-- alone — their warning is the accepted Supabase SECURITY DEFINER + auth.uid()
-- pattern, and revoking would break the app.
--
-- This round covers functions verified (by grepping mobile/landing client,
-- edge functions, landing/api, and the admin app) to be called ONLY by:
--   • pg_cron            (runs as `postgres`)
--   • edge fns / admin   (run as `service_role`)
--   • triggers / internal definer helpers
--   • retired surfaces   (invite-code system, the old Tribe lineage)
-- None are reachable from a signed-out OR signed-in client `.rpc()`.
--
-- CRITICAL difference vs 20260608020000: that round was pure-cron (postgres =
-- owner keeps EXECUTE), so a bare REVOKE sufficed. SEVERAL functions here are
-- called by EDGE FUNCTIONS / the ADMIN dashboard via the service_role key
-- (admin_*, try_consume_*_quota, find_reconnect_suggestions, …). A bare
-- REVOKE FROM PUBLIC would strip service_role's EXECUTE (it comes via PUBLIC)
-- and break them. So every function here is RE-GRANTED to postgres +
-- service_role after the revoke. Net effect: anon + authenticated can no
-- longer call them (closes the abuse / admin-data-exposure vectors and clears
-- both lint rows per function), while cron / edge / admin keep working.
--
-- DELIBERATELY EXCLUDED (kept callable — pre-auth / public / client flows):
--   get_scan_session_public, record_pending_connection, check_username_available,
--   qr_group_member_count, qr_group_members, increment_scan_count,
--   match_contacts_against_profiles, and all the signed-in client RPCs.
-- Idempotent (REVOKE/GRANT) + per-function guarded, so CI re-runs are safe.
-- =============================================================================

DO $$
DECLARE
  r record;
  internal_fns text[] := ARRAY[
    -- admin dashboard (service_role; also carry internal is_admin() guards)
    'admin_overview',
    'admin_biolink_click_stats',
    'admin_concept_graph_health',
    'admin_report_concept_merge_candidates',
    'get_admin_notification_recipients',
    -- notification / recommendation cron (pg_cron + recommendation edge)
    'enqueue_anniversary_notifications',
    'enqueue_birthday_notifications',
    'enqueue_date_tag_anniversaries',
    'enqueue_recommendation_notifications',
    'enqueue_tag_trending_notifications',
    'find_ask_prompt_targets',
    'find_on_this_day_anniversaries',
    'find_reconnect_suggestions',
    'find_tag_combinations',
    'find_tag_similar_strangers',   -- dead code (no caller; see CLAUDE.md)
    'get_daily_recommendation',
    'refresh_tag_snapshots_today',
    -- retired invite-code system (no live callers)
    'generate_invite_code',
    'redeem_invite_code',
    'recover_invite_quota_rpc',
    'check_invite_redeem_rate_limit',
    -- retired Tribe lineage (callers removed 2026-06-25)
    'get_tribe_lineage',
    'get_tribe_size',
    -- triggers / internal definer helpers / edge rate-limit gates
    'add_official_friend',
    'promote_local_contacts_for_profile',
    'piktag_classify_conversation',
    'try_consume_extract_intent_quota',
    'try_consume_scan_card_quota',
    'try_consume_suggest_tags_quota'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(internal_fns)
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres, service_role', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'lockdown grant on % failed: %', r.sig, SQLERRM;
    END;
  END LOOP;
END $$;
