-- 20260612010000_official_exclusion_sweep.sql
--
-- Phase 2 of the official-account feature (see 20260611120000): exclude
-- is_official accounts from every ranking / matching / counting surface.
-- Every user auto-friends @piktag, so without this sweep the graph is
-- polluted: friend-of-friend explodes (me→official→everyone), every pair
-- gains +1 mutual friend, search/ask/recommendation treat the bot as a
-- person, and admin activation metrics saturate at 100%.
--
-- 23 functions, patched against their LIVE definitions (pg_get_functiondef,
-- 2026-06-12), insert-only except five reviewed line edits (admin metrics,
-- recommendation cron, ask-prompt gate, mutual counts). Official is also
-- excluded as an ACTOR in broadcast triggers (vibe_shift / ask_posted /
-- ask feed) — announcements, if ever wanted, become a deliberate feature.
-- Viewer-side behavior untouched. Generic via is_official (no UUID
-- hardcoding) so future official accounts inherit the exclusions.
--
-- DRAFT migration (NOT applied) — official-account exclusion sweep
-- Generated 2026-06-12 from LIVE pg_get_functiondef() output (project kbwfdskulxnhjckdvghj).
-- The synthetic official account (piktag_profiles.is_official = true,
-- 00000000-0000-4000-a000-000000000001) is auto-friended to every user via
-- add_official_friend(). Because everyone shares this friend, it would pollute
-- every ranking/matching/counting surface (FoF explosion, mutual-friend counts,
-- search results, ask matching, recommendation cron, memory fan-outs).
-- Each function below is byte-identical to the live definition except for the
-- added exclusion predicates (generic via is_official — no hardcoded UUID):
--   AND NOT public.is_official_user(<friend-side user id>)        -- no profiles join handy
--   AND COALESCE(p.is_official, false) = false                    -- piktag_profiles already joined
-- Viewer/recipient real-user paths are untouched. Idempotent: CREATE OR REPLACE only, no DROPs.
-- Functions reviewed but deliberately NOT patched are listed in REPORT.md.

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.admin_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'growth', jsonb_build_object(
      'total_users',       (SELECT count(*) FROM public.piktag_profiles),
      'signups_24h',       (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '24 hours'),
      'signups_7d',        (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '7 days'),
      'signups_30d',       (SELECT count(*) FROM public.piktag_profiles WHERE created_at > now() - interval '30 days'),
      'onboarded_users',   (SELECT count(*) FROM public.piktag_profiles WHERE onboarding_completed = true),
      'total_connections', (SELECT count(*) FROM public.piktag_connections WHERE NOT public.is_official_user(user_id) AND NOT public.is_official_user(connected_user_id)),
      'activated_users',   (SELECT count(DISTINCT user_id) FROM public.piktag_connections WHERE NOT public.is_official_user(user_id) AND NOT public.is_official_user(connected_user_id)),
      'total_user_tags',   (SELECT count(*) FROM public.piktag_user_tags),
      'active_asks',       (SELECT count(*) FROM public.piktag_asks WHERE is_active = true AND expires_at > now())
    ),
    'concept_health', (SELECT to_jsonb(h) FROM public.admin_concept_graph_health() h),
    'merge_candidates', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY (c.similarity) DESC)
         FROM public.admin_report_concept_merge_candidates(0.85, 50) c),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.enqueue_anniversary_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_today_month int := extract(month FROM v_today)::int;
  v_today_day   int := extract(day   FROM v_today)::int;
  v_username    text;
  v_body        text;
BEGIN
  FOR v_row IN
    SELECT
      c.id                       AS connection_id,
      c.user_id                  AS recipient,
      c.connected_user_id        AS connected_user_id,
      c.nickname                 AS nickname,
      -- Effective anniversary date: prefer explicit column, fall back to met_at.
      COALESCE(c.anniversary, c.met_at::date) AS effective_date,
      p.full_name                AS connected_full_name,
      p.username                 AS connected_username,
      p.avatar_url               AS connected_avatar_url
    FROM piktag_connections c
    LEFT JOIN piktag_profiles p ON p.id = c.connected_user_id
    WHERE COALESCE(c.anniversary, c.met_at::date) IS NOT NULL
      AND COALESCE(p.is_official, false) = false
      AND extract(month FROM COALESCE(c.anniversary, c.met_at::date))::int = v_today_month
      AND extract(day   FROM COALESCE(c.anniversary, c.met_at::date))::int = v_today_day
      -- years >= 1 (anniversary year must have elapsed at least once)
      AND extract(year FROM age(v_today, COALESCE(c.anniversary, c.met_at::date)))::int >= 1
  LOOP
    -- Compute years-since for body + dedup.
    DECLARE
      v_years int := extract(year FROM age(v_today, v_row.effective_date))::int;
      v_already_exists boolean;
    BEGIN
      -- Dedup: "ever" — same (user_id, type='anniversary', connection_id, years)
      -- has already produced a row at any point in history.
      SELECT EXISTS (
        SELECT 1 FROM piktag_notifications n
         WHERE n.user_id = v_row.recipient
           AND n.type    = 'anniversary'
           AND n.data->>'connection_id' = v_row.connection_id::text
           AND (n.data->>'years')::int   = v_years
      ) INTO v_already_exists;

      IF v_already_exists THEN
        CONTINUE;
      END IF;

      v_username := COALESCE(
        NULLIF(v_row.nickname, ''),
        NULLIF(v_row.connected_full_name, ''),
        NULLIF(v_row.connected_username, ''),
        ''
      );

      v_body := format('%s years ago today, you met %s', v_years, v_username);

      INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
      VALUES (
        v_row.recipient,
        'anniversary',
        '',
        v_body,
        jsonb_build_object(
          'connected_user_id', v_row.connected_user_id,
          'connection_id',     v_row.connection_id,
          'username',          v_username,
          'avatar_url',        v_row.connected_avatar_url,
          'years',             v_years,
          'met_at',            to_char(v_row.effective_date, 'YYYY-MM-DD')
        ),
        false,
        now()
      );
    END;
  END LOOP;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.enqueue_birthday_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_username  text;
  v_birthday  date;
  v_age       integer;
  v_body      text;
BEGIN
  FOR v_row IN
    SELECT
      c.id                                                    AS connection_id,
      c.user_id                                               AS recipient_id,
      c.connected_user_id                                     AS connected_user_id,
      c.nickname                                              AS nickname,
      COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)                        AS effective_birthday,
      p.username                                              AS profile_username,
      p.full_name                                             AS profile_full_name,
      p.avatar_url                                            AS avatar_url
    FROM piktag_connections c
    LEFT JOIN piktag_profiles p ON p.id = c.connected_user_id
    WHERE COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END) IS NOT NULL
      AND COALESCE(p.is_official, false) = false
      AND EXTRACT(MONTH FROM COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'UTC')::date)
      AND EXTRACT(DAY   FROM COALESCE(c.birthday, CASE WHEN p.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN p.birthday::date ELSE NULL END)) = EXTRACT(DAY   FROM (now() AT TIME ZONE 'UTC')::date)
  LOOP
    -- Dedup: same recipient + same connected_user_id within 300d.
    IF EXISTS (
      SELECT 1
        FROM piktag_notifications n
       WHERE n.user_id = v_row.recipient_id
         AND n.type    = 'birthday'
         AND n.data->>'connected_user_id' = v_row.connected_user_id::text
         AND n.created_at > now() - interval '300 days'
       LIMIT 1
    ) THEN
      CONTINUE;
    END IF;

    v_username := COALESCE(NULLIF(v_row.nickname, ''),
                           NULLIF(v_row.profile_full_name, ''),
                           NULLIF(v_row.profile_username, ''),
                           '');
    v_birthday := v_row.effective_birthday;

    -- Compute age only if year of birth is known and not the SQL "year-unknown"
    -- placeholder (1900). Otherwise leave null.
    IF v_birthday IS NOT NULL AND EXTRACT(YEAR FROM v_birthday) > 1900 THEN
      v_age := EXTRACT(YEAR FROM age((now() AT TIME ZONE 'UTC')::date, v_birthday))::integer;
    ELSE
      v_age := NULL;
    END IF;

    v_body := 'it''s ' || v_username || '''s birthday today';

    INSERT INTO piktag_notifications (user_id, type, title, body, data, is_read, created_at)
    VALUES (
      v_row.recipient_id,
      'birthday',
      '',
      v_body,
      jsonb_build_object(
        'connected_user_id', v_row.connected_user_id,
        'connection_id',     v_row.connection_id,
        'username',          v_username,
        'avatar_url',        v_row.avatar_url,
        'birthday',          to_char(v_birthday, 'MM-DD'),
        'age',               v_age
      ),
      false,
      now()
    );
  END LOOP;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.enqueue_contact_sync_nudges()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
BEGIN
  -- Body is client-rendered via the localized
  -- notifications.types.contact_sync_nudge.body i18n key; the
  -- non-empty English string here is the legacy-client fallback
  -- (CLAUDE.md: an INSERT into piktag_notifications MUST write a
  -- non-empty body — never rely on the i18n template existing).
  INSERT INTO public.piktag_notifications (
    user_id, type, title, body, data, is_read, created_at
  )
  SELECT
    p.id,
    'contact_sync_nudge',
    '',
    'Find friends already on PikTag — sync your phone contacts.',
    jsonb_build_object('cta', 'contact_sync'),
    false,
    now()
  FROM public.piktag_profiles p
  WHERE p.created_at < now() - interval '1 day'
    AND p.created_at > now() - interval '90 days'
    AND (
      SELECT count(*) FROM public.piktag_connections c
      WHERE c.user_id = p.id
        AND NOT public.is_official_user(c.connected_user_id)
    ) < 5
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'contact_sync_nudge'
    )
  LIMIT 500;   -- batch cap per run; once-ever guard spreads the base over days

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.enqueue_endorsement_requests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND NOT public.is_official_user(ut.user_id)
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
          AND NOT public.is_official_user(conn.user_id)
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
$function$;

-- official-account exclusion (is_official) added 2026-06-12
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
      WHERE NOT public.is_official_user(m.candidate_id)
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
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.explore_users_for_tag(p_tag_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, mutual_tag_count integer, endorser_count integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  tag_concept AS (
    SELECT concept_id FROM piktag_tags WHERE id = p_tag_id LIMIT 1
  ),
  sibling_tags AS (
    SELECT t.id
    FROM piktag_tags t
    CROSS JOIN tag_concept c
    WHERE
      (c.concept_id IS NOT NULL AND t.concept_id = c.concept_id)
      OR (c.concept_id IS NULL AND t.id = p_tag_id)
  ),
  candidate_users AS (
    SELECT DISTINCT ut.user_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM sibling_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
  ),
  my_tag_ids AS (
    SELECT tag_id
    FROM piktag_user_tags
    WHERE user_id = auth.uid()
  ),
  mutual_counts AS (
    SELECT ut.user_id, COUNT(*) AS mutual_count
    FROM piktag_user_tags ut
    WHERE ut.user_id IN (SELECT user_id FROM candidate_users)
      AND ut.is_private = false
      AND ut.tag_id IN (SELECT tag_id FROM my_tag_ids)
    GROUP BY ut.user_id
  ),
  -- New: per-candidate distinct count of public endorsers (any
  -- sibling tag). "How many people say this about them."
  endorser_counts AS (
    SELECT
      c.connected_user_id AS user_id,
      COUNT(DISTINCT c.user_id) AS endorser_count
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM sibling_tags)
      AND ct.is_private = false
      AND c.connected_user_id IN (SELECT user_id FROM candidate_users)
    GROUP BY c.connected_user_id
  ),
  ranked AS (
    SELECT
      p.id,
      p.username,
      p.full_name,
      p.avatar_url,
      p.is_verified,
      COALESCE(mc.mutual_count,  0)::int AS mutual_tag_count,
      COALESCE(ec.endorser_count, 0)::int AS endorser_count
    FROM piktag_profiles p
    INNER JOIN candidate_users cu ON cu.user_id = p.id
    LEFT JOIN mutual_counts   mc ON mc.user_id = p.id
    LEFT JOIN endorser_counts ec ON ec.user_id = p.id
    WHERE p.is_public = true
      AND COALESCE(p.is_official, false) = false
  )
  SELECT
    r.id,
    r.username,
    r.full_name,
    r.avatar_url,
    r.is_verified,
    r.mutual_tag_count,
    r.endorser_count,
    COUNT(*) OVER ()::bigint AS total_count
  FROM ranked r
  ORDER BY r.mutual_tag_count DESC, r.endorser_count DESC, r.id
  LIMIT p_limit;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.fetch_ask_feed(p_limit integer DEFAULT 20)
 RETURNS TABLE(ask_id uuid, author_id uuid, author_username text, author_full_name text, author_avatar_url text, body text, title text, expires_at timestamp with time zone, created_at timestamp with time zone, ask_tag_names text[], degree integer, mutual_friend_count integer, mutual_friend_previews jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH
  friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid FROM public.piktag_connections c WHERE c.user_id = me
      AND NOT public.is_official_user(c.connected_user_id)
  ),
  friends_2 AS (
    SELECT DISTINCT c2.connected_user_id AS uid FROM friends_1 f1
    JOIN public.piktag_connections c2 ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> me AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
      AND NOT public.is_official_user(c2.connected_user_id)
  ),
  network AS (
    SELECT uid, 1 AS deg FROM friends_1
    UNION ALL SELECT uid, 2 AS deg FROM friends_2
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM public.piktag_blocks WHERE blocker_id = me
    UNION SELECT blocker_id AS uid FROM public.piktag_blocks WHERE blocked_id = me
  ),
  dismissed AS (
    SELECT d.ask_id FROM public.piktag_ask_dismissals d WHERE d.user_id = me
  ),
  candidate_asks AS (
    SELECT a.id, a.author_id, a.body, a.title, a.expires_at, a.created_at, n.deg
    FROM public.piktag_asks a JOIN network n ON n.uid = a.author_id
    WHERE a.is_active = true AND a.expires_at > now() AND a.author_id <> me
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.id NOT IN (SELECT ask_id FROM dismissed)
    ORDER BY a.created_at DESC LIMIT p_limit
  )
  SELECT ca.id, ca.author_id, p.username, p.full_name, p.avatar_url, ca.body, ca.title,
    ca.expires_at, ca.created_at,
    (SELECT COALESCE(array_agg(t.name ORDER BY t.name), ARRAY[]::text[])
     FROM public.piktag_ask_tags at3 JOIN public.piktag_tags t ON t.id = at3.tag_id
     WHERE at3.ask_id = ca.id),
    ca.deg,
    (SELECT COUNT(*)::int FROM friends_1 f
     JOIN public.piktag_connections c3 ON c3.user_id = ca.author_id AND c3.connected_user_id = f.uid),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', mp.id, 'username', mp.username,
      'full_name', mp.full_name, 'avatar_url', mp.avatar_url)), '[]'::jsonb)
     FROM (SELECT pp.id, pp.username, pp.full_name, pp.avatar_url FROM friends_1 f
       JOIN public.piktag_connections c4 ON c4.user_id = ca.author_id AND c4.connected_user_id = f.uid
       JOIN public.piktag_profiles pp ON pp.id = f.uid LIMIT 3) mp)
  FROM candidate_asks ca LEFT JOIN public.piktag_profiles p ON p.id = ca.author_id
  ORDER BY ca.created_at DESC;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.find_ask_prompt_targets()
 RETURNS TABLE(user_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT p.id FROM public.piktag_profiles p
  WHERE (SELECT COUNT(*) FROM public.piktag_connections c WHERE c.user_id = p.id AND NOT public.is_official_user(c.connected_user_id)) >= 2
    AND NOT EXISTS (SELECT 1 FROM public.piktag_asks a WHERE a.author_id = p.id AND a.is_active = true AND a.expires_at > now())
    AND NOT EXISTS (SELECT 1 FROM public.piktag_notifications n WHERE n.user_id = p.id AND n.type = 'ask_prompt' AND n.created_at > now() - interval '6 days');
END; $function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.find_connections_by_tag(p_tag_query text)
 RETURNS TABLE(connection_id uuid, connected_user_id uuid, username text, full_name text, avatar_url text, met_at timestamp with time zone, vibe_id uuid, vibe_name text, matched_tag text, match_score integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
    query_norm AS (
      SELECT lower(trim(both '#' from trim(coalesce(p_tag_query, '')))) AS q
    ),
    matches AS (
      SELECT
        c.id AS connection_id,
        c.connected_user_id,
        c.met_at,
        c.scan_session_id,
        t.name AS matched_tag,
        CASE
          WHEN lower(t.name) = (SELECT q FROM query_norm) THEN 3
          WHEN lower(t.name) LIKE (SELECT q || '%' FROM query_norm) THEN 2
          ELSE 1
        END AS match_score
      FROM piktag_connections c
      JOIN piktag_user_tags ut ON ut.user_id = c.connected_user_id
      JOIN piktag_tags t ON t.id = ut.tag_id
      CROSS JOIN query_norm qn
      WHERE c.user_id = auth.uid()
        AND NOT public.is_official_user(c.connected_user_id)
        AND length(qn.q) >= 1
        AND lower(t.name) LIKE '%' || qn.q || '%'
    )
  SELECT DISTINCT ON (m.connection_id)
    m.connection_id,
    m.connected_user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    m.met_at,
    s.id AS vibe_id,
    s.name AS vibe_name,
    m.matched_tag,
    m.match_score
  FROM matches m
  JOIN piktag_profiles p ON p.id = m.connected_user_id
  LEFT JOIN piktag_scan_sessions s
    ON s.id::text = m.scan_session_id::text
  ORDER BY m.connection_id, m.match_score DESC, m.met_at DESC
  LIMIT 50;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.find_reconnect_suggestions()
 RETURNS TABLE(user_id uuid, friend_id uuid, shared_tag_names text[], days_since_message integer, friend_full_name text, friend_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH pairs AS (
    SELECT c1.user_id, c1.connected_user_id AS friend_id
    FROM public.piktag_connections c1
    WHERE EXISTS (
      SELECT 1 FROM public.piktag_connections c2
      WHERE c2.user_id = c1.connected_user_id
        AND c2.connected_user_id = c1.user_id
    )
    AND NOT public.is_official_user(c1.connected_user_id)
  ),
  -- The recipient's tags, keyed by concept (fallback to a per-tag key
  -- for still-unlinked tags), carrying their own wording for display.
  my_concepts AS (
    SELECT p.user_id, p.friend_id,
      COALESCE(mt.concept_id::text, 'tag:' || mt.id::text) AS ckey,
      mt.name
    FROM pairs p
    JOIN public.piktag_user_tags mut ON mut.user_id = p.user_id
    JOIN public.piktag_tags mt ON mt.id = mut.tag_id
  ),
  -- The friend's tags, concept-keyed (names not needed).
  their_concepts AS (
    SELECT p.user_id, p.friend_id,
      COALESCE(tt.concept_id::text, 'tag:' || tt.id::text) AS ckey
    FROM pairs p
    JOIN public.piktag_user_tags tut ON tut.user_id = p.friend_id
    JOIN public.piktag_tags tt ON tt.id = tut.tag_id
  ),
  -- One row per (pair, shared concept) — concept present on BOTH sides.
  shared AS (
    SELECT DISTINCT ON (mc.user_id, mc.friend_id, mc.ckey)
      mc.user_id, mc.friend_id, mc.ckey, mc.name
    FROM my_concepts mc
    WHERE EXISTS (
      SELECT 1 FROM their_concepts tc
      WHERE tc.user_id = mc.user_id
        AND tc.friend_id = mc.friend_id
        AND tc.ckey = mc.ckey
    )
    ORDER BY mc.user_id, mc.friend_id, mc.ckey, mc.name
  ),
  overlap AS (
    SELECT s.user_id, s.friend_id,
      array_agg(s.name ORDER BY s.name) AS shared_tag_names,
      COUNT(*)::integer AS shared_tag_count
    FROM shared s
    GROUP BY s.user_id, s.friend_id
    HAVING COUNT(*) >= 2
  ),
  last_msg AS (
    SELECT
      LEAST(participant_a, participant_b)    AS a,
      GREATEST(participant_a, participant_b) AS b,
      MAX(last_message_at)                   AS ts
    FROM public.piktag_conversations
    GROUP BY 1, 2
  ),
  scored AS (
    SELECT o.user_id, o.friend_id, o.shared_tag_names, o.shared_tag_count,
      COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0)::numeric AS days_since,
      (
        o.shared_tag_count::numeric
        / (COALESCE(EXTRACT(EPOCH FROM (now() - lm.ts)) / 86400.0, 365.0) + 1)
        + CASE WHEN lm.ts IS NULL THEN 0.5 ELSE 0 END
      ) AS score
    FROM overlap o
    LEFT JOIN last_msg lm
      ON lm.a = LEAST(o.user_id, o.friend_id)
     AND lm.b = GREATEST(o.user_id, o.friend_id)
    WHERE lm.ts IS NULL OR lm.ts < now() - interval '60 days'
  ),
  ranked AS (
    SELECT s.*,
      ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC) AS rk
    FROM scored s
  )
  SELECT r.user_id, r.friend_id, r.shared_tag_names, r.days_since::integer,
    p.full_name, p.username
  FROM ranked r
  JOIN public.piktag_profiles p ON p.id = r.friend_id
  WHERE r.rk = 1;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.find_tag_combinations()
 RETURNS TABLE(user_id uuid, tag_a_name text, tag_b_name text, match_count integer, sample_friend_names text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  friends AS (
    SELECT c.user_id AS viewer_id, c.connected_user_id AS friend_id
    FROM public.piktag_connections c
    WHERE NOT public.is_official_user(c.connected_user_id)
  ),
  -- Every (viewer, friend, concept) edge with a representative name.
  friend_tags AS (
    SELECT f.viewer_id, f.friend_id,
      COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS ckey,
      t.name
    FROM friends f
    JOIN public.piktag_user_tags ut ON ut.user_id = f.friend_id
    JOIN public.piktag_tags t ON t.id = ut.tag_id
  ),
  -- Collapse a friend's sibling tags to ONE concept (one name).
  friend_concepts AS (
    SELECT DISTINCT ON (viewer_id, friend_id, ckey)
      viewer_id, friend_id, ckey, name
    FROM friend_tags
    ORDER BY viewer_id, friend_id, ckey, name
  ),
  -- Unordered concept pairs each friend carries (cka < ckb).
  friend_pairs AS (
    SELECT fc1.viewer_id, fc1.friend_id,
      fc1.ckey AS cka, fc2.ckey AS ckb,
      fc1.name AS na, fc2.name AS nb
    FROM friend_concepts fc1
    JOIN friend_concepts fc2
      ON fc1.viewer_id = fc2.viewer_id
     AND fc1.friend_id = fc2.friend_id
     AND fc1.ckey < fc2.ckey
  ),
  -- The viewer's own concepts (to filter self-identified pairs).
  viewer_concepts AS (
    SELECT ut.user_id AS viewer_id,
      COALESCE(t.concept_id::text, 'tag:' || t.id::text) AS ckey
    FROM public.piktag_user_tags ut
    JOIN public.piktag_tags t ON t.id = ut.tag_id
  ),
  combos AS (
    SELECT
      fp.viewer_id,
      fp.cka,
      fp.ckb,
      min(fp.na) AS tag_a_name,
      min(fp.nb) AS tag_b_name,
      COUNT(DISTINCT fp.friend_id)::integer AS match_count,
      array_agg(DISTINCT COALESCE(p.full_name, p.username) ORDER BY COALESCE(p.full_name, p.username))
        FILTER (WHERE COALESCE(p.full_name, p.username) IS NOT NULL) AS friend_names
    FROM friend_pairs fp
    JOIN public.piktag_profiles p ON p.id = fp.friend_id
    GROUP BY fp.viewer_id, fp.cka, fp.ckb
    HAVING COUNT(DISTINCT fp.friend_id) >= 2
  ),
  novel_combos AS (
    SELECT c.*
    FROM combos c
    WHERE NOT EXISTS (
      SELECT 1 FROM viewer_concepts vc
      WHERE vc.viewer_id = c.viewer_id AND vc.ckey = c.cka
    )
    OR NOT EXISTS (
      SELECT 1 FROM viewer_concepts vc
      WHERE vc.viewer_id = c.viewer_id AND vc.ckey = c.ckb
    )
  ),
  ranked AS (
    SELECT nc.*,
      ROW_NUMBER() OVER (
        PARTITION BY nc.viewer_id
        ORDER BY nc.match_count DESC, nc.tag_a_name, nc.tag_b_name
      ) AS rk
    FROM novel_combos nc
  )
  SELECT
    r.viewer_id, r.tag_a_name, r.tag_b_name, r.match_count,
    (r.friend_names)[1:3]
  FROM ranked r
  WHERE r.rk = 1;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.get_friend_detail(p_friend_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_viewer          uuid := auth.uid();
  v_profile         jsonb;
  v_tags            jsonb;
  v_mutual_friends  int;
  v_relation        text;
  v_connections     jsonb;
BEGIN
  -- Profile (subset; full_name etc.). NULL if missing/blocked by RLS.
  SELECT jsonb_build_object(
    'id',          p.id,
    'username',    p.username,
    'full_name',   p.full_name,
    'avatar_url',  p.avatar_url,
    'bio',         p.bio,
    'headline',    p.headline,
    'is_verified', p.is_verified,
    'is_public',   p.is_public
  ) INTO v_profile
  FROM piktag_profiles p
  WHERE p.id = p_friend_id;

  -- Friend's public tags, capped at 30 (above-the-fold render only).
  WITH ft AS (
    SELECT t.id, t.name
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.user_id = p_friend_id
      AND ut.is_private = false
    ORDER BY ut.is_pinned DESC NULLS LAST, ut.position NULLS LAST, t.name
    LIMIT 30
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ft.id, 'name', ft.name)), '[]'::jsonb)
  INTO v_tags FROM ft;

  -- Mutual connections count (intersection of viewer & friend connection sets).
  SELECT COUNT(*) INTO v_mutual_friends
  FROM piktag_connections c1
  JOIN piktag_connections c2
    ON c1.connected_user_id = c2.connected_user_id
  WHERE c1.user_id = v_viewer
    AND c2.user_id = p_friend_id
    AND NOT public.is_official_user(c1.connected_user_id);

  -- Viewer → friend relation (friend / blocked / none).
  SELECT CASE
    WHEN v_viewer IS NULL THEN 'none'
    WHEN v_viewer = p_friend_id THEN 'self'
    WHEN EXISTS (
      SELECT 1 FROM piktag_blocks b
      WHERE (b.blocker_id = v_viewer AND b.blocked_id = p_friend_id)
         OR (b.blocker_id = p_friend_id AND b.blocked_id = v_viewer)
    ) THEN 'blocked'
    WHEN EXISTS (
      SELECT 1 FROM piktag_connections
      WHERE user_id = v_viewer AND connected_user_id = p_friend_id
    ) THEN 'friend'
    ELSE 'none'
  END
  INTO v_relation;

  -- Friend's recent public connection rows (capped). Useful for the
  -- "who they've met" section without a separate fetch.
  WITH fc AS (
    SELECT c.id, c.connected_user_id, c.created_at
    FROM piktag_connections c
    WHERE c.user_id = p_friend_id
      AND NOT public.is_official_user(c.connected_user_id)
    ORDER BY c.created_at DESC
    LIMIT 50
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',                 fc.id,
    'connected_user_id',  fc.connected_user_id,
    'created_at',         fc.created_at
  )), '[]'::jsonb)
  INTO v_connections FROM fc;

  RETURN jsonb_build_object(
    'profile',        v_profile,
    'tags',           v_tags,
    'mutual_friends', v_mutual_friends,
    'relation',       v_relation,
    'connections',    v_connections
  );
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.get_friend_of_friend_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  me uuid := auth.uid();
  result uuid[];
BEGIN
  IF me IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT COALESCE(array_agg(DISTINCT c2.connected_user_id), ARRAY[]::uuid[])
    INTO result
  FROM public.piktag_connections c1
  JOIN public.piktag_connections c2 ON c2.user_id = c1.connected_user_id
  WHERE c1.user_id = me
    AND NOT public.is_official_user(c1.connected_user_id)
    AND c2.connected_user_id <> me
    AND NOT public.is_official_user(c2.connected_user_id)
    AND c2.connected_user_id NOT IN (
      SELECT connected_user_id FROM public.piktag_connections WHERE user_id = me
    )
    AND c2.connected_user_id NOT IN (
      SELECT blocked_id FROM public.piktag_blocks WHERE blocker_id = me
      UNION
      SELECT blocker_id FROM public.piktag_blocks WHERE blocked_id = me
    );

  RETURN result;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.get_similar_users(target_user_id uuid, max_results integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  viewer_id         uuid := auth.uid();
  v_users           jsonb;
  v_mutuals_map     jsonb;
  v_user_ids        uuid[];
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'get_similar_users requires an authenticated session'
      USING ERRCODE = '28000';
  END IF;

  WITH target_tags AS (
    SELECT tag_id
    FROM piktag_user_tags
    WHERE user_id = target_user_id AND is_private = false
  ),
  candidates AS (
    SELECT DISTINCT ut.user_id
    FROM piktag_user_tags ut
    JOIN target_tags tt ON tt.tag_id = ut.tag_id
    WHERE ut.is_private = false
      AND ut.user_id <> target_user_id
      AND ut.user_id <> viewer_id
  ),
  picked AS (
    SELECT p.*
    FROM piktag_profiles p
    JOIN candidates c ON c.user_id = p.id
    WHERE p.is_public = true
      AND COALESCE(p.is_official, false) = false
    LIMIT max_results
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', picked.id,
      'username', picked.username,
      'full_name', picked.full_name,
      'avatar_url', picked.avatar_url,
      'is_verified', picked.is_verified
    )), '[]'::jsonb),
    COALESCE(array_agg(picked.id), ARRAY[]::uuid[])
  INTO v_users, v_user_ids
  FROM picked;

  WITH my_friends AS (
    SELECT connected_user_id AS fid
    FROM piktag_connections WHERE user_id = viewer_id
      AND NOT public.is_official_user(connected_user_id)
  ),
  cand_friends AS (
    SELECT c.user_id AS candidate_id,
           c.connected_user_id AS friend_id
    FROM piktag_connections c
    WHERE c.user_id = ANY(v_user_ids)
  ),
  mutual_pairs AS (
    SELECT cf.candidate_id,
           cf.friend_id,
           row_number() OVER (PARTITION BY cf.candidate_id ORDER BY cf.friend_id) AS rn
    FROM cand_friends cf
    JOIN my_friends mf ON mf.fid = cf.friend_id
  ),
  mutual_enriched AS (
    SELECT mp.candidate_id,
           mp.friend_id,
           p.avatar_url,
           p.full_name
    FROM mutual_pairs mp
    JOIN piktag_profiles p ON p.id = mp.friend_id
    WHERE mp.rn <= 3
  )
  SELECT COALESCE(jsonb_object_agg(candidate_id::text, mutuals), '{}'::jsonb)
  INTO v_mutuals_map
  FROM (
    SELECT candidate_id,
           jsonb_agg(jsonb_build_object(
             'id', friend_id,
             'avatar_url', avatar_url,
             'full_name', full_name
           )) AS mutuals
    FROM mutual_enriched
    GROUP BY candidate_id
  ) grouped;

  RETURN jsonb_build_object(
    'users', v_users,
    'mutuals', v_mutuals_map
  );
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.get_user_detail(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  viewer_id           uuid := auth.uid();
  v_profile           jsonb;
  v_biolinks          jsonb;
  v_their_tags        jsonb;
  v_my_tag_ids        uuid[];
  v_follower_count    int;
  v_is_following      boolean;
  v_connection_id     uuid;
  v_is_close_friend   boolean;
  v_mutual_friends    int;
  v_mutual_tag_ids    uuid[];
  v_pick_counts       jsonb;
BEGIN
  IF viewer_id IS NULL THEN
    RAISE EXCEPTION 'get_user_detail requires an authenticated session'
      USING ERRCODE = '28000';
  END IF;

  -- Profile
  SELECT to_jsonb(p.*) INTO v_profile
  FROM piktag_profiles p WHERE p.id = target_user_id;

  -- Biolinks (active only, ordered)
  SELECT COALESCE(jsonb_agg(b ORDER BY b.position), '[]'::jsonb) INTO v_biolinks
  FROM piktag_biolinks b
  WHERE b.user_id = target_user_id AND b.is_active = true;

  -- Their public user_tags with the joined tag row
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         ut.id,
        'tag_id',     ut.tag_id,
        'position',   ut.position,
        'is_pinned',  ut.is_pinned,
        'is_private', ut.is_private,
        'tag',        to_jsonb(t.*)
      )
    ),
    '[]'::jsonb
  ) INTO v_their_tags
  FROM piktag_user_tags ut
  LEFT JOIN piktag_tags t ON t.id = ut.tag_id
  WHERE ut.user_id = target_user_id AND ut.is_private = false;

  -- My public tag IDs (for mutual-tag calc client-side)
  SELECT COALESCE(array_agg(tag_id), ARRAY[]::uuid[]) INTO v_my_tag_ids
  FROM piktag_user_tags
  WHERE user_id = viewer_id AND is_private = false;

  -- Follower count (people following target_user_id)
  SELECT COUNT(*) INTO v_follower_count
  FROM piktag_follows WHERE following_id = target_user_id;

  -- Am I following them?
  SELECT EXISTS(
    SELECT 1 FROM piktag_follows
    WHERE follower_id = viewer_id AND following_id = target_user_id
  ) INTO v_is_following;

  -- Existing connection (viewer → target). Optional row.
  SELECT id INTO v_connection_id
  FROM piktag_connections
  WHERE user_id = viewer_id AND connected_user_id = target_user_id
  LIMIT 1;

  -- Close-friend flag
  SELECT EXISTS(
    SELECT 1 FROM piktag_close_friends
    WHERE user_id = viewer_id AND close_friend_id = target_user_id
  ) INTO v_is_close_friend;

  -- Mutual friends count (intersection of our connection lists)
  SELECT COUNT(*) INTO v_mutual_friends
  FROM piktag_connections c1
  JOIN piktag_connections c2
    ON c1.connected_user_id = c2.connected_user_id
  WHERE c1.user_id = viewer_id
    AND c2.user_id = target_user_id
    AND NOT public.is_official_user(c1.connected_user_id);

  -- Mutual tag IDs (intersection — client joins to names it already has)
  SELECT COALESCE(array_agg(DISTINCT ut.tag_id), ARRAY[]::uuid[]) INTO v_mutual_tag_ids
  FROM piktag_user_tags ut
  WHERE ut.user_id = target_user_id
    AND ut.is_private = false
    AND ut.tag_id = ANY(v_my_tag_ids);

  -- Pick-count map: for each of target's tags, how many public
  -- connection_tags reference it.
  SELECT COALESCE(
    jsonb_object_agg(tag_id::text, cnt),
    '{}'::jsonb
  ) INTO v_pick_counts
  FROM (
    SELECT ct.tag_id, COUNT(*) AS cnt
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE c.connected_user_id = target_user_id
      AND ct.is_private = false
      AND ct.tag_id IN (SELECT tag_id FROM piktag_user_tags WHERE user_id = target_user_id AND is_private = false)
    GROUP BY ct.tag_id
  ) counts;

  RETURN jsonb_build_object(
    'profile',         v_profile,
    'biolinks',        v_biolinks,
    'their_tags',      v_their_tags,
    'my_tag_ids',      to_jsonb(v_my_tag_ids),
    'follower_count',  v_follower_count,
    'is_following',    v_is_following,
    'connection_id',   v_connection_id,
    'is_close_friend', v_is_close_friend,
    'mutual_friends',  v_mutual_friends,
    'mutual_tag_ids',  to_jsonb(v_mutual_tag_ids),
    'pick_counts',     v_pick_counts
  );
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.match_ask_to_friends(p_ask_id uuid, p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, matched_tag_count integer, match_score integer, top_matched_tags text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  asker AS (SELECT auth.uid() AS uid),
  ask_ownership AS (
    SELECT a.author_id
    FROM piktag_asks a, asker
    WHERE a.id = p_ask_id AND a.author_id = asker.uid
    LIMIT 1
  ),
  ask_tag_ids AS (
    SELECT at.tag_id
    FROM piktag_ask_tags at
    JOIN ask_ownership o ON true
    WHERE at.ask_id = p_ask_id
  ),
  expanded_tags AS (
    SELECT DISTINCT t.id
    FROM piktag_tags t
    WHERE t.id IN (SELECT tag_id FROM ask_tag_ids)
    UNION
    SELECT DISTINCT t2.id
    FROM piktag_tags t1
    JOIN piktag_tags t2 ON t2.concept_id IS NOT NULL AND t2.concept_id = t1.concept_id
    WHERE t1.id IN (SELECT tag_id FROM ask_tag_ids)
      AND t1.concept_id IS NOT NULL
  ),
  friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM piktag_connections c, asker
    WHERE c.user_id = asker.uid
      AND c.connected_user_id IS DISTINCT FROM asker.uid
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks, asker WHERE blocker_id = asker.uid
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks, asker WHERE blocked_id = asker.uid
  ),
  -- NEW (Lesson #2a): per-viewer dismissals on Ask-related surfaces.
  -- A candidate the asker has hidden on ANY Ask/recommendation
  -- surface in the last 60 days is excluded from this Ask's matches.
  dismissed AS (
    SELECT DISTINCT target_id AS uid
    FROM piktag_match_dismissals d, asker
    WHERE d.viewer_id = asker.uid
      AND d.surface IN ('ask_match','recommendation','reconnect_suggest',
                        'ask_bridge','tag_convergence','tag_combo')
      AND d.dismissed_at > now() - interval '60 days'
  ),
  self_matches AS (
    SELECT ut.user_id, ut.tag_id, t.name AS tag_name
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.tag_id IN (SELECT id FROM expanded_tags)
      AND ut.is_private = false
      AND ut.user_id IN (SELECT friend_id FROM friends)
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
      AND ut.user_id NOT IN (SELECT uid FROM dismissed)
  ),
  friend_endorsed AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id, t.name AS tag_name
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    JOIN piktag_tags t ON t.id = ct.tag_id
    WHERE ct.tag_id IN (SELECT id FROM expanded_tags)
      AND ct.is_private = false
      AND c.connected_user_id IN (SELECT friend_id FROM friends)
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  ask_authoring AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id, t.name AS tag_name
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    JOIN piktag_tags t ON t.id = at.tag_id
    WHERE at.tag_id IN (SELECT id FROM expanded_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.id <> p_ask_id
      AND a.author_id IN (SELECT friend_id FROM friends)
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.author_id NOT IN (SELECT uid FROM dismissed)
  ),
  event_attendance AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IN (SELECT friend_id FROM friends)
      AND c.user_id NOT IN (SELECT uid FROM blocked)
      AND c.user_id NOT IN (SELECT uid FROM dismissed)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id, t.name AS tag_name
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM expanded_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IN (SELECT friend_id FROM friends)
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      MAX(tag_name) AS tag_name,
      bool_or(src = 'self')   AS has_self,
      bool_or(src = 'friend') AS has_friend,
      bool_or(src = 'ask')    AS has_ask,
      bool_or(src = 'event')  AS has_event
    FROM (
      SELECT user_id, tag_id, tag_name, 'self'::text   AS src FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'friend'::text AS src FROM friend_endorsed
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'ask'::text    AS src FROM ask_authoring
      UNION ALL
      SELECT user_id, tag_id, tag_name, 'event'::text  AS src FROM event_attendance
    ) u
    GROUP BY user_id, tag_id
  ),
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      tag_name,
      CASE
        WHEN has_self AND has_friend THEN 30
        WHEN has_self                THEN 10
        WHEN has_friend              THEN 6
        WHEN has_ask                 THEN 4
        ELSE                              3
      END AS tag_weight
    FROM per_user_tag
  ),
  scoring AS (
    SELECT
      user_id,
      COUNT(*)::int        AS matched_tag_count,
      SUM(tag_weight)::int AS source_score
    FROM tag_scored
    GROUP BY user_id
  ),
  top_tags_per_user AS (
    SELECT
      user_id,
      ARRAY(
        SELECT t.tag_name
        FROM tag_scored t
        WHERE t.user_id = sc.user_id
        ORDER BY t.tag_weight DESC, t.tag_name
        LIMIT 3
      ) AS tags
    FROM scoring sc
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    s.matched_tag_count,
    (s.source_score + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score,
    tt.tags AS top_matched_tags
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  LEFT JOIN top_tags_per_user tt ON tt.user_id = s.user_id
  WHERE p.is_public = true
    AND COALESCE(p.is_official, false) = false
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.notify_ask_bridges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ask_id uuid;
  v_author uuid;
  v_tag_names text[];
  v_bridge_names text[];
  v_bridge_count integer;
  v_title text;
BEGIN
  SELECT DISTINCT nt.ask_id INTO v_ask_id FROM new_table nt LIMIT 1;
  IF v_ask_id IS NULL THEN RETURN NULL; END IF;

  SELECT a.author_id INTO v_author
  FROM public.piktag_asks a
  WHERE a.id = v_ask_id AND a.is_active = true;
  IF v_author IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piktag_notifications
    WHERE user_id = v_author AND type = 'ask_bridge' AND ref_id = v_ask_id::text
  ) THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(t.name) INTO v_tag_names
  FROM public.piktag_ask_tags at
  JOIN public.piktag_tags t ON t.id = at.tag_id
  WHERE at.ask_id = v_ask_id;
  IF v_tag_names IS NULL OR array_length(v_tag_names, 1) = 0 THEN
    RETURN NULL;
  END IF;

  WITH friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM public.piktag_connections c
    WHERE c.user_id = v_author
      AND NOT public.is_official_user(c.connected_user_id)
  ),
  friends_2 AS (
    SELECT DISTINCT
      f1.uid AS bridge_id,
      c2.connected_user_id AS target_id
    FROM friends_1 f1
    JOIN public.piktag_connections c2 ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> v_author
      AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
      AND NOT public.is_official_user(c2.connected_user_id)
  ),
  ask_tags AS (
    SELECT at.tag_id FROM public.piktag_ask_tags at WHERE at.ask_id = v_ask_id
  ),
  ask_tags_expanded AS (
    SELECT DISTINCT tag_id FROM ask_tags
    UNION
    SELECT DISTINCT sibling.id AS tag_id
    FROM ask_tags atag
    JOIN public.piktag_tags orig
      ON orig.id = atag.tag_id AND orig.concept_id IS NOT NULL
    JOIN public.piktag_tags sibling
      ON sibling.concept_id = orig.concept_id
  ),
  matched_targets AS (
    SELECT DISTINCT
      f2.bridge_id,
      f2.target_id
    FROM friends_2 f2
    JOIN public.piktag_user_tags ut ON ut.user_id = f2.target_id
    WHERE ut.tag_id IN (SELECT tag_id FROM ask_tags_expanded)
  ),
  bridges_ranked AS (
    SELECT
      m.bridge_id,
      COUNT(DISTINCT m.target_id) AS match_count,
      COALESCE(p.full_name, p.username) AS bridge_name
    FROM matched_targets m
    JOIN public.piktag_profiles p ON p.id = m.bridge_id
    GROUP BY m.bridge_id, p.full_name, p.username
    ORDER BY match_count DESC, bridge_name
    LIMIT 3
  )
  SELECT
    array_agg(bridge_name ORDER BY match_count DESC, bridge_name)
      FILTER (WHERE bridge_name IS NOT NULL),
    COUNT(*)::integer
  INTO v_bridge_names, v_bridge_count
  FROM bridges_ranked;

  IF v_bridge_count IS NULL OR v_bridge_count < 1 THEN
    RETURN NULL;
  END IF;

  v_title :=
    array_to_string(v_bridge_names, '、')
    || ' 認識 #' || v_tag_names[1] || ' 的朋友';
  IF array_length(v_tag_names, 1) > 1 THEN
    v_title := v_title || ' 等';
  END IF;

  INSERT INTO public.piktag_notifications (
    user_id, type, title, ref_type, ref_id, data
  ) VALUES (
    v_author,
    'ask_bridge',
    v_title,
    'ask',
    v_ask_id::text,
    jsonb_build_object(
      'ask_id', v_ask_id,
      'bridge_names', to_jsonb(v_bridge_names),
      'tags', to_jsonb(v_tag_names)
    )
  )
  ON CONFLICT (user_id, type, ref_id) DO NOTHING;

  RETURN NULL;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.notify_ask_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := NEW.author_id;
  v_actor_full_name text;
  v_actor_username text;
  v_actor_avatar text;
  v_recipient record;
  v_already_exists boolean;
  v_blocked boolean;
  v_body text;
  v_actor_label text;
  v_auth_key text;
  v_base_url text;
  v_push_token text;
BEGIN
  IF NEW.is_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  SELECT full_name, username, avatar_url
    INTO v_actor_full_name, v_actor_username, v_actor_avatar
    FROM public.piktag_profiles
   WHERE id = v_actor LIMIT 1;

  v_actor_label := COALESCE(
    NULLIF(v_actor_full_name, ''),
    NULLIF(v_actor_username, ''),
    'PikTag'
  );

  v_body := '發了 Ask · ' ||
            CASE
              WHEN char_length(NEW.body) <= 60 THEN NEW.body
              ELSE substring(NEW.body from 1 for 59) || '…'
            END;

  FOR v_recipient IN
    SELECT user_id
      FROM public.piktag_connections
     WHERE connected_user_id = v_actor
       AND user_id <> v_actor
       AND NOT public.is_official_user(user_id)
       AND NOT public.is_official_user(v_actor)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.piktag_blocks
       WHERE (blocker_id = v_recipient.user_id AND blocked_id = v_actor)
          OR (blocker_id = v_actor             AND blocked_id = v_recipient.user_id)
    ) INTO v_blocked;
    IF v_blocked THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.piktag_notifications
      WHERE user_id = v_recipient.user_id
        AND type    = 'ask_posted'
        AND data->>'ask_id' = NEW.id::text
        AND created_at > now() - interval '24 hours'
    ) INTO v_already_exists;

    IF v_already_exists THEN
      CONTINUE;
    END IF;

    INSERT INTO public.piktag_notifications (
      user_id, type, title, body, data, is_read, created_at
    ) VALUES (
      v_recipient.user_id,
      'ask_posted',
      '',
      v_body,
      jsonb_build_object(
        'actor_user_id', v_actor,
        'username',      v_actor_label,
        'avatar_url',    v_actor_avatar,
        'ask_id',        NEW.id,
        'ask_body',      NEW.body
      ),
      false,
      now()
    );

    BEGIN
      SELECT decrypted_secret INTO v_auth_key
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_service_role_key' LIMIT 1;
      SELECT decrypted_secret INTO v_base_url
        FROM vault.decrypted_secrets
       WHERE name = 'piktag_supabase_url' LIMIT 1;
      SELECT push_token INTO v_push_token
        FROM public.piktag_profiles
       WHERE id = v_recipient.user_id LIMIT 1;

      IF v_auth_key IS NOT NULL
         AND v_push_token IS NOT NULL
         AND length(v_push_token) > 0 THEN
        PERFORM net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Accept',        'application/json',
            'Authorization', 'Bearer ' || v_auth_key
          ),
          body := jsonb_build_object(
            'to',       v_push_token,
            'title',    v_actor_label,
            'body',     v_body,
            'data', jsonb_build_object(
              'type',          'ask_posted',
              'actor_user_id', v_actor,
              'ask_id',        NEW.id
            ),
            'sound',    'default',
            'priority', 'high'
          )
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_ask_posted push dispatch failed: %', SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.notify_tag_convergence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_name text;
  v_concept_id uuid;
  v_match_count integer;
  v_preview_names text[];
  v_title text;
BEGIN
  SELECT name, concept_id INTO v_tag_name, v_concept_id
    FROM public.piktag_tags WHERE id = NEW.tag_id;
  IF v_tag_name IS NULL THEN RETURN NEW; END IF;

  WITH friends AS (
    SELECT DISTINCT c.connected_user_id AS friend_id
    FROM public.piktag_connections c
    WHERE c.user_id = NEW.user_id
  ), matched_friends AS (
    -- A friend matches if they hold ANY tag sharing the added tag's
    -- concept (cross-language), or — when the added tag is still
    -- unlinked — the exact same tag_id (unchanged legacy behaviour).
    SELECT DISTINCT f.friend_id
    FROM friends f
    JOIN public.piktag_user_tags fut ON fut.user_id = f.friend_id
    JOIN public.piktag_tags ft ON ft.id = fut.tag_id
    WHERE
      (v_concept_id IS NOT NULL AND ft.concept_id = v_concept_id)
      OR (v_concept_id IS NULL AND fut.tag_id = NEW.tag_id)
  ), matched AS (
    SELECT mf.friend_id, p.full_name, p.username
    FROM matched_friends mf
    JOIN public.piktag_profiles p ON p.id = mf.friend_id
    WHERE COALESCE(p.is_official, false) = false
    LIMIT 50
  )
  SELECT COUNT(*)::integer,
         ARRAY_AGG(COALESCE(full_name, username) ORDER BY full_name)
           FILTER (WHERE COALESCE(full_name, username) IS NOT NULL)
  INTO v_match_count, v_preview_names FROM matched;

  IF v_match_count IS NULL OR v_match_count < 1 THEN RETURN NEW; END IF;

  v_title := '你貼了 #' || v_tag_name || ' — ';
  IF v_match_count = 1 THEN
    v_title := v_title || v_preview_names[1] || ' 也是';
  ELSIF v_match_count <= 3 THEN
    v_title := v_title || array_to_string(v_preview_names[1:v_match_count], '、') || ' 也是';
  ELSE
    v_title := v_title || array_to_string(v_preview_names[1:3], '、') || ' + '
               || (v_match_count - 3)::text || ' 人';
  END IF;

  -- `WHERE ref_id IS NOT NULL` mirrors the partial unique index
  -- idx_notif_user_type_refid (see 20260530090000). Keep it.
  INSERT INTO public.piktag_notifications (user_id, type, title, ref_type, ref_id, data)
  VALUES (
    NEW.user_id, 'tag_convergence', v_title, 'tag', NEW.tag_id::text,
    jsonb_build_object(
      'tag_id',        NEW.tag_id,
      'tag_name',      v_tag_name,
      'match_count',   v_match_count,
      'preview_names', to_jsonb(v_preview_names)
    )
  )
  ON CONFLICT (user_id, type, ref_id) WHERE ref_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.notify_vibe_shift()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id        uuid := NEW.user_id;
  v_actor_username  text;
  v_actor_full_name text;
  v_actor_avatar    text;
  v_actor_display   text;
  v_tag_name        text;
  v_body            text;
  rec               record;
BEGIN
  SELECT t.name INTO v_tag_name
  FROM piktag_tags t
  WHERE t.id = NEW.tag_id;

  IF v_tag_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT username, full_name, avatar_url
    INTO v_actor_username, v_actor_full_name, v_actor_avatar
  FROM piktag_profiles
  WHERE id = v_actor_id;

  -- Pre-compute the actor display + English fallback body once
  -- per actor (not per recipient) — saves work in the loop.
  v_actor_display := COALESCE(NULLIF(v_actor_username, ''),
                              NULLIF(v_actor_full_name, ''),
                              'A friend');
  v_body := 'added #' || v_tag_name;

  FOR rec IN
    SELECT DISTINCT c.user_id AS recipient_id
    FROM piktag_connections c
    WHERE c.connected_user_id = v_actor_id
      AND c.user_id <> v_actor_id
      AND NOT public.is_official_user(c.user_id)
      AND NOT public.is_official_user(v_actor_id)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM piktag_notifications
      WHERE user_id = rec.recipient_id
        AND type = 'vibe_shift'
        AND data->>'actor_user_id' = v_actor_id::text
        AND lower(data->>'tag_name') = lower(v_tag_name)
        AND created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO piktag_notifications (
      user_id, type, title, body, data, is_read
    ) VALUES (
      rec.recipient_id,
      'vibe_shift',
      '',           -- title rendered client-side via i18n key
                    -- (no longer blank-row risk — body is now
                    -- a non-empty string regardless).
      v_body,       -- English fallback. Modern clients prefer
                    -- notifications.types.vibe_shift.body if
                    -- present, falling back to this string.
      jsonb_build_object(
        -- New canonical keys (match the other triggers' shape +
        -- what NotificationsScreen.avatarUrl + getNotification-
        -- Display read by default).
        'username',         v_actor_username,
        'avatar_url',       v_actor_avatar,
        -- Legacy keys preserved for any code path that may have
        -- started reading them. Safe to retire post-launch once
        -- backward-compat window closes.
        'actor_user_id',    v_actor_id,
        'actor_username',   v_actor_username,
        'actor_full_name',  v_actor_full_name,
        'actor_avatar_url', v_actor_avatar,
        'tag_name',         v_tag_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notify_vibe_shift failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.search_screen_init()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks WHERE blocked_id = auth.uid()
  ),
  connections AS (
    SELECT connected_user_id AS uid
    FROM piktag_connections
    WHERE user_id = auth.uid()
  ),
  popular AS (
    SELECT id, name, semantic_type, usage_count, concept_id
    FROM piktag_tags
    ORDER BY usage_count DESC NULLS LAST
    LIMIT 30
  ),
  rec_pool AS (
    SELECT id, username, full_name, avatar_url, bio, is_verified
    FROM piktag_profiles
    WHERE is_public = true
      AND id IS DISTINCT FROM auth.uid()
      AND id NOT IN (SELECT uid FROM blocked)
      AND id NOT IN (SELECT uid FROM connections)
      AND COALESCE(is_official, false) = false
    ORDER BY random()
    LIMIT 10
  ),
  cat_counts AS (
    SELECT t.concept_id, COUNT(DISTINCT ut.user_id) AS user_count
    FROM piktag_user_tags ut
    JOIN piktag_tags t ON t.id = ut.tag_id
    WHERE ut.is_private = false
      AND t.concept_id IS NOT NULL
    GROUP BY t.concept_id
    ORDER BY user_count DESC
    LIMIT 10
  ),
  recent_cats AS (
    SELECT cc.concept_id, cc.user_count, tc.canonical_name, tc.semantic_type
    FROM cat_counts cc
    LEFT JOIN tag_concepts tc ON tc.id = cc.concept_id
    ORDER BY cc.user_count DESC
  )
  SELECT jsonb_build_object(
    'popular_tags', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM popular p), '[]'::jsonb),
    'recommended_users', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM rec_pool r), '[]'::jsonb),
    'recent_categories', COALESCE((SELECT jsonb_agg(to_jsonb(rc)) FROM recent_cats rc), '[]'::jsonb)
  );
$function$;

-- official-account exclusion (is_official) added 2026-06-12
CREATE OR REPLACE FUNCTION public.search_users(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, is_verified boolean, matched_tag_count integer, endorser_count integer, match_score integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  q AS (
    SELECT btrim(replace(p_query, '#', '')) AS qtext
  ),
  raw_terms AS (
    SELECT DISTINCT btrim(piece) AS term
    FROM q,
         LATERAL regexp_split_to_table(q.qtext, '\s+') AS piece
    WHERE btrim(piece) <> ''
    LIMIT 6
  ),
  cjk_decomp AS (
    SELECT substring(rt.term FROM i FOR 1) AS term
    FROM raw_terms rt, generate_series(1, length(rt.term)) AS i
    WHERE rt.term ~ '^[一-鿿]{2,6}$'
  ),
  terms AS (
    SELECT term FROM raw_terms
    UNION
    SELECT term FROM cjk_decomp WHERE term ~ '[一-鿿]'
    LIMIT 12
  ),
  name_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE t.name ILIKE '%' || te.term || '%'
    )
    ORDER BY t.usage_count DESC
    LIMIT 30
  ),
  alias_concepts AS (
    SELECT DISTINCT a.concept_id
    FROM tag_aliases a
    WHERE EXISTS (
      SELECT 1 FROM terms te WHERE a.alias ILIKE '%' || te.term || '%'
    )
    LIMIT 10
  ),
  alias_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN alias_concepts ac ON ac.concept_id = t.concept_id
  ),
  sibling_tags AS (
    SELECT t.id, t.concept_id, t.usage_count
    FROM piktag_tags t
    JOIN name_tags nt ON nt.concept_id IS NOT NULL AND nt.concept_id = t.concept_id
  ),
  matched_tags AS (
    SELECT id FROM name_tags
    UNION
    SELECT id FROM alias_tags
    UNION
    SELECT id FROM sibling_tags
  ),
  blocked AS (
    SELECT blocked_id AS uid FROM piktag_blocks WHERE blocker_id = auth.uid()
    UNION
    SELECT blocker_id AS uid FROM piktag_blocks WHERE blocked_id = auth.uid()
  ),
  -- NEW (v3 pre-launch primitive #2): per-viewer dismissals on the
  -- SEARCH surface. A candidate this searcher has hidden from search
  -- in the last 60 days is excluded from results. Surface-scoped to
  -- 'search' only — other surfaces' dismissals (ask_match,
  -- recommendation, etc.) carry different semantics and must not
  -- bleed across. Mirrors the predicate shape in
  -- 20260530050000_match_dismissals.sql / 20260530120000.
  dismissed AS (
    SELECT DISTINCT target_id AS uid
    FROM piktag_match_dismissals d
    WHERE d.viewer_id = auth.uid()
      AND d.surface = 'search'
      AND d.dismissed_at > now() - interval '60 days'
  ),
  self_matches AS (
    SELECT ut.user_id, ut.tag_id
    FROM piktag_user_tags ut
    WHERE ut.tag_id IN (SELECT id FROM matched_tags)
      AND ut.is_private = false
      AND ut.user_id IS DISTINCT FROM auth.uid()
      AND ut.user_id NOT IN (SELECT uid FROM blocked)
      AND ut.user_id NOT IN (SELECT uid FROM dismissed)
  ),
  friend_matches AS (
    SELECT DISTINCT c.connected_user_id AS user_id, ct.tag_id
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  ask_matches AS (
    SELECT DISTINCT a.author_id AS user_id, at.tag_id
    FROM piktag_asks a
    JOIN piktag_ask_tags at ON at.ask_id = a.id
    WHERE at.tag_id IN (SELECT id FROM matched_tags)
      AND a.is_active = true
      AND a.expires_at > now()
      AND a.author_id IS DISTINCT FROM auth.uid()
      AND a.author_id NOT IN (SELECT uid FROM blocked)
      AND a.author_id NOT IN (SELECT uid FROM dismissed)
  ),
  event_matches AS (
    SELECT DISTINCT c.user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.user_id IS DISTINCT FROM auth.uid()
      AND c.user_id NOT IN (SELECT uid FROM blocked)
      AND c.user_id NOT IN (SELECT uid FROM dismissed)
    UNION
    SELECT DISTINCT c.connected_user_id AS user_id, t.id AS tag_id
    FROM piktag_connections c
    JOIN piktag_scan_sessions s ON s.id = c.scan_session_id
    JOIN piktag_tags t ON t.id IN (SELECT id FROM matched_tags)
    WHERE t.name = ANY(s.event_tags)
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
  ),
  per_user_tag AS (
    SELECT
      user_id,
      tag_id,
      bool_or(src = 'self')   AS has_self,
      bool_or(src = 'friend') AS has_friend,
      bool_or(src = 'ask')    AS has_ask,
      bool_or(src = 'event')  AS has_event
    FROM (
      SELECT user_id, tag_id, 'self'::text   AS src FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, 'friend'::text AS src FROM friend_matches
      UNION ALL
      SELECT user_id, tag_id, 'ask'::text    AS src FROM ask_matches
      UNION ALL
      SELECT user_id, tag_id, 'event'::text  AS src FROM event_matches
    ) u
    GROUP BY user_id, tag_id
  ),
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      CASE
        WHEN has_self AND has_friend                                   THEN 30
        WHEN has_self                                                  THEN 10
        WHEN has_friend                                                THEN 6
        WHEN has_ask                                                   THEN 4
        ELSE                                                                3
      END AS tag_weight
    FROM per_user_tag
  ),
  -- Distinct endorser count per target across the matched_tags set.
  -- "How many distinct people publicly endorsed this user on any of
  -- the tags this search is about." Different from friend_matches'
  -- per-tag flag — this counts UNIQUE taggers (de-duped on tagger id).
  -- Also filters dismissed targets so the count doesn't include
  -- people the viewer hid (consistency with the candidate set above).
  endorser_counts AS (
    SELECT
      c.connected_user_id AS user_id,
      COUNT(DISTINCT c.user_id) AS endorser_count
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
    GROUP BY c.connected_user_id
  ),
  scoring AS (
    SELECT
      user_id,
      COUNT(*)::int           AS matched_tag_count,
      SUM(tag_weight)::int    AS source_score
    FROM tag_scored
    GROUP BY user_id
  )
  SELECT
    p.id,
    p.username,
    p.full_name,
    p.avatar_url,
    p.is_verified,
    s.matched_tag_count,
    COALESCE(ec.endorser_count, 0)::int AS endorser_count,
    (s.source_score + (CASE WHEN p.is_verified THEN 1 ELSE 0 END))::int AS match_score
  FROM scoring s
  JOIN piktag_profiles p ON p.id = s.user_id
  LEFT JOIN endorser_counts ec ON ec.user_id = s.user_id
  WHERE p.is_public = true
    AND COALESCE(p.is_official, false) = false
  ORDER BY match_score DESC, p.username
  LIMIT p_limit;
$function$;

