-- 20260429_drop_contract_expiry.sql
--
-- Removes the orphaned `contract_expiry` CRM feature.
--
-- The Edge Function + SQL helper + pg_cron job kept emitting daily
-- "合約即將到期" notifications even after the FriendDetail UI lost
-- its way to set the date (FriendDetailScreen.ReminderField was
-- narrowed to 'birthday' only, leaving setContractExpiry() as dead
-- code that never fires). Existing rows from when the UI worked
-- still triggered the cron, so users got reminders for fields they
-- couldn't even view in-app any more.
--
-- This migration is the matching DOWN of 20260428120009 and:
--   1. Unschedules the pg_cron job.
--   2. Drops the enqueue_contract_expiry_notifications() helper.
--   3. Drops piktag_connections.contract_expiry column (data goes too).
--   4. Cleans existing piktag_notifications rows of type='contract_expiry'
--      so users stop seeing them on next sync.
--
-- Note: the edge function `notification-contract-expiry` is removed
-- separately via `supabase functions delete` — Supabase migrations
-- can't manage edge function deployment.

-- =============================================================================
-- 1. Unschedule the daily cron tick
-- =============================================================================

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'notification-contract-expiry-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

-- =============================================================================
-- 2. Drop the SQL helper function
-- =============================================================================

DROP FUNCTION IF EXISTS public.enqueue_contract_expiry_notifications();

-- =============================================================================
-- 3. Drop the column from piktag_connections
-- =============================================================================

ALTER TABLE public.piktag_connections
  DROP COLUMN IF EXISTS contract_expiry;

-- =============================================================================
-- 4. Clean up existing notifications of this type so users stop
--    seeing the orphaned reminder card on next refresh.
-- =============================================================================

DELETE FROM public.piktag_notifications
  WHERE type = 'contract_expiry';
