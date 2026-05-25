-- Daily invite quota recovery mechanism
-- Adds invite_quota_last_recovery column (idempotent) and an RPC the client can
-- call to manually recover the user's daily invite quota.
--
-- NOTE: A pre-existing trigger function `public.recover_invite_quota()` returns
-- a `trigger` and is referenced by the `on_quota_recovery` trigger on
-- `piktag_profiles`. To avoid breaking that dependency, this RPC is named
-- `recover_invite_quota_rpc`.

ALTER TABLE public.piktag_profiles
  ADD COLUMN IF NOT EXISTS invite_quota_last_recovery timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.recover_invite_quota_rpc()
RETURNS TABLE (recovered boolean, new_quota integer, next_recovery_at timestamptz) AS $$
DECLARE
  v_user_id uuid;
  v_last_recovery timestamptz;
  v_quota_max integer;
  v_current_quota integer;
  v_new_quota integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, 0, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT invite_quota, invite_quota_max, invite_quota_last_recovery
    INTO v_current_quota, v_quota_max, v_last_recovery
  FROM public.piktag_profiles
  WHERE id = v_user_id;

  -- If already at max, no recovery needed; but still report next window
  IF v_current_quota >= v_quota_max THEN
    RETURN QUERY SELECT false, v_current_quota, v_last_recovery + INTERVAL '1 day';
    RETURN;
  END IF;

  -- Check if 24 hours have passed since last recovery
  IF v_last_recovery IS NULL OR (now() - v_last_recovery) >= INTERVAL '1 day' THEN
    -- Reset quota to max
    UPDATE public.piktag_profiles
    SET invite_quota = v_quota_max,
        invite_quota_last_recovery = now()
    WHERE id = v_user_id
    RETURNING invite_quota INTO v_new_quota;

    RETURN QUERY SELECT true, v_new_quota, now() + INTERVAL '1 day';
  ELSE
    -- Not yet time for recovery
    RETURN QUERY SELECT false, v_current_quota, v_last_recovery + INTERVAL '1 day';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recover_invite_quota_rpc() TO authenticated;
