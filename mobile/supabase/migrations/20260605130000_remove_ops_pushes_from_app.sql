-- 20260605130000_remove_ops_pushes_from_app.sql
--
-- Founder, 2026-06-06: "app 別做不關使用者的事情." Correct. The
-- concept-health digest + linker-stall alert (added 20260605070000 /
-- 090000) delivered INTERNAL ENGINE OPS metrics — concept-graph
-- fragmentation, linker backlog — into a real user account's
-- piktag_notifications feed + Expo lock-screen push (the account whose
-- email is in public.admins, i.e. the founder's own PikTag account).
-- Ops telemetry does not belong in the user-facing notification system,
-- even for an admin account.
--
-- This migration UNDOES the app-delivery half:
--   * unschedule both ops crons
--   * drop the two enqueue functions + the _send_admin_alert helper they
--     used (nothing else calls it — the growth-pulse pushes post to the
--     edge fn directly)
--
-- KEPT (read-only, NO push — the legitimate ops surface, queried from the
-- Supabase SQL editor, not the app):
--   * admin_concept_graph_health()
--   * admin_report_concept_merge_candidates(threshold, limit)
--   * the tag_concept_link_health VIEW (stall is still observable there,
--     plus the linker's GitHub Actions backstop emails on failure)
--
-- The growth-pulse pushes (signup / magic_moment, 20260527000000) are
-- left as-is — the founder set those up deliberately. If those should
-- also move off the app later, that's a separate call.

DO $cron$
BEGIN
  PERFORM cron.unschedule('concept-health-digest-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;

DO $cron$
BEGIN
  PERFORM cron.unschedule('linker-stall-check');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;

DROP FUNCTION IF EXISTS public.enqueue_concept_health_digest();
DROP FUNCTION IF EXISTS public.notify_linker_stall();
DROP FUNCTION IF EXISTS public._send_admin_alert(text, text, text);
