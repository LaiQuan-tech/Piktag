-- 20260706000000_official_account_retag.sql
--
-- Replace @piktag's profile tags (was: Startup / AI / tag) with the ten
-- brand hashtags the founder picked (2026-07-06). English-everywhere by
-- design — they're the brand voice, not localized content. Display order
-- follows the founder's numbering via `position` (tag ordering on a
-- profile is RULES: is_pinned → position → created_at).
--
-- usage_count bookkeeping mirrors the client's batch_tag_increment
-- convention: -1 on each detached tag, +1 on each attached tag.
-- NOTE: piktag_user_tags has NO `source` column (live-probed 2026-07-06;
-- the CLAUDE.md "Implemented: piktag_user_tags.source" note is stale).
--
-- Official's tag-adds do not notify (20260612010000 exclusion sweep),
-- and the BEFORE INSERT alias resolver + 5-min linker cron will
-- concept-link the new names — nothing else to wire.

DO $$
DECLARE
  v_official    uuid := '00000000-0000-4000-a000-000000000001';
  v_names       text[] := ARRAY[
    'DefineYourVibe',
    'FindYourTribe',
    'TagWhatMatters',
    'NoFilter',
    'AuraFarming',
    'MainCharacterEnergy',
    'POV',
    'CoreMemory',
    'SideQuest',
    'BetaEra'
  ];
  v_name        text;
  v_tag_id      uuid;
  v_pos         int := 0;
  v_old_tag_ids uuid[];
BEGIN
  -- Detach everything currently on the official profile.
  SELECT COALESCE(array_agg(tag_id), '{}') INTO v_old_tag_ids
    FROM public.piktag_user_tags
   WHERE user_id = v_official;

  DELETE FROM public.piktag_user_tags WHERE user_id = v_official;

  UPDATE public.piktag_tags
     SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - 1)
   WHERE id = ANY(v_old_tag_ids);

  -- Attach the ten, founder order. Case-insensitive find-or-create
  -- (piktag_tags carries a UNIQUE(lower(name)) functional index).
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT id INTO v_tag_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_name) LIMIT 1;
    IF v_tag_id IS NULL THEN
      INSERT INTO public.piktag_tags (name) VALUES (v_name)
      RETURNING id INTO v_tag_id;
    END IF;

    INSERT INTO public.piktag_user_tags (user_id, tag_id, position, is_private)
    SELECT v_official, v_tag_id, v_pos, false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.piktag_user_tags
       WHERE user_id = v_official AND tag_id = v_tag_id
    );

    UPDATE public.piktag_tags
       SET usage_count = COALESCE(usage_count, 0) + 1
     WHERE id = v_tag_id;

    v_pos := v_pos + 1;
  END LOOP;
END $$;
