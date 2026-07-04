-- 20260703050000_admin_search_users_by_email.sql
--
-- Admin audit finding M3 (2026-07-04): the users-list search box
-- placeholder promises "username 或 email", but the API route only
-- ILIKEs piktag_profiles.username / full_name — email lives in
-- auth.users, which PostgREST doesn't expose. Pasting an email always
-- returned "找不到符合條件的用戶". The founder specifically needs email
-- lookup right now (a wave of faker-named gmail signups to identify).
--
-- Fix: a service-role-only RPC that resolves matching user ids from
-- auth.users by email, so the route can filter profiles by id when the
-- query looks like an email. SECURITY DEFINER because auth.users is not
-- readable by the anon/authenticated roles; locked to service_role.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.admin_search_user_ids_by_email(p_query text)
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE p_query IS NOT NULL
    AND btrim(p_query) <> ''
    AND u.email ILIKE '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%'
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.admin_search_user_ids_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_user_ids_by_email(text) TO postgres, service_role;
