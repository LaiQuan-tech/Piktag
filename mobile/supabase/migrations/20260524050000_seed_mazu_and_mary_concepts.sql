-- 20260524050000_seed_mazu_and_mary_concepts.sql
--
-- Two iconic-concept seeds: Mazu (the Taiwanese sea goddess —
-- 媽祖) and Virgin Mary (the Christian figure). They share the
-- substring "聖母" in Chinese, which the cross-language embedding
-- linker can't reliably disambiguate, so every known variant is
-- routed to its correct concept explicitly across the 19 launch
-- locales.
--
-- BACKGROUND (DB audit 2026-05-24):
--   • concept A (3ee98898…) — owns the piktag_tags row "媽祖"
--   • concept B (59341411…) — owns the aliases "天上聖母" + "Mazu"
-- Same deity, split across two concepts because the auto-linker's
-- 0.85 cosine threshold + (then-absent) LLM judge couldn't bridge
-- "媽祖" ↔ "天上聖母" (cross-script variant of the same figure).
-- Step 2 below MERGES A into B.
--
-- DESIGN NOTE on "聖母" (the ambiguous bare term):
--   In Taiwan colloquial Mandarin it often means Mazu (天上聖母 is
--   her formal title). In standard Mandarin / Catholic contexts it
--   means Mary. Globally ~2.4B Christians vs ~100M Mazu followers,
--   so we default "聖母" → Mary. A future locale-based override
--   could route zh-TW Taiwan users to Mazu when they type "聖母"
--   alone — not in scope here.
--
-- Idempotent: ON CONFLICT (alias) DO NOTHING + IS NOT NULL guards
-- on the merge step. Safe to re-run.

DO $$
DECLARE
  v_mazu_id      uuid;
  v_mary_id      uuid;
  v_orphan_id    uuid;
BEGIN
  -- ── 1. Locate (or create) the canonical Mazu concept ──
  SELECT concept_id INTO v_mazu_id
    FROM public.tag_aliases
    WHERE alias IN ('天上聖母', 'Mazu')
    LIMIT 1;
  IF v_mazu_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Mazu', 'interest')
    RETURNING id INTO v_mazu_id;
  END IF;

  -- ── 2. Merge ANY orphan Mazu concept(s) into v_mazu_id ──
  -- We identify orphans via the "媽祖" tag row — if it points to a
  -- different concept than the alias map's canonical one, that
  -- concept is a duplicate to absorb.
  FOR v_orphan_id IN
    SELECT DISTINCT t.concept_id
    FROM public.piktag_tags t
    WHERE t.name = '媽祖'
      AND t.concept_id IS NOT NULL
      AND t.concept_id <> v_mazu_id
  LOOP
    UPDATE public.piktag_tags  SET concept_id = v_mazu_id WHERE concept_id = v_orphan_id;
    UPDATE public.tag_aliases  SET concept_id = v_mazu_id WHERE concept_id = v_orphan_id;
    DELETE FROM public.tag_concepts WHERE id = v_orphan_id;
  END LOOP;

  -- ── 3. Locate (or create) the Virgin Mary concept ──
  SELECT concept_id INTO v_mary_id
    FROM public.tag_aliases
    WHERE alias IN ('Virgin Mary', '聖母瑪利亞', '瑪利亞', 'María', 'Marie')
    LIMIT 1;
  IF v_mary_id IS NULL THEN
    INSERT INTO public.tag_concepts (canonical_name, semantic_type)
    VALUES ('Virgin Mary', 'interest')
    RETURNING id INTO v_mary_id;
  END IF;

  -- ── 4. Mazu aliases across 19 locales ──
  -- Covers: Chinese titles (天上聖母 / 天妃), mortal name (林默娘 /
  -- 默娘), colloquial honorifics (媽祖娘娘 / 媽祖婆), Cantonese-
  -- Vietnamese title (天后娘娘 / Thiên Hậu — same deity), Hokkien
  -- diaspora form (Mak Co), and romanizations across all launch
  -- languages. Excludes "天后" alone (ambiguous: also "queen of
  -- pop" in standard Mandarin).
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_mazu_id
  FROM (VALUES
    -- Chinese (zh-TW + zh-CN simplified)
    ('媽祖'), ('妈祖'),
    ('天上聖母'), ('天上圣母'),
    ('林默娘'), ('默娘'),
    ('媽祖娘娘'), ('妈祖娘娘'),
    ('媽祖婆'),   ('妈祖婆'),
    ('天妃'),
    ('海神媽祖'), ('海神妈祖'),
    ('天后娘娘'),                  -- Tin Hau (Cantonese title)
    -- English / romanizations
    ('Mazu'), ('Matsu'), ('Ma-tsu'), ('Ma Zu'), ('Mazhu'),
    ('Mazu Goddess'),
    ('Mak Co'), ('Makco'),         -- Hokkien diaspora (SE Asia Chinese)
    -- Japanese (kanji shared with Chinese; katakana variants)
    ('マツ'), ('マーツー'),
    -- Korean
    ('마조'),
    -- Vietnamese (Thiên Hậu = "Empress of Heaven" = same deity)
    ('Thiên Hậu'), ('Bà Thiên Hậu'), ('Ma Tổ'),
    -- Thai
    ('หม่าจู่'), ('มาจู่'), ('เจ้าแม่หม่าจู่'),
    -- Spanish / Portuguese / French / Italian / German
    ('Diosa Mazu'), ('Deusa Mazu'), ('Déesse Mazu'),
    ('Dea Mazu'),   ('Göttin Mazu'),
    -- Russian (two common transliterations)
    ('Мацзу'), ('Мазу'),
    -- Arabic / Urdu (same script)
    ('مازو'),
    -- Hindi
    ('माजू'),
    -- Bengali
    ('মাজু'),
    -- Turkish
    ('Mazu Tanrıçası'),
    -- Indonesian (uses "Mazu" — already covered above)
    ('Dewi Mazu')
  ) AS v(alias)
  ON CONFLICT (alias) DO NOTHING;

  -- ── 5. Virgin Mary aliases across 19 locales ──
  INSERT INTO public.tag_aliases (alias, concept_id)
  SELECT v.alias, v_mary_id
  FROM (VALUES
    -- Chinese
    ('聖母瑪利亞'), ('圣母玛利亚'),
    ('聖瑪利亞'),   ('圣玛利亚'),
    ('瑪利亞'),     ('玛利亚'),
    ('童貞瑪利亞'), ('童贞玛利亚'),
    ('耶穌的母親'), ('耶稣的母亲'),
    -- English
    ('Mary'), ('Virgin Mary'), ('Saint Mary'),
    ('Blessed Virgin'), ('Blessed Virgin Mary'),
    ('Mother Mary'), ('Holy Mary'), ('Mother of Jesus'),
    -- Japanese
    ('マリア'), ('聖母マリア'),
    -- Korean
    ('마리아'), ('성모 마리아'), ('성모마리아'),
    -- Spanish
    ('María'), ('Virgen María'), ('Santa María'),
    -- Portuguese
    ('Virgem Maria'), ('Nossa Senhora'), ('Maria de Nazaré'),
    -- French
    ('Marie'), ('Vierge Marie'), ('Sainte Marie'),
    -- Italian
    ('Vergine Maria'), ('Madonna'),
    -- German
    ('Jungfrau Maria'), ('Heilige Maria'),
    -- Russian
    ('Мария'), ('Дева Мария'), ('Святая Мария'),
    -- Arabic
    ('مريم'), ('مريم العذراء'), ('السيدة مريم'),
    -- Hindi
    ('मरियम'), ('कुँवारी मरियम'),
    -- Bengali
    ('মেরি'), ('কুমারী মেরি'),
    -- Thai
    ('พระแม่มารี'), ('มารี'), ('พระนางมารี'),
    -- Turkish
    ('Meryem'), ('Bakire Meryem'), ('Meryem Ana'),
    -- Urdu
    ('مریم'), ('کنواری مریم'),
    -- Vietnamese
    ('Đức Mẹ Maria'), ('Đức Mẹ'),
    -- Indonesian
    ('Bunda Maria'), ('Perawan Maria'),
    -- Generic shared (used by multiple Romance / Germanic langs)
    ('Maria')
  ) AS v(alias)
  ON CONFLICT (alias) DO NOTHING;

  -- ── 6. Ambiguous "聖母" → Mary (global default) ──
  -- See DESIGN NOTE in the header. A locale-aware override is the
  -- intended next iteration.
  INSERT INTO public.tag_aliases (alias, concept_id) VALUES
    ('聖母', v_mary_id),
    ('圣母', v_mary_id)
  ON CONFLICT (alias) DO NOTHING;

  -- ── 7. Surface a summary in the SQL Editor output ──
  RAISE NOTICE 'Mazu concept_id: %', v_mazu_id;
  RAISE NOTICE 'Mary concept_id: %', v_mary_id;
END
$$;
