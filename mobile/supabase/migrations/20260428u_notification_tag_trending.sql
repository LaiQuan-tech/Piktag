-- 20260428u_notification_tag_trending.sql
-- Scheduled notification helper: detect tags whose usage_count grew >= 5x
-- their 7-day rolling average and notify owners (piktag_user_tags) of those tags.
--
-- Owns: piktag_tag_snapshots table (created here if absent — see spec §6).
-- Helper: public.enqueue_tag_trending_notifications() — SECURITY DEFINER, returns void.
-- Schedule: daily 08:00 UTC via pg_cron.
-- Dedup window: 7 days per (user_id, type='tag_trending', data->>'tag_id').
-- Push: rank 1 only (handled by the matching edge function — this migration owns
-- the in-app insert + dedup; push fan-out is performed by `notification-tag-trending`).
--
-- Idempotent: all CREATE statements are guarded; pg_cron job is reschedulable.

BEGIN;

------------------------------------------------------------------------------
-- 1. piktag_tag_snapshots — daily snapshots of tag usage_count (this slice owns it)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.piktag_tag_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id        uuid NOT NULL REFERENCES public.piktag_tags(id) ON DELETE CASCADE,
  usage_count   integer NOT NULL,
  snapshot_date date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT piktag_tag_snapshots_tag_date_uniq UNIQUE (tag_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_piktag_tag_snapshots_date
  ON public.piktag_tag_snapshots (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_piktag_tag_snapshots_tag_date
  ON public.piktag_tag_snapshots (tag_id, snapshot_date DESC);

ALTER TABLE public.piktag_tag_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role / definers handle all writes & reads. Authenticated users do not
-- need to read snapshots directly (the trending list is materialized into
-- piktag_notifications). Drop+recreate keeps idempotence.
DROP POLICY IF EXISTS piktag_tag_snapshots_service_all ON public.piktag_tag_snapshots;
CREATE POLICY piktag_tag_snapshots_service_all
  ON public.piktag_tag_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.piktag_tag_snapshots
  TO postgres, service_role;

------------------------------------------------------------------------------
-- 2. Helper: refresh today's snapshot row for every tag.
--    Called at the top of enqueue_tag_trending_notifications() so the trending
--    detection always has a fresh "today" row to compare against the 7d window.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_tag_snapshots_today()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.piktag_tag_snapshots (tag_id, usage_count, snapshot_date)
  SELECT t.id, COALESCE(t.usage_count, 0), CURRENT_DATE
    FROM public.piktag_tags t
  ON CONFLICT (tag_id, snapshot_date)
  DO UPDATE SET usage_count = EXCLUDED.usage_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_tag_snapshots_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_tag_snapshots_today() TO postgres, service_role;

------------------------------------------------------------------------------
-- 3. Main helper: enqueue_tag_trending_notifications()
--    Trending tag = today's usage_count >= 5x its 7-day rolling average
--    (computed over snapshots strictly before today). For each trending tag,
--    insert one notification per owner in piktag_user_tags, skipping recipients
--    who received a tag_trending notification for the same tag in the last 7d.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_tag_trending_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trend  record;
  v_owner  record;
  v_body   text;
  v_dedup  interval := interval '7 days';
BEGIN
  -- Make sure today's row exists for every tag before computing growth.
  PERFORM public.refresh_tag_snapshots_today();

  FOR v_trend IN
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
    candidates AS (
      SELECT
        t.id              AS tag_id,
        t.name            AS tag_name,
        td.usage_count    AS usage_count,
        r.avg_7d          AS avg_7d,
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
    )
    SELECT
      tag_id,
      tag_name,
      usage_count,
      growth_factor,
      ROW_NUMBER() OVER (ORDER BY growth_factor DESC NULLS LAST, usage_count DESC) AS rank
    FROM candidates
    ORDER BY rank
  LOOP
    -- Render English body once per trending tag.
    v_body := 'your tag #' || COALESCE(v_trend.tag_name, '') || ' is trending today';

    FOR v_owner IN
      SELECT ut.user_id
        FROM public.piktag_user_tags ut
       WHERE ut.tag_id = v_trend.tag_id
         AND NOT EXISTS (
           SELECT 1
             FROM public.piktag_notifications n
            WHERE n.user_id = ut.user_id
              AND n.type    = 'tag_trending'
              AND n.data->>'tag_id' = v_trend.tag_id::text
              AND n.created_at > now() - v_dedup
         )
    LOOP
      INSERT INTO public.piktag_notifications (
        user_id, type, title, body, data, is_read, created_at
      )
      VALUES (
        v_owner.user_id,
        'tag_trending',
        '',
        v_body,
        jsonb_build_object(
          'tag_id',        v_trend.tag_id,
          'tag_name',      v_trend.tag_name,
          'usage_count',   v_trend.usage_count,
          'growth_factor', round(COALESCE(v_trend.growth_factor, 0)::numeric, 2),
          'rank',          v_trend.rank,
          -- Mobile UI always reads username + avatar_url; for tag_trending we
          -- populate username with the tag name per spec §3.9.
          'username',      COALESCE(v_trend.tag_name, ''),
          'avatar_url',    NULL
        ),
        false,
        now()
      );
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_tag_trending_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_tag_trending_notifications()
  TO postgres, service_role;

------------------------------------------------------------------------------
-- 4. pg_cron schedule — daily at 00:15 UTC ("each midnight" per spec §2.5).
--    The 15-minute offset gives any upstream usage_count writes from the
--    just-finished UTC day a moment to settle before the snapshot is frozen.
------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent reschedule.
    PERFORM cron.unschedule(jobid)
       FROM cron.job
      WHERE jobname = 'notification-tag-trending-daily';

    PERFORM cron.schedule(
      'notification-tag-trending-daily',
      '15 0 * * *',
      $job$ SELECT public.enqueue_tag_trending_notifications(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension not installed; skipping schedule for notification-tag-trending-daily';
  END IF;
END
$cron$;

COMMIT;
