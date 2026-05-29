-- 20260530070000_endorsement_drop_question.sql
--
-- Founder, 2026-05-30: "我覺得這句話根本不應該問使用者，
-- 這句話是找使用者麻煩".
--
-- The endorsement_request notification body used to be
-- "X tagged themselves as #Y — do you agree?". The "do you
-- agree?" tail (and its 18 localized equivalents) was the
-- "認同" rubber-stamp button reborn as a question, which is
-- exactly the anti-pattern locked in CLAUDE.md "No rubber-
-- stamp social buttons" — the question form puts the same
-- social pressure on the viewer.
--
-- The notification's useful function — surfacing "a friend
-- self-tagged something potentially worth your organic
-- endorsement" — survives the cut. The body just becomes
-- a fact: "X tagged themselves #Y". Tap routes to their
-- FriendDetail (already wired in 80a8568); viewer decides
-- via the existing tap-to-add chip flow, or ignores. Zero
-- ask.
--
-- This migration ONLY rewrites the English fallback string
-- baked into the cron's INSERT. The 19 locale JSONs
-- (notifications.types.endorsement_request.body) were
-- rewritten in the same commit; modern clients render those
-- and never see this fallback. Selection logic (priority
-- cascade, 90-day window, per-friend monthly cap, principle
-- #6 removal guard, friend-not-already-tagged check) is
-- preserved verbatim from 20260529060000 — only the body
-- string literal at lines 114-117 changes.

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
      ut.user_id    AS target_id,
      ut.tag_id     AS tag_id,
      ut.created_at AS tag_created_at
    FROM piktag_user_tags ut
    WHERE ut.is_private = false
      AND ut.created_at > now() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM piktag_connection_tags ct
        JOIN piktag_connections c ON c.id = ct.connection_id
        WHERE c.connected_user_id = ut.user_id
          AND ct.tag_id = ut.tag_id
          AND ct.is_private = false
      )
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
          AND NOT EXISTS (
            SELECT 1 FROM piktag_notifications n
            WHERE n.user_id = conn.user_id
              AND n.type = 'endorsement_request'
              AND n.created_at > now() - interval '30 days'
          )
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
    -- English fallback ONLY for legacy clients that don't
    -- render via notifications.types.endorsement_request.body.
    -- The trailing "— do you agree?" question was removed
    -- 2026-05-30 per CLAUDE.md "No rubber-stamp social
    -- buttons" — viewer should be informed, not asked.
    COALESCE(tp.username, tp.full_name, 'A friend') ||
      ' tagged themselves #' ||
      COALESCE(tt.name, 'a tag'),
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
GRANT EXECUTE ON FUNCTION public.enqueue_endorsement_requests()
  TO postgres, service_role;
