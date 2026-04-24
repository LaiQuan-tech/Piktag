-- Consolidated RPC for UserDetailScreen / FriendDetailScreen.
--
-- Before this migration the mobile client fired ~13 round-trips on
-- mount (profile → my-tags → their-tags → follow-state → follower-count →
-- connection → close-friend → biolinks → mutual-friends → mutual-tags →
-- similar-users → per-similar-user connections × N). That burned ~1.5s
-- of serial latency on 3G / LTE and made profile screens feel sluggish.
--
-- get_user_detail() packs the static bits into one JSON payload so the
-- client can paint the whole above-the-fold view after one RTT. The
-- heavier secondary data (similar-users with mutual-friend details,
-- event-card info) stays in its own calls — they load beneath the fold
-- and don't gate the initial render.
--
-- SECURITY: this function is invoker-side. We never return private
-- tags or close-friend biolinks to the wrong viewer — each subquery
-- filters by `is_private = false` or uses the existing RLS policies
-- on the underlying table (biolinks are fetched raw and the client
-- filter still runs via filterBiolinksByVisibility for defence in
-- depth; this matches the prior direct-query behavior exactly).

CREATE OR REPLACE FUNCTION public.get_user_detail(
  target_user_id uuid,
  viewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
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
  -- connection_tags reference it (used by the client to sort tags
  -- by "how many people tagged this person with X").
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

GRANT EXECUTE ON FUNCTION public.get_user_detail(uuid, uuid) TO authenticated;


-- Similar-users bundle: given a target user + viewer, return up to
-- `max_results` other public users who share at least one public tag
-- with the target, plus for each of those users a slice of up to 3
-- mutual-friend profiles with the viewer.
--
-- Replaces the N+1 pattern in UserDetailScreen where we fetched
-- per-similar-user connections in a for-loop.

CREATE OR REPLACE FUNCTION public.get_similar_users(
  target_user_id uuid,
  viewer_id uuid,
  max_results int DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_users           jsonb;
  v_mutuals_map     jsonb;
  v_user_ids        uuid[];
BEGIN
  -- Candidate users: public profiles sharing any public tag with target
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

  -- Build mutual-friends map: for each candidate, up to 3 friends-of
  -- candidate who are also friends of viewer.
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

GRANT EXECUTE ON FUNCTION public.get_similar_users(uuid, uuid, int) TO authenticated;
