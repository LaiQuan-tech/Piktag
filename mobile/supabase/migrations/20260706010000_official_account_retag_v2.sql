-- 20260706010000_official_account_retag_v2.sql
--
-- @piktag tag set v2 (founder, 2026-07-06, superseding 20260706000000
-- same day): the profile is the DEMO every new user sees first, so the
-- ten now model a copyable identity across dimensions — brand voice
-- (DefineYourVibe / SideQuest / AuraFarming / BetaEra), 身份
-- (DigitalNomad), 技能 (ReactNative / IceBreaker), 興趣
-- (ThriftedFashion / GravelCycling), MBTI (ENFP) — instead of ten
-- slogans. Position = founder's numbering.
--
-- Also sets the bio to the explicit teaching line: tags SHOW the
-- format, bio TELLS the instruction.
--
-- Same mechanics as v1: detach-all + usage_count -1, find-or-create
-- case-insensitively, attach with position + usage_count +1. No
-- `source` column on piktag_user_tags (live-probed 2026-07-06).

DO $$
DECLARE
  v_official    uuid := '00000000-0000-4000-a000-000000000001';
  v_names       text[] := ARRAY[
    'DefineYourVibe',
    'DigitalNomad',
    'ReactNative',
    'ThriftedFashion',
    'GravelCycling',
    'ENFP',
    'SideQuest',
    'AuraFarming',
    'IceBreaker',
    'BetaEra'
  ];
  v_name        text;
  v_tag_id      uuid;
  v_pos         int := 0;
  v_old_tag_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(tag_id), '{}') INTO v_old_tag_ids
    FROM public.piktag_user_tags
   WHERE user_id = v_official;

  DELETE FROM public.piktag_user_tags WHERE user_id = v_official;

  UPDATE public.piktag_tags
     SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - 1)
   WHERE id = ANY(v_old_tag_ids);

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

  -- Teaching bio (English-everywhere brand voice, same doctrine as
  -- "Pick. Tag. Connect.").
  UPDATE public.piktag_profiles
     SET bio = 'Tags are how people find you — job, skills, hobbies, MBTI, anything that''s you. Tap your profile to add yours.'
   WHERE id = v_official;
END $$;
