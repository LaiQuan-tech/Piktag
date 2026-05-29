-- 20260530040000_attribution_search_click_to_message.sql
--
-- Lesson #1 (Meta multi-predictor framework, 2026-05-30 reading):
-- before we can split search ranking into p(click) / p(message) /
-- p(endorse) predictors, we have to be able to ATTRIBUTE downstream
-- conversions back to the search event that started them. Today
-- the chain is broken — piktag_search_learnings has a `converted`
-- column that nothing writes to.
--
-- Two approaches were considered:
--   (a) Thread a search_learning_id through 4 layers of React
--       navigation (SearchScreen → FriendDetail/UserDetail →
--       ChatThread → get_or_create_conversation). Invasive,
--       brittle, every new entry surface to chat would need
--       wiring.
--   (b) Heuristic backfill — when get_or_create_conversation
--       fires, check if THIS searcher logged a click on THIS
--       other_user within the last 30 minutes; if so, mark
--       converted. ONE place to maintain. Slightly noisier (a
--       user could click person X via search, then message X
--       via a completely different path within 30 min — we'd
--       still attribute) but accurate at aggregate level.
--
-- Going with (b). The client work in the same PR is just adding
-- the INSERT at SearchScreen.handleProfilePress; the rest happens
-- server-side here.
--
-- The 30-min lookback is deliberate: "search → browse around →
-- come back and message them" is a common pattern, especially
-- on a profile they don't know yet. Shorter window would
-- under-attribute. Longer window risks false positives.
--
-- Idempotent CREATE OR REPLACE — preserves the existing block-
-- guard / canonical-ordering / ON CONFLICT behavior, ONLY adds
-- the attribution UPDATE at the end (after the INSERT returns
-- v_conv_id so we don't slow down the main path).

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  a uuid;
  b uuid;
  v_conv_id uuid;
BEGIN
  IF me IS NULL OR other_user_id IS NULL OR me = other_user_id THEN
    RAISE EXCEPTION 'invalid_participants';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.piktag_blocks
    WHERE (blocker_id = me AND blocked_id = other_user_id)
       OR (blocker_id = other_user_id AND blocked_id = me)
  ) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  a := LEAST(me, other_user_id);
  b := GREATEST(me, other_user_id);

  INSERT INTO public.piktag_conversations (participant_a, participant_b, initiated_by)
  VALUES (a, b, me)
  ON CONFLICT (participant_a, participant_b)
    DO UPDATE SET participant_a = EXCLUDED.participant_a
  RETURNING id INTO v_conv_id;

  -- Attribution backfill (Lesson #1 — Meta multi-predictor groundwork).
  -- If the same user logged a search-result tap on this other_user
  -- within the last 30 min, mark that learning row as converted.
  -- Cheap (indexed lookup, narrow predicate), never blocks the main
  -- INSERT path — wrapped in EXCEPTION so attribution failure can
  -- never break conversation creation.
  BEGIN
    UPDATE public.piktag_search_learnings
       SET converted = true
     WHERE searcher_id    = me
       AND clicked_user_id = other_user_id
       AND converted = false
       AND created_at > now() - interval '30 minutes';
  EXCEPTION WHEN OTHERS THEN
    -- Don't propagate — log and continue. The conversation is the
    -- user-visible outcome; attribution is an analytics nicety.
    RAISE NOTICE 'attribution backfill failed: %', SQLERRM;
  END;

  RETURN v_conv_id;
END;
$$;

-- GRANT preserved from 20260421000000.
