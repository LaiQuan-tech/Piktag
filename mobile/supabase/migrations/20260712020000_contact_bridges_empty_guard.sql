-- 20260712020000_contact_bridges_empty_guard.sql
--
-- Launch-hardening for get_contact_bridges (pre-launch audit 2026-07-12):
-- the matching arms compared columns by equality, so if any identifier
-- were stored as '' (empty string) instead of NULL, every empty-string
-- row would falsely bridge to every other — most dangerously via
-- email_lore=''. Live data is currently clean (all app write paths use
-- `|| null`), so this is purely defensive against a future write path:
-- nullif(...,'') makes an empty identifier non-matchable regardless.
-- Byte-for-byte the 20260712010000 function with only the mc-side guards
-- wrapped in nullif().

CREATE OR REPLACE FUNCTION public.get_contact_bridges()
RETURNS TABLE(contact_id uuid, friend_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  my_contacts AS (
    SELECT lc.id,
           nullif(lc.phone_normalized, '')  AS phone_normalized,
           nullif(lc.mobile_normalized, '') AS mobile_normalized,
           nullif(lc.email_lower, '')       AS email_lower
    FROM piktag_local_contacts lc, me
    WHERE lc.owner_user_id = me.uid
      AND lc.promoted_to_connection_id IS NULL
      AND (nullif(lc.phone_normalized, '') IS NOT NULL
           OR nullif(lc.mobile_normalized, '') IS NOT NULL
           OR nullif(lc.email_lower, '') IS NOT NULL)
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
