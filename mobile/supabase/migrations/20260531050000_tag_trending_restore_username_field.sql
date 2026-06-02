-- 20260531050000_tag_trending_restore_username_field.sql
--
-- REGRESSION FIX for the tag_trending consolidation in 20260531010000
-- (commit 6ae6031). 4.8 bug-scan 2026-06-03.
--
-- The bug: the ORIGINAL tag_trending function (20260428120005) set
-- `data.username = tag_name` with an explicit comment —
--   "Mobile UI always reads username + avatar_url; for tag_trending
--    we populate username with the tag name per spec §3.9."
-- The consolidation migration rewrote the data jsonb and DROPPED the
-- `username` field. That field is load-bearing on the client:
--
--   NotificationsScreen.getNotificationDisplay() only takes the
--   LOCALIZED i18n body branch when BOTH `i18nFound` AND a non-empty
--   `dataUsername` are true (line ~203):
--       if (i18nFound && dataUsername) return { username, body: i18nBody }
--   tag_trending has no actor, so `dataUsername` came ENTIRELY from
--   `data.username = tag_name`. With that field gone, dataUsername is
--   '' for single-tag rows, the localized branch is skipped, and the
--   row falls through to the raw English DB body
--   ("your tag #X is trending today") instead of the localized
--   "你的標籤 #X 今天爆紅了". It also loses the bold tag-name prefix.
--
-- So once the new cron writes single-tag rows, zh-TW (and every
-- non-English) user sees English tag_trending text — a visible
-- locale regression versus what the founder's own screenshots showed
-- (Chinese) from the pre-consolidation rows.
--
-- (Multi-tag rows are unaffected either way: the client short-
-- circuits on `tag_count > 1` to the pre-rendered server body and
-- ignores username — so restoring the field is correct for single
-- and harmless for multi.)
--
-- The fix: add `'username', v_tag_names[1]` back to the data jsonb.
-- Everything else in the function is byte-identical to 20260531010000.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.enqueue_tag_trending_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user        record;
  v_dedup       interval := '24 hours';
  v_body        text;
  v_tag_count   integer;
  v_tag_names   text[];
  v_first_three text;
BEGIN
  PERFORM public.refresh_tag_snapshots_today();

  FOR v_user IN
    WITH today AS (
      SELECT s.tag_id, s.usage_count
        FROM public.piktag_tag_snapshots s
       WHERE s.snapshot_date = CURRENT_DATE
    ),
    rolling AS (
      SELECT s.tag_id, AVG(s.usage_count)::numeric AS avg_7d
        FROM public.piktag_tag_snapshots s
       WHERE s.snapshot_date >= CURRENT_DATE - INTERVAL '7 days'
         AND s.snapshot_date <  CURRENT_DATE
       GROUP BY s.tag_id
    ),
    trending AS (
      SELECT
        t.id              AS tag_id,
        t.name            AS tag_name,
        td.usage_count    AS usage_count,
        CASE
          WHEN COALESCE(r.avg_7d, 0) = 0 THEN NULL
          ELSE td.usage_count::numeric / r.avg_7d
        END               AS growth_factor
      FROM public.piktag_tags t
      JOIN today    td ON td.tag_id = t.id
      LEFT JOIN rolling r ON r.tag_id = t.id
      WHERE r.avg_7d IS NOT NULL
        AND r.avg_7d > 0
        AND td.usage_count >= 5 * r.avg_7d
    ),
    user_trending AS (
      SELECT
        ut.user_id,
        ARRAY_AGG(tr.tag_name ORDER BY tr.growth_factor DESC NULLS LAST, tr.usage_count DESC) AS all_names,
        ARRAY_AGG(tr.tag_id ORDER BY tr.growth_factor DESC NULLS LAST, tr.usage_count DESC) AS all_ids,
        COUNT(*)::integer AS tag_count
      FROM trending tr
      JOIN public.piktag_user_tags ut ON ut.tag_id = tr.tag_id
      GROUP BY ut.user_id
    )
    SELECT
      ut.user_id,
      ut.all_names,
      ut.all_ids,
      ut.tag_count
    FROM user_trending ut
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.piktag_notifications n
       WHERE n.user_id = ut.user_id
         AND n.type    = 'tag_trending'
         AND n.created_at > now() - v_dedup
    )
  LOOP
    v_tag_count := v_user.tag_count;
    v_tag_names := v_user.all_names;

    IF v_tag_count = 1 THEN
      v_body := 'your tag #' || COALESCE(v_tag_names[1], '') || ' is trending today';
    ELSE
      v_first_three := '#' || array_to_string(
        v_tag_names[1:LEAST(v_tag_count, 3)], ' #'
      );
      IF v_tag_count <= 3 THEN
        v_body := 'your ' || v_tag_count || ' tags are trending today: ' || v_first_three;
      ELSE
        v_body := 'your ' || v_tag_count || ' tags are trending today: '
                  || v_first_three || ' +' || (v_tag_count - 3) || ' more';
      END IF;
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    )
    VALUES (
      v_user.user_id,
      'tag_trending',
      '',
      v_body,
      jsonb_build_object(
        'tag_name',         v_tag_names[1],
        'tag_id',           v_user.all_ids[1],
        -- RESTORED (see migration header): the client's localized-body
        -- branch requires a non-empty data.username; tag_trending has
        -- no actor, so the tag name doubles as the username (= the
        -- bold prefix). Single-tag rows now render the localized body
        -- + the prefix again; multi-tag rows ignore this field via the
        -- client's tag_count>1 short-circuit.
        'username',         v_tag_names[1],
        'tag_count',        v_tag_count,
        'tag_names',        to_jsonb(v_tag_names[1:LEAST(v_tag_count, 10)]),
        'primary_tag_id',   v_user.all_ids[1],
        'primary_tag_name', v_tag_names[1]
      ),
      false,
      now()
    );
  END LOOP;
END;
$$;
