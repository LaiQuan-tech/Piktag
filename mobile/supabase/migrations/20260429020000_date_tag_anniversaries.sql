-- 20260429b_date_tag_anniversaries.sql
--
-- Lightweight "tag a date, get a yearly reminder" CRM.
--
-- Hidden tags whose name matches `YYYY/MM/DD` (e.g. `#2025/04/29`)
-- become annual anniversary triggers. Every year on the same MM/DD,
-- a notification fires on the viewer's reminders tab.
--
-- Why this exists: the user wants the lightest possible CRM. Rather
-- than collecting separate fields (anniversary, contract_expiry,
-- follow_up_date — all of which we've either dropped or moved to
-- automatic), we let the existing tag system do the work. Whatever
-- date a viewer thought worth tagging IS the thing they want
-- reminded about a year later.
--
-- Pattern: this helper inserts notification rows of type='anniversary'
-- (re-uses the existing reminders-tab filter + press handler). Idempotent
-- via a SELECT check on (user_id, type, title) before insert.
--
-- The matching Edge Function (daily-date-tag-anniversaries) calls this
-- helper, then sweeps up the just-inserted rows to fire pushes —
-- mirroring daily-birthday-check's pattern.

CREATE OR REPLACE FUNCTION public.enqueue_date_tag_anniversaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Cron fires at 01:00 UTC; shift +8h so "today" matches the TW
  -- viewer's wall clock for the morning prompt.
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_today_mmdd text := to_char(v_today, 'MM/DD');
  v_today_year int := extract(year FROM v_today)::int;
  v_row record;
  v_title text;
  v_body text;
  v_tag_year int;
  v_years int;
  v_friend_name text;
  v_already_exists boolean;
BEGIN
  -- Find every (connection, hidden tag) pair where the tag name is a
  -- valid YYYY/MM/DD whose MM/DD matches today and whose YYYY is
  -- strictly before this year (so we don't fire on the day someone
  -- adds a future date or on the same day they tagged it).
  FOR v_row IN
    SELECT
      c.user_id            AS recipient,
      c.connected_user_id  AS connected_user_id,
      c.id                 AS connection_id,
      c.nickname           AS nickname,
      cu.full_name         AS connected_full_name,
      cu.username          AS connected_username,
      cu.avatar_url        AS connected_avatar_url,
      t.name               AS tag_name,
      t.id                 AS tag_id
    FROM piktag_connection_tags ct
    JOIN piktag_tags t ON t.id = ct.tag_id
    JOIN piktag_connections c ON c.id = ct.connection_id
    LEFT JOIN piktag_profiles cu ON cu.id = c.connected_user_id
    WHERE ct.is_private = true
      AND t.name ~ '^\d{4}/\d{2}/\d{2}$'
      AND substring(t.name from 6) = v_today_mmdd
      AND substring(t.name from 1 for 4)::int < v_today_year
  LOOP
    v_tag_year := substring(v_row.tag_name from 1 for 4)::int;
    v_years := v_today_year - v_tag_year;
    v_friend_name := COALESCE(
      v_row.nickname,
      v_row.connected_full_name,
      v_row.connected_username,
      '朋友'
    );

    -- Title: 「和 林宏達 的紀念日」  Body: 「1 年前的今天 · #2025/04/29」
    -- The friend's name + #tag uniquely identifies this anniversary
    -- per (user, year), so it works as the dedupe key for upsert.
    v_title := '和 ' || v_friend_name || ' 的紀念日';
    v_body := v_years::text || ' 年前的今天 · #' || v_row.tag_name;

    -- Idempotent: skip if we've already inserted this exact title for
    -- this viewer (different friends produce different titles, so
    -- collision implies same-day re-run, not different events).
    SELECT EXISTS (
      SELECT 1 FROM piktag_notifications
      WHERE user_id = v_row.recipient
        AND type = 'anniversary'
        AND title = v_title
        AND created_at >= (v_today::timestamptz - interval '6 hours')
    ) INTO v_already_exists;

    IF v_already_exists THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    ) VALUES (
      v_row.recipient,
      'anniversary',
      v_title,
      v_body,
      jsonb_build_object(
        'connected_user_id', v_row.connected_user_id,
        'connection_id',     v_row.connection_id,
        'tag_id',            v_row.tag_id,
        'tag_name',          v_row.tag_name,
        'years',             v_years,
        'source',            'date_tag'
      ),
      false,
      now()
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_date_tag_anniversaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_date_tag_anniversaries()
  TO postgres, service_role;
