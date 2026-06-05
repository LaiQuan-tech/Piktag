-- 20260605060000_concept_fragment_inventory_rpc.sql
--
-- WHY
-- ----
-- The pre-alias-resolver linker (before 20260530150000) minted a NEW
-- singleton concept every time an embedding miss didn't clear the seed,
-- so the graph carries duplicate concepts that SHOULD be one (e.g. a
-- "Rotary Club" seed AND an orphaned "扶輪社" singleton). People tagged
-- under each fragment do NOT match each other — a direct hit on the
-- North Star's cross-language媒合. The fix is a GC merge, but a merge is
-- IRREVERSIBLE, so we MEASURE FIRST: list the candidate pairs, eyeball
-- which is canonical vs fragment, THEN write the (separate) destructive
-- merge migration. This file is the read-only measurement, nothing else.
--
-- HOW TO USE (Supabase SQL editor, runs as service_role):
--   -- the high-level picture:
--   SELECT * FROM public.admin_concept_graph_health();
--   -- the merge candidates (lower the threshold to see more):
--   SELECT * FROM public.admin_report_concept_merge_candidates(0.88);
--   SELECT * FROM public.admin_report_concept_merge_candidates(0.85, 500);
--
-- READING THE OUTPUT
--   * alias_count is the best canonical-vs-fragment signal: a seeded
--     concept carries 15-40 aliases; an auto-linker fragment usually
--     carries 1 (just the tag name that minted it). In a candidate pair,
--     the high-alias_count side is almost always the keeper.
--   * tag_count = how many piktag_tags rows point at the concept (how
--     much real user data a merge would re-home).
--   * usage_count = the concept's own counter.
--   * created_at: seeds are oldest; fragments are newer.
--
-- CAVEATS (be honest about coverage)
--   * Only concepts WITH an embedding are comparable. Freshly-seeded
--     concepts (incl. the 18 added in 20260605050000) get their embedding
--     on the linker's next pass — they won't appear here until then. Run
--     admin_concept_graph_health() to see how many lack embeddings.
--   * O(n^2) over embedded concepts. Fine as a one-shot at current scale
--     (~250 concepts → ~31k pairs, sub-second). NOT for hot paths.
--
-- Read-only. SECURITY DEFINER + admin-only grants (exposes the whole
-- concept graph). Idempotent (CREATE OR REPLACE).

-- ─────────────────────────────────────────────────────────────────────
-- 1. High-level health summary — one row.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_concept_graph_health()
RETURNS TABLE (
  total_concepts        bigint,
  with_embedding        bigint,
  without_embedding     bigint,
  single_alias_concepts bigint,   -- likely auto-linker fragments
  zero_tag_concepts     bigint,    -- concept nothing points at
  total_aliases         bigint,
  unlinked_tags         bigint     -- piktag_tags.concept_id IS NULL right now
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `extensions` MUST be on the search_path: pgvector (the `<=>` cosine
-- operator + the `vector` type) is installed in the extensions schema on
-- Supabase, so a bare `search_path = public` makes `embedding <=> embedding`
-- fail with 42883 (operator does not exist). This was the CI break.
SET search_path = public, extensions
AS $$
  SELECT
    (SELECT count(*) FROM public.tag_concepts),
    (SELECT count(*) FROM public.tag_concepts WHERE embedding IS NOT NULL),
    (SELECT count(*) FROM public.tag_concepts WHERE embedding IS NULL),
    (SELECT count(*) FROM public.tag_concepts c
       WHERE (SELECT count(*) FROM public.tag_aliases a WHERE a.concept_id = c.id) <= 1),
    (SELECT count(*) FROM public.tag_concepts c
       WHERE NOT EXISTS (SELECT 1 FROM public.piktag_tags t WHERE t.concept_id = c.id)),
    (SELECT count(*) FROM public.tag_aliases),
    (SELECT count(*) FROM public.piktag_tags WHERE concept_id IS NULL);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Merge-candidate pairs above a cosine-similarity threshold.
--    Returns the more-aliased concept as the "a" (keeper) side so the
--    output reads keeper-then-fragment at a glance.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_report_concept_merge_candidates(
  p_threshold double precision DEFAULT 0.88,
  p_limit     integer          DEFAULT 200
)
RETURNS TABLE (
  similarity   double precision,
  a_id         uuid,
  a_name       text,
  a_aliases    bigint,
  a_tags       bigint,
  a_usage      integer,
  a_created    timestamptz,
  b_id         uuid,
  b_name       text,
  b_aliases    bigint,
  b_tags       bigint,
  b_usage      integer,
  b_created    timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `extensions` on the path so the pgvector `<=>` operator resolves
-- (see the companion note above — this was the 42883 CI break).
SET search_path = public, extensions
AS $$
  WITH stats AS (
    SELECT
      c.id,
      c.canonical_name,
      c.usage_count,
      c.created_at,
      c.embedding,
      (SELECT count(*) FROM public.tag_aliases a WHERE a.concept_id = c.id) AS alias_count,
      (SELECT count(*) FROM public.piktag_tags  t WHERE t.concept_id = c.id) AS tag_count
    FROM public.tag_concepts c
    WHERE c.embedding IS NOT NULL
  ),
  pairs AS (
    SELECT
      (1 - (s1.embedding <=> s2.embedding))::double precision AS similarity,
      -- Orient: keeper = the one with more aliases (tie → older).
      (s1.alias_count > s2.alias_count
         OR (s1.alias_count = s2.alias_count AND s1.created_at <= s2.created_at)) AS s1_keeper,
      s1.id AS s1_id, s1.canonical_name AS s1_name, s1.alias_count AS s1_aliases,
      s1.tag_count AS s1_tags, s1.usage_count AS s1_usage, s1.created_at AS s1_created,
      s2.id AS s2_id, s2.canonical_name AS s2_name, s2.alias_count AS s2_aliases,
      s2.tag_count AS s2_tags, s2.usage_count AS s2_usage, s2.created_at AS s2_created
    FROM stats s1
    JOIN stats s2 ON s1.id < s2.id
    WHERE (1 - (s1.embedding <=> s2.embedding)) >= p_threshold
  )
  SELECT
    similarity,
    CASE WHEN s1_keeper THEN s1_id      ELSE s2_id      END,
    CASE WHEN s1_keeper THEN s1_name    ELSE s2_name    END,
    CASE WHEN s1_keeper THEN s1_aliases ELSE s2_aliases END,
    CASE WHEN s1_keeper THEN s1_tags    ELSE s2_tags    END,
    CASE WHEN s1_keeper THEN s1_usage   ELSE s2_usage   END,
    CASE WHEN s1_keeper THEN s1_created ELSE s2_created END,
    CASE WHEN s1_keeper THEN s2_id      ELSE s1_id      END,
    CASE WHEN s1_keeper THEN s2_name    ELSE s1_name    END,
    CASE WHEN s1_keeper THEN s2_aliases ELSE s1_aliases END,
    CASE WHEN s1_keeper THEN s2_tags    ELSE s1_tags    END,
    CASE WHEN s1_keeper THEN s2_usage   ELSE s1_usage   END,
    CASE WHEN s1_keeper THEN s2_created ELSE s1_created END
  FROM pairs
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;

-- Admin-only: these expose the entire concept graph + embeddings shape.
REVOKE ALL ON FUNCTION public.admin_concept_graph_health()                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_report_concept_merge_candidates(double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_concept_graph_health()                              TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.admin_report_concept_merge_candidates(double precision, integer) TO postgres, service_role;
