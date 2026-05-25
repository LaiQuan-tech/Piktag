-- 20260508140000_popular_tags_near_location.sql
--
-- "What are other PikTag users tagging around this location lately?"
--
-- Used by AddTagScreen's AI suggestion flow: when the user is at the
-- Las Vegas Convention Center during CES, this RPC surfaces tags
-- like #CES2026 / #tech / #robotics that other hosts there have
-- recently put on their scan sessions. Those become AI grounding
-- so the LLM can confidently suggest event-specific tags instead of
-- making them up.
--
-- Approach: match `event_location` text. Lenient ILIKE wildcards on
-- the largest non-trivial token of the input string so "Las Vegas
-- Convention Center" still matches a session tagged "Las Vegas"
-- (and vice-versa). Aggregates event_tags across the matching
-- sessions in the last 90 days.
--
-- Why not geo (lat/lng): piktag_scan_sessions doesn't store
-- coordinates — the host's `event_location` is whatever
-- reverseGeocodeAsync returned at that moment, which is text. A
-- proper geo radius lookup would require adding lat/lng to the
-- schema and back-filling 60-90 days of history; the text-match
-- ILIKE gives us ~80% of the value with zero schema change.
-- Upgrade path: once we add lat/lng columns, swap the inside of
-- this function and the call surface stays identical.

CREATE OR REPLACE FUNCTION public.popular_tags_near_location(
  p_location text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  name text,
  usage_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_token text;
  v_min_len constant integer := 3;  -- "NY", "LA" too short to be unique
BEGIN
  IF p_location IS NULL OR trim(p_location) = '' THEN
    RETURN;
  END IF;

  -- Pick the longest non-trivial token in the location string. For
  -- "Las Vegas Convention Center" → "Convention" (or "Vegas", same
  -- effective ILIKE match because the input is multi-word). For
  -- "Da'an District" → "District". For "Taipei" → "Taipei".
  --
  -- Splitting + picking the LONGEST token avoids the case where the
  -- whole 3-word string ILIKE-matches almost nothing (a session
  -- tagged just "Las Vegas" wouldn't match "Las Vegas Convention
  -- Center" with a single ILIKE on the full string).
  SELECT word INTO v_token
  FROM unnest(string_to_array(p_location, ' ')) AS word
  WHERE length(word) >= v_min_len
  ORDER BY length(word) DESC
  LIMIT 1;

  IF v_token IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH unnested AS (
    SELECT unnest(s.event_tags) AS tag
    FROM piktag_scan_sessions s
    WHERE s.event_location ILIKE '%' || v_token || '%'
      AND s.event_tags IS NOT NULL
      AND array_length(s.event_tags, 1) > 0
      AND s.created_at > now() - interval '90 days'
  )
  SELECT
    trim(both '#' FROM trim(tag)) AS name,
    count(*)::bigint AS usage_count
  FROM unnested
  WHERE tag IS NOT NULL AND trim(tag) <> ''
  GROUP BY 1
  ORDER BY usage_count DESC, name ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.popular_tags_near_location(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_tags_near_location(text, integer) TO authenticated, anon;
