-- 20260705020000_algo_health_and_signals.sql
-- =============================================================================
-- The seven algorithm items (founder-approved 2026-07-05), server side:
--
-- #1 IDF on the RECOMMENDATION surface (search-side IDF stays replay-gated
--    per the deferred-tuning doctrine — see CLAUDE.md).
-- #2 Vector recall fallback: match_concepts_by_embedding (pgvector kNN over
--    tag_concepts.embedding; called by the semantic-tag-search edge fn as
--    the FIRST zero-result recovery step, before Gemini extraction).
-- #3 Moat metrics: admin_concept_coverage + admin_cross_language_match_rate.
-- #4 Label chain: query_id on search impressions + clicks, so click/message
--    labels are joinable per executed query (train toward MESSAGE later).
-- #5 Replay foundation: admin_search_funnel (per-rank impressions/clicks/CTR
--    via the query_id join) — the gate any future weight change must pass.
-- #6 Cross-script quota in the recommendation picker (top-2 by score + the
--    best cross-script candidate when one exists in ranks 3..12).
-- #7 Friend-source temporal decay in search_users (principle #4's
--    documented post-launch completion): 12-month e-folding, floor 3,
--    verified (30) undecayed. Function otherwise byte-identical to
--    20260612010000's version.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / re-runnable grants).
-- =============================================================================

-- ── #4: query_id label chain ────────────────────────────────────────────
alter table public.piktag_search_impressions
  add column if not exists query_id uuid;
alter table public.piktag_search_learnings
  add column if not exists query_id uuid;
create index if not exists idx_search_impressions_query_id
  on public.piktag_search_impressions (query_id);
create index if not exists idx_search_learnings_query_id
  on public.piktag_search_learnings (query_id);

-- ── #2: pgvector recall fallback ────────────────────────────────────────
-- LANGUAGE sql + `<=>` REQUIRES search_path to include `extensions`
-- (pgvector lives there) — the 2026-06-06 CI gotcha.
create or replace function public.match_concepts_by_embedding(
  p_embedding vector(3072),
  p_limit int default 5
)
returns table(concept_id uuid, tag_name text, similarity float)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with nearest as (
    select c.id, 1 - (c.embedding <=> p_embedding) as sim
    from tag_concepts c
    where c.embedding is not null
    order by c.embedding <=> p_embedding
    limit p_limit
  )
  select n.id, t.name, n.sim
  from nearest n
  join lateral (
    select name from piktag_tags t
    where t.concept_id = n.id
    order by t.usage_count desc nulls last
    limit 2
  ) t on true;
$$;
revoke all on function public.match_concepts_by_embedding(vector, int) from public, anon, authenticated;
grant execute on function public.match_concepts_by_embedding(vector, int) to service_role;

-- ── #3: moat metrics (admin dashboards; service_role only) ──────────────
create or replace function public.admin_concept_coverage()
returns table(
  total_tags bigint,
  linked_tags bigint,
  tag_coverage_pct numeric,
  total_instances bigint,
  linked_instances bigint,
  instance_coverage_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with tag_side as (
    select count(*) as total_tags,
           count(*) filter (where concept_id is not null) as linked_tags
    from piktag_tags
  ),
  inst_side as (
    select count(*) as total_instances,
           count(*) filter (where t.concept_id is not null) as linked_instances
    from piktag_user_tags ut
    join piktag_tags t on t.id = ut.tag_id
    where ut.is_private = false
  )
  select
    ts.total_tags,
    ts.linked_tags,
    round(100.0 * ts.linked_tags / greatest(ts.total_tags, 1), 1),
    is_.total_instances,
    is_.linked_instances,
    round(100.0 * is_.linked_instances / greatest(is_.total_instances, 1), 1)
  from tag_side ts, inst_side is_;
$$;
revoke all on function public.admin_concept_coverage() from public, anon, authenticated;
grant execute on function public.admin_concept_coverage() to postgres, service_role;

create or replace function public.admin_cross_language_match_rate(p_days int default 30)
returns table(total_clicks bigint, cross_script_clicks bigint, cross_rate_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  -- Cross-SCRIPT proxy: the query and the clicked tag live in different
  -- scripts (ascii vs non-ascii). Imperfect (misses es↔en) but zero-cost
  -- and directionally right for the CJK↔EN moat this measures.
  select
    count(*) as total_clicks,
    count(*) filter (
      where (l.query ~ '^[[:ascii:]]+$') <> (t.name ~ '^[[:ascii:]]+$')
    ) as cross_script_clicks,
    round(
      100.0 * count(*) filter (
        where (l.query ~ '^[[:ascii:]]+$') <> (t.name ~ '^[[:ascii:]]+$')
      ) / greatest(count(*), 1), 1
    ) as cross_rate_pct
  from piktag_search_learnings l
  join piktag_tags t on t.id = l.clicked_tag_id
  where l.created_at > now() - make_interval(days => p_days);
$$;
revoke all on function public.admin_cross_language_match_rate(int) from public, anon, authenticated;
grant execute on function public.admin_cross_language_match_rate(int) to postgres, service_role;

-- ── #5: replay foundation — per-rank funnel over the query_id join ─────
create or replace function public.admin_search_funnel(p_days int default 30)
returns table(rank_position int, impressions bigint, clicks bigint, ctr_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.rank_position,
    count(*) as impressions,
    count(l.id) as clicks,
    round(100.0 * count(l.id) / greatest(count(*), 1), 2) as ctr_pct
  from piktag_search_impressions i
  left join piktag_search_learnings l
    on l.query_id = i.query_id
   and l.clicked_user_id = i.target_user_id
  where i.shown_at > now() - make_interval(days => p_days)
    and i.query_id is not null
  group by i.rank_position
  order by i.rank_position;
$$;
revoke all on function public.admin_search_funnel(int) from public, anon, authenticated;
grant execute on function public.admin_search_funnel(int) to postgres, service_role;

-- ── #1 + #6: recommendation cron — IDF score + cross-script quota ──────
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
        ROW_NUMBER() OVER (
          PARTITION BY m.recipient_id
          ORDER BY m.mutual_score DESC, m.candidate_id
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
    -- algo #6 quota: top-2 by IDF score + the best cross-script candidate
    -- from ranks 3..12 when one exists (else plain rank 3). Guarantees the
    -- cross-language bridge — the candidate class unique to PikTag, which
    -- raw counts systematically drown — a seat whenever available, without
    -- displacing clear wins.
    cross_pick AS (
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, rn
      FROM (
        SELECT f.*,
               ROW_NUMBER() OVER (
                 PARTITION BY f.recipient_id
                 ORDER BY f.mutual_score DESC, f.candidate_id
               ) AS crn
        FROM filtered f
        WHERE f.has_cross_script AND f.rn > 2 AND f.rn <= 12
      ) x WHERE x.crn = 1
    ),
    chosen AS (
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, rn
      FROM filtered WHERE rn <= 2
      UNION ALL
      SELECT recipient_id, candidate_id, mutual_tag_count, mutual_tag_ids, rn
      FROM cross_pick
      UNION ALL
      SELECT f.recipient_id, f.candidate_id, f.mutual_tag_count, f.mutual_tag_ids, f.rn
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


-- ── #7: search_users — friend-source temporal decay ────────────────────
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
    -- algo #7 (principle #4 completion, 2026-07-05): carry the NEWEST
    -- endorsement time so friend weight can decay — peer perception ages.
    SELECT c.connected_user_id AS user_id, ct.tag_id,
           MAX(ct.created_at) AS friend_at
    FROM piktag_connection_tags ct
    JOIN piktag_connections c ON c.id = ct.connection_id
    WHERE ct.tag_id IN (SELECT id FROM matched_tags)
      AND ct.is_private = false
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND c.connected_user_id NOT IN (SELECT uid FROM blocked)
      AND c.connected_user_id NOT IN (SELECT uid FROM dismissed)
    GROUP BY c.connected_user_id, ct.tag_id
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
      bool_or(src = 'event')  AS has_event,
      MAX(src_at) FILTER (WHERE src = 'friend') AS friend_at
    FROM (
      SELECT user_id, tag_id, 'self'::text   AS src, NULL::timestamptz AS src_at FROM self_matches
      UNION ALL
      SELECT user_id, tag_id, 'friend'::text AS src, friend_at AS src_at FROM friend_matches
      UNION ALL
      SELECT user_id, tag_id, 'ask'::text    AS src, NULL::timestamptz AS src_at FROM ask_matches
      UNION ALL
      SELECT user_id, tag_id, 'event'::text  AS src, NULL::timestamptz AS src_at FROM event_matches
    ) u
    GROUP BY user_id, tag_id
  ),
  tag_scored AS (
    SELECT
      user_id,
      tag_id,
      CASE
        -- verified (self+friend agreement) stays undecayed: the strongest
        -- signal shouldn't erode while the agreement itself stands.
        WHEN has_self AND has_friend                                   THEN 30
        WHEN has_self                                                  THEN 10
        -- algo #7: friend endorsement decays with a 12-month e-folding,
        -- floored at 3 so an old endorsement never drops below the event
        -- tier. Backfilled created_at (pre-column rows) reads as fresh —
        -- decay phases in from deploy day, no cliff.
        WHEN has_friend THEN GREATEST(
          3,
          ROUND(6.0 * exp(
            - EXTRACT(EPOCH FROM (now() - COALESCE(friend_at, now()))) / 31557600.0
          ))::int
        )
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

