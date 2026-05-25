-- 20260526020000_tag_alias_locale_overrides.sql
--
-- Locale-aware alias routing. Some aliases mean different things in
-- different locales — the global-default `tag_aliases` map can't
-- express this, so we layer a tiny override table on top.
--
-- The canonical motivating case: "聖母" / "圣母".
--   • Globally: Christian "Virgin Mary" (~2.4B Christians worldwide).
--   • zh-TW Taiwan colloquial: very commonly Mazu (天上聖母 is her
--     formal title, often shortened to 聖母 in everyday speech).
-- The Mazu+Mary seed (20260524050000) acknowledged this in a comment
-- and deferred the actual routing to a future migration — this one.
--
-- Design:
--   • New table `tag_alias_locale_overrides (alias, locale, concept_id)`
--     with PK (alias, locale). One row per (alias, locale) pair.
--   • Client queries this table IN PARALLEL with `tag_aliases` using
--     the viewer's i18n locale. Hits front-load in the result merge
--     — they appear ABOVE direct name matches AND above the global-
--     default alias matches.
--   • Strict locale match (no fallback to base 'zh', no '*'). Keep it
--     simple; the override list will stay small and curated.
--   • RLS: public-read for authenticated (so SearchScreen can query
--     directly), service_role for writes (manual SQL Editor seed work).

CREATE TABLE IF NOT EXISTS public.tag_alias_locale_overrides (
  alias       text  NOT NULL,
  locale      text  NOT NULL,
  concept_id  uuid  NOT NULL REFERENCES public.tag_concepts(id) ON DELETE CASCADE,
  -- Future: a `priority smallint` if we ever need multiple overrides
  -- per (alias, locale). For now PK is the dedup; one override per pair.
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alias, locale)
);

CREATE INDEX IF NOT EXISTS idx_tag_alias_locale_overrides_alias
  ON public.tag_alias_locale_overrides (alias, locale);

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.tag_alias_locale_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alias_locale_overrides_read ON public.tag_alias_locale_overrides;
CREATE POLICY alias_locale_overrides_read ON public.tag_alias_locale_overrides
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS alias_locale_overrides_write ON public.tag_alias_locale_overrides;
CREATE POLICY alias_locale_overrides_write ON public.tag_alias_locale_overrides
  FOR ALL
  TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── Seed: zh-TW colloquial 聖母 → Mazu ─────────────────────────
-- Look up the canonical Mazu concept (created in 20260524050000).
-- Use a DO block so the seed is conditional on the concept existing.
-- Mary remains the global default in tag_aliases — this just gives
-- zh-TW Taiwan users a contextually-correct alternative when they
-- type "聖母" alone.
DO $$
DECLARE
  v_mazu_id uuid;
BEGIN
  SELECT concept_id INTO v_mazu_id
    FROM public.tag_aliases
    WHERE alias = '媽祖'
    LIMIT 1;

  IF v_mazu_id IS NULL THEN
    RAISE NOTICE 'Mazu concept not found — apply 20260524050000 first.';
    RETURN;
  END IF;

  INSERT INTO public.tag_alias_locale_overrides (alias, locale, concept_id) VALUES
    ('聖母', 'zh-TW', v_mazu_id),
    ('圣母', 'zh-TW', v_mazu_id)
  ON CONFLICT (alias, locale) DO NOTHING;

  RAISE NOTICE 'Seeded zh-TW 聖母/圣母 → Mazu (concept_id %)', v_mazu_id;
END $$;
