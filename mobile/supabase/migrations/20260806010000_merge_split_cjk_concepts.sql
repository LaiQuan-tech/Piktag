-- 20260806010000_merge_split_cjk_concepts.sql
--
-- Repair the cross-language bridge for 匹克球 / 美食 (pre-release audit
-- 2026-08-06).
--
-- 20260715040000 tried to register these as aliases of the new 'pickleball'
-- and 'foodie' concepts, but both CJK strings had ALREADY been claimed as
-- aliases by 1:1 auto-created concepts (20260328020000 step 5), and
-- tag_aliases.alias is globally UNIQUE — so the inserts hit
-- ON CONFLICT (alias) DO NOTHING and were skipped SILENTLY. Its step 3 then
-- linked the orphan tags to those split concepts, cementing the break.
--
-- Net effect: searching Pickleball did not reach anyone tagged 匹克球 (and
-- vice versa); same for Foodie / 美食. That is the exact failure the
-- migration existed to demonstrate against — and 匹克球 / 美食 are precisely
-- what a zh-TW visitor sees on the official @piktag teaching profile.
--
-- Repoint rather than delete: the orphan concepts are an artifact of the
-- 1:1 auto-seeder, not user-authored data. We move every reference onto the
-- canonical concept, then drop the now-unreferenced orphan.
--
-- Idempotent: each step is a no-op once the alias/tag already points at the
-- canonical concept, and the delete is guarded on having no references left.

DO $$
DECLARE
  v_pairs text[][] := ARRAY[
    -- (orphan concept canonical_name, canonical concept canonical_name)
    ARRAY['匹克球', 'pickleball'],
    ARRAY['美食',   'foodie']
  ];
  v_row       text[];
  v_orphan    uuid;
  v_canonical uuid;
BEGIN
  FOREACH v_row SLICE 1 IN ARRAY v_pairs LOOP
    SELECT id INTO v_orphan
      FROM public.tag_concepts WHERE canonical_name = v_row[1] LIMIT 1;
    SELECT id INTO v_canonical
      FROM public.tag_concepts WHERE canonical_name = v_row[2] LIMIT 1;

    -- Nothing to do if either side is missing or they are already the same.
    IF v_orphan IS NULL OR v_canonical IS NULL OR v_orphan = v_canonical THEN
      CONTINUE;
    END IF;

    -- 1. Move every alias off the orphan concept. This is what actually
    --    restores the bridge: the CJK alias now resolves to the canonical
    --    concept, so concept_id joins match across languages.
    UPDATE public.tag_aliases
       SET concept_id = v_canonical
     WHERE concept_id = v_orphan;

    -- 2. Move tags that were linked to the orphan (20260715040000 step 3
    --    pointed 匹克球 / 美食 at it).
    UPDATE public.piktag_tags
       SET concept_id = v_canonical
     WHERE concept_id = v_orphan;

    -- 3. Drop the orphan once nothing references it. Guarded so a partial
    --    re-run can never delete a concept still in use.
    DELETE FROM public.tag_concepts c
     WHERE c.id = v_orphan
       AND NOT EXISTS (SELECT 1 FROM public.tag_aliases a WHERE a.concept_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM public.piktag_tags t WHERE t.concept_id = c.id);
  END LOOP;
END $$;
