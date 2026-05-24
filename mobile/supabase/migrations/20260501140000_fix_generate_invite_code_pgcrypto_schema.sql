-- =============================================================================
-- fix(invite): "function gen_random_bytes(integer) does not exist" on
-- generate_invite_code (regression introduced by the previous fix).
--
-- Symptom: tapping "分享邀請碼" (after the ambiguous-id fix landed)
-- errored with `function gen_random_bytes(integer) does not exist`.
--
-- Root cause: 20260501120000_fix_generate_invite_code_ambiguous_id.sql
-- pinned `SET search_path = public, pg_temp` to avoid search_path
-- hijacking on a SECURITY DEFINER function. Supabase installs pgcrypto
-- (which provides `gen_random_bytes`) into the `extensions` schema by
-- convention — NOT public. The pinned search_path therefore excluded the
-- one schema where the function actually lives, and the unqualified call
-- inside the function body could no longer resolve.
--
-- Two ways to fix: (a) extend search_path to include `extensions`, or
-- (b) schema-qualify the call. We pick (b) — `extensions.gen_random_bytes(4)`
-- — because it doesn't depend on schema search order and survives any
-- future search_path tightening for security hardening.
--
-- Behaviour unchanged: same code shape, same retry loop, same quota
-- accounting. Only the cross-schema function reference changes.
--
-- Idempotent (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TABLE (id uuid, invite_code text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
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
    -- Schema-qualify pgcrypto call: pgcrypto lives in `extensions` on
    -- Supabase (not public), so an unqualified reference fails to
    -- resolve under our pinned search_path.
    v_code := 'PIK-' || substr(upper(encode(extensions.gen_random_bytes(4), 'hex')), 1, 6);

    BEGIN
      INSERT INTO public.piktag_invites (inviter_id, invite_code)
      VALUES (v_user_id, v_code)
      RETURNING * INTO v_invite;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        UPDATE public.piktag_profiles
           SET invite_quota = invite_quota + 1
         WHERE id = v_user_id;
        RAISE EXCEPTION 'code_generation_failed';
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_invite.id, v_invite.invite_code, v_invite.created_at, v_invite.expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated;
