-- 20260513140000_ask_bridge_detection.sql
--
-- Magic Moment #3: Bridge Detection.
--
-- When a user posts an Ask carrying tags (e.g. "我想找律師"
-- tagged #律師), find 2nd-degree friends — friends-of-friends —
-- who already have any of those tags on their profile. Surface
-- as ONE bundled notification per Ask:
--
--   "Bob、Alice 認識 #律師 的朋友 — 可以請他們介紹"
--
-- Why one bundled notification (not N separate):
--   • A user posting an Ask gets at most one notification, no
--     matter how many bridge friends + tag matches exist —
--     keeps the inbox clean.
--   • The Ask author opens the Ask detail (or for now the
--     notification press routes back to Connections/the ask
--     author's profile) and can tap any of the listed bridge
--     friends to DM them and ask for an intro.
--
-- Privacy posture:
--   • The notification names the BRIDGE friend (Bob), never the
--     2nd-degree target (Charlie). Bob is already the author's
--     friend — surfacing his name is fine. Charlie hasn't
--     consented to be exposed as "the lawyer my friend's friend
--     wanted to find".
--   • The bridge friend (Bob) decides whether to introduce, as
--     a normal social mediator. PikTag just plants the seed.
--
-- Idempotency:
--   • ref_id = ask_id ensures one notification per Ask. The
--     unique index from 20260513130000 (idx_notif_user_type_refid
--     on (user_id, type, ref_id) WHERE ref_id IS NOT NULL)
--     prevents double-fire from any retries or repeated
--     trigger invocations.
--
-- Note on the Ask creation flow: piktag_ask_tags rows are
-- inserted AFTER piktag_asks. We attach the trigger to
-- piktag_ask_tags AFTER INSERT (statement-level not row-level so
-- multi-tag inserts compute bridges once) and skip the run if
-- ANY notification for this ask_id already exists.

CREATE OR REPLACE FUNCTION public.notify_ask_bridges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ask_id uuid;
  v_author uuid;
  v_tag_names text[];
  v_bridges record;
  v_bridge_names text[];
  v_bridge_count integer;
  v_title text;
BEGIN
  -- Identify the Ask we're processing from the newly-inserted
  -- row(s). At INSERT time we only have piktag_ask_tags rows —
  -- they all share the same ask_id within a single statement, so
  -- pick from `new_table` (statement-level trigger transition).
  SELECT DISTINCT nt.ask_id INTO v_ask_id FROM new_table nt LIMIT 1;
  IF v_ask_id IS NULL THEN RETURN NULL; END IF;

  -- Resolve author. If the ask was deleted between INSERT and
  -- this trigger firing (rare race), silently skip.
  SELECT a.author_id INTO v_author
  FROM public.piktag_asks a
  WHERE a.id = v_ask_id AND a.is_active = true;
  IF v_author IS NULL THEN RETURN NULL; END IF;

  -- Skip if a bridge notification already exists for this Ask.
  -- Cheap pre-check before the heavier 2-hop CTE.
  IF EXISTS (
    SELECT 1 FROM public.piktag_notifications
    WHERE user_id = v_author AND type = 'ask_bridge' AND ref_id = v_ask_id::text
  ) THEN
    RETURN NULL;
  END IF;

  -- Gather the Ask's tags (need NAMES for the i18n body, but the
  -- bridge lookup itself happens via tag_id).
  SELECT array_agg(t.name) INTO v_tag_names
  FROM public.piktag_ask_tags at
  JOIN public.piktag_tags t ON t.id = at.tag_id
  WHERE at.ask_id = v_ask_id;
  IF v_tag_names IS NULL OR array_length(v_tag_names, 1) = 0 THEN
    RETURN NULL;
  END IF;

  -- 2-hop bridge search:
  --   friends_1 = my direct connections
  --   friends_2 = their connections (excluding me + my direct friends)
  --   target = friends_2 who have any of the ask's tags
  --   bridge = the friend_1 who routes me to a target
  --
  -- Aggregate by bridge (one row per (bridge_user_id, total
  -- matched-target count)). Pick the top 3 bridges by count.
  WITH friends_1 AS (
    SELECT DISTINCT c.connected_user_id AS uid
    FROM public.piktag_connections c
    WHERE c.user_id = v_author
  ),
  friends_2 AS (
    SELECT DISTINCT
      f1.uid AS bridge_id,
      c2.connected_user_id AS target_id
    FROM friends_1 f1
    JOIN public.piktag_connections c2 ON c2.user_id = f1.uid
    WHERE c2.connected_user_id <> v_author
      AND c2.connected_user_id NOT IN (SELECT uid FROM friends_1)
  ),
  ask_tags AS (
    SELECT at.tag_id FROM public.piktag_ask_tags at WHERE at.ask_id = v_ask_id
  ),
  matched_targets AS (
    -- Targets in 2nd degree who carry any of the ask's tags.
    SELECT DISTINCT
      f2.bridge_id,
      f2.target_id
    FROM friends_2 f2
    JOIN public.piktag_user_tags ut ON ut.user_id = f2.target_id
    WHERE ut.tag_id IN (SELECT tag_id FROM ask_tags)
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

  -- No bridges found — silent return. Nothing magical to surface.
  IF v_bridge_count IS NULL OR v_bridge_count < 1 THEN
    RETURN NULL;
  END IF;

  -- Compose the title. Tag namespace shown in the title is the
  -- FIRST tag of the ask — including all of them would crowd the
  -- one-line notification. The full list lives in data.tags_all.
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
$$;

REVOKE ALL ON FUNCTION public.notify_ask_bridges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_ask_bridges() TO postgres, service_role;

-- Statement-level AFTER INSERT trigger on piktag_ask_tags. We use
-- statement-level (FOR EACH STATEMENT) so a multi-row insert of
-- ask tags fires the function ONCE — the function reads the
-- transition table `new_table` to find the ask_id.
DROP TRIGGER IF EXISTS trg_notify_ask_bridges ON public.piktag_ask_tags;
CREATE TRIGGER trg_notify_ask_bridges
  AFTER INSERT ON public.piktag_ask_tags
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notify_ask_bridges();

-- ── find_ask_prompt_targets ──────────────────────────────────
-- Companion RPC for the weekly-ask-prompt edge function.
-- Returns user_ids who should receive the "今天想要什麼？" nudge
-- this week. Filters out anyone who:
--   • already has an active, unexpired Ask
--   • was prompted (any 'ask_prompt' notification) in the last
--     6 days
--   • has fewer than 2 connections (solo accounts — nudging them
--     to post an Ask nobody will see is just noise)
--
-- SECURITY DEFINER + service_role grant only — never exposed to
-- the client. The edge function is the only legitimate caller.
CREATE OR REPLACE FUNCTION public.find_ask_prompt_targets()
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.piktag_profiles p
  WHERE
    -- ≥ 2 friends — single-friend networks aren't useful for Asks
    (
      SELECT COUNT(*) FROM public.piktag_connections c
      WHERE c.user_id = p.id
    ) >= 2
    -- no active Ask
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_asks a
      WHERE a.author_id = p.id
        AND a.is_active = true
        AND a.expires_at > now()
    )
    -- not prompted in the last 6 days
    AND NOT EXISTS (
      SELECT 1 FROM public.piktag_notifications n
      WHERE n.user_id = p.id
        AND n.type = 'ask_prompt'
        AND n.created_at > now() - interval '6 days'
    );
$$;

REVOKE ALL ON FUNCTION public.find_ask_prompt_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_ask_prompt_targets() TO postgres, service_role;
