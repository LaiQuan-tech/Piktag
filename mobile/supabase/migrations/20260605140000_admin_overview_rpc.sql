-- 20260605140000_admin_overview_rpc.sql
--
-- Founder 2026-06-06: "所有營運的資料,你要顯示都顯示在後台,不要亂搞
-- 使用者的app." Two parts:
--
-- (1) STOP the growth-pulse pushes (new signup / first connection) from
--     firing into a real user account's app. The DATA already lives in
--     piktag_profiles / piktag_connections — the backend dashboard reads
--     it directly, so the push triggers are pure app-pollution. Drop them.
--
-- (2) admin_overview() — ONE admin-gated RPC the off-app web dashboard
--     (landing /admin) calls to render every ops number: growth stats +
--     concept-graph health + concept merge candidates. SECURITY DEFINER so
--     it can internally call the postgres-only concept RPCs; gated by the
--     existing is_admin() (email in public.admins) and granted ONLY to
--     authenticated — a logged-in non-admin gets 42501, an anon gets
--     nothing. extensions on search_path for the pgvector path inside the
--     merge-candidate scan.

-- ── (1) remove growth-pulse app pushes ───────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_admin_new_signup ON public.piktag_profiles;
DROP TRIGGER IF EXISTS trg_notify_admin_first_connection ON public.piktag_connections;
DROP FUNCTION IF EXISTS public.notify_admin_new_signup();
DROP FUNCTION IF EXISTS public.notify_admin_first_connection();

-- ── (2) the single admin dashboard RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'growth', jsonb_build_object(
      'total_users',       (SELECT count(*) FROM public.piktag_profiles),
      'signups_24h',       (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '24 hours'),
      'signups_7d',        (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '7 days'),
      'signups_30d',       (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '30 days'),
      'onboarded_users',   (SELECT count(*) FROM public.piktag_profiles WHERE onboarding_completed = true),
      'total_connections', (SELECT count(*) FROM public.piktag_connections),
      'activated_users',   (SELECT count(DISTINCT user_id) FROM public.piktag_connections),
      'total_user_tags',   (SELECT count(*) FROM public.piktag_user_tags),
      'active_asks',       (SELECT count(*) FROM public.piktag_asks WHERE is_active = true AND expires_at > now())
    ),
    'concept_health', (SELECT to_jsonb(h) FROM public.admin_concept_graph_health() h),
    'merge_candidates', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY (c.similarity) DESC)
         FROM public.admin_report_concept_merge_candidates(0.85, 50) c),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_overview() TO authenticated;
