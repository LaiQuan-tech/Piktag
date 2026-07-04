-- 20260703060000_reserved_username_guard.sql
--
-- CEO roadmap "do first" #3 (2026-07-04): reserve official / staff-like
-- usernames BEFORE open launch. Every user auto-friends @piktag, so an
-- impostor squatting `piktag`, `support`, `admin`, `piktagteam` etc. can
-- pose as the platform. Once signups are open, evicting an existing
-- squatter is far messier than a gate — so this must land pre-launch.
--
-- Guard: BEFORE INSERT OR UPDATE OF username on piktag_profiles. Normalize
-- the candidate (lowercase, strip everything but a-z0-9 — so `pik.tag`,
-- `pik_tag`, `PikTag` all collapse to `piktag`) and reject if it equals a
-- reserved word OR starts with `piktag`. The real official account
-- (is_official = true) is exempt so its own `piktag` username is allowed.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). Existing rows
-- are untouched (the trigger only fires on future writes); if a squatter
-- already exists, this doesn't evict them — run a one-off check after
-- deploy (a query is in the commit message).

CREATE OR REPLACE FUNCTION public.enforce_reserved_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_norm text;
  v_reserved text[] := ARRAY[
    'support', 'admin', 'administrator', 'official', 'staff', 'team',
    'help', 'contact', 'security', 'moderator', 'mod', 'root', 'system',
    'piktagofficial', 'piktagsupport', 'piktagteam', 'piktaghelp'
  ];
BEGIN
  -- Official account is the legitimate owner of the piktag name.
  IF COALESCE(NEW.is_official, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.username IS NULL THEN
    RETURN NEW;
  END IF;

  v_norm := regexp_replace(lower(NEW.username), '[^a-z0-9]', '', 'g');

  IF v_norm = ANY (v_reserved) OR v_norm LIKE 'piktag%' THEN
    RAISE EXCEPTION 'username "%" is reserved', NEW.username
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_reserved_username() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_reserved_username()
  TO postgres, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_reserved_username ON public.piktag_profiles;
CREATE TRIGGER trg_enforce_reserved_username
  BEFORE INSERT OR UPDATE OF username ON public.piktag_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_reserved_username();
