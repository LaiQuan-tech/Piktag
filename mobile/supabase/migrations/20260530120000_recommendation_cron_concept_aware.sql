-- 20260530120000_recommendation_cron_concept_aware.sql
--
-- Root cause: the daily recommendation cron's mutual-tag CTE matched
-- candidates on EXACT `piktag_user_tags.tag_id` equality —
--   JOIN piktag_user_tags ut_b ON ut_a.tag_id = ut_b.tag_id
-- while every OTHER matching surface on the platform (search_users,
-- explore_users_for_tag, notify_ask_bridges, match_ask_to_friends,
-- fetch_ask_feed) expands a tag to its concept_id siblings via the
-- `tag_concepts` graph kept fresh by the auto-link-concepts edge fn.
-- Net effect: the cross-language dormant-connection thesis (PikTag's
-- North Star principle: 律師 / 法律 / lawyer / 弁護士 are the SAME
-- concept and should match) was honoured everywhere EXCEPT here.
-- A user tagged #律師 would never get recommended a user tagged #法律
-- via the daily push — even though search would surface them.
--
-- What changes: the `mutual` CTE. Instead of pairing users by raw
-- tag_id, we pair them by a concept-key — `concept_id` when present,
-- else `'tag:' || tag_id` as a fallback (so unlinked / freshly-coined
-- tags STILL match exactly, preserving the floor and not regressing
-- newly-introduced tags that haven't been concept-linked yet). DISTINCT
-- on (user, concept_key) before the join so a user who tagged both
-- #律師 AND #法律 (same concept) doesn't get a +2 self-inflation —
-- they still count as ONE shared concept against a candidate.
--
-- What stays the same:
--   * ≥2 mutual threshold (HAVING COUNT(*) >= 2).
--   * Top-3 per recipient (ROW_NUMBER PARTITION BY recipient_id, rn<=3).
--   * 14-day dedup against piktag_notifications.
--   * Not-connected filter (both directions in piktag_connections).
--   * Not-blocked filter (both directions in piktag_blocks).
--   * Insert shape (title='', body='you might know X — N mutual tags',
--     data = { recommended_user_id, username, avatar_url,
--     mutual_tag_count, mutual_tag_ids }). mutual_tag_count is now the
--     concept count (semantically equivalent — caller reads it as
--     "shared interests"). mutual_tag_ids continues to carry tag_ids
--     from the RECIPIENT's side for the existing client renderer.
--   * Push fan-out via pg_net + vault secrets.
--   * pg_cron schedule (notification-recommendation-daily, 09:30 UTC) —
--     re-asserted at the foot for self-containment.
--
-- Additional principled corrections folded in (honest findings —
-- declared here, not hidden):
--   (a) `is_private = false` filter on piktag_user_tags. The old RPC
--       silently leaked private tags into mutual matching, contradicting
--       CLAUDE.md tag-quality principle "private/hidden tags are
--       owner-only and never enter the algorithm." search_users and
--       match_ask_to_friends both enforce this; this surface didn't.
--   (b) `is_public = true` filter on candidate piktag_profiles. Matches
--       the gold-standard search_users behaviour — non-public profiles
--       should not be recommended to strangers.
--   (c) `piktag_match_dismissals` respect (surface = 'recommendation',
--       60-day lookback — same horizon as match_ask_to_friends). Per
--       CLAUDE.md: "a Recommendation that re-suggests a dismissed
--       person is the single most user-trust-eroding bug in this
--       space." The dismissals table predates the recommendation cron
--       only by date; the cron never got rewired. Wiring it now.
--
-- Idempotent CREATE OR REPLACE FUNCTION + DO-block cron re-assert.
-- CI auto-applies on push to main.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- =============================================================================
-- enqueue_recommendation_notifications() — concept-aware mutual matching.
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
  -- 1. For every recipient, pick top-3 candidates (>=2 mutual CONCEPTS,
  --    not connected, not blocked, not dismissed, not self), dedup
  --    against the last 14 days of piktag_notifications, and insert.
  -- ---------------------------------------------------------------------------
  FOR v_row IN
    WITH user_concepts AS (
      -- One row per (user, concept_key) — DISTINCT so a user who self-
      -- tagged #律師 AND #法律 (sibling concepts) only contributes ONE
      -- vote to that concept. concept_key falls back to 'tag:'||tag_id
      -- when concept_id IS NULL so unlinked tags still match exactly,
      -- never fewer matches than before. is_private = false aligns with
      -- the tag-quality principle (private tags never enter algo).
      SELECT DISTINCT
        ut.user_id,
        COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS concept_key,
        -- Carry one representative tag_id per (user, concept) for the
        -- existing client renderer's `mutual_tag_ids` payload. min() is
        -- deterministic so identical inputs → identical output.
        MIN(t.id::text)                                    AS rep_tag_id
      FROM public.piktag_user_tags ut
      JOIN public.piktag_tags t ON t.id = ut.tag_id
      WHERE ut.is_private = false
      GROUP BY ut.user_id, COALESCE(t.concept_id::text, 'tag:' || t.id::text)
    ),
    mutual AS (
      -- (recipient, candidate, concept count, recipient-side tag_ids).
      -- Directed: each user gets recommendations about every other user
      -- independently (recipient_id <> candidate_id, no ordering).
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
        -- Exclude per-viewer dismissals (the recipient previously swiped
        -- this candidate away on any AI-discovery surface). 60-day
        -- horizon mirrors match_ask_to_friends — long enough to be
        -- meaningful, short enough that a tag profile may have evolved.
        AND NOT EXISTS (
              SELECT 1 FROM public.piktag_match_dismissals d
               WHERE d.viewer_id  = m.recipient_id
                 AND d.target_id  = m.candidate_id
                 AND d.surface    IN ('recommendation','ask_match','reconnect_suggest',
                                      'ask_bridge','tag_convergence','tag_combo')
                 AND d.dismissed_at > now() - interval '60 days'
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
      AND p.is_public = true
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
  --    function. Unchanged from prior revision — reads vault secrets
  --    seeded by 20260422_chat_push_trigger_vault.sql. If either is
  --    absent, log WARNING and skip — never raise.
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
-- pg_cron schedule re-asserted — daily at 09:30 UTC. Same name, same
-- expression as 20260428120004; re-running this migration replaces the
-- entry idempotently.
-- =============================================================================

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
