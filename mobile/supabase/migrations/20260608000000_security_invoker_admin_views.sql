-- 20260608000000_security_invoker_admin_views.sql
-- =============================================================================
-- Fix Supabase Security Advisor ERROR "Security Definer View" on 3 views
-- (founder 2026-06-08). These views were CREATE [OR REPLACE] VIEW with no
-- `security_invoker`, so they run with the VIEW OWNER's privileges (postgres)
-- and BYPASS row-level security. Worse, all three were GRANTed SELECT to
-- `authenticated`, so ANY logged-in user querying them got unfiltered,
-- cross-user OPS/analytics data. No client code queries them — they're
-- admin/analytics surfaces, which per the product rule ("營運資料只在後台")
-- belong to service-role only.
--
-- Two-part fix per view:
--   1. security_invoker = true  → the view runs as the CALLING role, so RLS on
--      the underlying tables applies. service_role (admin dashboard) bypasses
--      RLS as always, so admin still sees everything; clears the advisor error.
--   2. REVOKE from anon/authenticated + GRANT to service_role only → the app
--      can't read ops data at all (defense-in-depth on top of #1).
--
-- Idempotent: ALTER ... SET / REVOKE / GRANT are all safe to re-run.
--   • public.ask_tag_effectiveness     (20260527010000)
--   • public.search_recovery_failures  (20260524000000)
--   • public.tag_concept_link_health   (20260519010000)
-- =============================================================================

ALTER VIEW IF EXISTS public.ask_tag_effectiveness SET (security_invoker = true);
REVOKE ALL ON public.ask_tag_effectiveness FROM anon, authenticated;
GRANT SELECT ON public.ask_tag_effectiveness TO service_role;

ALTER VIEW IF EXISTS public.search_recovery_failures SET (security_invoker = true);
REVOKE ALL ON public.search_recovery_failures FROM anon, authenticated;
GRANT SELECT ON public.search_recovery_failures TO service_role;

ALTER VIEW IF EXISTS public.tag_concept_link_health SET (security_invoker = true);
REVOKE ALL ON public.tag_concept_link_health FROM anon, authenticated;
GRANT SELECT ON public.tag_concept_link_health TO service_role;
