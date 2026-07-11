-- 20260711010000_biolink_interest_tiebreaker.sql
-- =============================================================================
-- Biolink-platform IDF affinity as a recommendation TIEBREAKER
-- (founder-approved 2026-07-11).
--
-- Which platforms a user PUBLICLY lists (piktag_biolinks with strict
-- visibility = 'public' AND is_active = true; NULLs never qualify) is the
-- only compliance-safe "other platforms" signal available to the recommender.
-- Shared rare platforms get IDF weight — same ln(1 + N/(1+holders)) shape as
-- the mutual-tag score — and are consulted ONLY after mutual_score in the two
-- ROW_NUMBER orderings. Primary weights untouched; the search-side replay
-- gate (admin_search_funnel) is unaffected because search_users is untouched.
--
-- Contents:
--   (A) partial index over public+active biolinks
--   (B) enqueue_recommendation_notifications re-created VERBATIM from
--       20260705020000_algo_health_and_signals.sql:159-423 with exactly these
--       changes (each marked inline with "[biolink-tiebreaker 2026-07-11]"):
--         1. new CTEs user_platforms / platform_pop / platform_total
--         2. per-pair affinity via LEFT JOIN LATERAL, bound to pairs that
--            already passed HAVING >= 2 (no global self-join)
--         3. COALESCE(affinity, 0) DESC inserted after mutual_score DESC in
--            BOTH ROW_NUMBER orderings (filtered + cross_pick)
--         4. recipient gate on piktag_profiles.personalized_recs
--            (added by 20260711000000)
--         5. test-account exclusion via is_test_account_user — independent
--            fix: the live cron lacked this filter entirely
--         6. notification data jsonb gains 'biolink_affinity'
--            (measurement-only; no new type, title/body untouched)
--         7. affinity threaded through cross_pick/chosen/picked/aggregated/
--            final SELECT so the INSERT can read it (plumbing for change 6)
--   (C) admin_recommendation_funnel(p_days) — affinity-cohort measurement
--       RPC (service_role only)
--
-- Function signature and return type unchanged (no 42P13 risk).
-- Idempotent: CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- =============================================================================

-- ── (A) partial index: the exact slice both (B) and future readers scan ──
CREATE INDEX IF NOT EXISTS idx_biolinks_public_platform
  ON public.piktag_biolinks (user_id, platform)
  WHERE visibility = 'public' AND is_active = true;

-- ── (B) recommendation cron — biolink affinity tiebreaker ────────────────
CREATE OR REPLACE FUNCTION public.enqueue_recommendation_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
      SELECT
        ut.user_id,
        COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS concept_key,
        MIN(t.id::text)                                    AS rep_tag_id,
        (ARRAY_AGG(t.name ORDER BY t.id))[1]               AS rep_tag_name
      FROM public.piktag_user_tags ut
      JOIN public.piktag_tags t ON t.id = ut.tag_id
      WHERE ut.is_private = false
      GROUP BY ut.user_id, COALESCE(t.concept_id::text, 'tag:' || t.id::text)
    ),
    concept_pop AS (
      SELECT concept_key, COUNT(DISTINCT user_id)::float AS holders
      FROM user_concepts GROUP BY concept_key
    ),
    total_pop AS (
      SELECT GREATEST(COUNT(DISTINCT user_id), 1)::float AS n FROM user_concepts
    ),
    -- [biolink-tiebreaker 2026-07-11] change 1: publicly displayed platforms
    -- per user. Strict equality — NULL visibility/is_active never qualifies.
    -- Generic/payment/scheduling links are excluded: "has Venmo" is not an
    -- interest signal.
    user_platforms AS (
      SELECT DISTINCT bl.user_id, bl.platform
      FROM public.piktag_biolinks bl
      WHERE bl.visibility = 'public'
        AND bl.is_active = true
        AND bl.platform NOT IN (
          'phone','email','custom','website','blog','portfolio',
          'venmo','cashapp','paypal','stripe','alipay',
          'calendly','cal','kofi','buymeacoffee','patreon'
        )
    ),
    -- [biolink-tiebreaker 2026-07-11] change 1: holders per platform.
    platform_pop AS (
      SELECT platform, COUNT(DISTINCT user_id)::float AS holders
      FROM user_platforms GROUP BY platform
    ),
    -- [biolink-tiebreaker 2026-07-11] change 1: total N — same convention as
    -- total_pop above (distinct users carrying the signal, floored at 1).
    platform_total AS (
      SELECT GREATEST(COUNT(DISTINCT user_id), 1)::float AS n FROM user_platforms
    ),
    mutual AS (
      SELECT
        a.user_id                          AS recipient_id,
        b.user_id                          AS candidate_id,
        COUNT(*)::int                      AS mutual_tag_count,
        -- algo #1 (2026-07-05): IDF-weighted overlap. A shared RARE
        -- concept outweighs a shared ubiquitous one — serendipity IS
        -- rare overlap. ln(1 + N/(1+holders)) per shared concept.
        SUM(LN(1 + (SELECT n FROM total_pop) / (1 + cp.holders)))::float AS mutual_score,
        -- Cross-script pair present? Proxy for the cross-language
        -- matches that make PikTag unique (algo #6 quota below).
        BOOL_OR(
          (a.rep_tag_name ~ '^[[:ascii:]]+$') <> (b.rep_tag_name ~ '^[[:ascii:]]+$')
        ) AS has_cross_script,
        ARRAY_AGG(a.rep_tag_id::uuid ORDER BY a.rep_tag_id) AS mutual_tag_ids
      FROM user_concepts a
      JOIN user_concepts b
        ON a.concept_key = b.concept_key
       AND a.user_id <> b.user_id
      JOIN concept_pop cp ON cp.concept_key = a.concept_key
      GROUP BY a.user_id, b.user_id
      HAVING COUNT(*) >= 2
    ),
    filtered AS (
      SELECT
        m.recipient_id,
        m.candidate_id,
        m.mutual_tag_count,
        m.mutual_tag_ids,
        m.mutual_score,
        m.has_cross_script,
        -- [biolink-tiebreaker 2026-07-11] change 7: carried downstream.
        ba.affinity,
        ROW_NUMBER() OVER (
          PARTITION BY m.recipient_id
          -- [biolink-tiebreaker 2026-07-11] change 3: affinity breaks ties
          -- AFTER the primary IDF score, BEFORE the deterministic id tiebreak.
          ORDER BY m.mutual_score DESC, COALESCE(ba.affinity, 0) DESC, m.candidate_id
        ) AS rn
      FROM mutual m
      -- [biolink-tiebreaker 2026-07-11] change 2: IDF-weighted shared-platform
      -- affinity, computed ONLY for pairs that already passed HAVING >= 2
      -- above (no global self-join over biolinks).
      LEFT JOIN LATERAL (
        SELECT SUM(LN(1 + (SELECT n FROM platform_total) / (1 + pp.holders)))::float AS affinity
        FROM user_platforms upa
        JOIN user_platforms upb
          ON upb.platform = upa.platform
         AND upb.user_id  = m.candidate_id
        JOIN platform_pop pp ON pp.platform = upa.platform
        WHERE upa.user_id = m.recipient_id
      ) ba ON true
      WHERE NOT public.is_official_user(m.candidate_id)
        -- [biolink-tiebreaker 2026-07-11] change 5: independent fix — the
        -- live cron was missing the test-account filter on BOTH sides.
        AND NOT public.is_test_account_user(m.candidate_id)
        AND NOT public.is_test_account_user(m.recipient_id)
        -- [biolink-tiebreaker 2026-07-11] change 4: personalized_recs = false
        -- means this user does not participate in personalized-recommendation
        -- COMPUTATION at all (data-processing layer, not just delivery).
        -- Missing row / NULL defaults to opted-in.
        AND COALESCE((SELECT pr.personalized_recs
                        FROM public.piktag_profiles pr
                       WHERE pr.id = m.recipient_id), true)
        AND NOT EXISTS (
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
    -- algo #6 quota: top-2 by IDF score + the best cross-script candidate
    -- from ranks 3..12 when one exists (else plain rank 3). Guarantees the
    -- cross-language bridge — the candidate class unique to PikTag, which
    -- raw counts systematically drown — a seat whenever available, without
    -- displacing clear wins.
    cross_pick AS (
      -- [biolink-tiebreaker 2026-07-11] change 7: affinity added to the list.
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, affinity, rn
      FROM (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY f.recipient_id
                 -- [biolink-tiebreaker 2026-07-11] change 3: same tiebreak
                 -- position as in filtered.
                 ORDER BY f.mutual_score DESC, COALESCE(f.affinity, 0) DESC, f.candidate_id
               ) AS crn
        FROM filtered f
        WHERE f.has_cross_script AND f.rn > 2 AND f.rn <= 12
      ) x WHERE x.crn = 1
    ),
    chosen AS (
      -- [biolink-tiebreaker 2026-07-11] change 7: affinity added to all three
      -- UNION branches (same position each).
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, affinity, rn
      FROM filtered WHERE rn <= 2
      UNION ALL
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, affinity, rn
      FROM cross_pick
      UNION ALL
      SELECT f.recipient_id, f.candidate_id, f.mutual_tag_count, f.mutual_tag_ids, f.affinity, f.rn
      FROM filtered f
      WHERE f.rn = 3
        AND NOT EXISTS (SELECT 1 FROM cross_pick c WHERE c.recipient_id = f.recipient_id)
    ),
    picked AS (
      SELECT
        ch.recipient_id,
        ch.candidate_id,
        ch.mutual_tag_count,
        ch.mutual_tag_ids,
        -- [biolink-tiebreaker 2026-07-11] change 7: carried through.
        ch.affinity,
        ROW_NUMBER() OVER (PARTITION BY ch.recipient_id ORDER BY ch.rn) AS rn,
        p.username       AS candidate_username,
        p.full_name      AS candidate_full_name,
        p.avatar_url     AS candidate_avatar_url
      FROM chosen ch
      JOIN public.piktag_profiles p
        ON p.id = ch.candidate_id
      WHERE p.is_public = true
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
        -- [biolink-tiebreaker 2026-07-11] change 7: primary candidate's affinity.
        (ARRAY_AGG(affinity            ORDER BY rn))[1]                                  AS primary_affinity,
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
      -- [biolink-tiebreaker 2026-07-11] change 7: exposed to the loop.
      a.primary_affinity,
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
        -- [biolink-tiebreaker 2026-07-11] change 6: measurement-only key for
        -- the admin_recommendation_funnel cohort split. No new type; title
        -- and body untouched.
        'biolink_affinity',    COALESCE(v_row.primary_affinity, 0),
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
$function$;

-- ── (C) admin_recommendation_funnel — affinity-cohort measurement ────────
-- Splits type='recommendation' notifications from the last p_days into
-- with_affinity (data->>'biolink_affinity' > 0) vs no_affinity (0, or
-- pre-migration rows without the key) and reports per group: sent count,
-- read rate (piktag_notifications.is_read), BOTH dismissal rates side by
-- side (the notification's own is_dismissed row-hide AND
-- piktag_match_dismissals surface='recommendation' after the send), and
-- 7-day friend conversion against the primary candidate
-- (data->>'recommended_user_id'; either direction in piktag_connections,
-- matching how the cron itself defines "already connected").
-- Test accounts excluded on BOTH recipient and candidate side.
CREATE OR REPLACE FUNCTION public.admin_recommendation_funnel(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH recs AS (
    SELECT
      n.user_id,
      n.created_at,
      n.is_read,
      n.is_dismissed,
      COALESCE((n.data->>'biolink_affinity')::numeric, 0) > 0 AS has_affinity,
      (n.data->>'recommended_user_id')::uuid                  AS candidate_id
    FROM piktag_notifications n
    WHERE n.type = 'recommendation'
      AND n.created_at > now() - make_interval(days => p_days)
      AND NOT public.is_test_account_user(n.user_id)
      AND (n.data->>'recommended_user_id' IS NULL
           OR NOT public.is_test_account_user((n.data->>'recommended_user_id')::uuid))
  ),
  scored AS (
    SELECT
      r.*,
      EXISTS (
        SELECT 1 FROM piktag_match_dismissals d
        WHERE d.viewer_id    = r.user_id
          AND d.target_id    = r.candidate_id
          AND d.surface      = 'recommendation'
          AND d.dismissed_at > r.created_at
      ) AS match_dismissed,
      EXISTS (
        SELECT 1 FROM piktag_connections c
        WHERE ((c.user_id = r.user_id AND c.connected_user_id = r.candidate_id)
            OR (c.user_id = r.candidate_id AND c.connected_user_id = r.user_id))
          AND c.created_at > r.created_at
          AND c.created_at <= r.created_at + interval '7 days'
      ) AS connected_7d
    FROM recs r
  ),
  grouped AS (
    SELECT
      has_affinity,
      COUNT(*)::int AS sent,
      ROUND(100.0 * COUNT(*) FILTER (WHERE is_read)         / GREATEST(COUNT(*), 1), 1) AS read_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE is_dismissed)    / GREATEST(COUNT(*), 1), 1) AS dismissed_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE match_dismissed) / GREATEST(COUNT(*), 1), 1) AS match_dismissed_pct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE connected_7d)    / GREATEST(COUNT(*), 1), 1) AS connected_7d_pct
    FROM scored
    GROUP BY has_affinity
  )
  SELECT jsonb_build_object(
    'days', p_days,
    'groups', COALESCE(
      jsonb_object_agg(
        CASE WHEN has_affinity THEN 'with_affinity' ELSE 'no_affinity' END,
        jsonb_build_object(
          'sent',                sent,
          'read_pct',            read_pct,
          'dismissed_pct',       dismissed_pct,
          'match_dismissed_pct', match_dismissed_pct,
          'connected_7d_pct',    connected_7d_pct
        )
      ),
      '{}'::jsonb
    )
  )
  FROM grouped;
$$;
REVOKE ALL ON FUNCTION public.admin_recommendation_funnel(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recommendation_funnel(int) TO postgres, service_role;
