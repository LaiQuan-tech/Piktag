-- 20260527_search_learning_loop.sql
--
-- Search Learning Loop: when AI extracts keywords from a natural-language
-- query and the user actually taps a result, record the mapping as a
-- tag_alias so future searches skip the AI call entirely.
--
-- Example: user searches "養貓的人" → AI extracts "貓" → user taps a
-- profile with tag "貓奴" → we learn "養貓" ≈ concept of "貓奴" and
-- save it as an alias. Next time someone searches "養貓", the regular
-- alias lookup finds it instantly — no AI needed.

-- Table to track search → click-through events for learning
CREATE TABLE IF NOT EXISTS public.piktag_search_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  extracted_keyword text NOT NULL,
  clicked_tag_id uuid REFERENCES public.piktag_tags(id) ON DELETE CASCADE,
  clicked_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  searcher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  converted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_learnings_keyword
  ON public.piktag_search_learnings (extracted_keyword);
CREATE INDEX IF NOT EXISTS idx_search_learnings_created
  ON public.piktag_search_learnings (created_at DESC);

ALTER TABLE public.piktag_search_learnings ENABLE ROW LEVEL SECURITY;

-- Only the searcher can insert their own learnings
DROP POLICY IF EXISTS "search_learnings_insert" ON public.piktag_search_learnings;
CREATE POLICY "search_learnings_insert" ON public.piktag_search_learnings
  FOR INSERT WITH CHECK (searcher_id = auth.uid());

-- Service role can read all (for the promotion job)
DROP POLICY IF EXISTS "search_learnings_select_service" ON public.piktag_search_learnings;
CREATE POLICY "search_learnings_select_service" ON public.piktag_search_learnings
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── Promotion RPC: auto-promote recurring search patterns to tag_aliases ──
-- When the same extracted_keyword → clicked_tag mapping appears 3+ times
-- from different users, it's a strong signal. Promote it to a tag_alias
-- so future searches find it via the regular alias path (no AI needed).

CREATE OR REPLACE FUNCTION public.promote_search_learnings()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promoted int := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      sl.extracted_keyword,
      sl.clicked_tag_id,
      t.concept_id,
      COUNT(DISTINCT sl.searcher_id) AS unique_searchers
    FROM piktag_search_learnings sl
    JOIN piktag_tags t ON t.id = sl.clicked_tag_id
    WHERE sl.clicked_tag_id IS NOT NULL
      AND sl.created_at > now() - interval '30 days'
      AND t.concept_id IS NOT NULL
    GROUP BY sl.extracted_keyword, sl.clicked_tag_id, t.concept_id
    HAVING COUNT(DISTINCT sl.searcher_id) >= 3
  LOOP
    -- Check if alias already exists
    IF NOT EXISTS (
      SELECT 1 FROM tag_aliases
      WHERE alias = rec.extracted_keyword
        AND concept_id = rec.concept_id
    ) THEN
      INSERT INTO tag_aliases (alias, concept_id)
      VALUES (rec.extracted_keyword, rec.concept_id)
      ON CONFLICT DO NOTHING;
      promoted := promoted + 1;
    END IF;
  END LOOP;

  RETURN promoted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_search_learnings() TO postgres, service_role;

-- Daily cron to promote learnings
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'promote-search-learnings-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END;
$$;

SELECT cron.schedule(
  'promote-search-learnings-daily',
  '30 18 * * *',
  $cron$ SELECT public.promote_search_learnings(); $cron$
);
