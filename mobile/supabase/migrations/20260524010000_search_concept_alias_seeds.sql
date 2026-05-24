-- 20260524010000_search_concept_alias_seeds.sql
--
-- Seed common cross-language alias variants based on the patterns
-- Gemini produced consistently across our 19-locale extraction test.
-- These aliases let `resolve_tag_alias()` find the right concept
-- BEFORE the extract-search-intent edge function has to run —
-- saving the LLM call, latency, and cost on common queries like
-- "我要找會日文的朋友" → 日文 → resolves to the 日本語 concept.
--
-- Each row attaches a new alias to an EXISTING concept, identified
-- by an anchor — the canonical alias that auto-link-concepts (or an
-- earlier seed) already attached. If the anchor isn't in the DB on
-- this project, the row is silently skipped via the LATERAL join's
-- empty return + ON CONFLICT DO NOTHING — safe to re-run on any
-- environment.
--
-- Pattern is intentionally narrow: variants we have CONFIRMED
-- semantically equivalent through testing. Speculative additions
-- should come from the search_recovery_failures view (see the
-- companion telemetry migration), not from guessing.

INSERT INTO public.tag_aliases (alias, concept_id)
SELECT DISTINCT v.alias, ta.concept_id
FROM (VALUES
  -- ── Japanese language concept(anchor: 日本語) ──
  ('日文',        '日本語'),
  ('Japanese',    '日本語'),
  ('日語',        '日本語'),
  ('にほんご',    '日本語'),
  ('일본어',      '日本語'),
  ('ภาษาญี่ปุ่น', '日本語'),

  -- ── Rotary Club concept(anchor: 扶輪社) ──
  ('Rotary',       '扶輪社'),
  ('Rotary Club',  '扶輪社'),
  ('ロータリー',   '扶輪社'),
  ('ロータリークラブ', '扶輪社'),

  -- ── Photographer concept(anchor: 攝影 — common zh-TW tag) ──
  -- "photography" the activity and "photographer" the role are
  -- conventionally one concept for matching purposes here.
  ('photographer',     '攝影'),
  ('photography',      '攝影'),
  ('攝影師',           '攝影'),
  ('攝影家',           '攝影'),
  ('fotógrafo',        '攝影'),
  ('fotografo',        '攝影'),
  ('fotograf',         '攝影'),
  ('fotoğrafçı',       '攝影'),
  ('fotografer',       '攝影'),
  ('photographe',      '攝影'),
  ('フォトグラファー', '攝影'),
  ('写真家',           '攝影'),
  ('사진가',           '攝影'),
  ('मُصور',            '攝影'),
  ('مصور',             '攝影'),
  ('ফটোগ্রাফার',       '攝影'),
  ('nhiếp ảnh gia',    '攝影')
) AS v(alias, anchor)
CROSS JOIN LATERAL (
  SELECT concept_id
  FROM public.tag_aliases
  WHERE alias = v.anchor
  LIMIT 1
) ta
WHERE v.alias IS NOT NULL
ON CONFLICT (alias) DO NOTHING;
