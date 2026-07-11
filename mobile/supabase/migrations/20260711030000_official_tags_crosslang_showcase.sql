-- 20260711030000_official_tags_crosslang_showcase.sql
--
-- @piktag official tag set — swap the two weakest brand memes for two
-- NON-ENGLISH interest tags, to make the cross-language moat visible on
-- the teaching profile (founder 2026-07-11: "想更直觀"). After
-- 20260711020000 both concepts exist and are cross-language bridged, so
-- a viewer searching "photography"/"coffee" finds these, and a Chinese
-- user searching 攝影/咖啡 finds English-tagged people — the engine does
-- the bridging invisibly. The official profile now models a natural
-- mixed-language tag set: tag in whatever language fits you.
--
--   pos 7: AuraFarming → 攝影   (concept exists; alias-linked)
--   pos 9: BetaEra     → 咖啡   (concept exists; alias-linked)
--
-- Keeps the other 8 (DefineYourVibe / DigitalNomad / ReactNative /
-- ThriftedFashion / GravelCycling / ENFP / SideQuest / IceBreaker).
-- Same usage_count bookkeeping as the earlier retags. Idempotent.

DO $$
DECLARE
  v_official uuid := '00000000-0000-4000-a000-000000000001';
  -- (old tag name, new tag name, position)
  v_swaps    text[][] := ARRAY[
    ARRAY['AuraFarming', '攝影', '7'],
    ARRAY['BetaEra',     '咖啡', '9']
  ];
  v_row      text[];
  v_old      text;
  v_new      text;
  v_pos      int;
  v_old_id   uuid;
  v_new_id   uuid;
  v_concept  uuid;
BEGIN
  FOREACH v_row SLICE 1 IN ARRAY v_swaps LOOP
    v_old := v_row[1];
    v_new := v_row[2];
    v_pos := v_row[3]::int;

    -- Detach the old meme tag from the official profile (if still there).
    SELECT id INTO v_old_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_old) LIMIT 1;
    IF v_old_id IS NOT NULL THEN
      DELETE FROM public.piktag_user_tags
       WHERE user_id = v_official AND tag_id = v_old_id;
      UPDATE public.piktag_tags
         SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - 1)
       WHERE id = v_old_id;
    END IF;

    -- Find-or-create the new tag; ensure it is concept-linked via the
    -- curated alias map (embedding-free — works with the Gemini key down).
    SELECT id INTO v_new_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_new) LIMIT 1;
    IF v_new_id IS NULL THEN
      INSERT INTO public.piktag_tags (name) VALUES (v_new)
      RETURNING id INTO v_new_id;
    END IF;

    v_concept := public.resolve_tag_alias(v_new);
    IF v_concept IS NOT NULL THEN
      UPDATE public.piktag_tags
         SET concept_id = v_concept
       WHERE id = v_new_id AND concept_id IS DISTINCT FROM v_concept;
    END IF;

    -- Attach the new tag to the official profile at the freed position.
    INSERT INTO public.piktag_user_tags (user_id, tag_id, position, is_private)
    SELECT v_official, v_new_id, v_pos, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.piktag_user_tags
       WHERE user_id = v_official AND tag_id = v_new_id
    );
    UPDATE public.piktag_tags
       SET usage_count = COALESCE(usage_count, 0) + 1
     WHERE id = v_new_id;
  END LOOP;
END $$;
