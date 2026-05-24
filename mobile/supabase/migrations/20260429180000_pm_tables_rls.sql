-- =============================================================================
-- security(rls): close 6 publicly-accessible PM/dashboard tables
--
-- Supabase Security Advisor flagged: products, features, feedbacks,
-- versions, pipeline_logs, collaboration_logs all had RLS disabled.
-- That meant anyone with the project URL + the anon key (which is
-- bundled into every client) could read, write, and delete every row.
--
-- These tables are used by the admin Next.js dashboard (the
-- mission-control page reads features + versions via the browser
-- client; the API routes write via service-role). Service-role
-- bypasses RLS, so the API-route writes keep working. The browser
-- reads now require the user to be in the `admins` table.
--
-- Approach:
--   1. is_admin(uuid) helper (SECURITY DEFINER so it can read the
--      admins table inside RLS policies)
--   2. ENABLE ROW LEVEL SECURITY on each of the 6 tables
--   3. Single FOR ALL policy per table that restricts both read and
--      write to admins only
--
-- Idempotent. Service-role retains full access (bypasses RLS by
-- design — all admin API routes that use createAdminClient() keep
-- working without changes).
-- =============================================================================

-- 1. Reusable admin check.
-- SECURITY DEFINER so the policy can read public.admins even when the
-- caller is `authenticated` (which has no SELECT grant on admins by
-- default). search_path locked to public to prevent search_path
-- hijacking inside SECURITY DEFINER bodies.

CREATE OR REPLACE FUNCTION public.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins a
    JOIN auth.users u ON LOWER(u.email) = LOWER(a.email)
    WHERE u.id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- 2 + 3. Enable RLS + admin-only policy on each of the 6 tables.

ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.features            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.versions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_logs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_admin_all"            ON public.products;
DROP POLICY IF EXISTS "features_admin_all"            ON public.features;
DROP POLICY IF EXISTS "feedbacks_admin_all"           ON public.feedbacks;
DROP POLICY IF EXISTS "versions_admin_all"            ON public.versions;
DROP POLICY IF EXISTS "pipeline_logs_admin_all"       ON public.pipeline_logs;
DROP POLICY IF EXISTS "collaboration_logs_admin_all"  ON public.collaboration_logs;

CREATE POLICY "products_admin_all" ON public.products
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "features_admin_all" ON public.features
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "feedbacks_admin_all" ON public.feedbacks
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "versions_admin_all" ON public.versions
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "pipeline_logs_admin_all" ON public.pipeline_logs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "collaboration_logs_admin_all" ON public.collaboration_logs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
