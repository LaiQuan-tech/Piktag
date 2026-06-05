-- 20260605090000_concept_health_digest_responsive.sql
--
-- Make the concept-health digest (the GC-decision numbers) land SOON after
-- deploy instead of waiting for the next 08:00 UTC. Two changes:
--
--   1. Dedup-FIRST: check "already pushed in the last 20h" BEFORE running the
--      O(n^2) similarity scan, so a frequent schedule stays cheap (most runs
--      short-circuit on the cheap notifications lookup).
--   2. Reschedule 0 8 * * * -> 0 */3 * * * (every 3h). With the 20h dedup the
--      founder still gets at most ~1 push/day, but the FIRST push now lands
--      within 3h of deploy — today, not tomorrow. Once the GC merge lands and
--      the graph is clean (pair_count = 0) the digest self-silences.
--
-- Supersedes enqueue_concept_health_digest from 20260605070000 (same body
-- minus the reordered guard).

CREATE OR REPLACE FUNCTION public.enqueue_concept_health_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total     bigint;
  v_no_emb    bigint;
  v_frag      bigint;
  v_pairs     bigint;
  v_top       text;
BEGIN
  -- Cheap dedup gate FIRST: one digest per ~day. Skips the expensive
  -- similarity scan entirely on already-sent days.
  IF EXISTS (
    SELECT 1 FROM public.piktag_notifications
    WHERE type = 'admin_concept_health'
      AND created_at > now() - interval '20 hours'
  ) THEN
    RETURN;
  END IF;

  SELECT total_concepts, without_embedding, single_alias_concepts
    INTO v_total, v_no_emb, v_frag
    FROM public.admin_concept_graph_health();

  WITH cand AS (
    SELECT * FROM public.admin_report_concept_merge_candidates(0.90, 1000)
  )
  SELECT
    (SELECT count(*) FROM cand),
    (SELECT string_agg(
        a_name || ' <-> ' || b_name || ' (' || round(similarity::numeric, 3)::text || ')',
        E'\n'
      )
      FROM (SELECT a_name, b_name, similarity FROM cand ORDER BY similarity DESC LIMIT 3) t)
    INTO v_pairs, v_top;

  -- Nothing actionable → stay silent (auto-retires post-GC).
  IF COALESCE(v_pairs, 0) = 0 THEN
    RETURN;
  END IF;

  PERFORM public._send_admin_alert(
    '概念圖碎片',
    format(
      '概念 %s 個(%s 無向量)。疑似碎片(單一別名)%s 個。相似度≥0.90 可合併對 %s 組。前三:%s%s',
      v_total, v_no_emb, v_frag, v_pairs, E'\n', COALESCE(v_top, '-')
    ),
    'admin_concept_health'
  );
END;
$$;

DO $cron$
BEGIN
  PERFORM cron.unschedule('concept-health-digest-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;
SELECT cron.schedule(
  'concept-health-digest-daily',
  '0 */3 * * *',
  $cmd$ SELECT public.enqueue_concept_health_digest(); $cmd$
);
