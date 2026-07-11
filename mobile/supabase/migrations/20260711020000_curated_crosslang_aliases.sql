-- 20260711020000_curated_crosslang_aliases.sql
--
-- Curated cross-language concept aliases — the EMBEDDING-FREE resilience
-- layer for PikTag's moat (founder ask 2026-07-11). The Gemini embedding
-- API has been down since 2026-06-22, so the auto-linker cannot bridge
-- cross-language tags for the long tail. But the alias path
-- (resolve_tag_alias, exact case-insensitive match) needs NO embedding and
-- survived the outage — so for HIGH-VALUE concepts we curate the bridge by
-- hand. After this, tagging #ThriftedFashion and #古著 both resolve to ONE
-- concept, so searching either finds the other WITHOUT the embedding API up
-- (founder Q4: "從 #ThriftedFashion 找到 #古著").
--
-- Two shapes, because a live-DB probe (2026-07-11) found:
--   * thrift fashion / gravel cycling → NO existing concept → CREATE.
--   * coffee (咖啡) / hiking (登山)     → concept ALREADY EXISTS → we must
--     NOT create a duplicate (that would SPLIT the concept). Instead attach
--     the new aliases to the existing concept via an anchor alias.
--
-- New concepts carry NO embedding (nullable column); the alias path doesn't
-- need it. Backfill embeddings once the Gemini key is restored so the
-- long-tail linker can also match them. Idempotent throughout.

-- ── 1. Create the two genuinely-new concepts (no embedding) ─────────
INSERT INTO public.tag_concepts (canonical_name, semantic_type)
VALUES
  ('thrift fashion', 'interest'),
  ('gravel cycling', 'interest')
ON CONFLICT (canonical_name) DO NOTHING;

-- ── 2. Aliases for the NEW concepts — joined by canonical_name ──────
INSERT INTO public.tag_aliases (alias, concept_id, language)
SELECT DISTINCT v.alias, c.id, v.language
FROM (VALUES
  ('ThriftedFashion',   'thrift fashion', 'en'),
  ('thrifted fashion',  'thrift fashion', 'en'),
  ('thrifting',         'thrift fashion', 'en'),
  ('thrift',            'thrift fashion', 'en'),
  ('secondhand fashion','thrift fashion', 'en'),
  ('vintage fashion',   'thrift fashion', 'en'),
  ('vintage clothing',  'thrift fashion', 'en'),
  ('古著',              'thrift fashion', 'zh-TW'),
  ('二手時尚',          'thrift fashion', 'zh-TW'),
  ('二手服飾',          'thrift fashion', 'zh-TW'),
  ('中古時尚',          'thrift fashion', 'zh-TW'),
  ('二手时尚',          'thrift fashion', 'zh-CN'),
  ('古着',              'thrift fashion', 'ja'),
  ('빈티지 패션',       'thrift fashion', 'ko'),
  ('구제패션',          'thrift fashion', 'ko'),
  ('moda de segunda mano', 'thrift fashion', 'es'),
  ('mode vintage',      'thrift fashion', 'fr'),

  ('GravelCycling',     'gravel cycling', 'en'),
  ('gravel cycling',    'gravel cycling', 'en'),
  ('gravel riding',     'gravel cycling', 'en'),
  ('gravel bike',       'gravel cycling', 'en'),
  ('gravel',            'gravel cycling', 'en'),
  ('碎石路騎行',        'gravel cycling', 'zh-TW'),
  ('礫石路騎行',        'gravel cycling', 'zh-TW'),
  ('碎石騎行',          'gravel cycling', 'zh-CN'),
  ('グラベル',          'gravel cycling', 'ja'),
  ('グラベルロード',    'gravel cycling', 'ja'),
  ('그래블',            'gravel cycling', 'ko'),
  ('그래블 라이딩',     'gravel cycling', 'ko')
) AS v(alias, canonical, language)
JOIN public.tag_concepts c ON c.canonical_name = v.canonical
ON CONFLICT (alias) DO NOTHING;

-- ── 3. Aliases for EXISTING concepts — anchored on an alias that already
--       resolves (咖啡 → coffee concept, 登山 → hiking concept). No concept
--       is created, so nothing splits. ──
INSERT INTO public.tag_aliases (alias, concept_id, language)
SELECT DISTINCT v.alias, ta.concept_id, v.language
FROM (VALUES
  -- coffee — anchor 咖啡
  ('Coffee',            '咖啡', 'en'),
  ('coffee',            '咖啡', 'en'),
  ('speciality coffee', '咖啡', 'en'),
  ('specialty coffee',  '咖啡', 'en'),
  ('精品咖啡',          '咖啡', 'zh-TW'),
  ('コーヒー',          '咖啡', 'ja'),
  ('커피',              '咖啡', 'ko'),
  ('café',              '咖啡', 'es'),
  ('kopi',              '咖啡', 'id'),
  ('กาแฟ',             '咖啡', 'th'),

  -- hiking — anchor 登山
  ('Hiking',            '登山', 'en'),
  ('hiking',            '登山', 'en'),
  ('trekking',          '登山', 'en'),
  ('健行',              '登山', 'zh-TW'),
  ('爬山',              '登山', 'zh-TW'),
  ('徒步',              '登山', 'zh-CN'),
  ('ハイキング',        '登山', 'ja'),
  ('등산',              '登山', 'ko'),
  ('senderismo',        '登山', 'es'),
  ('randonnée',         '登山', 'fr'),
  ('mendaki',           '登山', 'id')
) AS v(alias, anchor, language)
JOIN public.tag_aliases ta ON lower(ta.alias) = lower(v.anchor)
ON CONFLICT (alias) DO NOTHING;

-- ── 4. Retro-link EXISTING orphan tags whose name matches any curated
--       alias — drains part of the unlinked backlog immediately, no
--       embedding. Case-insensitive; only NULL concept_id (never overrides). ──
UPDATE public.piktag_tags t
SET concept_id = a.concept_id
FROM public.tag_aliases a
WHERE lower(t.name) = lower(a.alias)
  AND t.concept_id IS NULL;
