-- 20260808044404_username_unique_index.sql
--
-- Make usernames actually unique, case-insensitively.
--
-- Until now there was no constraint. Two earlier migrations say so and call
-- it deliberate (20260605010000_username_availability_rpc.sql:22 and
-- 20260715000000_get_ask_public_is_official.sql:5). The app checks with
-- check_username_available and then writes, and nothing sits between the
-- check and the write: two people can pass the check at the same moment and
-- both get the handle. That makes pikt.ag/<handle> ambiguous — share links
-- and QR codes silently resolve to whichever row is returned first — and it
-- is an impersonation vector. OnboardingScreen already handles a 23505 on
-- save (197a65fd); that code is dead until this index exists.
--
-- The index is on lower(username) to match how check_username_available
-- compares (20260605010000), so the constraint and the check agree.
--
-- WHY THE PRE-FLIGHT BLOCK BELOW:
-- Creating a unique index over existing duplicates fails with a message that
-- names the index, not the offending rows, which is useless when you are
-- staring at a red deploy. A read-only probe of the live table found 195
-- profiles, zero case-collisions and zero exact duplicates — but that probe
-- ran through PostgREST under RLS, so it cannot prove a hidden row does not
-- collide. Rather than trust it, this migration checks for itself and, if
-- there IS a collision, aborts with the actual usernames and ids listed.
-- The whole migration is one transaction, so a failure changes nothing; it
-- only blocks the deploy and tells us exactly what to resolve.
--
-- Resolving a collision means renaming somebody, which breaks their existing
-- share links and QR codes, so it is a founder decision, not something to
-- automate inside a migration.
--
-- Idempotent: IF NOT EXISTS, and the pre-flight passes trivially once the
-- index is in place.

DO $$
DECLARE
  v_collisions text;
  v_groups     int;
BEGIN
  SELECT count(*), string_agg(detail, E'\n')
    INTO v_groups, v_collisions
  FROM (
    SELECT lower(username) || ' -> ' || string_agg(username || ' (' || id || ')', ', ') AS detail
      FROM public.piktag_profiles
     WHERE username IS NOT NULL
       AND btrim(username) <> ''
     GROUP BY lower(username)
    HAVING count(*) > 1
  ) g;

  IF COALESCE(v_groups, 0) > 0 THEN
    RAISE EXCEPTION
      'Cannot add the unique username index: % handle(s) are already held by more than one profile.%Resolve these first (renaming breaks that user''s existing share links and QR codes, so decide deliberately):%%',
      v_groups, E'\n', E'\n', v_collisions;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS piktag_profiles_username_lower_key
  ON public.piktag_profiles (lower(username))
  WHERE username IS NOT NULL AND btrim(username) <> '';
