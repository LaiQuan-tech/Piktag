-- 20260428w_notification_birthday.sql
--
-- Scheduled notification: 'birthday' (reminders tab).
--
-- For every piktag_connections row whose effective birthday (per-connection
-- override, or fallback to the connected user's piktag_profiles.birthday)
-- has month/day matching today's month/day, enqueue a notification to
-- piktag_connections.user_id (the owner / viewer).
--
-- Dedup: skip if a 'birthday' notification for the same connected_user_id
-- has been emitted to this recipient within the last 300 days (per spec
-- §2.7 — once-per-year guard).
--
-- Schedule: daily at 08:00 UTC via pg_cron. The spec requests "08:00
-- local"; without a per-user timezone column the closest portable choice
-- is 08:00 UTC. Run cadence = once per day, which matches the spec.
--
-- Push delivery: this migration creates the in-app notification rows
-- (which the realtime subscription fans out to connected clients). The
-- companion edge function `notification-birthday` (separate slice) is
-- responsible for outbound Expo push delivery and may invoke the same
-- helper or run its own logic.
--
-- Idempotency: the migration is safe to re-run — function is CREATE OR
-- REPLACE, the cron job is removed and re-scheduled, and the helper's
-- internal NOT EXISTS dedup guards against duplicate rows on repeated
-- invocations within the 300-day window.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =============================================================================
-- Helper: enqueue_birthday_notifications()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_birthday_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_username  text;
  v_birthday  date;
  v_age       integer;
  v_body      text;
BEGIN
  FOR v_row IN
    SELECT
      c.id                                                    AS connection_id,
      c.user_id                                               AS recipient_id,
      c.connected_user_id                                     AS connected_user_id,
      c.nickname                                              AS nickname,
      COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)                        AS effective_birthday,
      p.username                                              AS profile_username,
      p.full_name                                             AS profile_full_name,
      p.avatar_url                                            AS avatar_url
    FROM piktag_connections c
    LEFT JOIN piktag_profiles p ON p.id = c.connected_user_id
    WHERE COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END) IS NOT NULL
      AND EXTRACT(MONTH FROM COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'UTC')::date)
      AND EXTRACT(DAY   FROM COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)) = EXTRACT(DAY   FROM (now() AT TIME ZONE 'UTC')::date)
  LOOP
    -- Dedup: same recipient + same connected_user_id within 300d.
    IF EXISTS (
      SELECT 1
        FROM piktag_notifications n
       WHERE n.user_id = v_row.recipient_id
         AND n.type    = 'birthday'
         AND n.data->>'connected_user_id' = v_row.connected_user_id::text
         AND n.created_at > now() - interval '300 days'
       LIMIT 1
    ) THEN
      CONTINUE;
    END IF;

    v_username := COALESCE(NULLIF(v_row.nickname, ''),
                           NULLIF(v_row.profile_full_name, ''),
                           NULLIF(v_row.profile_username, ''),
                           '');
    v_birthday := v_row.effective_birthday;

    -- Compute age only if year of birth is known and not the SQL "year-unknown"
    -- placeholder (1900). Otherwise leave null.
    IF v_birthday IS NOT NULL AND EXTRACT(YEAR FROM v_birthday) > 1900 THEN
      v_age := EXTRACT(YEAR FROM age((now() AT TIME ZONE 'UTC')::date, v_birthday))::integer;
    ELSE
      v_age := NULL;
    END IF;

    v_body := 'it''s ' || v_username || '''s birthday today';

    INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
    VALUES (
      v_row.recipient_id,
      'birthday',
      '',
      v_body,
      jsonb_build_object(
        'connected_user_id', v_row.connected_user_id,
        'connection_id',     v_row.connection_id,
        'username',          v_username,
        'avatar_url',        v_row.avatar_url,
        'birthday',          to_char(v_birthday, 'MM-DD'),
        'age',               v_age
      ),
      false,
      now()
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_birthday_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_birthday_notifications() TO postgres, service_role;

-- =============================================================================
-- pg_cron schedule — daily 08:00 UTC.
-- =============================================================================

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'notification-birthday-daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;

SELECT cron.schedule(
  'notification-birthday-daily',
  '0 8 * * *',
  $cron$ SELECT public.enqueue_birthday_notifications(); $cron$
);
