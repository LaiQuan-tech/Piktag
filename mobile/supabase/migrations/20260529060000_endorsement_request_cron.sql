-- 20260529060000_endorsement_request_cron.sql
--
-- North-Star tag-quality principle #3 (active-learning style
-- endorsement prompts). See CLAUDE.md "Tag-quality principles".
-- Converts the passive "wait for friends to organically tag"
-- loop into an active 采集 mechanism: a daily cron picks (target,
-- tag, friend) trios where the gap is most useful to close, and
-- writes an `endorsement_request` notification to the friend.
--
-- Selection logic (in priority order):
--   1. Target's PUBLIC self-tag must exist (target asserted this
--      about themselves).
--   2. NO friend has publicly endorsed that same tag on the target
--      yet (else the verified bit is already set; no need to ask).
--   3. Target hasn't REMOVED this tag in the past (principle #6:
--      don't re-suggest a rejected tag).
--   4. Self-tag created within the past 90 days (older tags are
--      stable identity, not the cold-start gap we want to close).
--   5. Friend = most-recently-connected to target (more likely to
--      remember + respond), skipping any friend who has been
--      asked to endorse anything in the past 30 days (per-friend
--      monthly cap — anti-spam).
--   6. Friend hasn't already privately or publicly tagged that
--      target with that tag.
--
-- One distinct target per cron run (DISTINCT ON target_id) so a
-- noisy single target doesn't flood the system. Per-friend monthly
-- cap is the global rate limit — friends won't get more than ~1
-- endorsement request every 30 days regardless of how many
-- targets need help.
--
-- The notification body intentionally renders client-side via the
-- existing `notifications.types.endorsement_request.body` i18n key
-- (added in the companion mobile commit) — keeps push-time text
-- in English and in-app text fully localised, per the pattern
-- established for the other notification types.

CREATE OR REPLACE FUNCTION public.enqueue_endorsement_requests()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH candidates AS (
    SELECT
      ut.user_id   AS target_id,
      ut.tag_id    AS tag_id,
      ut.created_at AS tag_created_at
    FROM piktag_user_tags ut
    WHERE ut.is_private = false
      AND ut.created_at > now() - interval '90 days'
      -- Skip tags the target already has a friend endorsement for
      AND NOT EXISTS (
        SELECT 1 FROM piktag_connection_tags ct
        JOIN piktag_connections c ON c.id = ct.connection_id
        WHERE c.connected_user_id = ut.user_id
          AND ct.tag_id = ut.tag_id
          AND ct.is_private = false
      )
      -- Skip tags the target has actively removed before (principle #6)
      AND NOT EXISTS (
        SELECT 1 FROM piktag_tag_removals tr
        WHERE tr.user_id = ut.user_id AND tr.tag_id = ut.tag_id
      )
  ),
  candidate_with_friend AS (
    SELECT
      c.target_id,
      c.tag_id,
      c.tag_created_at,
      (
        SELECT conn.user_id
        FROM piktag_connections conn
        WHERE conn.connected_user_id = c.target_id
          AND conn.user_id IS DISTINCT FROM c.target_id
          -- Per-friend monthly cap
          AND NOT EXISTS (
            SELECT 1 FROM piktag_notifications n
            WHERE n.user_id = conn.user_id
              AND n.type = 'endorsement_request'
              AND n.created_at > now() - interval '30 days'
          )
          -- Friend hasn't already endorsed (or privately noted) this tag
          AND NOT EXISTS (
            SELECT 1 FROM piktag_connection_tags ct2
            WHERE ct2.connection_id = conn.id AND ct2.tag_id = c.tag_id
          )
        ORDER BY conn.created_at DESC
        LIMIT 1
      ) AS friend_id
    FROM candidates c
  ),
  chosen AS (
    SELECT DISTINCT ON (target_id)
      target_id, tag_id, friend_id
    FROM candidate_with_friend
    WHERE friend_id IS NOT NULL
    ORDER BY target_id, tag_created_at DESC
  )
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  SELECT
    ch.friend_id,
    'endorsement_request',
    '',
    -- Best-effort English fallback body for legacy clients that
    -- don't speak the new i18n key. Modern clients render via
    -- notifications.types.endorsement_request.body with the
    -- username + tag_name substituted from the data payload.
    COALESCE(tp.username, tp.full_name, 'A friend') ||
      ' tagged themselves as #' ||
      COALESCE(tt.name, 'a tag') ||
      ' — do you agree?',
    jsonb_build_object(
      'target_user_id', ch.target_id,
      'tag_id',         ch.tag_id,
      'tag_name',       tt.name,
      'username',       COALESCE(tp.username, tp.full_name, ''),
      'avatar_url',     tp.avatar_url
    ),
    false,
    now()
  FROM chosen ch
  JOIN piktag_tags     tt ON tt.id = ch.tag_id
  JOIN piktag_profiles tp ON tp.id = ch.target_id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_endorsement_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_endorsement_requests() TO postgres, service_role;

-- Daily schedule — 19:00 UTC = 03:00 Taipei (low-traffic).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'endorsement-requests-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END;
$$;

SELECT cron.schedule(
  'endorsement-requests-daily',
  '0 19 * * *',
  $cron$ SELECT public.enqueue_endorsement_requests(); $cron$
);

-- ─── RPC: endorse_tag_from_notification ────────────────────────────
-- Called when a friend taps "認同" on an endorsement_request
-- notification. Resolves the connection from caller→target, inserts
-- the public connection_tag (idempotent), and marks the notification
-- as read.

CREATE OR REPLACE FUNCTION public.endorse_tag_from_notification(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_friend         uuid := auth.uid();
  v_data           jsonb;
  v_target         uuid;
  v_tag_id         uuid;
  v_connection_id  uuid;
BEGIN
  IF v_friend IS NULL THEN
    RETURN false;
  END IF;

  -- Fetch notification + ownership check
  SELECT data INTO v_data
    FROM public.piktag_notifications
   WHERE id = p_notification_id
     AND user_id = v_friend
     AND type = 'endorsement_request'
   LIMIT 1;

  IF v_data IS NULL THEN
    RETURN false;
  END IF;

  v_target := (v_data->>'target_user_id')::uuid;
  v_tag_id := (v_data->>'tag_id')::uuid;

  -- Find the calling friend's outgoing connection to the target.
  SELECT id INTO v_connection_id
    FROM public.piktag_connections
   WHERE user_id = v_friend
     AND connected_user_id = v_target
   LIMIT 1;

  IF v_connection_id IS NULL THEN
    -- Connection vanished between request fire and accept — silently
    -- mark the notification read so it doesn't sit forever, return false.
    UPDATE public.piktag_notifications
       SET is_read = true
     WHERE id = p_notification_id AND user_id = v_friend;
    RETURN false;
  END IF;

  -- Insert public endorsement. ON CONFLICT covers the rare race
  -- where the friend also organically tagged the target same-moment.
  INSERT INTO public.piktag_connection_tags (connection_id, tag_id, is_private)
  VALUES (v_connection_id, v_tag_id, false)
  ON CONFLICT (connection_id, tag_id) DO NOTHING;

  UPDATE public.piktag_notifications
     SET is_read = true
   WHERE id = p_notification_id AND user_id = v_friend;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.endorse_tag_from_notification(uuid) TO authenticated;
