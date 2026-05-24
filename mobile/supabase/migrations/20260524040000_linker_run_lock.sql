-- 20260524040000_linker_run_lock.sql
--
-- Row-mutex for the auto-link-concepts 5-min cron.
--
-- The Code Review skill flagged this in the earlier audit: with the
-- LLM gray-zone judge in the linker, a backlog-heavy run can exceed
-- 5 min, so the next cron fires while the previous is still running.
-- Both runs SELECT `concept_id IS NULL LIMIT 50` and both INSERT
-- new concepts — duplicate singletons appear, the exact fragmentation
-- bug the linker is supposed to FIX.
--
-- Fix: a single-row lock table. The edge function does a conditional
-- UPDATE at the top — if it grabs the row, it owns the run; otherwise
-- it exits. Postgres row-level locking makes the conditional UPDATE
-- atomic across concurrent invocations.
--
-- A 10-minute stale-lock window lets a crashed run self-heal: if the
-- function never released the lock (Deno OOM, network drop, anything),
-- the NEXT cron 10+ min later can still claim it. Cron interval is 5
-- min, so the stale window covers a "missed two cycles" worst case.

CREATE TABLE IF NOT EXISTS public.linker_run_lock (
  id smallint PRIMARY KEY,
  locked_at timestamptz,
  CONSTRAINT linker_run_lock_single_row CHECK (id = 1)
);

-- Seed the single row. ON CONFLICT lets the migration re-run safely.
INSERT INTO public.linker_run_lock (id, locked_at)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Lock down: only service_role (edge function) and postgres touch it.
ALTER TABLE public.linker_run_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.linker_run_lock FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.linker_run_lock TO postgres, service_role;
