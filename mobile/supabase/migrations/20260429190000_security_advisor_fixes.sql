-- =============================================================================
-- security: clear remaining Supabase Security Advisor findings
--
-- ERRORs (2):
--   * piktag_api_usage_daily   — view runs with default (DEFINER) semantics
--   * piktag_api_usage_monthly — same
--   Both aggregate piktag_api_usage_log (which has RLS), so without
--   security_invoker the views silently bypass that RLS for any caller.
--
-- WARNs:
--   * 14 SECURITY DEFINER functions had no search_path pinned
--     → vulnerable to search_path hijacking via shadowed objects in
--     attacker-writable schemas. Pin to (public, pg_temp).
--   * admin_audit_log has RLS on but no policies → effectively
--     service-role-only (correct), but the advisor flags ambiguous
--     intent. Add an explicit deny-all to document the intent.
--
-- Idempotent.
-- =============================================================================

-- 1. Views: opt into security_invoker so view queries respect the
-- caller's RLS on piktag_api_usage_log (admin-only).

ALTER VIEW public.piktag_api_usage_daily   SET (security_invoker = true);
ALTER VIEW public.piktag_api_usage_monthly SET (security_invoker = true);

-- 2. SECURITY DEFINER functions: pin search_path. Using
-- ALTER FUNCTION (instead of redefining) preserves the body and
-- argument list — pure config change.

ALTER FUNCTION public.auto_confirm_email()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.check_invite_redeem_rate_limit(p_user uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.check_tag_trending()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.generate_invite_code()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_daily_recommendation(p_user_id uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_new_user()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.increment_scan_count(session_id uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.notify_mutual_follow()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.notify_new_follower()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.notify_shared_tag()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.recover_invite_quota()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.recover_invite_quota_rpc()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.redeem_invite_code(p_code text)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.resolve_pending_connections(p_new_user_id uuid, p_scan_session_id text)
  SET search_path = public, pg_temp;

-- 3. admin_audit_log: explicit deny-all policy so the "RLS on but no
-- policy" advisor warning clears. service-role still bypasses RLS, so
-- the server-side audit insert path is unaffected.

DROP POLICY IF EXISTS "admin_audit_log_no_user_access" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log_no_user_access" ON public.admin_audit_log
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
