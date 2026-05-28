-- 20260529050000_negative_signals.sql
--
-- North-Star tag-quality principle #6 (negative signals are signals
-- too). See CLAUDE.md "Tag-quality principles".
--
-- Captures two kinds of "I don't want this tag" data the algorithm
-- previously dropped on the floor:
--
--   1. Tag removals.   When the owner deletes a row from
--      piktag_user_tags or piktag_connection_tags, that act is the
--      strongest anti-endorsement we get. Was effectively invisible —
--      DELETE has no audit trail. AFTER DELETE triggers now mirror
--      each removal into piktag_tag_removals with a source tag, so
--      AI suggestion / search rerank can read "user has actively
--      rejected this tag before."
--
--   2. AI suggestion dismissals.   The mark_ai_tag_suggestion_accepted
--      RPC (20260529040000) only handled the positive path. Symmetric
--      mark_ai_tag_suggestion_dismissed flips the accepted flag to
--      false so calibration analysis can distinguish "shown but
--      ignored" (accepted = NULL after timeout) from "shown and
--      explicitly rejected" (accepted = false).
--
-- Out of scope for first ship (each its own follow-up):
--   • Search quick-bounce (open-and-back-out under N seconds) —
--     requires client-side time-on-screen instrumentation.
--   • Scoring impact in search_users / suggest-tags — the table and
--     RPC land here; downstream consumers wire in subsequent commits.
--
-- Idempotent throughout.

-- ─── Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.piktag_tag_removals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The tag the user has rejected. References piktag_tags so removals
  -- cascade when a tag is deleted entirely (rare; defensive).
  tag_id        uuid NOT NULL REFERENCES public.piktag_tags(id) ON DELETE CASCADE,
  -- Where the rejection came from:
  --   self_unstag      — target removed it from their own profile
  --   friend_withdraw  — the tagger withdrew their public endorsement
  --                       (NOT the target — RLS prevents that)
  --   ai_dismissed     — explicit "not this one" on an AI suggestion
  source        text NOT NULL CHECK (source IN ('self_unstag','friend_withdraw','ai_dismissed')),
  -- Free-form context: payload from the trigger, e.g. tagger_id when
  -- a friend withdrew. Used for "X friends withdrew their PM tag" UX.
  context       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tag_removals_user_tag
  ON public.piktag_tag_removals (user_id, tag_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_removals_source_created
  ON public.piktag_tag_removals (source, created_at DESC);

ALTER TABLE public.piktag_tag_removals ENABLE ROW LEVEL SECURITY;

-- Owner-readable; primarily consumed by SECURITY DEFINER scoring
-- functions, which the service role / postgres can bypass entirely.
DROP POLICY IF EXISTS "tag_removals_select_self" ON public.piktag_tag_removals;
CREATE POLICY "tag_removals_select_self" ON public.piktag_tag_removals
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "tag_removals_service" ON public.piktag_tag_removals;
CREATE POLICY "tag_removals_service" ON public.piktag_tag_removals
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- Direct INSERT not allowed from clients — only the triggers (which
-- are SECURITY DEFINER) and the ai-dismiss RPC write rows.

-- ─── Trigger: self un-tag ─────────────────────────────────────────
-- Fires after target removes a row from their own piktag_user_tags
-- (only the owner can DELETE per the existing RLS). The deleted row
-- is OLD.* — we log the user_id + tag_id.

CREATE OR REPLACE FUNCTION public.log_self_tag_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.piktag_tag_removals (user_id, tag_id, source)
  VALUES (OLD.user_id, OLD.tag_id, 'self_unstag')
  ON CONFLICT DO NOTHING;  -- no-op if a duplicate signal arrived
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_self_tag_removal ON public.piktag_user_tags;
CREATE TRIGGER trg_log_self_tag_removal
  AFTER DELETE ON public.piktag_user_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_self_tag_removal();

-- ─── Trigger: friend withdraw endorsement ─────────────────────────
-- Fires when a tagger DELETE-s their own piktag_connection_tags row.
-- We log against the TARGET (connection.connected_user_id) because
-- the signal is "someone retracted an endorsement of THIS user."
-- The withdrawing tagger goes in context for "N friends withdrew"
-- UX downstream.

CREATE OR REPLACE FUNCTION public.log_friend_endorsement_withdraw()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid;
  v_tagger uuid;
BEGIN
  -- Resolve target + tagger from the deleted connection row.
  SELECT c.connected_user_id, c.user_id
    INTO v_target, v_tagger
    FROM public.piktag_connections c
   WHERE c.id = OLD.connection_id
   LIMIT 1;

  IF v_target IS NULL THEN
    -- Connection already gone (cascaded delete) — skip; the signal
    -- is moot when the underlying connection no longer exists.
    RETURN OLD;
  END IF;

  -- Only log PUBLIC endorsement withdrawals. Private notes don't
  -- carry endorsement signal in the first place.
  IF OLD.is_private = true THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.piktag_tag_removals (user_id, tag_id, source, context)
  VALUES (
    v_target,
    OLD.tag_id,
    'friend_withdraw',
    jsonb_build_object('tagger_id', v_tagger)
  )
  ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_friend_endorsement_withdraw ON public.piktag_connection_tags;
CREATE TRIGGER trg_log_friend_endorsement_withdraw
  AFTER DELETE ON public.piktag_connection_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_friend_endorsement_withdraw();

-- ─── RPC: mark_ai_tag_suggestion_dismissed ────────────────────────
-- Symmetric to mark_ai_tag_suggestion_accepted (20260529040000).
-- Sets accepted=false on a suggestion the user explicitly rejected,
-- and writes a row to piktag_tag_removals with source='ai_dismissed'
-- so downstream re-suggestion logic can exclude this tag for this user.

CREATE OR REPLACE FUNCTION public.mark_ai_tag_suggestion_dismissed(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_tag_name text;
  v_tag_id uuid;
BEGIN
  UPDATE public.piktag_ai_tag_suggestions
     SET accepted = false, accepted_at = now()
   WHERE id = p_id
     AND user_id = auth.uid()
     AND accepted IS DISTINCT FROM false
  RETURNING user_id, tag_name INTO v_user, v_tag_name;

  IF v_user IS NULL THEN
    RETURN;
  END IF;

  -- Resolve tag_name to tag_id if it exists; if the AI suggested a
  -- tag that's never been promoted to piktag_tags yet, we silently
  -- skip the removal log (no canonical tag to point at).
  SELECT id INTO v_tag_id FROM public.piktag_tags WHERE lower(name) = lower(v_tag_name) LIMIT 1;
  IF v_tag_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.piktag_tag_removals (user_id, tag_id, source, context)
  VALUES (v_user, v_tag_id, 'ai_dismissed', jsonb_build_object('suggestion_id', p_id))
  ON CONFLICT DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ai_tag_suggestion_dismissed(uuid) TO authenticated;
