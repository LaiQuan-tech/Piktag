-- 20260910030000_alias_backfill_selector.sql
--
-- Picks which existing concepts should get cross-language aliases.
--
-- WHY
-- 20260910020000 made auto-link-concepts generate aliases in all 19 locales,
-- but only on the MINT path -- the branch that creates a brand-new concept.
-- Every concept that already existed stays monolingual for good, and a live
-- probe says that is most of them: of ~595 concepts, 470 carry exactly one
-- alias. Those are 470 concepts in the same state `crystal` was in when the
-- founder could not find a friend by searching 水晶.
--
-- So the linker needs a second job: work through the existing ones. This is
-- the query that decides the order, kept in SQL because it is a two-way
-- rollup that PostgREST cannot express.
--
-- SELECTION RULES
--
-- 1. The concept must have at least one tag on it (the inner join to the
--    tag rollup). An alias on a concept nobody tagged bridges nobody, so
--    generating for it spends a Gemini call to connect zero people.
--
-- 2. At most one alias today. That one alias is the tag string the concept
--    was minted from, so these are exactly the monolingual ones.
--
-- 3. Never attempted before -- see aliases_generated_at below.
--
-- 4. Ordered by total tag usage, so the concepts real people actually use
--    are reachable first. A backfill that ran alphabetically would spend
--    its first hour on concepts with one holder each.
--
-- Deliberately NOT a selection rule: tag_aliases.language. That column
-- defaults to 'zh-TW' and the linker's three tag-name upserts never set it,
-- so ~85% of existing rows claim to be Chinese regardless of what they
-- actually are. Nothing reads the column today, so nothing is broken by it,
-- but it cannot be used to work out which languages a concept is missing.
-- Alias COUNT is trustworthy; alias LANGUAGE is not.

-- ── An attempt marker, so the backfill terminates ────────────────────
-- Without this, a concept the model has nothing to say about (an invented
-- word, a personal in-joke) would match the selector on every single run
-- and burn a call every five minutes forever. Stamped after the attempt
-- regardless of how many aliases came back, so "we asked" and "we got
-- something" stay separate facts.
ALTER TABLE public.tag_concepts
  ADD COLUMN IF NOT EXISTS aliases_generated_at timestamptz;

COMMENT ON COLUMN public.tag_concepts.aliases_generated_at IS
  'When auto-link-concepts last asked the model for cross-language aliases. Set even when the model returned none, so the backfill does not retry forever. NULL means never attempted.';

CREATE OR REPLACE FUNCTION public.select_concepts_needing_aliases(p_limit int DEFAULT 10)
RETURNS TABLE (
  concept_id    uuid,
  canonical_name text,
  semantic_type text,
  alias_count   bigint,
  tag_usage     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tag_rollup AS (
    SELECT t.concept_id,
           COUNT(*)                          AS tag_count,
           COALESCE(SUM(t.usage_count), 0)   AS tag_usage
    FROM public.piktag_tags t
    WHERE t.concept_id IS NOT NULL
    GROUP BY t.concept_id
  ),
  alias_rollup AS (
    SELECT a.concept_id, COUNT(*) AS alias_count
    FROM public.tag_aliases a
    GROUP BY a.concept_id
  )
  SELECT c.id,
         c.canonical_name,
         c.semantic_type,
         COALESCE(ar.alias_count, 0)::bigint,
         tr.tag_usage::bigint
  FROM public.tag_concepts c
  JOIN tag_rollup tr        ON tr.concept_id = c.id
  LEFT JOIN alias_rollup ar ON ar.concept_id = c.id
  WHERE c.aliases_generated_at IS NULL
    AND COALESCE(ar.alias_count, 0) <= 1
  ORDER BY tr.tag_usage DESC, tr.tag_count DESC, c.created_at ASC
  LIMIT GREATEST(p_limit, 0);
$$;

-- How much work is left. Lets the cron log say "412 concepts remaining"
-- instead of leaving the operator to guess whether the backfill is moving.
CREATE OR REPLACE FUNCTION public.admin_alias_backfill_remaining()
RETURNS TABLE (
  monolingual_with_tags bigint,
  attempted             bigint,
  llm_aliases           bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.select_concepts_needing_aliases(1000000)),
    (SELECT COUNT(*) FROM public.tag_concepts WHERE aliases_generated_at IS NOT NULL),
    (SELECT COUNT(*) FROM public.tag_aliases  WHERE source = 'llm');
$$;

-- Ops/service-role only. Named roles, never FROM PUBLIC alone: on Supabase
-- a REVOKE aimed at PUBLIC leaves the default anon/authenticated grant in
-- place (see 20260909230000).
REVOKE EXECUTE ON FUNCTION public.select_concepts_needing_aliases(int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_concepts_needing_aliases(int)
  TO postgres, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_alias_backfill_remaining()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alias_backfill_remaining()
  TO postgres, service_role;

DO $$
DECLARE v_pending bigint;
BEGIN
  SELECT COUNT(*) INTO v_pending FROM public.select_concepts_needing_aliases(1000000);
  RAISE NOTICE 'alias backfill: % monolingual concepts with tags are queued.', v_pending;
END $$;
