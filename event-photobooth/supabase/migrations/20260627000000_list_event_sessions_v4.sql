-- v4: support variable-length sessions (1–5 photos per code).
-- Previously HAVING count(*) = 5 excluded single-background events.
-- Now accepts any completed session (>= 1 photo), and the org is a parameter
-- so the same function works for rotary, yongxin, and future events.

CREATE OR REPLACE FUNCTION list_event_sessions(
  p_org   text    DEFAULT 'rotary',
  p_limit int     DEFAULT 5000
)
RETURNS TABLE(code text, taken_at timestamptz, photo_count int)
LANGUAGE sql SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT
    split_part(name, '/', 2)        AS code,
    min(created_at)                 AS taken_at,
    count(*)::int                   AS photo_count
  FROM storage.objects
  WHERE bucket_id = 'event'
    AND name LIKE p_org || '/%/%'
  GROUP BY split_part(name, '/', 2)
  HAVING count(*) >= 1
  ORDER BY min(created_at) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION list_event_sessions(text, int) TO service_role;
