-- 20260524070000_fix_iconic_concept_aliases.sql
--
-- POST-AUDIT corrections to 20260524060000_seed_iconic_concepts.sql.
--
-- The 22-concept seed introduced three aliases that either (a) collide
-- with a more common meaning of the same string, or (b) don't exist in
-- the language they were tagged to. Because tag_aliases.alias is
-- UNIQUE, leaving them in **permanently shadows** the correct mapping
-- — a future Mr. concept can never claim "先生", a future Assistant
-- Director concept can never claim "AD", etc. Delete them now while
-- the seed has been live for minutes, not weeks.
--
-- Also: adds 6 high-value variants the audit flagged as missing.
-- Designeur (fr) - removed because French doesn't have that word
-- (French just borrows "Designer" as-is).
--
-- Idempotent: DELETE … WHERE alias = / IS NOT NULL guards; INSERT …
-- ON CONFLICT (alias) DO NOTHING. Safe to re-run.

DO $$
DECLARE
  v_jesus_id    uuid;
  v_guanyin_id  uuid;
  v_founder_id  uuid;
  v_ai_id       uuid;
  v_startup_id  uuid;
BEGIN
  -- ────────────────────────────────────────────────────────────────
  -- PART 1: DELETE the three problematic aliases
  -- ────────────────────────────────────────────────────────────────

  -- '先生' was tagged to Teacher (because in Japanese context "先生"
  -- means teacher). But the string ALSO means Mr./Sir as a generic
  -- honorific across Chinese, Japanese, and Korean — by far the more
  -- common reading. A user typing "先生" almost always means the
  -- honorific, not "I'm a teacher". Drop the alias; the concrete
  -- teacher words (老師 / Teacher / Educator / Profesor / etc.) still
  -- route correctly.
  DELETE FROM public.tag_aliases WHERE alias = '先生';

  -- 'AD' was tagged to CEO (Italian "Amministratore Delegato"
  -- abbreviation). Too ambiguous in a global app: also means
  -- advertisement (Ad), Anno Domini (A.D.), Art Director,
  -- Assistant Director. The full phrase "Amministratore Delegato"
  -- already covers Italian CEO; drop the bare abbreviation.
  DELETE FROM public.tag_aliases WHERE alias = 'AD';

  -- 'Designeur' is not a French word — French uses the English
  -- "Designer" as a loan-word verbatim (already aliased on L173).
  -- A wrong-spelling alias only confuses the embedding linker.
  DELETE FROM public.tag_aliases WHERE alias = 'Designeur';

  -- ────────────────────────────────────────────────────────────────
  -- PART 2: ADD missing high-value variants
  -- ────────────────────────────────────────────────────────────────

  -- ── Guanyin: complete 4-character Korean honorific ──
  -- The seed already has 관음 / 관세음 / 관음보살 (line 121) but
  -- 관세음보살 is the FULL and most-common Korean Buddhist form.
  SELECT concept_id INTO v_guanyin_id FROM public.tag_aliases
    WHERE alias IN ('Guanyin', '觀音', '관음', '관세음') LIMIT 1;
  IF v_guanyin_id IS NOT NULL THEN
    INSERT INTO public.tag_aliases (alias, concept_id) VALUES
      ('관세음보살', v_guanyin_id)
    ON CONFLICT (alias) DO NOTHING;
  END IF;

  -- ── Founder: add Mainland Chinese formal "奠基人" ──
  -- 創辦人 (TW) and 创始人 (CN) covered; 奠基人 is the more
  -- formal/literary variant used in PRC business press.
  SELECT concept_id INTO v_founder_id FROM public.tag_aliases
    WHERE alias IN ('Founder', '創辦人', '创始人') LIMIT 1;
  IF v_founder_id IS NOT NULL THEN
    INSERT INTO public.tag_aliases (alias, concept_id) VALUES
      ('奠基人', v_founder_id)
    ON CONFLICT (alias) DO NOTHING;
  END IF;

  -- ── AI: 2026-era variants the seed missed ──
  -- AGI = Artificial General Intelligence — different concept
  -- arguably, but in casual usage "AGI" and "AI" cluster together
  -- on PikTag's social-tag surface (a user tagged "AGI" is a friend
  -- match for someone searching "AI"). "Generative AI" / "生成式 AI"
  -- exploded as a category 2023-2026 and is what most non-technical
  -- users now mean by "AI".
  SELECT concept_id INTO v_ai_id FROM public.tag_aliases
    WHERE alias IN ('AI', 'Artificial Intelligence', '人工智慧', '人工智能') LIMIT 1;
  IF v_ai_id IS NOT NULL THEN
    INSERT INTO public.tag_aliases (alias, concept_id) VALUES
      ('AGI',            v_ai_id),
      ('Generative AI',  v_ai_id),
      ('生成式 AI',      v_ai_id),
      ('生成式AI',       v_ai_id),  -- no-space variant (common in zh)
      ('生成式人工智慧', v_ai_id),
      ('生成式人工智能', v_ai_id)
    ON CONFLICT (alias) DO NOTHING;
  END IF;

  -- ── Startup: Cantonese/HK + Japanese venture variants ──
  -- 初創 is the HK/Cantonese (and increasingly CN) standard; the
  -- seed only had 新創 (TW) and 创业公司 (CN-mainland). ベンチャー /
  -- ベンチャー企業 is how Japanese tech ecosystem refers to
  -- startups — "スタートアップ" (already seeded) is more recent loan.
  SELECT concept_id INTO v_startup_id FROM public.tag_aliases
    WHERE alias IN ('Startup', '新創', '创业') LIMIT 1;
  IF v_startup_id IS NOT NULL THEN
    INSERT INTO public.tag_aliases (alias, concept_id) VALUES
      ('初創',           v_startup_id),
      ('初創企業',       v_startup_id),
      ('初創公司',       v_startup_id),
      ('ベンチャー',     v_startup_id),
      ('ベンチャー企業', v_startup_id)
    ON CONFLICT (alias) DO NOTHING;
  END IF;

  RAISE NOTICE 'Iconic alias corrections applied.';
END $$;
