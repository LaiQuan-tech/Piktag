-- Security hardening for invite codes:
--   H5  race condition in points credit       -> idempotent redemption table + row lock
--   H8  client-side Math.random code gen      -> server-side generate_invite_code() using gen_random_bytes
--   M7  brute-force redeem                    -> per-user rate limit (5 / hour)

-- pgcrypto powers gen_random_bytes / gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pgcrypto;

------------------------------------------------------------------
-- Idempotency table for redemptions: (code_id, user) is unique.
-- Lets us use INSERT ... ON CONFLICT DO NOTHING as the atomic gate
-- for crediting points, eliminating the read-modify-write race.
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.piktag_invite_redemptions (
  invite_id   uuid NOT NULL REFERENCES public.piktag_invites(id) ON DELETE CASCADE,
  redeemer_id uuid NOT NULL REFERENCES public.piktag_profiles(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, redeemer_id)
);

CREATE INDEX IF NOT EXISTS idx_invite_redemptions_redeemer_time
  ON public.piktag_invite_redemptions (redeemer_id, redeemed_at DESC);

ALTER TABLE public.piktag_invite_redemptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own redemptions" ON public.piktag_invite_redemptions
    FOR SELECT USING (redeemer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

------------------------------------------------------------------
-- Rate-limit helper: caps redeem attempts at 5 per hour per user.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_invite_redeem_rate_limit(p_user uuid)
RETURNS void AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.piktag_invite_redemptions
  WHERE redeemer_id = p_user
    AND redeemed_at > now() - INTERVAL '1 hour';

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING HINT = 'Too many invite redemption attempts. Try again in an hour.';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_invite_redeem_rate_limit(uuid) TO authenticated;

------------------------------------------------------------------
-- Server-side invite code generator. Replaces client Math.random().
-- Format: PIK-XXXXXX  (XXXXXX = uppercase hex from 4 random bytes -> 8 chars truncated to 6)
-- Decrements quota atomically; retries on the (extremely unlikely) collision.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TABLE (id uuid, invite_code text, created_at timestamptz, expires_at timestamptz) AS $$
DECLARE
  v_user_id uuid;
  v_code    text;
  v_quota   integer;
  v_invite  public.piktag_invites%ROWTYPE;
  v_attempt integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Atomically decrement quota only if available.
  UPDATE public.piktag_profiles
     SET invite_quota = invite_quota - 1
   WHERE id = v_user_id
     AND COALESCE(invite_quota, 0) > 0
  RETURNING invite_quota INTO v_quota;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quota_exhausted';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := 'PIK-' || substr(upper(encode(gen_random_bytes(4), 'hex')), 1, 6);

    BEGIN
      INSERT INTO public.piktag_invites (inviter_id, invite_code)
      VALUES (v_user_id, v_code)
      RETURNING * INTO v_invite;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        -- Refund quota before bailing
        UPDATE public.piktag_profiles
           SET invite_quota = invite_quota + 1
         WHERE id = v_user_id;
        RAISE EXCEPTION 'code_generation_failed';
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_invite.id, v_invite.invite_code, v_invite.created_at, v_invite.expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated;

------------------------------------------------------------------
-- Replace redeem_invite_code with a race-free, rate-limited version.
-- Strategy:
--   1. Rate-limit check.
--   2. SELECT ... FOR UPDATE the invite row to serialize concurrent calls.
--   3. INSERT into piktag_invite_redemptions; ON CONFLICT means we already
--      credited this (invite, user) pair -> return already_redeemed without
--      double-crediting points.
------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.redeem_invite_code(text);

CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (success boolean, inviter_id uuid, message text, points_awarded integer) AS $$
DECLARE
  v_invite_row  public.piktag_invites%ROWTYPE;
  v_user_id     uuid;
  v_new_balance integer;
  v_rowcount    integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  -- M7: brute-force protection.
  PERFORM public.check_invite_redeem_rate_limit(v_user_id);

  -- H5: lock the invite row for the duration of the txn.
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

  -- Atomic gate: only one redemption row may exist per (invite, user).
  INSERT INTO public.piktag_invite_redemptions (invite_id, redeemer_id)
  VALUES (v_invite_row.id, v_user_id)
  ON CONFLICT (invite_id, redeemer_id) DO NOTHING;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'already_redeemed'::text, 0;
    RETURN;
  END IF;

  -- Mark the invite consumed.
  UPDATE public.piktag_invites
     SET used_by = v_user_id, used_at = now()
   WHERE id = v_invite_row.id;

  -- Credit inviter exactly once.
  UPDATE public.piktag_profiles
     SET p_points          = p_points + 1,
         p_points_lifetime = p_points_lifetime + 1
   WHERE id = v_invite_row.inviter_id
  RETURNING p_points INTO v_new_balance;

  INSERT INTO public.piktag_points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
  VALUES (v_invite_row.inviter_id, 1, COALESCE(v_new_balance, 0), 'invite_accepted', 'invite', v_invite_row.id);

  RETURN QUERY SELECT true, v_invite_row.inviter_id, 'ok'::text, 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
