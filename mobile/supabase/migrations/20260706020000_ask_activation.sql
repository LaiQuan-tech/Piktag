-- 20260706020000_ask_activation.sql
--
-- Ask activation batch (founder-approved 2026-07-06, items 1-4;
-- client counterpart lands in AskStoryRow.tsx):
--   1. count_ask_tag_reach() — dry-run reach preview for the composer
--      ("這題會送到 N 位朋友面前"), the feedback loop that teaches
--      users that SPECIFIC asks reach people.
--   2. fetch_ask_feed — deliberate, narrow exception to the official-
--      account exclusion sweep: @piktag's own asks ARE visible
--      (teaching surface — demo asks model what a good ask looks
--      like). Ranking/matching surfaces keep excluding official.
--   3. piktag_ask_responses — new 'recommend' action + who was
--      recommended (answer-by-introduction).
--   4. Seed one evergreen demo ask from @piktag (10-year expiry;
--      notify_ask_posted already excludes official, so no fan-out).
--
-- Idempotent throughout.

-- ── 1. Reach preview RPC ────────────────────────────────────────
-- Approximation by design: counts 1st-degree friends whose PUBLIC
-- self-tags overlap the concept-expanded input tags (same expansion
-- as match_ask_to_friends). Skips dismissals/multi-source weighting —
-- this is a composer preview, not the matcher.
CREATE OR REPLACE FUNCTION public.count_ask_tag_reach(p_tag_ids uuid[])
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH expanded_tags AS (
    SELECT DISTINCT t.id FROM piktag_tags t WHERE t.id = ANY(p_tag_ids)
    UNION
    SELECT DISTINCT t2.id
    FROM piktag_tags t1
    JOIN piktag_tags t2
      ON t2.concept_id IS NOT NULL AND t2.concept_id = t1.concept_id
    WHERE t1.id = ANY(p_tag_ids) AND t1.concept_id IS NOT NULL
  ),
  friends AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM piktag_connections c
    WHERE c.user_id = auth.uid()
      AND c.connected_user_id IS DISTINCT FROM auth.uid()
      AND NOT public.is_official_user(c.connected_user_id)
  )
  SELECT COUNT(DISTINCT f.uid)::int
  FROM friends f
  JOIN piktag_user_tags ut
    ON ut.user_id = f.uid
   AND ut.is_private = false
   AND ut.tag_id IN (SELECT id FROM expanded_tags);
$$;
GRANT EXECUTE ON FUNCTION public.count_ask_tag_reach(uuid[]) TO authenticated;

-- ── 2. fetch_ask_feed — official demo-ask exception ─────────────
-- Identical to the 20260612010000 version EXCEPT the network CTE
-- gains a third arm admitting official accounts the viewer is
-- connected to (= everyone, via the auto-friend). blocked/dismissed
-- guards still apply, so users can dismiss the demo ask for good.
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
    -- Teaching-surface exception (2026-07-06): @piktag's demo asks.
    UNION ALL SELECT DISTINCT c5.connected_user_id AS uid, 1 AS deg
      FROM public.piktag_connections c5
      WHERE c5.user_id = me AND public.is_official_user(c5.connected_user_id)
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

-- ── 3. Answer-by-introduction schema ────────────────────────────
ALTER TABLE public.piktag_ask_responses
  ADD COLUMN IF NOT EXISTS recommended_user_id uuid
  REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.piktag_ask_responses
  DROP CONSTRAINT IF EXISTS piktag_ask_responses_action_check;
ALTER TABLE public.piktag_ask_responses
  ADD CONSTRAINT piktag_ask_responses_action_check
  CHECK (action IN ('view', 'follow', 'chat', 'connect', 'recommend'));

-- ── 4. Evergreen demo ask from @piktag ──────────────────────────
DO $$
DECLARE
  v_official uuid := '00000000-0000-4000-a000-000000000001';
  v_body     text := 'Looking for a React Native developer for a side project — who do you know?';
  v_ask_id   uuid;
  v_name     text;
  v_tag_id   uuid;
BEGIN
  SELECT id INTO v_ask_id FROM public.piktag_asks
   WHERE author_id = v_official AND body = v_body LIMIT 1;

  IF v_ask_id IS NULL THEN
    INSERT INTO public.piktag_asks (author_id, title, body, expires_at, is_active)
    VALUES (v_official, 'React Native developer', v_body,
            now() + interval '10 years', true)
    RETURNING id INTO v_ask_id;
  END IF;

  FOREACH v_name IN ARRAY ARRAY['ReactNative', 'SideQuest'] LOOP
    SELECT id INTO v_tag_id FROM public.piktag_tags
     WHERE lower(name) = lower(v_name) LIMIT 1;
    IF v_tag_id IS NULL THEN
      INSERT INTO public.piktag_tags (name) VALUES (v_name)
      RETURNING id INTO v_tag_id;
    END IF;
    INSERT INTO public.piktag_ask_tags (ask_id, tag_id)
    VALUES (v_ask_id, v_tag_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
