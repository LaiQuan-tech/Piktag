-- 20260531020000_recommendation_consolidate_per_user.sql
--
-- Consolidate `recommendation` notifications: ONE row per user per
-- day, regardless of how many 2nd-degree candidates the SQL picks
-- for them. Mirrors what 20260531010000 just did for tag_trending —
-- founder picked "方案 3" (per-category caps + same-type consolidation)
-- after the tag_trending screenshot, and `recommendation` is the
-- next-largest spam-prone surface (daily cron × up to 3 candidates
-- per user → up to 3 rows per user per day).
--
-- Old behaviour (20260530120000): per (user, candidate) loop, dedup
-- on (user, candidate) 14d. Same user could legitimately receive 3
-- rows the same morning when 3 different 2nd-degree people met the
-- ≥2-mutual-concept threshold.
--
-- New behaviour:
--   • Same candidate-detection logic (the WITH ... mutual ... HAVING
--     COUNT(*) >= 2 cascade is preserved verbatim — we only change
--     the LOOP shape and the dedup window).
--   • For each recipient with ≥1 candidate AND no `recommendation`
--     row in the last 24h, INSERT ONE row aggregating their up-to-3
--     candidates.
--   • data.candidate_count: total
--   • data.candidates: array of {user_id, username, full_name,
--     avatar_url, mutual_tag_count} for all picked candidates
--   • Back-compat fields kept at the top level for the existing
--     client template (which interpolates `{{username}}` +
--     `{{count}}`): recommended_user_id, username, avatar_url,
--     mutual_tag_count, mutual_tag_ids → all point at the PRIMARY
--     (highest-mutual-count) candidate. Multi-candidate rows render
--     via the server `body` (similar to the tag_trending fallback).
--   • Server-rendered English body — CLAUDE.md "non-empty body" rule.
--
-- Push fan-out at the bottom unchanged — still calls the same edge
-- function which iterates the newly-inserted rows.
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
    ),
    picked AS (
      -- Same top-3 ceiling per recipient as before.
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
    -- Per-user aggregation. NB: the OLD per-candidate dedup (against
    -- the last 14 days of notifications for the SAME candidate) is
    -- relaxed in favour of the per-user 24h dedup below — pre-launch
    -- the user-level cap is what reduces "煩躁", and 14-day per-
    -- candidate uniqueness wouldn't survive consolidation cleanly
    -- (the row carries 2-3 candidates now). Post-launch we may revisit.
    aggregated AS (
      SELECT
        recipient_id,
        COUNT(*)::int                                                                   AS candidate_count,
        -- Primary = highest-mutual-count (ties broken by candidate_id
        -- for determinism, matching the ROW_NUMBER ordering above).
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
    -- New per-user dedup: skip anyone who got a `recommendation` row
    -- in the last 24h. Max one row per user per day.
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.piktag_notifications n
       WHERE n.user_id   = a.recipient_id
         AND n.type      = 'recommendation'
         AND n.created_at > now() - interval '24 hours'
    )
  LOOP
    -- English fallback body. Single-candidate keeps the historical
    -- "you might know X — N mutual tags" shape so the existing client
    -- template path still renders correctly for back-compat;
    -- multi-candidate body is what the client renders via fallback.
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
        -- Single-candidate back-compat at the top level so the
        -- existing `{{username}} — {{count}}` client template still
        -- renders untouched when candidate_count = 1.
        'recommended_user_id', v_row.primary_id,
        'username',            COALESCE(v_row.primary_username, v_row.primary_full_name, ''),
        'avatar_url',          v_row.primary_avatar_url,
        'mutual_tag_count',    v_row.primary_mutual_count,
        'mutual_tag_ids',      to_jsonb(v_row.primary_mutual_ids),
        -- New consolidated fields. Client checks `candidate_count > 1`
        -- to decide template-vs-server-body, mirroring the
        -- tag_trending pattern in 20260531010000.
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
