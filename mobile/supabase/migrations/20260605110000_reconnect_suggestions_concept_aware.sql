-- 20260605110000_reconnect_suggestions_concept_aware.sql
--
-- Cross-language fix for the weekly reconnect magic moment.
--
-- find_reconnect_suggestions (latest def 20260513170000) computed tag
-- overlap with a LITERAL join: `th.tag_id = my.tag_id`. So a pair who
-- share a CONCEPT across language/wording (you #律師, them #法律 /
-- #lawyer) registered ZERO overlap and never surfaced — the exact
-- dormant-cross-language pair the product exists to reconnect.
--
-- FIX: overlap is now counted by CONCEPT KEY
-- (COALESCE(concept_id::text, 'tag:'||tag_id::text)) — a shared concept
-- counts once, whether the two sides wrote it the same way or not. An
-- unlinked tag falls back to its own 'tag:<id>' key, so it still only
-- matches an identical unlinked tag (no regression until the linker
-- assigns a concept). The ≥2 gate is now ≥2 distinct shared CONCEPTS.
--
-- Everything else preserved VERBATIM from 20260513170000:
--   * #variable_conflict use_column directive
--   * mutual-pair filter, last_msg / scored / ranked CTEs, the
--     tag_overlap × 1/(days_since+1) score, never-talked +0.5 bonus,
--     ≥60-day-or-never gate, top-1-per-user, RETURNS TABLE shape, grants.
-- shared_tag_names now carries ONE representative name per shared concept
-- (the recipient's own wording), so the notification title reads clean.

CREATE OR REPLACE FUNCTION public.find_reconnect_suggestions()
RETURNS TABLE (
  user_id uuid,
  friend_id uuid,
  shared_tag_names text[],
  days_since_message integer,
  friend_full_name text,
  friend_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH pairs AS (
    SELECT c1.user_id, c1.connected_user_id AS friend_id
    FROM public.piktag_connections c1
    WHERE EXISTS (
      SELECT 1 FROM public.piktag_connections c2
      WHERE c2.user_id = c1.connected_user_id
        AND c2.connected_user_id = c1.user_id
    )
  ),
  -- The recipient's tags, keyed by concept (fallback to a per-tag key
  -- for still-unlinked tags), carrying their own wording for display.
  my_concepts AS (
    SELECT p.user_id, p.friend_id,
      COALESCE(mt.concept_id::text, 'tag:' || mt.id::text) AS ckey,
      mt.name
    FROM pairs p
    JOIN public.piktag_user_tags mut ON mut.user_id = p.user_id
    JOIN public.piktag_tags mt ON mt.id = mut.tag_id
  ),
  -- The friend's tags, concept-keyed (names not needed).
  their_concepts AS (
    SELECT p.user_id, p.friend_id,
      COALESCE(tt.concept_id::text, 'tag:' || tt.id::text) AS ckey
    FROM pairs p
    JOIN public.piktag_user_tags tut ON tut.user_id = p.friend_id
    JOIN public.piktag_tags tt ON tt.id = tut.tag_id
  ),
  -- One row per (pair, shared concept) — concept present on BOTH sides.
  shared AS (
    SELECT DISTINCT ON (mc.user_id, mc.friend_id, mc.ckey)
      mc.user_id, mc.friend_id, mc.ckey, mc.name
    FROM my_concepts mc
    WHERE EXISTS (
      SELECT 1 FROM their_concepts tc
      WHERE tc.user_id = mc.user_id
        AND tc.friend_id = mc.friend_id
        AND tc.ckey = mc.ckey
    )
    ORDER BY mc.user_id, mc.friend_id, mc.ckey, mc.name
  ),
  overlap AS (
    SELECT s.user_id, s.friend_id,
      array_agg(s.name ORDER BY s.name) AS shared_tag_names,
      COUNT(*)::integer AS shared_tag_count
    FROM shared s
    GROUP BY s.user_id, s.friend_id
    HAVING COUNT(*) >= 2
  ),
  last_msg AS (
    SELECT
      LEAST(participant_a, participant_b)    AS a,
      GREATEST(participant_a, participant_b) AS b,
      MAX(last_message_at)                   AS ts
    FROM public.piktag_conversations
    GROUP BY 1, 2
  ),
  scored AS (
    SELECT o.user_id, o.friend_id, o.shared_tag_names, o.shared_tag_count,
      COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0)::numeric AS days_since,
      (
        o.shared_tag_count::numeric
        / (COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0) + 1)
        + CASE WHEN lm.ts IS NULL THEN 0.5 ELSE 0 END
      ) AS score
    FROM overlap o
    LEFT JOIN last_msg lm
      ON lm.a = LEAST(o.user_id, o.friend_id)
     AND lm.b = GREATEST(o.user_id, o.friend_id)
    WHERE lm.ts IS NULL OR lm.ts < now() - interval '60 days'
  ),
  ranked AS (
    SELECT s.*,
      ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC) AS rk
    FROM scored s
  )
  SELECT r.user_id, r.friend_id, r.shared_tag_names, r.days_since::integer,
    p.full_name, p.username
  FROM ranked r
  JOIN public.piktag_profiles p ON p.id = r.friend_id
  WHERE r.rk = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_reconnect_suggestions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_reconnect_suggestions() TO postgres, service_role;
