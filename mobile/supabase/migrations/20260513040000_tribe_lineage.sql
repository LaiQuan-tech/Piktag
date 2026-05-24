-- 20260513040000_tribe_lineage.sql
--
-- "Tribe" replaces the points-based referral system.
--
-- Concept: every PikTag user has a "Tribe" — the set of people who
-- signed up to PikTag because of THEM, transitively. Display as a
-- single number (Tribe size) on the profile + a private anonymous
-- constellation visualization the user can explore from their own
-- profile.
--
-- Lineage is set ONCE per profile, the first time someone gets
-- attributed back to an inviter. Two paths can attribute:
--   1. Redeeming an invite code (PIK-XXXXXX link share)
--   2. Scanning a Vibe QR before signing up — the host of that
--      Vibe becomes the inviter when the scanner registers
-- "First one wins" — once `invited_by_user_id` is set, neither
-- path overwrites it.
--
-- Why we keep the invite-code mechanism (just stop awarding
-- points): the invite code is the only path that works for
-- people who learn about PikTag via DM/link, not via QR scan.
-- Without it the only way to bring someone in is to be physically
-- present + scan their phone. That's too narrow.

-- ── 1. Lineage column ────────────────────────────────────────
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Partial index — only profiles that DO have an inviter.
-- The vast majority of rows once a user-base grows are
-- already-set, so a partial index keeps it lean for the
-- count(*) queries that power tribe size.
CREATE INDEX IF NOT EXISTS idx_profiles_invited_by
  ON public.piktag_profiles (invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;

-- ── 2. redeem_invite_code — drop points, add lineage ─────────
-- Same signature so the existing client code keeps working
-- (it still reads success / inviter_id from the result).
-- `points_awarded` is now always 0 — kept in the return type for
-- backward compat; clients can ignore it.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (success boolean, inviter_id uuid, message text, points_awarded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_row  public.piktag_invites%ROWTYPE;
  v_user_id     uuid;
  v_rowcount    integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  PERFORM public.check_invite_redeem_rate_limit(v_user_id);

  SELECT * INTO v_invite_row
    FROM public.piktag_invites
   WHERE invite_code = p_code
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'invite_not_found'::text, 0;
    RETURN;
  END IF;

  IF v_invite_row.used_by IS NOT NULL AND v_invite_row.used_by <> v_user_id THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'already_redeemed'::text, 0;
    RETURN;
  END IF;

  IF v_invite_row.expires_at IS NOT NULL AND v_invite_row.expires_at < now() THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'expired'::text, 0;
    RETURN;
  END IF;

  IF v_invite_row.inviter_id = v_user_id THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'cannot_redeem_own'::text, 0;
    RETURN;
  END IF;

  INSERT INTO public.piktag_invite_redemptions (invite_id, redeemer_id)
  VALUES (v_invite_row.id, v_user_id)
  ON CONFLICT (invite_id, redeemer_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'already_redeemed'::text, 0;
    RETURN;
  END IF;

  UPDATE public.piktag_invites
     SET used_by = v_user_id, used_at = now()
   WHERE id = v_invite_row.id;

  -- ✱ New: attribute the redeemer to this inviter — but only
  -- if they don't already have one. "First inviter wins"; we
  -- never overwrite an existing lineage edge.
  UPDATE public.piktag_profiles
     SET invited_by_user_id = v_invite_row.inviter_id
   WHERE id = v_user_id
     AND invited_by_user_id IS NULL;

  -- ✗ Points logic removed. The previous implementation
  -- incremented p_points + wrote a piktag_points_ledger row.
  -- We're keeping the columns/table around for now (no point
  -- in dropping them in the same commit as the UI cleanup),
  -- but they're dead — no new credits ever again.

  RETURN QUERY SELECT true, v_invite_row.inviter_id, 'ok'::text, 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

-- ── 3. resolve_pending_connections — add lineage attribution ─
-- When someone scans a Vibe QR before signing up, then later
-- registers, resolve_pending_connections fires to wire up the
-- bidirectional piktag_connections rows. That's also the moment
-- to attribute their lineage to the Vibe host.
--
-- We don't redefine the whole function here (it's a 100+ line
-- beast in 20260408_pending_connections.sql). Instead we add a
-- second, focused trigger function that the existing fan-out
-- can call. Approach: AFTER UPDATE trigger on
-- piktag_pending_connections that fires when status flips to
-- 'resolved' — at that point `scanner_user_id` IS set, so we
-- know who to attribute and to whom.
CREATE OR REPLACE FUNCTION public.attribute_tribe_on_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'resolved'
     AND (OLD.status IS NULL OR OLD.status <> 'resolved')
     AND NEW.scanner_user_id IS NOT NULL
     AND NEW.host_user_id IS NOT NULL
     AND NEW.scanner_user_id <> NEW.host_user_id THEN
    UPDATE public.piktag_profiles
       SET invited_by_user_id = NEW.host_user_id
     WHERE id = NEW.scanner_user_id
       AND invited_by_user_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.attribute_tribe_on_resolve() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attribute_tribe_on_resolve() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_attribute_tribe_on_resolve ON public.piktag_pending_connections;
CREATE TRIGGER trg_attribute_tribe_on_resolve
  AFTER UPDATE ON public.piktag_pending_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.attribute_tribe_on_resolve();

-- ── 4. get_tribe_size — transitive count ─────────────────────
-- Returns the number of people in the caller's full lineage
-- subtree (recursive descendants), not just direct invites.
-- Display on the user's profile as a single number.
--
-- SECURITY DEFINER + auth.uid()-guarded so even though the
-- recursive query touches rows the caller couldn't normally
-- read, only their own subtree size is ever returned.
CREATE OR REPLACE FUNCTION public.get_tribe_size(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Privacy: the count of any user's tribe is fine to be public
  -- (it's just a number, like a follower count). No auth.uid()
  -- guard — anyone can ask "how big is X's tribe?".
  WITH RECURSIVE descendants AS (
    SELECT id
    FROM piktag_profiles
    WHERE invited_by_user_id = p_user_id
    UNION ALL
    SELECT p.id
    FROM piktag_profiles p
    JOIN descendants d ON p.invited_by_user_id = d.id
  )
  SELECT count(*)::integer INTO v_count FROM descendants;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_tribe_size(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tribe_size(uuid) TO authenticated, anon;

-- ── 5. get_tribe_lineage — anonymous tree structure ──────────
-- Returns the caller's full lineage subtree as flat rows
-- (id, parent_id, depth) — no usernames, no avatars, no PII.
-- The client renders these as anonymous dots + connecting lines.
--
-- auth.uid()-guarded: you can only see YOUR own subtree shape.
-- This is the privacy-by-default design — we never expose
-- another user's tribe structure.
CREATE OR REPLACE FUNCTION public.get_tribe_lineage()
RETURNS TABLE (
  node_id uuid,
  parent_id uuid,
  depth integer,
  downstream_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE tree AS (
    -- Roots: the caller's direct invites (depth 1).
    SELECT
      p.id AS node_id,
      p.invited_by_user_id AS parent_id,
      1 AS depth
    FROM piktag_profiles p
    WHERE p.invited_by_user_id = v_user_id
    UNION ALL
    -- Walk: children of every node already in the tree.
    SELECT
      p.id,
      p.invited_by_user_id,
      t.depth + 1
    FROM piktag_profiles p
    JOIN tree t ON p.invited_by_user_id = t.node_id
    -- Safety: cap at depth 10. Lineage chains beyond 10 hops are
    -- extremely rare in practice and a cap protects against
    -- runaway recursion if data ever cycles.
    WHERE t.depth < 10
  ),
  -- Per-node downstream count (how many descendants each has).
  -- Lets the client size dots proportionally to a node's reach.
  with_counts AS (
    SELECT
      t.node_id,
      t.parent_id,
      t.depth,
      (
        SELECT count(*)::integer
        FROM tree c
        WHERE c.parent_id = t.node_id
      ) AS downstream_count
    FROM tree t
  )
  SELECT
    wc.node_id,
    wc.parent_id,
    wc.depth,
    wc.downstream_count
  FROM with_counts wc
  ORDER BY wc.depth, wc.node_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tribe_lineage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tribe_lineage() TO authenticated;

-- ── 6. Backfill — set lineage for already-redeemed invites ───
-- If any invites have been redeemed before this migration ran,
-- backfill their lineage from piktag_invites.used_by → inviter.
-- One-time backfill on migration apply.
UPDATE public.piktag_profiles p
   SET invited_by_user_id = i.inviter_id
  FROM public.piktag_invites i
 WHERE i.used_by = p.id
   AND i.used_at IS NOT NULL
   AND p.invited_by_user_id IS NULL
   AND i.inviter_id <> p.id;

-- ── 7. Backfill — set lineage from resolved pending connections
-- Same idea for QR-scan-then-signup attributions. Earliest
-- resolved scan wins (matches "first inviter wins" rule).
WITH first_resolved AS (
  SELECT DISTINCT ON (scanner_user_id)
    scanner_user_id,
    host_user_id
  FROM public.piktag_pending_connections
  WHERE status = 'resolved'
    AND scanner_user_id IS NOT NULL
    AND host_user_id IS NOT NULL
    AND scanner_user_id <> host_user_id
  ORDER BY scanner_user_id, resolved_at ASC NULLS LAST
)
UPDATE public.piktag_profiles p
   SET invited_by_user_id = fr.host_user_id
  FROM first_resolved fr
 WHERE fr.scanner_user_id = p.id
   AND p.invited_by_user_id IS NULL;
