-- Filter to only complete sessions (5 photos uploaded successfully).
CREATE OR REPLACE FUNCTION list_event_sessions(p_limit int DEFAULT 5000)
RETURNS TABLE(code text, taken_at timestamptz, photo_count int)
LANGUAGE sql SECURITY DEFINER SET search_path = public, storage AS $$
  SELECT
    split_part(name, '/', 2) AS code,
    min(created_at)           AS taken_at,
    count(*)::int             AS photo_count
  FROM storage.objects
  WHERE bucket_id = 'event'
    AND name LIKE 'rotary/%/%'
  GROUP BY split_part(name, '/', 2)
  HAVING count(*) = 5
  ORDER BY min(created_at) DESC
  LIMIT p_limit;
$$;
