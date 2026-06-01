-- 20260531010000_tag_trending_consolidate_per_user.sql
--
-- Consolidate tag_trending notifications: ONE row per user per day,
-- regardless of how many of their tags are trending. Founder caught
-- the spam pattern 2026-05-31 — a user with 4 self-tags all trending
-- (#AI, #Startup, #PM, #PikTag) received 4 separate rows in the same
-- minute, which reads as "煩躁 / annoying" not "useful signal".
--
-- The old function (20260428120005) ran a per-tag → per-owner loop
-- with dedup keyed on (user_id, tag_id, 7-day window). Same user
-- could legitimately receive N rows the same day if N of their
-- self-tags trended at once. Today's screenshot showed exactly that.
--
-- New behaviour:
--   • Compute trending tags (same 5×-growth-over-7d-avg detection).
--   • For each user owning ≥1 trending tag AND who has NOT received
--     a tag_trending notification in the last 24h, INSERT ONE row
--     summarising ALL their trending tags.
--   • data.tag_count: total count
--   • data.tag_names: array of up to 10 names (cap for body length)
--   • data.primary_tag_id / data.primary_tag_name: highest-growth tag
--     (used by the push payload as the "lead" tag in single-tag
--     pushes and as the deep-link anchor)
--   • Server-rendered English body — non-empty per CLAUDE.md
--     "non-empty body" rule (2026-05-30 vibe_shift incident). Client
--     i18n templates handle the single-tag case (existing
--     `notifications.types.tag_trending.body` reads `data.tag_name`);
--     multi-tag case falls back to this server body until per-locale
--     pluralized templates land in a follow-up.
--
-- Idempotent: CREATE OR REPLACE; the underlying snapshot table and
-- the 24h dedup query both tolerate replay.

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
  -- Snapshot today so the growth calc has a fresh row.
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
        -- All trending tags this user owns, ordered by growth desc.
        ARRAY_AGG(tr.tag_name ORDER BY tr.growth_factor DESC NULLS LAST, tr.usage_count DESC) AS all_names,
        ARRAY_AGG(tr.tag_id ORDER BY tr.growth_factor DESC NULLS LAST, tr.usage_count DESC) AS all_ids,
        COUNT(*)::integer AS tag_count
      FROM trending tr
      JOIN public.piktag_user_tags ut ON ut.tag_id = tr.tag_id
      GROUP BY ut.user_id
    )
    -- Per-user dedup: skip anyone who already got a tag_trending
    -- notification in the last 24h. This is the new restraint: max
    -- 1 row per user per day, regardless of tag count.
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

    -- Build the English fallback body. Cap displayed tag list at 3
    -- so the body stays scannable; the full list lives in data.tag_names.
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
        -- Single-tag case keeps `tag_name` / `tag_id` at the top
        -- level so the existing client template (which reads
        -- `data.tag_name`) renders correctly without any update.
        'tag_name',         v_tag_names[1],
        'tag_id',           v_user.all_ids[1],
        -- New fields for the consolidated case. Client checks
        -- `tag_count > 1` to decide whether to use the server body
        -- vs the legacy single-tag template.
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
