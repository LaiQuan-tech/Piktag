-- 20260617010000_retire_search_digest_cron.sql
-- =============================================================================
-- Retire the weekly "PikTag 週報" admin push (notification-search-digest).
--
-- Decision (founder, 2026-06-17): operational data belongs in the admin
-- backend (admin.pikt.ag), NOT pushed to the founder's phone — consistent with
-- the 2026-06-07 "ops data lives in the admin backend; the app does not push
-- internal telemetry" direction. The same growth + search-health numbers are
-- already on the admin analytics page; the one piece that was push-only
-- (top failing-search keywords + vs-last-week trend) is added to that page in
-- the same change.
--
-- This migration removes ONLY the weekly PUSH machinery:
--   1. Unschedule the pg_cron job 'notification-search-digest-weekly'.
--   2. Drop the trigger function public.trigger_notification_search_digest().
--
-- KEPT INTACT (do NOT touch):
--   - piktag_search_telemetry table + its prune cron + RLS + indexes — this is
--     the data we want, now surfaced in the admin dashboard.
--   - public.get_admin_notification_recipients() — STILL used by
--     notify-admin-growth for the linker-stall / concept-health admin_alert
--     crons; dropping it would break those.
-- The notification-search-digest edge-function source is removed in the same
-- commit; the orphaned deployed copy is unreachable once this cron + trigger
-- are gone (optionally `supabase functions delete notification-search-digest`).
--
-- Idempotent.
-- =============================================================================

-- 1. Unschedule the weekly cron (guarded for not-found / re-runs).
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

-- 2. Drop the trigger function that HTTP-POSTed the edge function.
DROP FUNCTION IF EXISTS public.trigger_notification_search_digest();
