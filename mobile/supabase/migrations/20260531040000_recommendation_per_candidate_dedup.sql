-- 20260531040000_recommendation_per_candidate_dedup.sql
--
-- REGRESSION FIX for the recommendation consolidation shipped in
-- 20260531020000 (commit 983aa56). 4.8 bug-scan 2026-06-03.
--
-- The bug: the consolidation migration replaced the original
-- function's PER-CANDIDATE 14-day dedup with only a PER-USER 24h
-- dedup. The original (20260530120000) had, in its `filtered` WHERE:
--
--     AND NOT EXISTS (
--       SELECT 1 FROM piktag_notifications n
--        WHERE n.user_id = f.recipient_id
--          AND n.type    = 'recommendation'
--          AND n.data->>'recommended_user_id' = f.candidate_id::text
--          AND n.created_at > now() - interval '14 days')
--
-- The consolidation dropped that and kept only "skip the user if
-- they got ANY recommendation row in the last 24h". Consequence for
-- a STATIC network (the common case): candidate detection is
-- deterministic, so every daily cron run re-picks the SAME top-3
-- people. The 24h cap limits it to ONE row/day — but it's the SAME
-- "you might know Alice and 2 others" row EVERY SINGLE DAY until the
-- user connects or explicitly dismisses. Ignoring the notification
-- doesn't make it stop. That is precisely the 煩躁 (notification
-- fatigue) the whole 方案-3 consolidation pass was meant to kill —
-- the consolidation fixed the COUNT but reintroduced the REPETITION.
--
-- Note recommendation can't use the `ON CONFLICT (user_id,type,ref_id)
-- DO NOTHING` permanent-dedup trick that the magic-moments helpers
-- use, because a consolidated row carries 2-3 candidates and has no
-- single ref_id. So the time-windowed per-candidate guard is the
-- right mechanism — restored here.
--
-- The fix: re-add the per-candidate 14-day dedup to the `filtered`
-- CTE's WHERE so the rn ranking + top-3 pick are computed only over
-- candidates NOT recommended in the last 14 days. Two differences
-- from the original predicate, both required by consolidation:
--   1. Checks the new `candidates[]` jsonb array (via @> containment)
--      in addition to the legacy top-level `recommended_user_id`, so
--      a candidate that rode in a prior row's array — not just as the
--      primary — is also suppressed. Legacy pre-consolidation rows
--      (no `candidates` key) are still caught by the `recommended_
--      user_id` branch; the array branch evaluates to NULL→false for
--      them, no gap.
--   2. Lives BEFORE the rn window so a recently-recommended candidate
--      doesn't even occupy a top-3 slot (a fresh #4 candidate gets
--      promoted into the row instead of the row going half-empty).
--
-- Net cadence after this fix: at most 1 recommendation row/user/day
-- (per-user 24h cap, unchanged) AND no candidate repeats within 14
-- days (per-candidate guard, restored). After 14 days a still-
-- relevant, not-connected, not-dismissed candidate may resurface
-- once — a gentle reminder cadence, not daily nagging.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.enqueue_recommendation_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row             record;
  v_inserted_count  integer := 0;
  v_auth_key        text;
  v_base_url        text;
  v_func_url        text;
  v_body            text;
BEGIN
  FOR v_row IN
    WITH user_concepts AS (
      SELECT DISTINCT
        ut.user_id,
        COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS concept_key,
        MIN(t.id::text)                                    AS rep_tag_id
      FROM public.piktag_user_tags ut
      JOIN public.piktag_tags t ON t.id = ut.tag_id
      WHERE ut.is_private = false
      GROUP BY ut.user_id, COALESCE(t.concept_id::text, 'tag:' || t.id::text)
    ),
    mutual AS (
      SELECT
        a.user_id                          AS recipient_id,
        b.user_id                          AS candidate_id,
        COUNT(*)::int                      AS mutual_tag_count,
        ARRAY_AGG(a.rep_tag_id::uuid ORDER BY a.rep_tag_id) AS mutual_tag_ids
      FROM user_concepts a
      JOIN user_concepts b
        ON a.concept_key = b.concept_key
       AND a.user_id <> b.user_id
      GROUP BY a.user_id, b.user_id
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
      WHERE NOT EXISTS (
              SELECT 1 FROM public.piktag_connections c
               WHERE (c.user_id = m.recipient_id AND c.connected_user_id = m.candidate_id)
                  OR (c.user_id = m.candidate_id AND c.connected_user_id = m.recipient_id)
            )
        AND NOT EXISTS (
              SELECT 1 FROM public.piktag_blocks b
               WHERE (b.blocker_id = m.recipient_id AND b.blocked_id = m.candidate_id)
                  OR (b.blocker_id = m.candidate_id AND b.blocked_id = m.recipient_id)
            )
        AND NOT EXISTS (
              SELECT 1 FROM public.piktag_match_dismissals d
               WHERE d.viewer_id  = m.recipient_id
                 AND d.target_id  = m.candidate_id
                 AND d.surface    IN ('recommendation','ask_match','reconnect_suggest',
                                      'ask_bridge','tag_convergence','tag_combo')
                 AND d.dismissed_at > now() - interval '60 days'
            )
        -- ── RESTORED per-candidate 14-day dedup (see migration header) ──
        AND NOT EXISTS (
              SELECT 1 FROM public.piktag_notifications n
               WHERE n.user_id    = m.recipient_id
                 AND n.type       = 'recommendation'
                 AND n.created_at > now() - interval '14 days'
                 AND (
                       n.data->>'recommended_user_id' = m.candidate_id::text
                       OR n.data->'candidates' @> jsonb_build_array(
                            jsonb_build_object('user_id', m.candidate_id::text)
                          )
                     )
            )
    ),
    picked AS (
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
        AND p.is_public = true
    ),
    aggregated AS (
      SELECT
        recipient_id,
        COUNT(*)::int                                                                   AS candidate_count,
        (ARRAY_AGG(candidate_id        ORDER BY rn))[1]                                  AS primary_id,
        (ARRAY_AGG(candidate_username  ORDER BY rn))[1]                                  AS primary_username,
        (ARRAY_AGG(candidate_full_name ORDER BY rn))[1]                                  AS primary_full_name,
        (ARRAY_AGG(candidate_avatar_url ORDER BY rn))[1]                                 AS primary_avatar_url,
        (ARRAY_AGG(mutual_tag_count    ORDER BY rn))[1]                                  AS primary_mutual_count,
        (ARRAY_AGG(mutual_tag_ids      ORDER BY rn))[1]                                  AS primary_mutual_ids,
        jsonb_agg(
          jsonb_build_object(
            'user_id',          candidate_id,
            'username',         candidate_username,
            'full_name',        candidate_full_name,
            'avatar_url',       candidate_avatar_url,
            'mutual_tag_count', mutual_tag_count
          )
          ORDER BY rn
        )                                                                                AS candidates
      FROM picked
      GROUP BY recipient_id
    )
    SELECT
      a.recipient_id,
      a.candidate_count,
      a.primary_id,
      a.primary_username,
      a.primary_full_name,
      a.primary_avatar_url,
      a.primary_mutual_count,
      a.primary_mutual_ids,
      a.candidates
    FROM aggregated a
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.piktag_notifications n
       WHERE n.user_id   = a.recipient_id
         AND n.type      = 'recommendation'
         AND n.created_at > now() - interval '24 hours'
    )
  LOOP
    IF v_row.candidate_count = 1 THEN
      v_body := 'you might know '
                || COALESCE(v_row.primary_username, v_row.primary_full_name, '')
                || ' — '
                || v_row.primary_mutual_count::text
                || ' mutual tags';
    ELSE
      v_body := 'you might know '
                || COALESCE(v_row.primary_username, v_row.primary_full_name, '')
                || ' and ' || (v_row.candidate_count - 1)::text
                || ' other'
                || CASE WHEN v_row.candidate_count - 1 > 1 THEN 's' ELSE '' END
                || ' from your tags';
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    )
    VALUES (
      v_row.recipient_id,
      'recommendation',
      '',
      v_body,
      jsonb_build_object(
        'recommended_user_id', v_row.primary_id,
        'username',            COALESCE(v_row.primary_username, v_row.primary_full_name, ''),
        'avatar_url',          v_row.primary_avatar_url,
        'mutual_tag_count',    v_row.primary_mutual_count,
        'mutual_tag_ids',      to_jsonb(v_row.primary_mutual_ids),
        'candidate_count',     v_row.candidate_count,
        'candidates',          v_row.candidates
      ),
      false,
      now()
    );

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  -- Push fan-out unchanged.
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
