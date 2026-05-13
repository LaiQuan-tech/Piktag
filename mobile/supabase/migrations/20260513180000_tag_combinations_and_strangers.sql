-- 20260513180000_tag_combinations_and_strangers.sql
--
-- Magic Moments #4 + #5 — both about turning the tag graph into
-- a connection-finding engine. Shipped together because they
-- share the same conceptual primitive: "tag co-occurrence in
-- the viewer's extended network".
--
-- #4 — TAG COMBINATION MINING (weekly digest cron)
--   For each user, find tag PAIRS that appear together on ≥2
--   friends in their 1st-degree network. Pairs are higher-signal
--   than single tags (#台北 alone is everyone; #台北 + #攝影 +
--   #咖啡 is "this specific kind of person").
--
--   Surface as a weekly notification:
--     "你朋友圈裡有 N 個人是 #台北 + #攝影 — 點開看是誰"
--
-- #5 — MUTUAL TAG STRANGERS (called on demand from SearchScreen)
--   Returns 2nd-degree users (friend-of-friend) whose tag set
--   most overlaps with the viewer's. Powered by per-user
--   discoverability opt-out (default ON, gated by a new column
--   so users can hide themselves from tag-similarity recs).
--
-- Both surface through existing notification + search infra;
-- no new mobile state needed beyond the SearchScreen empty-state
-- hookup (separate commit's UI change).

-- ── #5 prerequisite: opt-in column ─────────────────────────
-- Default TRUE so users start discoverable. A future settings
-- screen can flip it. Users who don't want to appear as "people
-- you might know" suggestions to strangers in their 2-hop
-- network simply UPDATE this to FALSE; the RPC below skips them.
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS discoverable_by_tag_similarity boolean
    NOT NULL DEFAULT true;

-- ── #4: find_tag_combinations() ────────────────────────────
-- Per-user top tag pairs from their 1st-degree friends.
-- Strategy:
--   1. For each user, list every (friend, tag) edge in their
--      network.
--   2. Self-join to get (friend, tag_a, tag_b) triples where
--      tag_a < tag_b (avoid double-counting the same pair).
--   3. Aggregate: how many DISTINCT friends share each tag_a +
--      tag_b combination?
--   4. Pick the TOP pair per user (highest match count, tiebreak
--      lexicographic) — one weekly notification at most.
--
-- Caveats:
--   • Pairs are noisy if both tags are very common (#台北 +
--     #攝影 might just mean "everyone in Taipei who takes
--     photos"). We mitigate with the ≥2-friend threshold AND
--     by ranking by COUNT — but at user scale ~50 this is
--     still rough. Worth tuning when there's real data to
--     observe.
--   • Skips combos that match the viewer's own tags entirely
--     (they already know "I like this stuff"; surface only
--     pairs they DON'T self-identify with — those are the
--     discoveries).
CREATE OR REPLACE FUNCTION public.find_tag_combinations()
RETURNS TABLE (
  user_id uuid,
  tag_a_name text,
  tag_b_name text,
  match_count integer,
  sample_friend_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  -- Every (viewer, friend) connection.
  friends AS (
    SELECT c.user_id AS viewer_id, c.connected_user_id AS friend_id
    FROM public.piktag_connections c
  ),
  -- Every (viewer, friend, tag) edge.
  friend_tags AS (
    SELECT f.viewer_id, f.friend_id, ut.tag_id
    FROM friends f
    JOIN public.piktag_user_tags ut ON ut.user_id = f.friend_id
  ),
  -- Pair-up: for each viewer + friend, join their own tags to
  -- themselves with tag_id_a < tag_id_b. Gives all unordered
  -- tag pairs that one friend carries.
  friend_pairs AS (
    SELECT ft1.viewer_id, ft1.friend_id, ft1.tag_id AS tag_a, ft2.tag_id AS tag_b
    FROM friend_tags ft1
    JOIN friend_tags ft2
      ON ft1.viewer_id = ft2.viewer_id
     AND ft1.friend_id = ft2.friend_id
     AND ft1.tag_id < ft2.tag_id
  ),
  -- The viewer's own tags (to filter out self-overlapping pairs).
  viewer_tags AS (
    SELECT ut.user_id AS viewer_id, ut.tag_id
    FROM public.piktag_user_tags ut
  ),
  -- Aggregate per (viewer, tag_a, tag_b): how many distinct
  -- friends carry this pair? Plus pull sample names for the
  -- notification preview.
  combos AS (
    SELECT
      fp.viewer_id,
      fp.tag_a,
      fp.tag_b,
      COUNT(DISTINCT fp.friend_id)::integer AS match_count,
      array_agg(DISTINCT COALESCE(p.full_name, p.username) ORDER BY COALESCE(p.full_name, p.username))
        FILTER (WHERE COALESCE(p.full_name, p.username) IS NOT NULL) AS friend_names
    FROM friend_pairs fp
    JOIN public.piktag_profiles p ON p.id = fp.friend_id
    GROUP BY fp.viewer_id, fp.tag_a, fp.tag_b
    HAVING COUNT(DISTINCT fp.friend_id) >= 2
  ),
  -- Drop combos where BOTH tags overlap the viewer's own
  -- profile (already self-identified; not a discovery).
  novel_combos AS (
    SELECT c.*
    FROM combos c
    WHERE NOT EXISTS (
      SELECT 1 FROM viewer_tags vt1
      WHERE vt1.viewer_id = c.viewer_id AND vt1.tag_id = c.tag_a
    )
    OR NOT EXISTS (
      SELECT 1 FROM viewer_tags vt2
      WHERE vt2.viewer_id = c.viewer_id AND vt2.tag_id = c.tag_b
    )
  ),
  -- Rank per viewer; pick #1.
  ranked AS (
    SELECT nc.*,
      ROW_NUMBER() OVER (
        PARTITION BY nc.viewer_id
        ORDER BY nc.match_count DESC, nc.tag_a, nc.tag_b
      ) AS rk
    FROM novel_combos nc
  )
  SELECT
    r.viewer_id, ta.name, tb.name, r.match_count,
    (r.friend_names)[1:3]
  FROM ranked r
  JOIN public.piktag_tags ta ON ta.id = r.tag_a
  JOIN public.piktag_tags tb ON tb.id = r.tag_b
  WHERE r.rk = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_tag_combinations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_tag_combinations() TO postgres, service_role;

-- ── #5: find_tag_similar_strangers() ────────────────────────
-- Called from the mobile SearchScreen's empty-state — surfaces
-- 2-degree users whose tag set most overlaps with the viewer's
-- own. The result is "people you might know" but driven by
-- TAG match, not by mutual friends.
--
-- Returns top N (default 10) candidates ranked by tag overlap
-- count. Filters out:
--   • self
--   • 1st-degree friends (already connected)
--   • blocked users (in either direction)
--   • users with discoverable_by_tag_similarity = FALSE
--
-- All strangers are 2nd-degree — never surfaces total strangers
-- with no shared network at all. That preserves "you might know"
-- semantics vs. spammy random recs.
CREATE OR REPLACE FUNCTION public.find_tag_similar_strangers(p_limit int DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  username text,
  full_name text,
  avatar_url text,
  shared_tag_count integer,
  shared_tag_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH
  my_tags AS (
    SELECT ut.tag_id FROM public.piktag_user_tags ut WHERE ut.user_id = me
  ),
  friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM public.piktag_connections c WHERE c.user_id = me
  ),
  -- 2nd degree only: friend-of-friend, not me, not 1st degree.
  candidates AS (
    SELECT DISTINCT c2.connected_user_id AS uid
    FROM friends_1 f1
    JOIN public.piktag_connections c2 ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> me
      AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM public.piktag_blocks WHERE blocker_id = me
    UNION
    SELECT blocker_id AS uid FROM public.piktag_blocks WHERE blocked_id = me
  ),
  scored AS (
    SELECT
      cand.uid,
      COUNT(DISTINCT ut.tag_id)::integer AS shared_count,
      array_agg(DISTINCT t.name ORDER BY t.name) AS shared_names
    FROM candidates cand
    JOIN public.piktag_user_tags ut ON ut.user_id = cand.uid
    JOIN my_tags mt ON mt.tag_id = ut.tag_id
    JOIN public.piktag_tags t ON t.id = ut.tag_id
    WHERE cand.uid NOT IN (SELECT uid FROM blocked)
    GROUP BY cand.uid
    HAVING COUNT(DISTINCT ut.tag_id) >= 2
  )
  SELECT
    s.uid, p.username, p.full_name, p.avatar_url,
    s.shared_count, s.shared_names
  FROM scored s
  JOIN public.piktag_profiles p ON p.id = s.uid
  WHERE p.discoverable_by_tag_similarity = true
  ORDER BY s.shared_count DESC, s.uid
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.find_tag_similar_strangers(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_tag_similar_strangers(int) TO authenticated;
