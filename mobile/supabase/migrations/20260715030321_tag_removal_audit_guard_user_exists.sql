-- 20260715030321_tag_removal_audit_guard_user_exists.sql
--
-- Launch-hardening (2026-07-15): deleting an auth.users row DIRECTLY
-- (Supabase dashboard "Delete user", a future admin tool, or a psql
-- session) fails with:
--
--   ERROR: 23503 insert or update on table "piktag_tag_removals"
--   violates foreign key constraint "piktag_tag_removals_user_id_fkey"
--   Key (user_id)=(<deleted uid>) is not present in table "users".
--
-- ROOT CAUSE: the AFTER DELETE trigger trg_log_self_tag_removal on
-- piktag_user_tags (log_self_tag_removal(), 20260529050000) mirrors every
-- removed tag into piktag_tag_removals for negative-signal scoring. When
-- auth.users is deleted directly, ON DELETE CASCADE removes that user's
-- piktag_user_tags rows, which fires this trigger, which tries to INSERT
-- an audit row keyed to a user that is ALREADY gone (same transaction) —
-- violating the audit table's own user_id FK and rolling back the entire
-- account deletion. piktag_tag_removals.user_id is even ON DELETE CASCADE,
-- but that does not help: the offending INSERT happens DURING the parent's
-- deletion, so the referenced user is no longer visible.
--
-- The delete-user edge function (mobile/supabase/functions/delete-user)
-- currently dodges this by ORDERING — it deletes piktag_user_tags first
-- (while the user still exists, so the audit insert succeeds) and auth.users
-- last. So user-facing self-delete already works; that defense-in-depth is
-- intentionally LEFT IN PLACE. This migration removes the fragility for
-- every OTHER deletion path.
--
-- FIX (option 1, least invasive): guard the audit INSERT on the owning
-- user still existing. During a cascade from auth.users, an AFTER DELETE
-- trigger sees the parent row already deleted in the transaction snapshot,
-- so EXISTS(...) is false and the insert is skipped — no FK violation, the
-- delete proceeds. During a NORMAL self-untag (account intact) EXISTS is
-- true and the audit behaviour is byte-for-byte unchanged.
--
-- The sibling audit trigger log_friend_endorsement_withdraw() (same file)
-- writes piktag_tag_removals(user_id = the endorsement TARGET) and has the
-- identical exposure if the target is a user being deleted, so it gets the
-- same guard for symmetry. It already self-skips when the connection row is
-- gone; the guard covers the residual "connection_tags deleted while the
-- target user is mid-deletion" path.
--
-- Idempotent: CREATE OR REPLACE on the two SECURITY DEFINER functions only.
-- The triggers already bind these function names, so they are not touched.

-- ─── self un-tag audit: skip when the owning user is gone ─────────────
CREATE OR REPLACE FUNCTION public.log_self_tag_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only log when the user still exists. A false EXISTS means this DELETE
  -- is a cascade from auth.users being removed — logging would violate
  -- piktag_tag_removals_user_id_fkey (23503) and roll back the deletion.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    INSERT INTO public.piktag_tag_removals (user_id, tag_id, source)
    VALUES (OLD.user_id, OLD.tag_id, 'self_unstag')
    ON CONFLICT DO NOTHING;  -- no-op if a duplicate signal arrived
  END IF;
  RETURN OLD;
END;
$$;

-- ─── friend-withdraw audit: same guard on the target user ─────────────
CREATE OR REPLACE FUNCTION public.log_friend_endorsement_withdraw()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid;
  v_tagger uuid;
BEGIN
  SELECT c.connected_user_id, c.user_id
    INTO v_target, v_tagger
    FROM public.piktag_connections c
   WHERE c.id = OLD.connection_id
   LIMIT 1;

  IF v_target IS NULL THEN
    -- Connection already gone (cascaded delete) — signal is moot.
    RETURN OLD;
  END IF;

  IF OLD.is_private = true THEN
    -- Private notes carry no endorsement signal.
    RETURN OLD;
  END IF;

  -- Skip when the target user is mid-deletion (see log_self_tag_removal).
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_target) THEN
    INSERT INTO public.piktag_tag_removals (user_id, tag_id, source, context)
    VALUES (
      v_target,
      OLD.tag_id,
      'friend_withdraw',
      jsonb_build_object('tagger_id', v_tagger)
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
