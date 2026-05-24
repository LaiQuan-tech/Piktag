-- 20260513010000_vibe_member_current_tags.sql
--
-- P0 of the "Vibes" feature line — reactivation surface for a
-- given Vibe.
--
-- When the host opens a months-old Vibe ("Coffee tasting · 龍洞
-- 潛水 · …"), this RPC returns the tags those people are using
-- on their PikTag profile RIGHT NOW. The intent: turn a static
-- record of "who was there" into a live "what they're into now"
-- view, so:
--   • The host sees an instant snapshot of the tribe's current
--     vibe shift ("3 of these 12 are now into #海邊")
--   • The host has a natural reactivation hook: tap a tag → see
--     which members of this Vibe share that interest now → DM /
--     re-invite that subset
--
-- Excludes the Vibe's OWN event_tags from the result. Those are
-- self-referential identity tags (every member of the 龍洞潛水
-- Vibe is probably tagged "潛水") and don't surface anything new.
--
-- Threshold: a tag must be shared by ≥2 members of this Vibe to
-- appear. A single member's solo tag isn't a "tribe shift" — it's
-- just one person. The threshold filters noise and keeps the UI
-- focused on collective patterns.
--
-- Security: SECURITY DEFINER so the function can read other users'
-- tags (which the viewer normally couldn't via RLS), but explicitly
-- guarded by `auth.uid() = c.user_id` — the viewer MUST be the
-- Vibe's host. Same pattern as the existing qr_group_members RPC.

CREATE OR REPLACE FUNCTION public.vibe_member_current_tags(p_group_id uuid)
RETURNS TABLE (
  tag_name text,
  member_count integer,
  member_ids uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH
    -- Tags that ARE this Vibe's identity — exclude from result
    vibe_self_tags AS (
      SELECT lower(unnest(event_tags)) AS tag_name
      FROM piktag_scan_sessions
      WHERE id = p_group_id
    ),
    -- Members: host's connections that originated from this Vibe.
    -- auth.uid() check enforces "viewer is the host" — without it,
    -- SECURITY DEFINER would let anyone enumerate any Vibe's tribe.
    vibe_members AS (
      SELECT c.connected_user_id AS member_id
      FROM piktag_connections c
      -- Cast both sides to text. The schema type of
      -- piktag_connections.scan_session_id varies by deploy:
      -- early seeds had it as `text` (to allow legacy non-UUID
      -- prefixed ids like "local_…"), production was later
      -- migrated to `uuid`. Casting both makes the predicate
      -- type-agnostic so this RPC works on either schema.
      WHERE c.scan_session_id::text = p_group_id::text
        AND c.user_id = (
          SELECT host_user_id FROM piktag_scan_sessions WHERE id = p_group_id
        )
        AND auth.uid() = c.user_id
    ),
    -- Each member's currently displayed profile tags (the ones
    -- they've chosen via ManageTags / EditProfile to represent
    -- themselves NOW — i.e. the "live vibe" the user wants to be
    -- known for today)
    member_tags AS (
      SELECT
        ut.user_id AS member_id,
        lower(t.name) AS tag_name
      FROM piktag_user_tags ut
      JOIN piktag_tags t ON t.id = ut.tag_id
      WHERE ut.user_id IN (SELECT member_id FROM vibe_members)
    )
  SELECT
    tag_name,
    count(DISTINCT member_id)::integer AS member_count,
    array_agg(DISTINCT member_id) AS member_ids
  FROM member_tags
  WHERE tag_name NOT IN (SELECT tag_name FROM vibe_self_tags)
  GROUP BY tag_name
  HAVING count(DISTINCT member_id) >= 2  -- "tribe shift" threshold
  ORDER BY count(DISTINCT member_id) DESC, tag_name
  LIMIT 8;
$$;

REVOKE ALL ON FUNCTION public.vibe_member_current_tags(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vibe_member_current_tags(uuid) TO authenticated;
