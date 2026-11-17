-- Embedding v2 + reranker SHADOW mode (founder-approved "safe" version,
-- 2026-11-18). Spec: mobile/docs/plans/2026-11-18-embedding-v2-shadow-design.md
--
-- SHADOW ONLY. Nothing here feeds a live decision: search_users, the
-- linker's thresholds/judge, stopwords all stay on `embedding`
-- (gemini-embedding-001, 3072-d). These objects only collect data so the
-- founder can later decide whether BAAI/bge-m3 (1024-d) and
-- BAAI/bge-reranker-v2-m3 can replace them. Swapping requires a separate
-- founder sign-off.
--
-- Writers: auto-link-concepts (one concept_judge_shadow row per gray-zone
-- judge call) and the hf-shadow edge fn (embedding_v2 backfill + reranker
-- scores). Reader: admin_embedding_v2_shadow_report().
--
-- Idempotent throughout. Live probe 2026-11-18: tag_concepts.id is uuid,
-- 646 concepts, embedding_v2 / concept_judge_shadow did not exist.

-- ── 1. embedding_v2 on tag_concepts ────────────────────────────────────
-- `vector` referenced unqualified, same as tag_concepts.embedding
-- (20260328020000) — pgvector resolves via the migration search_path.
ALTER TABLE public.tag_concepts
  ADD COLUMN IF NOT EXISTS embedding_v2 vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_v2_model text;

-- HNSW (unlike ivfflat) needs no existing data, so it can be created now.
-- NULL rows are simply not indexed.
CREATE INDEX IF NOT EXISTS idx_tag_concepts_embedding_v2_hnsw
  ON public.tag_concepts USING hnsw (embedding_v2 vector_cosine_ops);

-- ── 2. concept_judge_shadow ────────────────────────────────────────────
-- One row per gray-zone (0.70–0.85) Gemini judge call. No user FK: only
-- tag text and concept ids, so nothing to cascade on account deletion.
--   candidates      [{concept_id, name, sim}]  (sim = Gemini cosine)
--   reranker_scores [{concept_id, score, raw}] aligned with candidates
--   v2_sims         [{concept_id, sim}]        (bge-m3 cosine)
--   judge_ok        false = the Gemini judge call FAILED (HTTP error,
--                   exception, unparsable reply); pick is then null but means
--                   "unknown", not "no match". true + null pick = genuine "0".
--   attempts / last_error  hf-shadow failure bookkeeping; after 3 failed
--                   runs the row is stamped evaluated_at with scores left
--                   NULL ("gave up") so it can't block the queue.
CREATE TABLE IF NOT EXISTS public.concept_judge_shadow (
  id                    bigserial PRIMARY KEY,
  tag_name              text NOT NULL,
  candidates            jsonb NOT NULL,
  judge_model           text,
  judge_ok              boolean NOT NULL DEFAULT true,
  judge_pick_concept_id uuid REFERENCES public.tag_concepts(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  evaluated_at          timestamptz,
  reranker_model        text,
  reranker_scores       jsonb,
  v2_sims               jsonb,
  attempts              int NOT NULL DEFAULT 0,
  last_error            text
);

-- hf-shadow's work queue: unevaluated rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_concept_judge_shadow_pending
  ON public.concept_judge_shadow (created_at)
  WHERE evaluated_at IS NULL;

-- RLS on, no policies: only service_role (which bypasses RLS) reads/writes.
ALTER TABLE public.concept_judge_shadow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.concept_judge_shadow FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.concept_judge_shadow_id_seq FROM anon, authenticated;

-- ── 3. Admin report ────────────────────────────────────────────────────
-- Agreement between the live Gemini judge and the shadow reranker, plus v2
-- backfill coverage. Caveats when reading it:
--   * Agreement stats and recent_disagreements use only rows with
--     judge_ok = true AND reranker_scores IS NOT NULL (gave-up rows and
--     failed judge calls are counted separately).
--   * judge_pick NULL with judge_ok = true = judge said "none", OR the picked
--     concept was later deleted (ON DELETE SET NULL; rare).
--   * reranker score scale depends on what HF returns (sigmoid prob for a
--     single-label text-classification head); the 0.5 cut is indicative.
--     The raw element is kept in reranker_scores[].raw.
CREATE OR REPLACE FUNCTION public.admin_embedding_v2_shadow_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH ev AS (
    SELECT
      s.id,
      s.tag_name,
      s.created_at,
      s.judge_pick_concept_id AS pick,
      (SELECT e->>'concept_id'
         FROM jsonb_array_elements(COALESCE(s.reranker_scores, '[]'::jsonb)) e
        WHERE jsonb_typeof(e->'score') = 'number'
        ORDER BY (e->>'score')::float8 DESC
        LIMIT 1)                                         AS rr_top_id,
      (SELECT max((e->>'score')::float8)
         FROM jsonb_array_elements(COALESCE(s.reranker_scores, '[]'::jsonb)) e
        WHERE jsonb_typeof(e->'score') = 'number')       AS rr_top_score,
      (SELECT (e->>'score')::float8
         FROM jsonb_array_elements(COALESCE(s.reranker_scores, '[]'::jsonb)) e
        WHERE jsonb_typeof(e->'score') = 'number'
          AND e->>'concept_id' = s.judge_pick_concept_id::text
        LIMIT 1)                                         AS rr_pick_score,
      (SELECT e->>'concept_id'
         FROM jsonb_array_elements(COALESCE(s.v2_sims, '[]'::jsonb)) e
        WHERE jsonb_typeof(e->'sim') = 'number'
        ORDER BY (e->>'sim')::float8 DESC
        LIMIT 1)                                         AS v2_top_id,
      (SELECT max((e->>'sim')::float8)
         FROM jsonb_array_elements(COALESCE(s.v2_sims, '[]'::jsonb)) e
        WHERE jsonb_typeof(e->'sim') = 'number')         AS v2_top_sim
    FROM public.concept_judge_shadow s
    WHERE s.evaluated_at IS NOT NULL
      AND s.reranker_scores IS NOT NULL
      AND s.judge_ok
  )
  SELECT jsonb_build_object(
    'v2_backfill', (
      SELECT jsonb_build_object(
        'concepts_total', count(*),
        'with_v2',        count(*) FILTER (WHERE c.embedding_v2 IS NOT NULL),
        'without_v2',     count(*) FILTER (WHERE c.embedding_v2 IS NULL)
      )
      FROM public.tag_concepts c
    ),
    'shadow_rows', (
      SELECT jsonb_build_object(
        'total',     count(*),
        'evaluated', count(*) FILTER (WHERE s.evaluated_at IS NOT NULL),
        'pending',   count(*) FILTER (WHERE s.evaluated_at IS NULL),
        -- hf-shadow gave up after repeated failures (scores NULL).
        'gave_up',   count(*) FILTER (WHERE s.evaluated_at IS NOT NULL AND s.reranker_scores IS NULL),
        'retrying',  count(*) FILTER (WHERE s.evaluated_at IS NULL AND s.attempts > 0),
        -- Gemini judge call failed (excluded from agreement).
        'judge_failed', count(*) FILTER (WHERE NOT s.judge_ok),
        'oldest',    min(s.created_at),
        'newest',    max(s.created_at)
      )
      FROM public.concept_judge_shadow s
    ),
    'agreement', (
      SELECT jsonb_build_object(
        'scored_rows', count(*) FILTER (WHERE rr_top_id IS NOT NULL),
        -- Judge said "yes, candidate X".
        'judge_picked', count(*) FILTER (WHERE pick IS NOT NULL AND rr_top_id IS NOT NULL),
        'judge_pick_eq_reranker_argmax',
          count(*) FILTER (WHERE pick IS NOT NULL AND rr_top_id = pick::text),
        'judge_pick_eq_v2_argmax',
          count(*) FILTER (WHERE pick IS NOT NULL AND v2_top_id = pick::text),
        'judge_picked_reranker_score_avg',
          round(avg(rr_pick_score) FILTER (WHERE pick IS NOT NULL)::numeric, 4),
        'judge_picked_reranker_top_lt_0_5',
          count(*) FILTER (WHERE pick IS NOT NULL AND rr_top_score < 0.5),
        -- Judge said "none" (or failed — see caveat above).
        'judge_none', count(*) FILTER (WHERE pick IS NULL AND rr_top_id IS NOT NULL),
        'judge_none_reranker_top_avg',
          round(avg(rr_top_score) FILTER (WHERE pick IS NULL)::numeric, 4),
        'judge_none_reranker_top_ge_0_5',
          count(*) FILTER (WHERE pick IS NULL AND rr_top_score >= 0.5),
        'v2_top_sim_avg_judge_picked',
          round(avg(v2_top_sim) FILTER (WHERE pick IS NOT NULL)::numeric, 4),
        'v2_top_sim_avg_judge_none',
          round(avg(v2_top_sim) FILTER (WHERE pick IS NULL)::numeric, 4)
      )
      FROM ev
    ),
    -- Most recent rows where judge and reranker disagree, for hand review.
    'recent_disagreements', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          ev.created_at,
          ev.tag_name,
          jp.canonical_name   AS judge_pick,
          rt.canonical_name   AS reranker_top,
          round(ev.rr_top_score::numeric, 4) AS reranker_top_score,
          round(ev.rr_pick_score::numeric, 4) AS reranker_score_of_judge_pick
        FROM ev
        LEFT JOIN public.tag_concepts jp ON jp.id = ev.pick
        LEFT JOIN public.tag_concepts rt ON rt.id::text = ev.rr_top_id
        WHERE ev.rr_top_id IS NOT NULL
          AND (
            (ev.pick IS NOT NULL AND ev.rr_top_id <> ev.pick::text)
            OR (ev.pick IS NULL AND ev.rr_top_score >= 0.5)
          )
        ORDER BY ev.created_at DESC
        LIMIT 20
      ) d
    )
  );
$$;

-- Admin/ops only. Named roles, never FROM PUBLIC alone (20260909230000).
REVOKE EXECUTE ON FUNCTION public.admin_embedding_v2_shadow_report()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_embedding_v2_shadow_report()
  TO postgres, service_role;
