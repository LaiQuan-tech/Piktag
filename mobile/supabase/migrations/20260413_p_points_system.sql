-- P-points infrastructure: profile columns, ledger table, and invite redemption reward
ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS p_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_points_lifetime integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.piktag_points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.piktag_profiles(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  balance_after integer NOT NULL,
  reason text NOT NULL,
  ref_type text,
  ref_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user ON public.piktag_points_ledger(user_id, created_at DESC);

ALTER TABLE public.piktag_points_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own ledger" ON public.piktag_points_ledger
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rewrite redeem_invite_code to award 1 P-point and record ledger entry
DROP FUNCTION IF EXISTS public.redeem_invite_code(text);

CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (success boolean, inviter_id uuid, message text, points_awarded integer) AS $$
DECLARE
  v_invite_row public.piktag_invites%ROWTYPE;
  v_user_id uuid;
  v_new_balance integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'not_authenticated'::text, 0;
    RETURN;
  END IF;

  SELECT * INTO v_invite_row FROM public.piktag_invites
  WHERE invite_code = p_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'invite_not_found'::text, 0;
    RETURN;
  END IF;

  IF v_invite_row.used_by IS NOT NULL THEN
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

  -- Mark invite used
  UPDATE public.piktag_invites
  SET used_by = v_user_id, used_at = now()
  WHERE id = v_invite_row.id;

  -- Reward inviter with 1 P point
  UPDATE public.piktag_profiles
  SET p_points = p_points + 1,
      p_points_lifetime = p_points_lifetime + 1
  WHERE id = v_invite_row.inviter_id
  RETURNING p_points INTO v_new_balance;

  -- Record ledger entry
  INSERT INTO public.piktag_points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id)
  VALUES (v_invite_row.inviter_id, 1, COALESCE(v_new_balance, 0), 'invite_accepted', 'invite', v_invite_row.id);

  RETURN QUERY SELECT true, v_invite_row.inviter_id, 'ok'::text, 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
