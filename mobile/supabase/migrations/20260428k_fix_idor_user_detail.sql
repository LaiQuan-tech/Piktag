-- SECURITY FIX: IDOR in get_user_detail / get_similar_users.
--
-- Original definitions (20260425_user_detail_rpc.sql) accepted a
-- client-supplied `viewer_id uuid` parameter and used it directly to
-- compute follow / connection / close-friend / my-tag state.
--
-- Because both RPCs are SECURITY INVOKER granted to `authenticated`,
-- any signed-in user could call them with someone else's UUID as
-- `viewer_id` and read that other user's relationship state to a
-- target — e.g. "is Alice following Bob?", "is Bob in Alice's close
-- friends?", "what are Alice's private-but-shared tags with Bob?".
-- That's a textbook IDOR (Insecure Direct Object Reference).
--
-- Fix: drop the `viewer_id` parameter entirely from both functions
-- and derive it from `auth.uid()` inside the function body. Anonymous
-- callers (auth.uid() IS NULL) are rejected with an exception so the
-- functions are not callable without a session.

-- Drop the old (uuid, uuid) and (uuid, uuid, int) signatures so we
-- can change the parameter list cleanly. CREATE OR REPLACE cannot
-- remove a parameter from an existing function.
DROP FUNCTION IF EXISTS public.get_user_detail(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_similar_users(uuid, uuid, int);

CREATE OR REPLACE FUNCTION public.get_user_detail(
  target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  viewer_id           uuid := auth.uid();
  v_profile           jsonb;
  v_biolinks          jsonb;
  v_their_tags        jsonb;
  v_my_tag_ids        uuid[];
  v_follower_count    int;
  v_is_following      boolean;
  v_connection_id     uuid;
  v_is_close_friend   boolean;
  v_mutual_friends    int;
  v_mutual_tag_ids    uuid[];
  v_pick_counts       jsonb;
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'get_user_detail requires an authenticated session'
      USING ERRCODE = '28000';
  END IF;

  -- Profile
  SELECT to_jsonb(p.*) INTO v_profile
  FROM piktag_profiles p WHERE p.id = target_user_id;

  -- Biolinks (active only, ordered)
  SELECT COALESCE(jsonb_agg(b ORDER BY b.position), '[]'::jsonb) INTO v_biolinks
  FROM piktag_biolinks b
  WHERE b.user_id = target_user_id AND b.is_active = true;

  -- Their public user_tags with the joined tag row
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         ut.id,
        'tag_id',     ut.tag_id,
        'position',   ut.position,
        'is_pinned',  ut.is_pinned,
        'is_private', ut.is_private,
        'tag',        to_jsonb(t.*)
      )
    ),
    '[]'::jsonb
  ) INTO v_their_tags
  FROM piktag_user_tags ut
  LEFT JOIN piktag_tags t ON t.id = ut.tag_id
  WHERE ut.user_id = target_user_id AND ut.is_private = false;

  -- My public tag IDs (for mutual-tag calc client-side)
  SELECT COALESCE(array_agg(tag_id), ARRAY[]::uuid[]) INTO v_my_tag_ids
  FROM piktag_user_tags
  WHERE user_id = viewer_id AND is_private = false;

  -- Follower count (people following target_user_id)
  SELECT COUNT(*) INTO v_follower_count
  FROM piktag_follows WHERE following_id = target_user_id;

  -- Am I following them?
  SELECT EXISTS(
    SELECT 1 FROM piktag_follows
    WHERE follower_id = viewer_id AND following_id = target_user_id
  ) INTO v_is_following;

  -- Existing connection (viewer → target). Optional row.
  SELECT id INTO v_connection_id
  FROM piktag_connections
  WHERE user_id = viewer_id AND connected_user_id = target_user_id
  LIMIT 1;

  -- Close-friend flag
  SELECT EXISTS(
    SELECT 1 FROM piktag_close_friends
    WHERE user_id = viewer_id AND close_friend_id = target_user_id
  ) INTO v_is_close_friend;

  -- Mutual friends count (intersection of our connection lists)
  SELECT COUNT(*) INTO v_mutual_friends
  FROM piktag_connections c1
  JOIN piktag_connections c2
    ON c1.connected_user_id = c2.connected_user_id
  WHERE c1.user_id = viewer_id
    AND c2.user_id = target_user_id;

  -- Mutual tag IDs (intersection — client joins to names it already has)
  SELECT COALESCE(array_agg(DISTINCT ut.tag_id), ARRAY[]::uuid[]) INTO v_mutual_tag_ids
  FROM piktag_user_tags ut
  WHERE ut.user_id = target_user_id
    AND ut.is_private = false
    AND ut.tag_id = ANY(v_my_tag_ids);

  -- Pick-count map: for each of target's tags, how many public
  -- connection_tags reference it.
  SELECT COALESCE(
    jsonb_object_agg(tag_id::text, cnt),
    '{}'::jsonb
  ) INTO v_pick_counts
  FROM (
    SELECT ct.tag_id, COUNT(*) AS cnt
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE c.connected_user_id = target_user_id
      AND ct.is_private = false
      AND ct.tag_id IN (SELECT tag_id FROM piktag_user_tags WHERE user_id = target_user_id AND is_private = false)
    GROUP BY ct.tag_id
  ) counts;

  RETURN jsonb_build_object(
    'profile',         v_profile,
    'biolinks',        v_biolinks,
    'their_tags',      v_their_tags,
    'my_tag_ids',      to_jsonb(v_my_tag_ids),
    'follower_count',  v_follower_count,
    'is_following',    v_is_following,
    'connection_id',   v_connection_id,
    'is_close_friend', v_is_close_friend,
    'mutual_friends',  v_mutual_friends,
    'mutual_tag_ids',  to_jsonb(v_mutual_tag_ids),
    'pick_counts',     v_pick_counts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_detail(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_similar_users(
  target_user_id uuid,
  max_results int DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  viewer_id         uuid := auth.uid();
  v_users           jsonb;
  v_mutuals_map     jsonb;
  v_user_ids        uuid[];
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'get_similar_users requires an authenticated session'
      USING ERRCODE = '28000';
  END IF;

  WITH target_tags AS (
    SELECT tag_id
    FROM piktag_user_tags
    WHERE user_id = target_user_id AND is_private = false
  ),
  candidates AS (
    SELECT DISTINCT ut.user_id
    FROM piktag_user_tags ut
    JOIN target_tags tt ON tt.tag_id = ut.tag_id
    WHERE ut.is_private = false
      AND ut.user_id <> target_user_id
      AND ut.user_id <> viewer_id
  ),
  picked AS (
    SELECT p.*
    FROM piktag_profiles p
    JOIN candidates c ON c.user_id = p.id
    WHERE p.is_public = true
    LIMIT max_results
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', picked.id,
      'username', picked.username,
      'full_name', picked.full_name,
      'avatar_url', picked.avatar_url,
      'is_verified', picked.is_verified
    )), '[]'::jsonb),
    COALESCE(array_agg(picked.id), ARRAY[]::uuid[])
  INTO v_users, v_user_ids
  FROM picked;

  WITH my_friends AS (
    SELECT connected_user_id AS fid
    FROM piktag_connections WHERE user_id = viewer_id
  ),
  cand_friends AS (
    SELECT c.user_id AS candidate_id,
           c.connected_user_id AS friend_id
    FROM piktag_connections c
    WHERE c.user_id = ANY(v_user_ids)
  ),
  mutual_pairs AS (
    SELECT cf.candidate_id,
           cf.friend_id,
           row_number() OVER (PARTITION BY cf.candidate_id ORDER BY cf.friend_id) AS rn
    FROM cand_friends cf
    JOIN my_friends mf ON mf.fid = cf.friend_id
  ),
  mutual_enriched AS (
    SELECT mp.candidate_id,
           mp.friend_id,
           p.avatar_url,
           p.full_name
    FROM mutual_pairs mp
    JOIN piktag_profiles p ON p.id = mp.friend_id
    WHERE mp.rn <= 3
  )
  SELECT COALESCE(jsonb_object_agg(candidate_id::text, mutuals), '{}'::jsonb)
  INTO v_mutuals_map
  FROM (
    SELECT candidate_id,
           jsonb_agg(jsonb_build_object(
             'id', friend_id,
             'avatar_url', avatar_url,
             'full_name', full_name
           )) AS mutuals
    FROM mutual_enriched
    GROUP BY candidate_id
  ) grouped;

  RETURN jsonb_build_object(
    'users', v_users,
    'mutuals', v_mutuals_map
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_similar_users(uuid, int) TO authenticated;
