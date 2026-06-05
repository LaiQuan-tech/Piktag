-- 20260605070000_linker_health_admin_alerts.sql
--
-- WHY
-- ----
-- The concept linker is the heart of cross-language媒合 — but it runs on
-- pg_cron every 5 min with a GitHub Actions backstop, and a silent stall
-- (cron paused, edge fn erroring, embedding API down) reads to users as
-- "no match exists," not "the engine is down." `tag_concept_link_health`
-- already EXISTS as an observable view, but nobody watches it. This wires
-- two admin pushes through the existing notify-admin-growth pipeline:
--
--   1. notify_linker_stall()  — every 30 min. Pushes admin IFF the oldest
--      unlinked tag is older than 30 min (healthy linker clears NULLs every
--      5 min, so >30 min = ~6 missed cycles = a real stall, not a burst).
--      Deduped to once / 6h so a persistent stall doesn't spam.
--
--   2. enqueue_concept_health_digest() — daily 08:00 UTC. Delivers the
--      concept-graph fragment numbers (from the read-only inventory RPCs in
--      20260605060000) so the founder can make the GC decision WITHOUT
--      hand-running SQL. Fires ONLY when merge candidates actually exist
--      (pair_count > 0) — so it stays silent on a clean graph and
--      auto-retires itself once the GC merge lands.
--
-- Both reuse the generic `admin_alert` event added to notify-admin-growth.
-- All push bodies are PLAIN TEXT — no emoji (CLAUDE.md).
--
-- Vault secrets (same as the growth pushes):
--   piktag_supabase_url, piktag_cron_secret
-- Fail-soft everywhere: a missed alert must never error the cron.

-- ─────────────────────────────────────────────────────────────────────
-- Shared helper: fire one admin_alert through notify-admin-growth.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._send_admin_alert(
  p_title text,
  p_body  text,
  p_type  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_base_url    text;
  v_cron_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'piktag_supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_cron_secret
    FROM vault.decrypted_secrets WHERE name = 'piktag_cron_secret' LIMIT 1;

  IF v_base_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE WARNING '_send_admin_alert: vault secrets missing — skipped';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/functions/v1/notify-admin-growth',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_cron_secret
    ),
    body    := jsonb_build_object(
      'event', 'admin_alert',
      'title', p_title,
      'body',  p_body,
      'type',  p_type
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_send_admin_alert failed (%): %', p_type, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public._send_admin_alert(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._send_admin_alert(text, text, text) TO postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Linker stall detector.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_linker_stall()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlinked   bigint;
  v_oldest     timestamptz;
  v_age_min    integer;
  v_recent     boolean;
BEGIN
  SELECT unlinked_tags, oldest_unlinked_at
    INTO v_unlinked, v_oldest
    FROM public.tag_concept_link_health;

  -- Healthy: nothing unlinked, or the oldest unlinked tag is recent
  -- (within the normal 5-min linker window + headroom).
  IF v_oldest IS NULL OR v_oldest > now() - interval '30 minutes' THEN
    RETURN;
  END IF;

  -- Dedup: don't re-alert if we already pushed a stall in the last 6h.
  SELECT EXISTS (
    SELECT 1 FROM public.piktag_notifications
    WHERE type = 'admin_linker_stall'
      AND created_at > now() - interval '6 hours'
  ) INTO v_recent;
  IF v_recent THEN
    RETURN;
  END IF;

  v_age_min := floor(extract(epoch FROM (now() - v_oldest)) / 60)::int;

  PERFORM public._send_admin_alert(
    'Linker 可能停擺',
    format(
      '未連結標籤 %s 筆,最舊已等 %s 分鐘(健康時 <5 分)。跨語言配對可能正在腐化,請查連結器 cron / edge fn / 嵌入 API。',
      v_unlinked, v_age_min
    ),
    'admin_linker_stall'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_linker_stall() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_linker_stall() TO postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Concept-graph health digest (delivers the GC inventory numbers).
-- ─────────────────────────────────────────────────────────────────────
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
  v_sent_today boolean;
BEGIN
  SELECT total_concepts, without_embedding, single_alias_concepts
    INTO v_total, v_no_emb, v_frag
    FROM public.admin_concept_graph_health();

  -- Count merge candidates + the top 3 examples in ONE pass over the
  -- (read-only) inventory RPC.
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

  -- One digest per calendar day.
  SELECT EXISTS (
    SELECT 1 FROM public.piktag_notifications
    WHERE type = 'admin_concept_health'
      AND created_at > now() - interval '20 hours'
  ) INTO v_sent_today;
  IF v_sent_today THEN
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

REVOKE ALL ON FUNCTION public.enqueue_concept_health_digest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_concept_health_digest() TO postgres, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Schedules.
-- ─────────────────────────────────────────────────────────────────────
DO $cron$
BEGIN
  PERFORM cron.unschedule('linker-stall-check');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;
SELECT cron.schedule(
  'linker-stall-check',
  '*/30 * * * *',
  $cmd$ SELECT public.notify_linker_stall(); $cmd$
);

DO $cron$
BEGIN
  PERFORM cron.unschedule('concept-health-digest-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END
$cron$;
SELECT cron.schedule(
  'concept-health-digest-daily',
  '0 8 * * *',
  $cmd$ SELECT public.enqueue_concept_health_digest(); $cmd$
);
