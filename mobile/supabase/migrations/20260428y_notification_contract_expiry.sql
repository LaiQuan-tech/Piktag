-- 20260428y_notification_contract_expiry.sql
--
-- Scheduled notification helper: contract_expiry
--
-- Fires for each piktag_connections row whose contract_expiry date is
-- exactly 30, 7, 1, or 0 days from today. Each (connection, milestone)
-- pair fires once per all time (no duplicate notifications for the same
-- milestone on the same contract). Push notifications are dispatched
-- via the notification-contract-expiry edge function relay using the
-- vault secrets seeded by 20260422_chat_push_trigger_vault.sql.
--
-- Spec ref: docs/notification-types-spec.md §2.9.
-- Conventions: §3.3 (helper naming), §3.7 (dedup), §3.8 (SECURITY
-- DEFINER + search_path), §3.9 (insert convention), §3.10 (push relay).
--
-- This migration is idempotent: CREATE OR REPLACE on the function,
-- DROP-and-recreate on the cron schedule, IF NOT EXISTS / DO blocks
-- where applicable.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =============================================================================
-- Helper: enqueue_contract_expiry_notifications()
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_contract_expiry_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row              record;
  v_username         text;
  v_avatar           text;
  v_body             text;
  v_push_token       text;
  v_auth_key         text;
  v_base_url         text;
  v_func_url         text;
  v_today            date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Resolve push relay creds once. If missing, we still insert the
  -- notification rows; only push delivery is skipped (mirrors
  -- piktag_notify_message_push behaviour).
  SELECT decrypted_secret INTO v_auth_key
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_service_role_key'
    LIMIT 1;
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets
    WHERE name = 'piktag_supabase_url'
    LIMIT 1;
  IF v_base_url IS NOT NULL THEN
    v_func_url := v_base_url || '/functions/v1/notification-contract-expiry';
  END IF;

  FOR v_row IN
    SELECT
      c.id                                   AS connection_id,
      c.user_id                              AS recipient,
      c.connected_user_id                    AS connected_user_id,
      c.nickname                             AS nickname,
      c.contract_expiry                      AS contract_expiry,
      (c.contract_expiry - v_today)          AS days_until,
      p.username                             AS p_username,
      p.full_name                            AS p_full_name,
      p.avatar_url                           AS p_avatar_url
    FROM piktag_connections c
    LEFT JOIN piktag_profiles p ON p.id = c.connected_user_id
    WHERE c.contract_expiry IS NOT NULL
      AND (c.contract_expiry - v_today) IN (30, 7, 1, 0)
  LOOP
    -- Dedup: skip if this exact (connection, days_until) milestone has
    -- ever been emitted before.
    IF EXISTS (
      SELECT 1 FROM piktag_notifications n
       WHERE n.user_id = v_row.recipient
         AND n.type    = 'contract_expiry'
         AND n.data->>'connection_id' = v_row.connection_id::text
         AND n.data->>'days_until'    = v_row.days_until::text
    ) THEN
      CONTINUE;
    END IF;

    v_username := COALESCE(
      NULLIF(v_row.nickname, ''),
      NULLIF(v_row.p_full_name, ''),
      NULLIF(v_row.p_username, ''),
      ''
    );
    v_avatar := v_row.p_avatar_url;

    IF v_row.days_until = 0 THEN
      v_body := 'your contract with ' || v_username || ' expires today';
    ELSIF v_row.days_until = 1 THEN
      v_body := 'your contract with ' || v_username || ' expires in 1 day';
    ELSE
      v_body := 'your contract with ' || v_username
                || ' expires in ' || v_row.days_until::text || ' days';
    END IF;

    INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
    VALUES (
      v_row.recipient,
      'contract_expiry',
      '',
      v_body,
      jsonb_build_object(
        'connected_user_id', v_row.connected_user_id,
        'connection_id',     v_row.connection_id,
        'username',          v_username,
        'avatar_url',        v_avatar,
        'contract_expiry',   to_char(v_row.contract_expiry, 'YYYY-MM-DD'),
        'days_until',        v_row.days_until
      ),
      false,
      now()
    );

    -- Fire-and-forget push relay. Wrapped so a failure here cannot
    -- abort the loop (other recipients still get their notifications).
    IF v_auth_key IS NOT NULL AND v_func_url IS NOT NULL THEN
      -- Resolve recipient push token. NULL token => skip the relay
      -- entirely; the in-app notification row is already inserted above.
      SELECT push_token INTO v_push_token
        FROM piktag_profiles
        WHERE id = v_row.recipient
        LIMIT 1;

      IF v_push_token IS NOT NULL AND v_push_token <> '' THEN
        BEGIN
          PERFORM net.http_post(
            url     := v_func_url,
            headers := jsonb_build_object(
              'Content-Type',  'application/json',
              'Authorization', 'Bearer ' || v_auth_key
            ),
            body    := jsonb_build_object(
              'recipient_id',      v_row.recipient,
              'connection_id',     v_row.connection_id,
              'connected_user_id', v_row.connected_user_id,
              'username',          v_username,
              'avatar_url',        v_avatar,
              'contract_expiry',   to_char(v_row.contract_expiry, 'YYYY-MM-DD'),
              'days_until',        v_row.days_until,
              'body',              v_body,
              'push_token',        v_push_token
            )
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING
            'enqueue_contract_expiry_notifications push relay failed: %',
            SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_contract_expiry_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_contract_expiry_notifications()
  TO postgres, service_role;

-- =============================================================================
-- pg_cron schedule: daily at 08:10 UTC (per §2.9)
-- =============================================================================
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
    FROM cron.job
    WHERE jobname = 'notification-contract-expiry-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'notification-contract-expiry-daily',
  '10 8 * * *',
  $cron$ SELECT public.enqueue_contract_expiry_notifications(); $cron$
);
