-- 20260526030000_friend_of_friend_ids.sql
--
-- Returns the set of 2nd-degree user_ids (friend-of-friend) for the
-- calling user. Used by SearchScreen's ranking layer to boost search
-- results that are reachable through the viewer's network — a 2-hop
-- match is stronger leverage than a globally-popular stranger.
--
-- Why a SECURITY DEFINER RPC (not a client-side fan-out):
--   piktag_connections RLS restricts SELECT to rows where
--   user_id = auth.uid(). A client can see its OWN friends (1st-
--   degree) but NOT its friends' friends — those rows have a
--   different user_id. The DEFINER context lifts that and lets the
--   walk traverse 2 hops in one query.
--
-- What's filtered out:
--   • self (auth.uid())
--   • 1st-degree friends (already direct connections)
--   • blocked users (in either direction)
--
-- What's NOT applied (intentional, vs find_tag_similar_strangers):
--   • No tag-overlap scoring. This RPC just returns the ID set.
--     The caller (SearchScreen) ranks separately — we want every
--     FoF id available so the ranker can boost ANY search hit that
--     happens to be in the network, not just ones with shared tags.
--   • No discoverable_by_tag_similarity opt-out. That flag gates
--     who appears in the "you might know" recommendations surface,
--     not who's reachable via search-result boost. Different
--     product surface, different privacy rule.
--   • No LIMIT. The set should be small enough to ship to the
--     client (typical user has < 5000 FoF even with many friends);
--     a small array passes through PostgREST cheaply and avoids
--     a per-search round-trip.

CREATE OR REPLACE FUNCTION public.get_friend_of_friend_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  result uuid[];
BEGIN
  IF me IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c2.connected_user_id), ARRAY[]::uuid[])
    INTO result
  FROM public.piktag_connections c1
  JOIN public.piktag_connections c2 ON c2.user_id = c1.connected_user_id
  WHERE c1.user_id = me
    AND c2.connected_user_id <> me
    AND c2.connected_user_id NOT IN (
      SELECT connected_user_id FROM public.piktag_connections WHERE user_id = me
    )
    AND c2.connected_user_id NOT IN (
      SELECT blocked_id FROM public.piktag_blocks WHERE blocker_id = me
      UNION
      SELECT blocker_id FROM public.piktag_blocks WHERE blocked_id = me
    );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_friend_of_friend_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_of_friend_ids() TO authenticated, service_role;
