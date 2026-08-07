CREATE OR REPLACE FUNCTION count_event_sessions_by_day()
RETURNS TABLE(day text, sessions bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, storage AS $$
  WITH per_code AS (
    SELECT
      split_part(name, '/', 2) AS code,
      min(created_at) AT TIME ZONE 'Asia/Taipei' AS taken_tw
    FROM storage.objects
    WHERE bucket_id = 'event'
      AND name LIKE 'rotary/%/%'
    GROUP BY split_part(name, '/', 2)
  )
  SELECT
    to_char(date_trunc('day', taken_tw), 'Mon DD') AS day,
    count(*) AS sessions
  FROM per_code
  GROUP BY date_trunc('day', taken_tw)
  ORDER BY date_trunc('day', taken_tw);
$$;

GRANT EXECUTE ON FUNCTION count_event_sessions_by_day() TO service_role;
