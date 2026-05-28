-- 20260528010000_drop_p_coin_from_invite_notif.sql
--
-- The p_points / P 幣 system was retired in the Tribe-size pivot
-- (the DB columns + ledger were kept for historical reasons, but the
-- user-facing surface — points balance, points-earned animations,
-- PointsHistory route — was removed). The invite-accepted notification
-- trigger was the last place still saying "你獲得 1 P 幣" in its body,
-- shipping a misleading reward claim to the inviter every time their
-- invite is redeemed.
--
-- This migration drops the "— 你獲得 1 P 幣" suffix from the v_body
-- string. Everything else about the trigger is identical to the
-- 20260508150000 version (vault secrets lookup, push dispatch,
-- defensive exception handling). i18n is handled client-side via the
-- notifications.types.invite_accepted.body key which already exists
-- in all 19 locales and is also already P-coin-free — this fixes the
-- last leak point at the SQL/DB layer.

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
  IF NEW.used_by IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.used_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_recipient := NEW.inviter_id;
  v_redeemer  := NEW.used_by;

  IF v_recipient IS NULL OR v_redeemer IS NULL OR v_recipient = v_redeemer THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.username, ''),
         p.avatar_url,
         COALESCE(p.full_name, p.username, '')
    INTO v_redeemer_uname,
         v_redeemer_avatar,
         v_redeemer_name
    FROM public.piktag_profiles p
   WHERE p.id = v_redeemer;

  v_title := '你的邀請被接受了 🎉';
  -- DROP " — 你獲得 1 P 幣" — the p_points system was retired.
  v_body  := COALESCE(NULLIF(v_redeemer_name, ''), '有人') || ' 加入了 PikTag';

  BEGIN
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
        'avatar_url',   v_redeemer_avatar
        -- 'points_awarded' field also dropped from data payload —
        -- nothing in the client reads it anymore.
      ),
      false,
      now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_invite_accepted in-app insert failed: %', SQLERRM;
  END;

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
