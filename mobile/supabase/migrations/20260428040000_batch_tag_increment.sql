-- Batch tag usage_count increment.
--
-- Replaces per-tag `increment_tag_usage(tag_id)` round-trips when the
-- client adds multiple tags at once (review screens, bulk imports). One
-- UPDATE …WHERE id = ANY(p_tag_ids) is dramatically cheaper than N RPC
-- calls and stays atomic on the server.

CREATE OR REPLACE FUNCTION public.batch_tag_increment(
  p_tag_ids uuid[],
  p_delta   int DEFAULT 1
)
RETURNS TABLE (id uuid, usage_count int)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE piktag_tags
  SET usage_count = GREATEST(0, COALESCE(usage_count, 0) + p_delta)
  WHERE id = ANY(p_tag_ids)
  RETURNING id, usage_count;
$$;

GRANT EXECUTE ON FUNCTION public.batch_tag_increment(uuid[], int) TO authenticated;
