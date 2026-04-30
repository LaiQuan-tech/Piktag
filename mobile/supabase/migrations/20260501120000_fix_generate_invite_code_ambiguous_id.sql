-- =============================================================================
-- fix(invite): "column reference \"id\" is ambiguous" on generate_invite_code
--
-- Symptom: tapping the "產生邀請碼" button errored with
--   ERROR:  column reference "id" is ambiguous
--   CONTEXT: PL/pgSQL function public.generate_invite_code() …
--
-- Root cause: the function declares
--   RETURNS TABLE (id uuid, invite_code text, created_at timestamptz, expires_at timestamptz)
-- which makes `id` (etc.) an OUT parameter visible inside the function body.
-- Two UPDATE statements then write
--   UPDATE public.piktag_profiles SET invite_quota = … WHERE id = v_user_id
-- where `id` could resolve to either the OUT param `id` (uuid, currently NULL)
-- or piktag_profiles.id (uuid). PL/pgSQL's default `variable_conflict` mode is
-- `error` → it refuses to guess and raises ambiguity.
--
-- This had probably been latent since the function was written — variable
-- conflict checking is invoked per-call, and any prior CALL/ALTER (e.g. the
-- search_path pin in 20260429190000_security_advisor_fixes.sql) can cause
-- the planner to revalidate the body and surface the issue.
--
-- Fix: add `#variable_conflict use_column` at the top of the function body
-- so column references resolve to the table column, not the OUT param. This
-- is the canonical PL/pgSQL fix for this exact shape; no behaviour changes
-- for any caller — the OUT params were never read inside the function, only
-- written via RETURN QUERY at the end.
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
$$;

GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated;
