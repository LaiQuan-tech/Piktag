-- 20260530130000_piktag_search_impressions.sql
--
-- v3-vision pre-launch primitive #1: per-result search impression log.
--
-- WHY THIS EXISTS
-- The existing piktag_search_learnings (20260527020000) logs CLICKS
-- only. A click in rank position 1 vs rank position 7 are wildly
-- different signals — but without impression counts we cannot tell
-- them apart, so we cannot compute CTR per (concept, target,
-- rank_position). CTR is the load-bearing input for the eventual
-- Quality Score model that gates the v3 tag-auction (see CLAUDE.md
-- "v3 vision — Tag-auction monetization"). The auction itself is
-- NOT yet built; this log is what it'll consume when it lands.
--
-- POST-LAUNCH SCHEDULE
-- Once ≥500 impression events accrue (typically 30-90 days
-- post-launch), this table becomes the source for a rolled-up
-- `concept_user_quality` materialized view (v3 architectural change
-- #3 in CLAUDE.md) — daily refresh of (concept_id, user_id,
-- impressions, clicks, conversions, removals, dismissals, CTR,
-- conv_rate, neg_rate, quality_score). DO NOT add UPDATE/DELETE
-- policies — this log is immutable; service role prunes via cron
-- once the rollup exists.

CREATE TABLE IF NOT EXISTS public.piktag_search_impressions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  searcher_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL when the matched tag had no concept_id at impression time, OR
  -- when the row came from a name/headline/bio match without a concept
  -- link. ON DELETE SET NULL so concept GC (architectural change #1)
  -- doesn't cascade-wipe historical impression data.
  concept_id      uuid REFERENCES public.tag_concepts(id) ON DELETE SET NULL,
  query_text      text NOT NULL,
  -- 0-indexed position in the FINAL displayed list (after filters,
  -- friend/explore tab split, dedup). Same query can yield different
  -- positions across renders (refresh, late waves) — that's expected
  -- per-impression data, not noise.
  rank_position   int NOT NULL CHECK (rank_position >= 0),
  -- Leaves room for tag_detail / ask_match / etc. to feed the same
  -- rollup without schema churn. Default 'search' matches the only
  -- writer today (SearchScreen).
  surface         text NOT NULL DEFAULT 'search',
  shown_at        timestamptz NOT NULL DEFAULT now()
);

-- "How many times has this profile been shown?" — feeds per-target
-- Quality Score impression counts.
CREATE INDEX IF NOT EXISTS idx_search_impressions_target_shown
  ON public.piktag_search_impressions (target_user_id, shown_at DESC);

-- Per-concept demand telemetry: "which concepts are users searching
-- for?" Feeds concept-level CTR for the auction's per-concept reserve
-- price decision.
CREATE INDEX IF NOT EXISTS idx_search_impressions_concept_shown
  ON public.piktag_search_impressions (concept_id, shown_at DESC);

-- Searcher-side history: debugging + the potential "Who's been
-- searching for me?" reverse-query (not surfaced today).
CREATE INDEX IF NOT EXISTS idx_search_impressions_searcher_shown
  ON public.piktag_search_impressions (searcher_id, shown_at DESC);

-- NOTE: deliberately NO unique constraint. Same (searcher, target,
-- query) can legitimately impression multiple times — different
-- sessions, app refresh, scroll back to a previous result. The
-- rollup view will GROUP BY whatever dimension it needs.

ALTER TABLE public.piktag_search_impressions ENABLE ROW LEVEL SECURITY;

-- Clients may only log their own impressions. Server-side INSERTs
-- via service role bypass RLS.
DROP POLICY IF EXISTS "search_impressions_insert_own" ON public.piktag_search_impressions;
CREATE POLICY "search_impressions_insert_own" ON public.piktag_search_impressions
  FOR INSERT WITH CHECK (searcher_id = auth.uid());

-- Searcher can read their own log (debugging + future reverse-query
-- feature). No-one else can read it from the client.
DROP POLICY IF EXISTS "search_impressions_select_own" ON public.piktag_search_impressions;
CREATE POLICY "search_impressions_select_own" ON public.piktag_search_impressions
  FOR SELECT USING (searcher_id = auth.uid());

-- Service role full access for the rollup cron + admin analytics.
DROP POLICY IF EXISTS "search_impressions_service" ON public.piktag_search_impressions;
CREATE POLICY "search_impressions_service" ON public.piktag_search_impressions
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- Intentionally NO UPDATE / DELETE policies. The log is append-only;
-- service role can prune via cron once the rollup view consumes it.
