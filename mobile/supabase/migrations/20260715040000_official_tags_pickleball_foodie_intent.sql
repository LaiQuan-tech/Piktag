-- 20260715040000_official_tags_pickleball_foodie_intent.sql
--
-- @piktag official teaching profile — refresh the showcase tag set
-- (founder 2026-07-15). Swaps four of the ten teaching tags for a mix
-- of a cross-language sport interest, a cross-language food interest,
-- and two social *intent* tags, so the official profile keeps modelling
-- the "tag in whatever language fits you, everyone sees it in theirs"
-- story. Position-preserving swaps (reuse the freed slot so ordering is
-- stable):
--
--   pos 4: GravelCycling → Foodie         (interest;  zh 美食)
--   pos 6: SideQuest      → OpenToCollab   (intent;    zh 開放合作)
--   pos 7: 攝影           → Pickleball     (interest;  zh 匹克球)
--   pos 9: 咖啡           → CoffeeChat     (intent;    zh 喝咖啡聊聊)
--
-- Keeps the other 6 untouched (DefineYourVibe / DigitalNomad /
-- ReactNative / ThriftedFashion / ENFP / IceBreaker).
--
-- Mechanism mirrors 20260711020000 (curated, embedding-free aliases) and
-- 20260711030000 (official-account swap). NOTE the split of concerns:
--   * tag_aliases below = the cross-language SEARCH bridge (searching
--     "pickleball" finds 匹克球-tagged people and vice-versa) — the
--     embedding-free alias path, no Gemini key needed.
--   * the per-viewer DISPLAY label (a zh-TW viewer seeing 匹克球, an en
--     viewer Pickleball on the profile) is NOT stored in any DB table.
--     It lives in app/web code + i18n:
--       - mobile: OFFICIAL_TAG_LABEL_KEYS (src/lib/officialDemoAsk.ts)
--                 + showcaseTag.* keys in src/i18n/locales/*.json
--       - web:    getDisplayTagName() (landing/api/u/[username].js)
--                 + officialTag* keys in landing/api/_config.js
--     Those files are updated alongside this migration in the same change.
--
-- semantic_type: there is no 'intent' value in this column (plain text,
-- no CHECK; observed distinct values are career/identity/interest/
-- personality/profession_industry/skill). 'interest' is the nearest
-- valid bucket for all four, and the official account is is_official
-- (excluded from matching) so the type never feeds real recommendations.
--
-- Idempotent throughout — a second run is a no-op (usage_count bookkeeping
-- is gated on ROW_COUNT, so it does not drift on re-apply).

-- ── 1. Create the four concepts (no embedding; alias path needs none) ──
-- All genuinely new (live probe 2026-07-15 found no existing pickleball /
-- foodie / coffee-chat / open-to-collab concept). CoffeeChat is a social
-- intent distinct from the existing 'coffee' beverage concept, so it gets
-- its own concept rather than anchoring onto 咖啡.
INSERT INTO public.tag_concepts (canonical_name, semantic_type)
VALUES
  ('pickleball',     'interest'),
  ('foodie',         'interest'),
  ('coffee chat',    'interest'),
  ('open to collab', 'interest')
ON CONFLICT (canonical_name) DO NOTHING;

-- ── 2. Cross-language aliases, joined by canonical_name ───────────────
-- Density mirrors the 20260711020000 curated set: canonical English name
-- + lowercase + synonyms + distinct-script labels across the app's
-- locales. Aliases are globally UNIQUE, so an identical Latin string
-- (e.g. "pickleball") is inserted once and resolves for every locale via
-- resolve_tag_alias's case-insensitive match; only distinct scripts need
-- their own row. In-house translations, final. ON CONFLICT skips any
-- alias already claimed by another concept (harmless — just no bridge).
INSERT INTO public.tag_aliases (alias, concept_id, language)
SELECT DISTINCT v.alias, c.id, v.language
FROM (VALUES
  -- pickleball ------------------------------------------------------
  ('Pickleball',        'pickleball', 'en'),
  ('pickleball',        'pickleball', 'en'),
  ('pickle ball',       'pickleball', 'en'),
  ('匹克球',            'pickleball', 'zh-TW'),
  ('ピックルボール',    'pickleball', 'ja'),
  ('피클볼',            'pickleball', 'ko'),
  ('พิกเกิลบอล',        'pickleball', 'th'),
  ('пиклбол',           'pickleball', 'ru'),
  ('بيكل بول',          'pickleball', 'ar'),
  ('पिकलबॉल',           'pickleball', 'hi'),

  -- foodie ----------------------------------------------------------
  ('Foodie',            'foodie', 'en'),
  ('foodie',            'foodie', 'en'),
  ('food lover',        'foodie', 'en'),
  ('gourmet',           'foodie', 'en'),
  ('美食',              'foodie', 'zh-TW'),
  ('美食家',            'foodie', 'zh-TW'),
  ('吃貨',              'foodie', 'zh-TW'),
  ('吃货',              'foodie', 'zh-CN'),
  ('グルメ',            'foodie', 'ja'),
  ('미식가',            'foodie', 'ko'),
  ('맛집',              'foodie', 'ko'),
  ('pecinta kuliner',   'foodie', 'id'),
  ('สายกิน',            'foodie', 'th'),
  ('гурман',            'foodie', 'ru'),
  ('عاشق الطعام',       'foodie', 'ar'),
  ('खाने का शौकीन',      'foodie', 'hi'),
  ('buongustaio',       'foodie', 'it'),
  ('tín đồ ẩm thực',    'foodie', 'vi'),

  -- coffee chat (social intent; distinct from the 'coffee' concept) --
  ('CoffeeChat',        'coffee chat', 'en'),
  ('coffee chat',       'coffee chat', 'en'),
  ('coffeechat',        'coffee chat', 'en'),
  ('grab a coffee',     'coffee chat', 'en'),
  ('coffee meetup',     'coffee chat', 'en'),
  ('喝咖啡聊聊',        'coffee chat', 'zh-TW'),
  ('咖啡聊聊',          'coffee chat', 'zh-TW'),
  ('喝咖啡聊天',        'coffee chat', 'zh-CN'),
  ('コーヒーチャット',  'coffee chat', 'ja'),
  ('커피챗',            'coffee chat', 'ko'),
  ('ngopi santai',      'coffee chat', 'id'),
  ('จิบกาแฟคุยกัน',      'coffee chat', 'th'),
  ('кофе и беседа',     'coffee chat', 'ru'),
  ('قهوة ودردشة',       'coffee chat', 'ar'),

  -- open to collab (social intent) ----------------------------------
  ('OpenToCollab',          'open to collab', 'en'),
  ('open to collab',        'open to collab', 'en'),
  ('open to collaboration', 'open to collab', 'en'),
  ('open for collab',       'open to collab', 'en'),
  ('looking to collaborate','open to collab', 'en'),
  ('開放合作',              'open to collab', 'zh-TW'),
  ('找合作',                'open to collab', 'zh-TW'),
  ('开放合作',              'open to collab', 'zh-CN'),
  ('コラボ募集',            'open to collab', 'ja'),
  ('협업 환영',             'open to collab', 'ko'),
  ('abierto a colaborar',   'open to collab', 'es'),
  ('ouvert à la collaboration', 'open to collab', 'fr'),
  ('offen für zusammenarbeit',  'open to collab', 'de'),
  ('terbuka untuk kolaborasi',  'open to collab', 'id'),
  ('sẵn sàng hợp tác',      'open to collab', 'vi')
) AS v(alias, canonical, language)
JOIN public.tag_concepts c ON c.canonical_name = v.canonical
ON CONFLICT (alias) DO NOTHING;

-- ── 3. Retro-link any existing orphan piktag_tags whose name matches a
--       curated alias (case-insensitive; only NULL concept_id, never
--       overrides). Drains a bit of the unlinked backlog for free. ──
UPDATE public.piktag_tags t
SET concept_id = a.concept_id
FROM public.tag_aliases a
WHERE lower(t.name) = lower(a.alias)
  AND t.concept_id IS NULL;

-- ── 4. Swap the official account's four showcase tags in place ────────
-- Detach old → find-or-create new → concept-link via resolve_tag_alias →
-- attach new at the freed position. usage_count changes are gated on
-- ROW_COUNT so re-running this migration does not drift the counts.
DO $$
DECLARE
  v_official  uuid := '00000000-0000-4000-a000-000000000001';
  -- (old tag name, new tag name, position)
  v_swaps     text[][] := ARRAY[
    ARRAY['GravelCycling', 'Foodie',       '4'],
    ARRAY['SideQuest',     'OpenToCollab', '6'],
    ARRAY['攝影',          'Pickleball',   '7'],
    ARRAY['咖啡',          'CoffeeChat',   '9']
  ];
  v_row       text[];
  v_old       text;
  v_new       text;
  v_pos       int;
  v_old_id    uuid;
  v_new_id    uuid;
  v_concept   uuid;
  v_affected  int;
BEGIN
  FOREACH v_row SLICE 1 IN ARRAY v_swaps LOOP
    v_old := v_row[1];
    v_new := v_row[2];
    v_pos := v_row[3]::int;

    -- Detach the old showcase tag from the official profile (if present).
    SELECT id INTO v_old_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_old) LIMIT 1;
    IF v_old_id IS NOT NULL THEN
      DELETE FROM public.piktag_user_tags
       WHERE user_id = v_official AND tag_id = v_old_id;
      GET DIAGNOSTICS v_affected = ROW_COUNT;
      IF v_affected > 0 THEN
        UPDATE public.piktag_tags
           SET usage_count = GREATEST(0, COALESCE(usage_count, 0) - 1)
         WHERE id = v_old_id;
      END IF;
    END IF;

    -- Find-or-create the new tag.
    SELECT id INTO v_new_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_new) LIMIT 1;
    IF v_new_id IS NULL THEN
      INSERT INTO public.piktag_tags (name) VALUES (v_new)
      RETURNING id INTO v_new_id;
    END IF;

    -- Ensure the new tag is concept-linked via the curated alias map
    -- (embedding-free — resolve_tag_alias is an exact case-insensitive
    -- match, works with the Gemini key down).
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
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected > 0 THEN
      UPDATE public.piktag_tags
         SET usage_count = COALESCE(usage_count, 0) + 1
       WHERE id = v_new_id;
    END IF;
  END LOOP;
END $$;
