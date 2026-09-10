-- 20260910040000_drop_generic_llm_aliases.sql
--
-- Remove the model-generated aliases for 品味 and 募資.
--
-- WHY (founder call, 2026-09-10, after reviewing the first 151 generated
-- aliases)
--
-- Two of the sampled concepts came back wrong, both abstract, and in the
-- two ways abstract concepts fail:
--
--   募資 — narrowed. All four sampled languages rendered it as
--   crowdfunding (تمويل جماعي / क्राउडफंडिंग / کراؤڈ فنڈنگ). But 募資 is
--   fundraising in general — VC, angel and private rounds included —
--   while crowdfunding is 群眾募資. Someone raising a VC round is now
--   only findable by people searching for crowdfunding.
--
--   品味 — genericised, which is the worse failure. Hindi got रुचि and
--   Arabic ذوق, both everyday words for "interest / liking / taste".
--   Anyone searching for "interest" in those languages would now surface
--   everyone tagged 品味. A wrong translation is merely useless; a
--   generic one actively injects noise into a search index, and
--   tag_aliases.alias is globally UNIQUE so it also holds that string
--   hostage against every other concept.
--
-- Both are exactly what the generator prompt forbids ("a narrower
-- speciality is WRONG", "never return a generic everyday word"). The
-- model followed it for concrete nouns — 排球 → volleyball, 法國 →
-- France, 台北 transliterated — and drifted on the abstract ones.
--
-- SCOPE: every language, not just the four sampled. The defect is a
-- property of the concept being abstract, so the unsampled languages are
-- no more trustworthy than the ones we looked at.
--
-- WHAT SURVIVES: tag_concepts.aliases_generated_at stays set, so the
-- backfill does not queue these two again and regenerate the same output
-- from the same prompt. They revert to monolingual — precisely where they
-- were this morning, so nothing is worse than before the backfill. To let
-- them be retried after the prompt is tightened (60-TRIGGERS #32 ②),
-- clear that column for these rows and they rejoin the queue.
--
-- This is the whole reason tag_aliases.source exists (20260910020000).
-- Without it these rows would be indistinguishable from the hand-curated
-- bridges and this cleanup would have to be done by eye.

DO $$
DECLARE
  v_deleted int;
  v_concepts int;
BEGIN
  SELECT COUNT(*) INTO v_concepts
  FROM public.tag_concepts
  WHERE canonical_name IN ('品味', '募資');

  IF v_concepts = 0 THEN
    RAISE NOTICE 'drop generic llm aliases: neither concept found, nothing to do.';
    RETURN;
  END IF;

  WITH doomed AS (
    DELETE FROM public.tag_aliases a
    USING public.tag_concepts c
    WHERE a.concept_id = c.id
      AND c.canonical_name IN ('品味', '募資')
      -- Only model output. A curated or seeded bridge on these concepts,
      -- if one is ever added, must survive this.
      AND a.source = 'llm'
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_deleted FROM doomed;

  RAISE NOTICE 'drop generic llm aliases: % row(s) removed across % concept(s).',
    v_deleted, v_concepts;
END $$;
