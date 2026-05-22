-- 20260523010000_auto_link_concepts_frequent_cron.sql
--
-- WHY: concept linking is what powers PikTag's cross-language /
-- cross-wording tag matching — the serendipity engine. Until now the
-- linker (the auto-link-concepts edge function) ran ONCE A DAY
-- (pg_cron 18:00 UTC + GitHub 19:00 backstop — see
-- 20260519010000_auto_link_concepts_pg_cron). A tag coined right
-- after the daily run therefore sits with concept_id = NULL —
-- semantically dead, invisible to the concept-sibling expansion that
-- search / ask-feed / explore all rely on — for up to ~24h.
--
-- For a product whose core action IS tagging, that dead window is a
-- real defect: a user tags a new friend or contact, immediately
-- searches that tag, and finds nobody — the feature looks broken when
-- it is merely not-yet-linked.
--
-- FIX: add a SECOND pg_cron job that fires the SAME idempotent linker
-- every 5 minutes. Worst-case dead window drops from ~24h to ~5min —
-- "near-real-time". This is cheap: the edge function checks for
-- concept_id IS NULL tags FIRST and returns immediately when there
-- are none (before any embedding / LLM call), so an idle run is just
-- two indexed queries.
--
-- No overlap risk: a real run processes at most BATCH_SIZE (50) tags
-- and finishes well under 5 min, so the next fire never collides with
-- an in-flight run. A pathological backlog (>150 new tags inside one
-- 5-min window) is not a launch-scale concern, and the linker's
-- idempotency (it only ever touches concept_id IS NULL rows) heals it.
--
-- The daily 18:00 job + the GitHub Actions 19:00 backstop are KEPT —
-- defense in depth, consistent with this repo's pattern. Once the
-- 5-min job has drained the queue they simply find nothing to do
-- (idle = instant no-op), so keeping them costs effectively nothing.
--
-- Idempotent: unschedule-guard + re-schedule. Safe to re-run. Inert
-- (trigger_auto_link_concepts fails SOFT, logs a WARNING, breaks
-- nothing) until Vault is seeded — see 20260519010000 for the
-- one-time vault.create_secret('piktag_cron_secret', ...) step.

-- ── pg_cron schedule — every 5 minutes ───────────────────────────
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'auto-link-concepts-frequent';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'auto-link-concepts-frequent',
  '*/5 * * * *',
  $cron$ SELECT public.trigger_auto_link_concepts(); $cron$
);
