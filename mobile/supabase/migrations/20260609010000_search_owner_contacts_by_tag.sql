-- 20260609010000_search_owner_contacts_by_tag.sql
-- =============================================================================
-- Case-insensitive search of the OWNER'S OWN local contacts by tag string
-- (founder 2026-06-09, "英文是主戰場"). piktag_local_contacts.tags is a
-- text[] of plain strings; PostgREST array operators (overlaps/contains) are
-- case-SENSITIVE exact, so typing "remittance" missed a contact tagged
-- "Remittance". This RPC matches each contact tag against the supplied terms
-- with lower()=lower() (true case-insensitive equality, no LIKE wildcard
-- hazard), so English case-variants resolve. CJK is unaffected (lower() is a
-- no-op there).
--
-- SECURITY INVOKER (default): the function runs with the CALLER's privileges,
-- so the existing piktag_local_contacts RLS ("owner FOR ALL") scopes results
-- to the caller's own contacts automatically — no privilege escalation, stays
-- owner-private. No DEFINER, no auth.uid() filter needed (RLS does it).
--
-- search_path pinned per project standard (clears the function_search_path
-- lint). No pgvector here, but public,extensions is harmless + consistent.
-- Idempotent (CREATE OR REPLACE + idempotent REVOKE/GRANT).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_owner_contacts_by_tag(
  p_terms text[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE(id uuid, name text, avatar_url text)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT lc.id, lc.name, lc.avatar_url
  FROM public.piktag_local_contacts lc
  WHERE p_terms IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM unnest(lc.tags) AS t(val)
      JOIN unnest(p_terms) AS q(term) ON lower(t.val) = lower(q.term)
    )
  LIMIT GREATEST(COALESCE(p_limit, 200), 1);
$$;

-- Client RPC: callable by authenticated users (RLS owner-scopes inside).
-- anon would get nothing useful (auth.uid() NULL → RLS returns no rows) but
-- revoke anyway to keep the surface tight.
REVOKE EXECUTE ON FUNCTION public.search_owner_contacts_by_tag(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_owner_contacts_by_tag(text[], integer) TO authenticated;
