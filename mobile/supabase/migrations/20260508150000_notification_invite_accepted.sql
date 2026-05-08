-- Inviter feedback loop: when someone redeems an invite, the inviter
-- needs to know — both in-app and via push — without having to open the
-- InviteScreen and scan the history list manually.
--
-- This migration fires AFTER UPDATE on piktag_invites whenever
-- used_by transitions from NULL → NOT NULL (the only path used by the
-- redeem_invite_code RPC). Mirrors the structure of notify_follow:
--
--   1. Insert an in-app row in piktag_notifications (type='invite_accepted')
--   2. Best-effort Expo push via pg_net + Vault secrets
--   3. Failures in either path swallow into RAISE WARNING — the redeem
--      transaction MUST NOT roll back over a notification dispatch.
--
-- Notification routes the inviter to the redeemer's profile when tapped
-- (data.redeemer_id is consumed by NotificationsScreen).

CREATE OR REPLACE FUNCTION public.notify_invite_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_recipient        uuid;
  v_redeemer         uuid;
  v_redeemer_uname   text;
  v_redeemer_avatar  text;
  v_redeemer_name    text;
  v_title            text;
  v_body             text;
  v_push_token       text;
  v_auth_key         text;
  v_base_url         text;
BEGIN
  -- Only fire on the NULL → NOT NULL transition for used_by. Updates that
  -- already had used_by set (e.g. backfills) shouldn't re-notify.
  IF NEW.used_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.used_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_recipient := NEW.inviter_id;
  v_redeemer  := NEW.used_by;

  -- Defensive: skip if either side missing or self-redeem (already
  -- blocked at RPC level, but cheap to double-check here).
  IF v_recipient IS NULL OR v_redeemer IS NULL OR v_recipient = v_redeemer THEN
    RETURN NEW;
  END IF;

  -- Resolve redeemer display fields for both the in-app payload and push
  -- title — falling back gracefully when avatar/full_name are missing.
  SELECT COALESCE(p.username, ''),
         p.avatar_url,
         COALESCE(p.full_name, p.username, '')
    INTO v_redeemer_uname,
         v_redeemer_avatar,
         v_redeemer_name
    FROM public.piktag_profiles p
   WHERE p.id = v_redeemer;

  v_title := '你的邀請被接受了 🎉';
  v_body  := COALESCE(NULLIF(v_redeemer_name, ''), '有人') || ' 加入了 PikTag — 你獲得 1 P 幣';

  -- 1. In-app notification row.
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  VALUES (
    v_recipient,
    'invite_accepted',
    v_title,
    v_body,
    jsonb_build_object(
      'invite_id',    NEW.id,
      'invite_code',  NEW.invite_code,
      'redeemer_id',  v_redeemer,
      'username',     v_redeemer_uname,
      'avatar_url',   v_redeemer_avatar,
      'points_awarded', 1
    ),
    false,
    now()
  );

  -- 2. Expo push (best-effort). Same shape as notify_follow — keep the
  -- HTTP call inside a sub-block so a network blip never breaks redeem.
  BEGIN
    SELECT decrypted_secret INTO v_auth_key
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_service_role_key'
     LIMIT 1;

    SELECT decrypted_secret INTO v_base_url
      FROM vault.decrypted_secrets
     WHERE name = 'piktag_supabase_url'
     LIMIT 1;

    SELECT push_token INTO v_push_token
      FROM public.piktag_profiles
     WHERE id = v_recipient
     LIMIT 1;

    IF v_auth_key IS NULL OR v_base_url IS NULL THEN
      RAISE WARNING
        'notify_invite_accepted: vault secrets missing (piktag_service_role_key / piktag_supabase_url)';
    ELSIF v_push_token IS NOT NULL AND length(v_push_token) > 0 THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Accept',        'application/json',
          'Authorization', 'Bearer ' || v_auth_key
        ),
        body    := jsonb_build_object(
          'to',       v_push_token,
          'title',    v_title,
          'body',     v_body,
          'data',     jsonb_build_object(
            'type',         'invite_accepted',
            'redeemer_id',  v_redeemer,
            'invite_id',    NEW.id,
            'invite_code',  NEW.invite_code
          ),
          'sound',    'default',
          'priority', 'high'
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_invite_accepted push dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_invite_accepted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_invite_accepted() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notify_invite_accepted ON public.piktag_invites;
CREATE TRIGGER trg_notify_invite_accepted
AFTER UPDATE OF used_by ON public.piktag_invites
FOR EACH ROW EXECUTE FUNCTION public.notify_invite_accepted();
