-- 20260525020000_linker_lock_stale_release_cron.sql
--
-- Force-release linker_run_lock rows that have been held longer than
-- the edge function's own STALE_LOCK_MIN (10 min). Without this, a
-- crashed / timed-out auto-link-concepts invocation leaves the lock
-- pinned until the NEXT cron tick coincidentally re-acquires it via
-- its own stale-cutoff check — but if the function consistently
-- hangs (which is what we just observed: every 5-min cron run grabs
-- the lock, never releases, next run sees lock <10 min old → skips,
-- ad infinitum), no one ever drains the backlog of unlinked tags.
--
-- This 2-min cleanup cron breaks that cycle: any lock older than
-- 10 min is force-cleared so the next auto-link tick can re-enter.
-- It is INTENTIONALLY a band-aid — the real fix is figuring out
-- why the function hangs (suspect: Gemini embedding upstream
-- timeout, or the Deno worker getting reaped before releaseLock
-- runs). Logged here for the audit trail.
--
-- Idempotent — CTE pattern to unschedule any existing job by name
-- before re-scheduling (same approach as the other crons in this
-- repo, e.g. 20260524100000_extract_intent_rate_limit.sql).

WITH existing AS (
  SELECT jobid FROM cron.job WHERE jobname = 'piktag-linker-lock-stale-release'
)
SELECT cron.unschedule(jobid) FROM existing;

SELECT cron.schedule(
  'piktag-linker-lock-stale-release',
  '*/2 * * * *',  -- every 2 minutes
  $cron$
    UPDATE public.linker_run_lock
       SET locked_at = NULL
     WHERE locked_at IS NOT NULL
       AND locked_at < now() - interval '10 minutes'
  $cron$
);
