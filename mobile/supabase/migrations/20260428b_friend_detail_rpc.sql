-- FriendDetailScreen: collapse the 5-query above-the-fold fetch (profile +
-- their public tags + viewer connections + friend connections + viewer→friend
-- relation) into one round-trip. Mirrors the pattern from
-- 20260428_explore_users_rpc.sql.
--
-- Returns jsonb so the client can pull a single page-ready slice without
-- chasing N+1 lookups for mutual-friend counts or the friend/blocked flag.
--
-- SECURITY INVOKER — RLS still applies and auth.uid() resolves to the caller.

CREATE OR REPLACE FUNCTION public.get_friend_detail(
  p_friend_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_viewer          uuid := auth.uid();
  v_profile         jsonb;
  v_tags            jsonb;
  v_mutual_friends  int;
  v_relation        text;
  v_connections     jsonb;
BEGIN
  -- Profile (subset; full_name etc.). NULL if missing/blocked by RLS.
  SELECT jsonb_build_object(
    'id',          p.id,
    'username',    p.username,
    'full_name',   p.full_name,
    'avatar_url',  p.avatar_url,
    'bio',         p.bio,
    'headline',    p.headline,
    'is_verified', p.is_verified,
    'is_public',   p.is_public
  ) INTO v_profile
  FROM piktag_profiles p
  WHERE p.id = p_friend_id;

  -- Friend's public tags, capped at 30 (above-the-fold render only).
  WITH ft AS (
    SELECT t.id, t.name
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.user_id = p_friend_id
      AND ut.is_private = false
    ORDER BY ut.is_pinned DESC NULLS LAST, ut.position NULLS LAST, t.name
    LIMIT 30
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ft.id, 'name', ft.name)), '[]'::jsonb)
  INTO v_tags FROM ft;

  -- Mutual connections count (intersection of viewer & friend connection sets).
  SELECT COUNT(*) INTO v_mutual_friends
  FROM piktag_connections c1
  JOIN piktag_connections c2
    ON c1.connected_user_id = c2.connected_user_id
  WHERE c1.user_id = v_viewer
    AND c2.user_id = p_friend_id;

  -- Viewer → friend relation (friend / blocked / none).
  SELECT CASE
    WHEN v_viewer IS NULL THEN 'none'
    WHEN v_viewer = p_friend_id THEN 'self'
    WHEN EXISTS (
      SELECT 1 FROM piktag_blocks b
      WHERE (b.blocker_id = v_viewer AND b.blocked_id = p_friend_id)
         OR (b.blocker_id = p_friend_id AND b.blocked_id = v_viewer)
    ) THEN 'blocked'
    WHEN EXISTS (
      SELECT 1 FROM piktag_connections
      WHERE user_id = v_viewer AND connected_user_id = p_friend_id
    ) THEN 'friend'
    ELSE 'none'
  END
  INTO v_relation;

  -- Friend's recent public connection rows (capped). Useful for the
  -- "who they've met" section without a separate fetch.
  WITH fc AS (
    SELECT c.id, c.connected_user_id, c.created_at
    FROM piktag_connections c
    WHERE c.user_id = p_friend_id
    ORDER BY c.created_at DESC
    LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                 fc.id,
    'connected_user_id',  fc.connected_user_id,
    'created_at',         fc.created_at
  )), '[]'::jsonb)
  INTO v_connections FROM fc;

  RETURN jsonb_build_object(
    'profile',        v_profile,
    'tags',           v_tags,
    'mutual_friends', v_mutual_friends,
    'relation',       v_relation,
    'connections',    v_connections
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_detail(uuid) TO authenticated;
