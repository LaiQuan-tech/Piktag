-- 20260910010000_curated_spiritual_craft_aliases.sql
--
-- Cross-language aliases for the spiritual / mineral / handcraft quadrant.
--
-- WHY
-- Founder hit this directly: a friend tagged `crystal`, searching 水晶 found
-- nothing. A live probe showed the tag is healthy -- concept_id set, concept
-- has an embedding -- so this is not the 2026-06 linker outage. The concept
-- is simply MONOLINGUAL: auto-link-concepts minted a singleton concept named
-- `crystal` and never produced cross-language aliases for it.
--
-- search_users reaches a concept only by matching the query TEXT against
-- piktag_tags.name or tag_aliases.alias (20260705020000:455-470). Nothing in
-- the system said the characters 水晶 point at that concept, so the bridge
-- did not exist -- the concept's embedding is irrelevant on that path.
--
-- The seeds so far cover careers and mainstream interests (coffee, yoga,
-- gym, cats, dogs, movies, wine...). Spirituality, minerals, divination and
-- handcraft are a systematic blank, so the founder's friend is simply the
-- first person to land in it. This curates that quadrant by hand, the same
-- embedding-free way 20260711020000 did for thrift fashion and gravel
-- cycling.
--
-- This is the stopgap. The systemic fix -- having the linker mint
-- cross-language aliases whenever it creates a concept -- ships alongside
-- it in auto-link-concepts.
--
-- SAFETY
-- 20260711020000 had it easy: a live probe told it exactly which concepts
-- existed. Here we do not, so every group is resolved by canonical_name
-- and nothing else -- create it if absent, use it if present. Aliases are
-- then attached ON CONFLICT (alias) DO NOTHING, so an alias another
-- concept already owns is never stolen, only reported.
--
-- Both of those rules were earned by running this migration against a
-- local Postgres 16 with a fixture that reproduces the nasty cases:
--   * Resolving a group through "any alias that already matches" let one
--     pre-owned alias (星座, held by an unrelated concept) pull the entire
--     astrology group onto that concept -- 14 aliases misfiled in one shot.
--   * An earlier "skip ambiguous groups" pass was silently undone by the
--     re-resolve step that followed it, so a group flagged as split still
--     received its aliases.
-- Both are gone; the fixture now passes. Ownership conflicts surface as
-- WARNINGs in the Supabase Deploy log instead of being acted on, because a
-- conflict means the concept is split across two ids (the same shape as
-- the 匹克球/pickleball and 美食/foodie splits that 20260806010000 had to
-- repair by hand) and merging is destructive.
--
-- Idempotent throughout.

-- ── 1. The curated set ───────────────────────────────────────────────
-- Staged in a temp table so the resolve-or-create logic below can read it
-- more than once without repeating the literal.

CREATE TEMP TABLE curated_seed (canonical text, alias text, language text);

INSERT INTO curated_seed (canonical, alias, language) VALUES
  -- crystal — the reported case. Concept exists (canonical_name 'crystal',
  -- probed 2026-09-10), so this resolves to it and only adds aliases.
  ('crystal', 'crystal',            'en'),
  ('crystal', 'crystals',           'en'),
  ('crystal', 'healing crystals',   'en'),
  ('crystal', 'crystal healing',    'en'),
  ('crystal', 'gemstone',           'en'),
  ('crystal', 'water crystal',      'en'),
  ('crystal', '水晶',               'zh-TW'),
  ('crystal', '水晶療癒',           'zh-TW'),
  ('crystal', '能量石',             'zh-TW'),
  ('crystal', '寶石',               'zh-TW'),
  ('crystal', '礦石',               'zh-TW'),
  ('crystal', '水晶疗愈',           'zh-CN'),
  ('crystal', 'クリスタル',         'ja'),
  ('crystal', '天然石',             'ja'),
  ('crystal', '크리스탈',           'ko'),
  ('crystal', 'cristales',          'es'),
  ('crystal', 'cristaux',           'fr'),

  ('tarot',   'tarot',              'en'),
  ('tarot',   'tarot reading',      'en'),
  ('tarot',   'tarot cards',        'en'),
  ('tarot',   '塔羅',               'zh-TW'),
  ('tarot',   '塔羅牌',             'zh-TW'),
  ('tarot',   '塔羅占卜',           'zh-TW'),
  ('tarot',   '塔罗牌',             'zh-CN'),
  ('tarot',   'タロット',           'ja'),
  ('tarot',   '타로',               'ko'),
  ('tarot',   'tarot cartas',       'es'),

  ('astrology', 'astrology',        'en'),
  ('astrology', 'horoscope',        'en'),
  ('astrology', 'natal chart',      'en'),
  ('astrology', 'zodiac',           'en'),
  ('astrology', '占星',             'zh-TW'),
  ('astrology', '占星術',           'zh-TW'),
  ('astrology', '星座',             'zh-TW'),
  ('astrology', '星盤',             'zh-TW'),
  ('astrology', '占星术',           'zh-CN'),
  ('astrology', '占星術師',         'ja'),
  ('astrology', 'ホロスコープ',     'ja'),
  ('astrology', '점성술',           'ko'),
  ('astrology', 'astrologia',       'es'),
  ('astrology', 'astrologie',       'fr'),

  ('aromatherapy', 'aromatherapy',    'en'),
  ('aromatherapy', 'essential oils',  'en'),
  ('aromatherapy', 'essential oil',   'en'),
  ('aromatherapy', '香氛',            'zh-TW'),
  ('aromatherapy', '芳療',            'zh-TW'),
  ('aromatherapy', '芳香療法',        'zh-TW'),
  ('aromatherapy', '精油',            'zh-TW'),
  ('aromatherapy', '芳香疗法',        'zh-CN'),
  ('aromatherapy', 'アロマテラピー',  'ja'),
  ('aromatherapy', 'アロマ',          'ja'),
  ('aromatherapy', '아로마테라피',    'ko'),
  ('aromatherapy', 'aromaterapia',    'es'),
  ('aromatherapy', 'aromathérapie',   'fr'),

  ('meditation', 'meditation',      'en'),
  ('meditation', 'mindfulness',     'en'),
  ('meditation', '冥想',            'zh-TW'),
  ('meditation', '靜心',            'zh-TW'),
  ('meditation', '正念',            'zh-TW'),
  ('meditation', '瞑想',            'ja'),
  ('meditation', 'マインドフルネス', 'ja'),
  ('meditation', '명상',            'ko'),
  ('meditation', 'meditación',      'es'),
  ('meditation', 'méditation',      'fr'),

  ('sound healing', 'sound healing',   'en'),
  ('sound healing', 'singing bowl',    'en'),
  ('sound healing', 'singing bowls',   'en'),
  ('sound healing', 'sound bath',      'en'),
  ('sound healing', '頌缽',            'zh-TW'),
  ('sound healing', '音療',            'zh-TW'),
  ('sound healing', '聲音療癒',        'zh-TW'),
  ('sound healing', '颂钵',            'zh-CN'),
  ('sound healing', 'シンギングボウル', 'ja'),
  ('sound healing', '싱잉볼',          'ko'),

  ('reiki',   'reiki',              'en'),
  ('reiki',   'energy healing',     'en'),
  ('reiki',   '靈氣',               'zh-TW'),
  ('reiki',   '靈氣療癒',           'zh-TW'),
  ('reiki',   '能量療癒',           'zh-TW'),
  ('reiki',   '灵气疗愈',           'zh-CN'),
  ('reiki',   'レイキ',             'ja'),
  ('reiki',   '레이키',             'ko'),

  ('handmade', 'handmade',          'en'),
  ('handmade', 'handcraft',         'en'),
  ('handmade', 'handicraft',        'en'),
  ('handmade', 'diy crafts',        'en'),
  ('handmade', '手作',              'zh-TW'),
  ('handmade', '手工藝',            'zh-TW'),
  ('handmade', '手創',              'zh-TW'),
  ('handmade', '手工艺',            'zh-CN'),
  ('handmade', '手作り',            'ja'),
  ('handmade', 'ハンドメイド',      'ja'),
  ('handmade', '핸드메이드',        'ko'),
  ('handmade', 'hecho a mano',      'es'),
  ('handmade', 'fait main',         'fr'),

  ('pottery', 'pottery',            'en'),
  ('pottery', 'ceramics',           'en'),
  ('pottery', 'ceramic art',        'en'),
  ('pottery', '陶藝',               'zh-TW'),
  ('pottery', '陶瓷',               'zh-TW'),
  ('pottery', '拉坯',               'zh-TW'),
  ('pottery', '陶艺',               'zh-CN'),
  ('pottery', '陶芸',               'ja'),
  ('pottery', '도예',               'ko'),
  ('pottery', 'cerámica',           'es'),
  ('pottery', 'poterie',            'fr');

-- ── 2. Create any concept whose canonical name is not present yet ────
-- No embedding: the alias path does not need one, and the linker will
-- backfill it on a later pass now that the Gemini key is healthy.
--
-- Resolution is by canonical_name ONLY, deliberately. The obvious
-- alternative -- "this group belongs to whichever concept already owns
-- any of its aliases" -- was implemented first and is actively dangerous:
-- a local Postgres run of this migration showed one pre-owned alias
-- (星座, held by an unrelated 'zodiac merch' concept) dragging the whole
-- astrology group onto that concept, handing it 14 aliases it has no
-- business owning. Adopting another concept's identity from a single
-- overlapping string corrupts a concept that was previously fine, which
-- is worse and far less visible than the duplicate this avoids.

INSERT INTO public.tag_concepts (canonical_name, semantic_type)
SELECT DISTINCT s.canonical, 'interest'
FROM curated_seed s
ON CONFLICT (canonical_name) DO NOTHING;

CREATE TEMP TABLE curated_resolved AS
SELECT DISTINCT s.canonical, tc.id AS concept_id
FROM curated_seed s
JOIN public.tag_concepts tc ON lower(tc.canonical_name) = lower(s.canonical);

-- ── 3. Report aliases that another concept already owns ──────────────
-- These are left exactly where they are (step 4 cannot steal them). A row
-- here means the concept is split across two ids -- the same shape as the
-- 匹克球/pickleball and 美食/foodie splits that 20260806010000 had to
-- repair by hand. Merging is destructive, so this migration reports and
-- moves on rather than guessing.

DO $$
DECLARE r RECORD; v_n int := 0;
BEGIN
  FOR r IN
    SELECT s.canonical, s.alias, tc.canonical_name AS owned_by
    FROM curated_seed s
    JOIN public.tag_aliases ta ON lower(ta.alias) = lower(s.alias)
    JOIN curated_resolved cr   ON cr.canonical = s.canonical
    JOIN public.tag_concepts tc ON tc.id = ta.concept_id
    WHERE ta.concept_id <> cr.concept_id
    ORDER BY s.canonical, s.alias
  LOOP
    v_n := v_n + 1;
    RAISE WARNING
      'curated alias seed: alias "%" (group "%") is already owned by concept "%" -- left alone. That concept is split; merge by hand before this bridge works.',
      r.alias, r.canonical, r.owned_by;
  END LOOP;
  IF v_n = 0 THEN
    RAISE NOTICE 'curated alias seed: no alias ownership conflicts.';
  END IF;
END $$;

-- ── 4. Attach the aliases ────────────────────────────────────────────
-- ON CONFLICT (alias) DO NOTHING: an alias already owned by some other
-- concept stays where it is. We add bridges, we never steal them.

INSERT INTO public.tag_aliases (alias, concept_id, language)
SELECT DISTINCT s.alias, r.concept_id, s.language
FROM curated_seed s
JOIN curated_resolved r ON r.canonical = s.canonical
ON CONFLICT (alias) DO NOTHING;

-- ── 5. Retro-link orphan tags that match a curated alias ─────────────
-- Same shape as 20260711020000 step 4: drains part of the unlinked
-- backlog with no embedding call. Only touches NULL concept_id, so an
-- existing link is never overridden.

UPDATE public.piktag_tags t
SET concept_id = a.concept_id
FROM public.tag_aliases a
WHERE lower(t.name) = lower(a.alias)
  AND t.concept_id IS NULL;

-- ── 6. Report what landed, so the deploy log is auditable ────────────
DO $$
DECLARE
  v_groups int;
  v_aliases int;
BEGIN
  SELECT COUNT(*) INTO v_groups FROM curated_resolved;
  -- Count only aliases that landed on the concept they were curated for.
  -- Counting every curated alias present anywhere inflates the number with
  -- the conflicts reported above, which are precisely the ones that did
  -- NOT get wired up.
  SELECT COUNT(*) INTO v_aliases
  FROM curated_seed s
  JOIN curated_resolved r    ON r.canonical = s.canonical
  JOIN public.tag_aliases ta ON lower(ta.alias) = lower(s.alias)
                            AND ta.concept_id = r.concept_id;
  RAISE NOTICE 'curated alias seed: % concept groups, % of % curated aliases wired to their own concept.',
    v_groups, v_aliases, (SELECT COUNT(*) FROM curated_seed);
END $$;

DROP TABLE IF EXISTS curated_seed;
DROP TABLE IF EXISTS curated_resolved;
