-- 20260605080000_get_my_removed_tag_names_rpc.sql
--
-- Principle #6 enforcement primitive: "AI shouldn't re-suggest a removed
-- tag." Returns the caller's own removed tag names (lowercased, distinct)
-- so the suggest-tags edge function can DETERMINISTICALLY drop them from
-- its output — an LLM "never suggest X" instruction is not reliable, a
-- post-filter is.
--
-- Sources included: 'self_unstag' (user removed the tag from their own
-- profile — strongest self-rejection) and 'ai_dismissed' (user explicitly
-- rejected an AI suggestion). 'friend_withdraw' is DELIBERATELY excluded:
-- that signal is "a friend retracted their endorsement of you" — a
-- different axis from "what should the AI suggest for your OWN profile",
-- and folding it in would suppress legitimate self-suggestions over
-- someone else's action.
--
-- SECURITY DEFINER + explicit auth.uid() filter → only ever the caller's
-- own removals, regardless of RLS shape on the join. authenticated-only.
-- Returns '{}' (never NULL) so callers can treat it as a plain array.

CREATE OR REPLACE FUNCTION public.get_my_removed_tag_names()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(t.name))), '{}')
  FROM public.piktag_tag_removals r
  JOIN public.piktag_tags t ON t.id = r.tag_id
  WHERE r.user_id = auth.uid()
    AND r.source IN ('self_unstag', 'ai_dismissed')
    AND t.name IS NOT NULL
    AND btrim(t.name) <> '';
$$;

REVOKE ALL ON FUNCTION public.get_my_removed_tag_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_removed_tag_names() TO authenticated, service_role;
