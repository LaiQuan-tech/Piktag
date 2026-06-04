-- 20260605010000_username_availability_rpc.sql
--
-- Live username availability check for the 3-step onboarding wizard
-- Step 1 (and reusable by EditProfile's username field). The username
-- is the user's pikt.ag/{username} handle — core to the share/install
-- funnel — and users CAN set it, but there is NO DB unique constraint
-- on it today, so this RPC is the UX guard against picking a taken or
-- route-colliding handle.
--
--  • Case-insensitive (lower()) so "Alice" and "alice" can't both own
--    the same URL.
--  • Excludes the caller's own row (auth.uid()) so keeping your
--    current username reads as available.
--  • Empty / whitespace → not available (invalid).
--  • Reserved handles (the landing site's real routes + a few obvious
--    ones) → not available, because pikt.ag/privacy etc. must resolve
--    to the static page, not a profile.
--  • SECURITY DEFINER so it works regardless of piktag_profiles
--    SELECT RLS (search goes through RPCs; direct table reads of other
--    rows may be restricted).
--
-- NOT done here (deliberately): a hard UNIQUE INDEX on lower(username).
-- That's a separate data-integrity migration that must first dedupe
-- any existing collisions (the column predates the migration history,
-- so its current constraint state is unknown). This RPC closes the
-- common case; the hard constraint is a tracked follow-up.

CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- empty / whitespace-only → invalid, not available
    WHEN btrim(COALESCE(p_username, '')) = '' THEN false
    -- reserved handles that would shadow a real pikt.ag/* route
    WHEN lower(btrim(p_username)) = ANY (ARRAY[
      'privacy','terms','contact','reset-password','pitch','download',
      'scan','child-safety','delete-account','api','www','admin','app',
      'about','help','support','login','register','settings','profile',
      'search','explore','tag','tags','u','user','pikt','piktag'
    ]) THEN false
    -- otherwise: available iff no OTHER profile already holds it
    ELSE NOT EXISTS (
      SELECT 1
      FROM piktag_profiles
      WHERE lower(username) = lower(btrim(p_username))
        AND id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.check_username_available(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO authenticated;
