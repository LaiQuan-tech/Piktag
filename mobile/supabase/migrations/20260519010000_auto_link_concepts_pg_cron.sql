-- 20260519010000_auto_link_concepts_pg_cron.sql
--
-- WHY: cross-language tag matching (PM ≈ 專案經理 ≈ Project Manager ≈
-- プロジェクトマネージャー) is the core of PikTag's serendipity. It
-- works by linking every user-coined tag to a language-agnostic
-- tag_concept; the fetch_ask_feed / notify_ask_bridges / search RPC
-- all expand tags to concept-siblings (and explicitly guard
-- `concept_id IS NOT NULL`). So a tag that is NOT yet concept-linked
-- silently fails to match across language/wording.
--
-- The linker is the `auto-link-concepts` edge function (Gemini
-- embeddings + LLM hierarchy — can't be pure SQL). It was triggered
-- ONLY by GitHub Actions `schedule` (.github/workflows/daily-cron.yml,
-- cron '0 19 * * *'). We have hard, in-repo evidence that GitHub
-- `schedule` is best-effort and silently skips (the iOS-TestFlight
-- cron didn't fire for ~a day — that's why push triggers were
-- restored in b35d0c0). The same failure here degrades matching
-- INVISIBLY: no error, just "fewer matches", which for a serendipity
-- product is indistinguishable from "no match exists".
--
-- FIX: drive the linker from Supabase pg_cron via pg_net. pg_cron
-- runs on the database itself (the same reliable scheduler that
-- already runs enqueue_birthday_notifications), not on GitHub's
-- best-effort runners. Mirrors the established repo patterns:
--   • Vault for the secret      (20260422_chat_push_trigger_vault)
--   • net.http_post call shape   (same migration)
--   • cron.(un)schedule guard    (20260428120007_notification_birthday)
--
-- pg_cron runs at 18:00 UTC — ONE HOUR BEFORE the existing GitHub
-- Actions 19:00 job, which is deliberately KEPT as a backstop:
--   • If Vault isn't seeded yet (see operator step below), this
--     function fails soft (WARNING, no throw) and GitHub Actions
--     still keeps the linker alive — zero regression window.
--   • Once Vault is seeded, pg_cron does the work at 18:00 and the
--     19:00 GitHub run simply finds little/nothing left to link
--     (the edge function is idempotent: it only processes
--     concept_id IS NULL tags + concepts missing embeddings).
-- This is defense-in-depth, NOT a contradictory twin (cf. the
-- removed daily-birthday-check): same function, same effect.
--
-- ── ONE-TIME OPERATOR STEP (secrets stay OUT of git) ────────────
-- The edge function authenticates with `Authorization: Bearer
-- <CRON_SECRET>` (constant-time compared against its CRON_SECRET
-- env). Seed that same value into Vault ONCE via the SQL Editor
-- (piktag_supabase_url is already seeded from the chat-push
-- migration; reuse it):
--
--   SELECT vault.create_secret(
--     '<the CRON_SECRET value>',   -- same string as the GitHub /
--     'piktag_cron_secret',        -- Supabase edge-fn CRON_SECRET
--     'CRON_SECRET for pg_cron-triggered edge functions'
--   );
--
-- Rotate later with:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'piktag_cron_secret'),
--     '<new value>'
--   );
--
-- Idempotent: CREATE OR REPLACE + cron unschedule-guard. Safe to
-- re-run. Inert (logs a WARNING, breaks nothing) until Vault seeded.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.trigger_auto_link_concepts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_url    text;
  cron_secret text;
BEGIN
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_supabase_url'
    LIMIT 1;

  SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_cron_secret'
    LIMIT 1;

  IF base_url IS NULL OR cron_secret IS NULL THEN
    -- Vault not seeded yet. Fail SOFT: do not error the cron run.
    -- The GitHub Actions 19:00 backstop still triggers the linker,
    -- so cross-language matching keeps working with zero regression
    -- until the operator runs the one-time seed step above.
    RAISE WARNING
      'trigger_auto_link_concepts: vault secrets missing (piktag_supabase_url / piktag_cron_secret) — relying on GitHub Actions backstop';
    RETURN;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := base_url || '/functions/v1/auto-link-concepts',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || cron_secret
      ),
      body    := jsonb_build_object()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Network/pg_net hiccup must not fail the cron job; the next
    -- daily run (and the GitHub backstop) will retry. The linker is
    -- idempotent so a missed run only delays linking, never corrupts.
    RAISE WARNING 'trigger_auto_link_concepts http_post failed: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_auto_link_concepts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trigger_auto_link_concepts() TO postgres, service_role;

-- ── pg_cron schedule — daily 18:00 UTC (1h before the GH backstop) ──
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'auto-link-concepts-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'auto-link-concepts-daily',
  '0 18 * * *',
  $cron$ SELECT public.trigger_auto_link_concepts(); $cron$
);

-- ── Observability: surface the silent-degradation signal ──────────
-- The failure mode this migration fixes is invisible. This view
-- makes it visible: if `unlinked_tags` keeps climbing or
-- `oldest_unlinked_at` keeps receding into the past, the linker has
-- stalled and cross-language matching is quietly rotting. Aggregate
-- only (no tag names) so it's safe to expose to the authed client.
CREATE OR REPLACE VIEW public.tag_concept_link_health AS
SELECT
  count(*)                                            AS total_tags,
  count(*) FILTER (WHERE concept_id IS NULL)           AS unlinked_tags,
  round(
    100.0 * count(*) FILTER (WHERE concept_id IS NULL)
    / NULLIF(count(*), 0)
  , 1)                                                 AS unlinked_pct,
  min(created_at) FILTER (WHERE concept_id IS NULL)    AS oldest_unlinked_at,
  max(created_at) FILTER (WHERE concept_id IS NULL)    AS newest_unlinked_at
FROM public.piktag_tags;

GRANT SELECT ON public.tag_concept_link_health TO authenticated, service_role;
