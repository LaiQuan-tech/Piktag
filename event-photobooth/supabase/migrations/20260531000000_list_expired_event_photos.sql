-- Helper for the delete-old-photos Edge Function.
--
-- supabase-js (Deno) won't let the client touch the `storage` schema
-- directly, even with the service_role key — every query routes through
-- PostgREST which only exposes whitelisted schemas. Wrap the query in a
-- SECURITY DEFINER function in the `public` schema instead.
--
-- The function only RETURNS names; it doesn't delete. Actual deletion still
-- goes through the Storage API in the Edge Function so the bytes (not just
-- the metadata row) get cleaned up properly.

CREATE OR REPLACE FUNCTION public.list_expired_event_photos(
  retention_days int DEFAULT 30,
  batch_limit int DEFAULT 500
) RETURNS TABLE(name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT name
  FROM storage.objects
  WHERE bucket_id = 'event'
    AND created_at < (NOW() - make_interval(days => retention_days))
  ORDER BY created_at ASC
  LIMIT batch_limit;
$$;

REVOKE ALL ON FUNCTION public.list_expired_event_photos(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_expired_event_photos(int, int) TO service_role;
