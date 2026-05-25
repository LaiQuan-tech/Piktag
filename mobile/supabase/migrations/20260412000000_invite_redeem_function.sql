-- Add UNIQUE constraint on invite_code to prevent collisions
CREATE UNIQUE INDEX IF NOT EXISTS idx_piktag_invites_code_unique ON public.piktag_invites (invite_code);

-- Add expires_at column (30 day default)
ALTER TABLE public.piktag_invites ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + INTERVAL '30 days');

-- Backfill existing invites with 30-day expiry from creation
UPDATE public.piktag_invites SET expires_at = COALESCE(created_at, now()) + INTERVAL '30 days' WHERE expires_at IS NULL;

-- Index for efficient lookup of unused, unexpired invites
CREATE INDEX IF NOT EXISTS idx_piktag_invites_unused ON public.piktag_invites (invite_code) WHERE used_by IS NULL;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (success boolean, inviter_id uuid, message text) AS $$
DECLARE
  v_invite_row public.piktag_invites%ROWTYPE;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'not_authenticated'::text;
    RETURN;
  END IF;

  SELECT * INTO v_invite_row FROM public.piktag_invites
  WHERE invite_code = p_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'invite_not_found'::text;
    RETURN;
  END IF;

  IF v_invite_row.used_by IS NOT NULL THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'already_redeemed'::text;
    RETURN;
  END IF;

  IF v_invite_row.expires_at IS NOT NULL AND v_invite_row.expires_at < now() THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'expired'::text;
    RETURN;
  END IF;

  IF v_invite_row.inviter_id = v_user_id THEN
    RETURN QUERY SELECT false, v_invite_row.inviter_id, 'cannot_redeem_own'::text;
    RETURN;
  END IF;

  UPDATE public.piktag_invites
  SET used_by = v_user_id, used_at = now()
  WHERE id = v_invite_row.id;

  RETURN QUERY SELECT true, v_invite_row.inviter_id, 'ok'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
