-- 20260525010000_seed_real_estate_concept.sql
--
-- Hand-seed the "Real Estate / 不動產" concept + aliases.
--
-- WHY this is hand-seeded instead of left for auto-link-concepts:
-- the founder hit a launch query "我要找賣房子的朋友" that should
-- have surfaced a local-contact tagged "商用不動產", but Gemini's
-- extracted keywords ("賣房子", "real estate", "房地產", "房子") all
-- have zero substring overlap with the canonical "商用不動產" name.
-- The recovery client's name-ILIKE pass therefore misses, and the
-- L1829 private-world effect's `.overlaps('tags', allTagNames)`
-- short-circuits on empty allTagNames — the contact stays hidden.
--
-- The proper bridge is concept membership: every CJK / English /
-- Japanese way of saying "real estate" should resolve to the SAME
-- concept_id, and the canonical "商用不動產" tag should be linked
-- to that concept. The 20260525000000_local_contact_tag_promotion
-- migration promoted "商用不動產" to canonical but auto-link was
-- backlogged (its 5-min cron was lock-stuck for unrelated reasons),
-- so this migration explicitly seeds the bridge.
--
-- Companion client change (commit 268d5be0): the recovery's new
-- Pass B does ILIKE on tag_aliases.alias + expands to all tags
-- sharing the matched concept_id, so once these aliases exist any
-- of "賣房子", "房地產", "real estate" produces the chip + drives
-- the contact effect that surfaces the local contact.
--
-- Idempotent. CTE captures the concept id whether the row already
-- existed or was just inserted, then all alias rows use ON CONFLICT
-- DO NOTHING. Safe to re-run.

WITH concept_row AS (
  INSERT INTO public.tag_concepts (canonical_name, semantic_type)
  VALUES ('不動產', 'profession_industry')
  ON CONFLICT (canonical_name) DO UPDATE SET canonical_name = EXCLUDED.canonical_name
  RETURNING id
),
linked AS (
  UPDATE public.piktag_tags
  SET concept_id = (SELECT id FROM concept_row)
  WHERE name = '商用不動產'
    AND (concept_id IS NULL OR concept_id <> (SELECT id FROM concept_row))
  RETURNING id
)
INSERT INTO public.tag_aliases (alias, concept_id, language)
SELECT alias, (SELECT id FROM concept_row), language
FROM (VALUES
  ('不動產',        'zh-TW'),
  ('商用不動產',    'zh-TW'),
  ('房地產',        'zh-TW'),
  ('房屋',          'zh-TW'),
  ('房子',          'zh-TW'),
  ('賣房子',        'zh-TW'),
  ('買房子',        'zh-TW'),
  ('房仲',          'zh-TW'),
  ('房屋仲介',      'zh-TW'),
  ('地產',          'zh-TW'),
  ('Real Estate',   'en'),
  ('Real estate',   'en'),
  ('real estate',   'en'),
  ('Property',      'en'),
  ('property',      'en'),
  ('Realtor',       'en'),
  ('不動産',        'ja')
) AS v(alias, language)
ON CONFLICT (alias) DO NOTHING;
