-- 20260516020000_ask_bridge_semantic_concept_match.sql
--
-- Make Ask BRIDGE detection semantic — match the Ask FEED.
--
-- The whole point of the semantic-tag layer (tag_concepts /
-- concept_id, kept fresh daily by the auto-link-concepts edge
-- function via GitHub Actions) is: every user tags in their own
-- words, even their own language (#律師 / #法律 / #lawyer /
-- 弁護士), and the DB unifies them by concept so matching works
-- WITHOUT forcing anyone to change their wording.
--
-- fetch_ask_feed already honours this (20260501150000): it expands
-- the viewer's profile tags to all concept-siblings before matching
-- (`my_tags_expanded`). But notify_ask_bridges (20260513140000)
-- never got that treatment — its matched_targets CTE did a raw
--   ut.tag_id IN (SELECT tag_id FROM ask_tags)
-- exact-id match. Result: the SAME 2nd-degree person who would
-- surface in the feed because their #法律 shares a concept with the
-- Ask's #律師 would NOT trigger a bridge notification. The Ask
-- feature contradicted itself, and the contradiction was exactly
-- the case the semantic layer exists to solve.
--
-- Fix: expand the Ask's tags to their concept-siblings (mirror of
-- fetch_ask_feed.my_tags_expanded, applied to the ask side), then
-- match profile tags against the expanded set. Concept membership
-- is transitive within a concept_id group, so expanding the ask
-- side alone is sufficient AND cheaper than expanding every
-- candidate profile's tags.
--
-- Only the ask_tags / matched_targets CTEs change. Everything else
-- (2-hop walk, dedupe pre-check, title composition, notification
-- insert, trigger binding) is byte-for-byte the original. Idempotent
-- CREATE OR REPLACE; trigger re-asserted so the migration is
-- self-contained.

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
  -- Semantic expansion. Identical shape to
  -- fetch_ask_feed.my_tags_expanded — the ask's literal tags
  -- UNION every tag that shares their concept_id. So an Ask
  -- tagged #律師 (concept C) now also matches a profile carrying
  -- #法律 / #lawyer / 弁護士 if auto-link-concepts grouped them
  -- under C. concept_id IS NOT NULL guard keeps unlinked tags
  -- behaving exactly as before (pure exact match) — a strict
  -- superset of the old behaviour, never fewer matches.
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
    -- 2nd-degree people who carry any tag semantically equivalent
    -- to one of the ask's tags.
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
$$;

REVOKE ALL ON FUNCTION public.notify_ask_bridges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_ask_bridges() TO postgres, service_role;

-- Trigger binding unchanged in substance; re-asserted so this
-- migration stands alone (statement-level, transition table).
DROP TRIGGER IF EXISTS trg_notify_ask_bridges ON public.piktag_ask_tags;
CREATE TRIGGER trg_notify_ask_bridges
  AFTER INSERT ON public.piktag_ask_tags
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notify_ask_bridges();
