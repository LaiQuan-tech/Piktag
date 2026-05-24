-- 20260428t_notification_recommendation.sql
--
-- Scheduled notification: type='recommendation'.
-- Spec card: docs/notification-types-spec.md §2.4.
--
-- Once a day, recommend up to 3 candidate users to each recipient. A
-- candidate is a user who:
--   1. Shares >= 2 mutual tags with the recipient (both rows in
--      piktag_user_tags reference the same tag_id).
--   2. Has no existing connection with the recipient — neither
--      direction in piktag_connections.
--   3. Is not blocked — neither direction in piktag_blocks.
--   4. Is not the recipient themselves.
--
-- Candidates are ranked by mutual_tag_count DESC and capped at 3 per
-- recipient. Each surviving (recipient, candidate) pair is dedup-checked
-- against piktag_notifications: skip if a row with
--   (user_id=recipient, type='recommendation',
--    data->>'recommended_user_id' = candidate)
-- exists within the last 14 days.
--
-- Each surviving pair becomes a row in piktag_notifications with:
--   title = ''
--   body  = 'you might know <username> — <count> mutual tags'
--   data  = { recommended_user_id, username, avatar_url,
--             mutual_tag_count, mutual_tag_ids }
--
-- After all rows are inserted, the helper attempts a single push per
-- recipient (the highest-scoring candidate only) by POSTing to the
-- notification-recommendation edge function via pg_net using the Vault
-- secrets piktag_service_role_key + piktag_supabase_url. The edge
-- function is responsible for resolving expo push tokens and forwarding
-- to https://exp.host/--/api/v2/push/send. Push failure never blocks
-- the insert.
--
-- Schedule: pg_cron daily at 09:30 UTC (the spec card says "09:30
-- local"; pg_cron only honors UTC on managed Supabase, so operators
-- adjust the cron expression per deployment timezone if a different
-- local hour is required).
--
-- Idempotent:
--   - CREATE OR REPLACE FUNCTION
--   - cron.unschedule(...) wrapped in DO block tolerant of "not found"
--   - cron.schedule(...) re-asserts the entry under a stable name.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =============================================================================
-- enqueue_recommendation_notifications()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_recommendation_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             record;
  v_inserted_count  integer := 0;
  v_auth_key        text;
  v_base_url        text;
  v_func_url        text;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. For every recipient, pick top-3 candidates (>=2 mutual tags, not
  --    connected, not blocked, not self), dedup against the last 14 days
  --    of piktag_notifications, and insert.
  -- ---------------------------------------------------------------------------
  FOR v_row IN
    WITH mutual AS (
      -- (recipient, candidate, count, tag_ids) for every pair sharing
      -- >=2 tags. Ordering pair as (recipient < candidate) is NOT done
      -- because we want directed rows: each user gets recommendations
      -- about every other user independently.
      SELECT
        ut_a.user_id                    AS recipient_id,
        ut_b.user_id                    AS candidate_id,
        COUNT(*)::int                   AS mutual_tag_count,
        ARRAY_AGG(ut_a.tag_id ORDER BY ut_a.tag_id) AS mutual_tag_ids
      FROM public.piktag_user_tags ut_a
      JOIN public.piktag_user_tags ut_b
        ON ut_a.tag_id = ut_b.tag_id
       AND ut_a.user_id <> ut_b.user_id
      GROUP BY ut_a.user_id, ut_b.user_id
      HAVING COUNT(*) >= 2
    ),
    filtered AS (
      SELECT
        m.recipient_id,
        m.candidate_id,
        m.mutual_tag_count,
        m.mutual_tag_ids,
        ROW_NUMBER() OVER (
          PARTITION BY m.recipient_id
          ORDER BY m.mutual_tag_count DESC, m.candidate_id
        ) AS rn
      FROM mutual m
      -- Exclude existing connections in either direction.
      WHERE NOT EXISTS (
              SELECT 1 FROM public.piktag_connections c
               WHERE (c.user_id = m.recipient_id AND c.connected_user_id = m.candidate_id)
                  OR (c.user_id = m.candidate_id AND c.connected_user_id = m.recipient_id)
            )
        -- Exclude blocks in either direction.
        AND NOT EXISTS (
              SELECT 1 FROM public.piktag_blocks b
               WHERE (b.blocker_id = m.recipient_id AND b.blocked_id = m.candidate_id)
                  OR (b.blocker_id = m.candidate_id AND b.blocked_id = m.recipient_id)
            )
    )
    SELECT
      f.recipient_id,
      f.candidate_id,
      f.mutual_tag_count,
      f.mutual_tag_ids,
      f.rn,
      p.username       AS candidate_username,
      p.full_name      AS candidate_full_name,
      p.avatar_url     AS candidate_avatar_url
    FROM filtered f
    JOIN public.piktag_profiles p
      ON p.id = f.candidate_id
    WHERE f.rn <= 3
      AND NOT EXISTS (
            SELECT 1 FROM public.piktag_notifications n
             WHERE n.user_id   = f.recipient_id
               AND n.type      = 'recommendation'
               AND n.data->>'recommended_user_id' = f.candidate_id::text
               AND n.created_at > now() - interval '14 days'
          )
    ORDER BY f.recipient_id, f.rn
  LOOP
    INSERT INTO public.piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    )
    VALUES (
      v_row.recipient_id,
      'recommendation',
      '',
      'you might know '
        || COALESCE(v_row.candidate_username, v_row.candidate_full_name, '')
        || ' — '
        || v_row.mutual_tag_count::text
        || ' mutual tags',
      jsonb_build_object(
        'recommended_user_id', v_row.candidate_id,
        'username',            COALESCE(v_row.candidate_username, v_row.candidate_full_name, ''),
        'avatar_url',          v_row.candidate_avatar_url,
        'mutual_tag_count',    v_row.mutual_tag_count,
        'mutual_tag_ids',      to_jsonb(v_row.mutual_tag_ids)
      ),
      false,
      now()
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  -- ---------------------------------------------------------------------------
  -- 2. Optional push fan-out via the notification-recommendation edge
  --    function. Reads vault secrets seeded by
  --    20260422_chat_push_trigger_vault.sql. If either is absent, log
  --    WARNING and skip — never raise.
  -- ---------------------------------------------------------------------------
  IF v_inserted_count > 0 THEN
    BEGIN
      SELECT decrypted_secret INTO v_auth_key
        FROM vault.decrypted_secrets
        WHERE name = 'piktag_service_role_key'
        LIMIT 1;

      SELECT decrypted_secret INTO v_base_url
        FROM vault.decrypted_secrets
        WHERE name = 'piktag_supabase_url'
        LIMIT 1;

      IF v_auth_key IS NULL OR v_base_url IS NULL THEN
        RAISE WARNING
          'enqueue_recommendation_notifications: vault secrets missing — push delivery skipped';
      ELSE
        v_func_url := v_base_url || '/functions/v1/notification-recommendation';

        PERFORM net.http_post(
          url     := v_func_url,
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || v_auth_key
          ),
          body    := jsonb_build_object(
            'mode',     'push_only',
            'inserted', v_inserted_count
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'enqueue_recommendation_notifications push fan-out failed: %', SQLERRM;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_recommendation_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_recommendation_notifications() TO postgres, service_role;

-- =============================================================================
-- pg_cron schedule — daily at 09:30 UTC.
-- =============================================================================
--
-- Wrapped in DO block so re-running the migration is idempotent: the
-- existing job (if any) is unscheduled before being re-asserted under
-- the same name.

DO $cron$
BEGIN
  PERFORM cron.unschedule('notification-recommendation-daily');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" — fine on first install.
  NULL;
END
$cron$;

SELECT cron.schedule(
  'notification-recommendation-daily',
  '30 9 * * *',
  $cmd$ SELECT public.enqueue_recommendation_notifications(); $cmd$
);
