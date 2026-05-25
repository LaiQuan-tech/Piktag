-- 20260526010000_tag_search_count_ranking.sql
--
-- Adds a `search_count` counter to piktag_tags and a derived
-- `popularity_score` that blends "how many users have this tag on
-- their profile" (usage_count) with "how many committed searches
-- matched this tag" (search_count). The mobile SearchScreen orders
-- tag results by popularity_score so a tag people actively look for
-- rises ahead of one people merely self-attached.
--
-- Weighting: search_count counts double. Active intent-to-find is a
-- stronger ranking signal than passive self-tagging — someone typing
-- "designer" wants to be sent to designers TODAY, not the historical
-- pile. usage_count still carries weight so a brand-new tag with one
-- search doesn't outrank an established tag with hundreds of carriers.
--
-- Read-side behavior:
--   • The generated STORED column is updated on every UPDATE of its
--     dependencies. A hot row receiving an increment refreshes the
--     score atomically — no application-level recompute needed.
--   • An index on popularity_score DESC makes the
--     `.order('popularity_score').limit(N)` queries fast.
--
-- Write-side behavior:
--   • bump_tag_search_count(p_tag_ids uuid[]) is a SECURITY DEFINER
--     RPC the mobile client fires-and-forgets after a committed
--     search. It increments search_count for the top-N matched tags
--     in a single statement → one round-trip, one row-write per tag.
--
-- Why bigint, not integer:
--   • Even at a low rate (say 100 searches/day per tag for a long-
--     running popular tag), integer (~2.1B max) would last ~57k years
--     — overkill but cheap. bigint costs 4 extra bytes per row,
--     guarantees we never have to think about overflow.

ALTER TABLE public.piktag_tags
  ADD COLUMN IF NOT EXISTS search_count bigint NOT NULL DEFAULT 0;

-- Generated stored column. STORED (not VIRTUAL) so the value can be
-- indexed; we ORDER BY this on hot search queries.
ALTER TABLE public.piktag_tags
  ADD COLUMN IF NOT EXISTS popularity_score bigint
  GENERATED ALWAYS AS (
    COALESCE(usage_count, 0) + 2 * COALESCE(search_count, 0)
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_piktag_tags_popularity_score
  ON public.piktag_tags (popularity_score DESC);

-- Atomic increment helper. The client passes the top-N matched tag
-- IDs from a committed search; this single UPDATE bumps them all.
-- SECURITY DEFINER so the mobile JWT (authenticated role) can call it
-- without needing direct UPDATE rights on piktag_tags.
CREATE OR REPLACE FUNCTION public.bump_tag_search_count(p_tag_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.piktag_tags
  SET search_count = COALESCE(search_count, 0) + 1
  WHERE id = ANY(p_tag_ids);
$$;

REVOKE ALL ON FUNCTION public.bump_tag_search_count(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_tag_search_count(uuid[]) TO authenticated, service_role;
