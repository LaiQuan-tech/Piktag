-- 20260428x_notification_anniversary.sql
-- Scheduled notification helper: emit a 'anniversary' notification for each
-- piktag_connections row where today's month/day matches the connection's
-- anniversary date (preferring the explicit `anniversary` column when present,
-- falling back to `met_at`) AND the elapsed years is >= 1. Dedup is "ever":
-- each (connection, year) anniversary fires exactly once for all time.
--
-- Coordinator note (per docs/notification-types-spec.md §2.8):
--   The legacy `daily-followup-check` edge function already emits an
--   "On This Day" reminder under `type='reminder'`. That overlapping legacy
--   path is intentionally LEFT IN PLACE here. This migration introduces the
--   canonical `type='anniversary'` row alongside the legacy reminder. A
--   follow-up cleanup migration (out of scope for this slice) will migrate
--   legacy rows and remove the duplicate emission.
--
-- Idempotent: CREATE OR REPLACE on the function, and a guarded reschedule of
-- the pg_cron job by name.

CREATE OR REPLACE FUNCTION public.enqueue_anniversary_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_today_month int := extract(month FROM v_today)::int;
  v_today_day   int := extract(day   FROM v_today)::int;
  v_username    text;
  v_body        text;
BEGIN
  FOR v_row IN
    SELECT
      c.id                       AS connection_id,
      c.user_id                  AS recipient,
      c.connected_user_id        AS connected_user_id,
      c.nickname                 AS nickname,
      -- Effective anniversary date: prefer explicit column, fall back to met_at.
      COALESCE(c.anniversary, c.met_at::date) AS effective_date,
      p.full_name                AS connected_full_name,
      p.username                 AS connected_username,
      p.avatar_url               AS connected_avatar_url
    FROM piktag_connections c
    LEFT JOIN piktag_profiles p ON p.id = c.connected_user_id
    WHERE COALESCE(c.anniversary, c.met_at::date) IS NOT NULL
      AND extract(month FROM COALESCE(c.anniversary, c.met_at::date))::int = v_today_month
      AND extract(day   FROM COALESCE(c.anniversary, c.met_at::date))::int = v_today_day
      -- years >= 1 (anniversary year must have elapsed at least once)
      AND extract(year FROM age(v_today, COALESCE(c.anniversary, c.met_at::date)))::int >= 1
  LOOP
    -- Compute years-since for body + dedup.
    DECLARE
      v_years int := extract(year FROM age(v_today, v_row.effective_date))::int;
      v_already_exists boolean;
    BEGIN
      -- Dedup: "ever" — same (user_id, type='anniversary', connection_id, years)
      -- has already produced a row at any point in history.
      SELECT EXISTS (
        SELECT 1 FROM piktag_notifications n
         WHERE n.user_id = v_row.recipient
           AND n.type    = 'anniversary'
           AND n.data->>'connection_id' = v_row.connection_id::text
           AND (n.data->>'years')::int   = v_years
      ) INTO v_already_exists;

      IF v_already_exists THEN
        CONTINUE;
      END IF;

      v_username := COALESCE(
        NULLIF(v_row.nickname, ''),
        NULLIF(v_row.connected_full_name, ''),
        NULLIF(v_row.connected_username, ''),
        ''
      );

      v_body := format('%s years ago today, you met %s', v_years, v_username);

      INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
      VALUES (
        v_row.recipient,
        'anniversary',
        '',
        v_body,
        jsonb_build_object(
          'connected_user_id', v_row.connected_user_id,
          'connection_id',     v_row.connection_id,
          'username',          v_username,
          'avatar_url',        v_row.connected_avatar_url,
          'years',             v_years,
          'met_at',            to_char(v_row.effective_date, 'YYYY-MM-DD')
        ),
        false,
        now()
      );
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_anniversary_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_anniversary_notifications() TO postgres, service_role;

-- Schedule via pg_cron — daily at 08:05 UTC per spec card §2.8.
-- pg_cron is already enabled in this project (used by other slices /
-- daily-followup-check). Idempotent: unschedule any prior job with the same
-- name before re-creating, so re-running this migration is safe.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('notification-anniversary-daily')
      WHERE EXISTS (
        SELECT 1 FROM cron.job WHERE jobname = 'notification-anniversary-daily'
      );

    PERFORM cron.schedule(
      'notification-anniversary-daily',
      '5 8 * * *',
      $job$ SELECT public.enqueue_anniversary_notifications(); $job$
    );
  END IF;
END
$cron$;
