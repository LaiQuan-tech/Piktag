-- 20260712010000_contact_bridges.sql
--
-- Contact bridges for the network graph (founder 2026-07-12): when the
-- viewer AND one of their member friends have each saved the SAME person
-- in their private contact books (matched on normalized phone / mobile /
-- email), the graph can draw viewer's-contact ↔ friend edges — the
-- coral contact node gets pulled between the members who both know them,
-- turning two populations into one net.
--
-- Privacy posture: reveals to the VIEWER that a friend also saved this
-- person — same class of signal as mutual-friend counts and the
-- anonymous-bridge "N friends know them" row. Matching uses only
-- numbers/emails BOTH sides deliberately saved. Only the viewer's OWN
-- un-promoted contacts are surfaced (their data); the friend's book is
-- never enumerated — just the one-bit overlap per shared person.
-- Cross-column matching (phone vs mobile both ways) because the
-- mobile/landline split (20260712000000) is new and older rows carry
-- one number in phone_normalized only.

CREATE OR REPLACE FUNCTION public.get_contact_bridges()
RETURNS TABLE(contact_id uuid, friend_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  my_contacts AS (
    SELECT lc.id, lc.phone_normalized, lc.mobile_normalized, lc.email_lower
    FROM piktag_local_contacts lc, me
    WHERE lc.owner_user_id = me.uid
      AND lc.promoted_to_connection_id IS NULL
      AND (lc.phone_normalized IS NOT NULL
           OR lc.mobile_normalized IS NOT NULL
           OR lc.email_lower IS NOT NULL)
  ),
  my_friends AS (
    SELECT DISTINCT c.connected_user_id AS fid
    FROM piktag_connections c, me
    WHERE c.user_id = me.uid
      AND c.connected_user_id IS DISTINCT FROM me.uid
      AND NOT public.is_official_user(c.connected_user_id)
  )
  SELECT DISTINCT mc.id AS contact_id, fl.owner_user_id AS friend_id
  FROM my_contacts mc
  JOIN piktag_local_contacts fl
    ON fl.owner_user_id IN (SELECT fid FROM my_friends)
   AND (
        (mc.phone_normalized IS NOT NULL
         AND (fl.phone_normalized = mc.phone_normalized
              OR fl.mobile_normalized = mc.phone_normalized))
     OR (mc.mobile_normalized IS NOT NULL
         AND (fl.phone_normalized = mc.mobile_normalized
              OR fl.mobile_normalized = mc.mobile_normalized))
     OR (mc.email_lower IS NOT NULL AND fl.email_lower = mc.email_lower)
   )
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.get_contact_bridges() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_bridges() TO authenticated;
