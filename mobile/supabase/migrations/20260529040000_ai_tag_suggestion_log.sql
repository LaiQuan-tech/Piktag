-- 20260529040000_ai_tag_suggestion_log.sql
--
-- North-Star tag-quality principle #5 (AI-suggestion confidence
-- calibration). See CLAUDE.md "Tag-quality principles".
--
-- Goal: instrument every AI tag suggestion so post-launch we can plot
-- a calibration curve (suggestion rank or confidence vs. actual
-- accept rate). If the top-3 suggestions get accepted at ~70% but
-- positions 7-10 get ~10%, the AI ordering is informative. If
-- positions 1-10 all get ~30%, ordering is noise — re-rank or
-- re-prompt.
--
-- Pragmatic shape for first ship:
--
--   The suggest-tags edge function currently returns string[] with
--   NO per-tag confidence (Gemini's chat completion doesn't surface
--   it natively, and asking the model to self-report a probability
--   produces hallucinated numbers). So `confidence` stays NULL until
--   the edge function is upgraded; `position_in_list` (0-indexed) is
--   the proxy. Position 0 = model's first-pick = highest confidence
--   proxy. This is enough to bucket and compare accept rates.
--
--   Once the edge function returns real per-tag confidence, the field
--   can be backfilled / written going forward, no schema change.
--
-- Outcome states:
--   accepted = NULL   — shown to user, no decision yet
--   accepted = true   — user tapped/accepted the suggestion
--   accepted = false  — user dismissed, removed, or timed out
--
-- For first ship the dismissed/timeout transition is NOT wired
-- (would require lifecycle tracking client-side). NULL rows older
-- than ~24h can be treated as implicit dismissals during analysis.

CREATE TABLE IF NOT EXISTS public.piktag_ai_tag_suggestions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_name         text NOT NULL CHECK (length(btrim(tag_name)) BETWEEN 1 AND 50),
  source           text NOT NULL CHECK (source IN (
                     'suggest_tags_rpc',  -- AddTagScreen's suggest-tags edge fn
                     'card_scan',         -- card-scan flow AI tag extraction
                     'bio_extract',       -- profile-bio derived suggestions
                     'connection_context' -- post-connect "you might also tag"
                   )),
  position_in_list int  CHECK (position_in_list IS NULL OR position_in_list >= 0),
  confidence       float CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  accepted         boolean DEFAULT NULL,
  accepted_at      timestamptz,
  context          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tag_suggestions_user_created
  ON public.piktag_ai_tag_suggestions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tag_suggestions_source_outcome
  ON public.piktag_ai_tag_suggestions (source, accepted, created_at DESC);

ALTER TABLE public.piktag_ai_tag_suggestions ENABLE ROW LEVEL SECURITY;

-- Users can insert their own suggestion logs (client-side hook fires
-- whenever an AI suggestion is shown to them).
DROP POLICY IF EXISTS "ai_suggestions_insert_self" ON public.piktag_ai_tag_suggestions;
CREATE POLICY "ai_suggestions_insert_self" ON public.piktag_ai_tag_suggestions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update accepted state on their own rows (when they tap).
DROP POLICY IF EXISTS "ai_suggestions_update_self" ON public.piktag_ai_tag_suggestions;
CREATE POLICY "ai_suggestions_update_self" ON public.piktag_ai_tag_suggestions
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Service role / postgres get full access for analytics jobs.
DROP POLICY IF EXISTS "ai_suggestions_service" ON public.piktag_ai_tag_suggestions;
CREATE POLICY "ai_suggestions_service" ON public.piktag_ai_tag_suggestions
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── RPC: record_ai_tag_suggestions ────────────────────────────────
-- Batch insert from client when AI returns a list of suggestions.
-- Returns the array of inserted ids so the client can store them and
-- later report which one(s) got accepted.

CREATE OR REPLACE FUNCTION public.record_ai_tag_suggestions(
  p_source     text,
  p_tag_names  text[],
  p_context    jsonb DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id  uuid;
  i     int;
BEGIN
  IF auth.uid() IS NULL OR p_tag_names IS NULL OR array_length(p_tag_names, 1) IS NULL THEN
    RETURN v_ids;
  END IF;
  FOR i IN 1..array_length(p_tag_names, 1) LOOP
    INSERT INTO public.piktag_ai_tag_suggestions
      (user_id, tag_name, source, position_in_list, context)
    VALUES
      (auth.uid(), p_tag_names[i], p_source, i - 1, p_context)
    RETURNING id INTO v_id;
    v_ids := array_append(v_ids, v_id);
  END LOOP;
  RETURN v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ai_tag_suggestions(text, text[], jsonb)
  TO authenticated;

-- ── RPC: mark_ai_tag_suggestion_accepted ──────────────────────────
-- Called when the user taps an AI suggestion chip and it lands in
-- their tag set. Idempotent — re-firing on the same id is a no-op.

CREATE OR REPLACE FUNCTION public.mark_ai_tag_suggestion_accepted(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.piktag_ai_tag_suggestions
     SET accepted = true, accepted_at = now()
   WHERE id = p_id
     AND user_id = auth.uid()
     AND accepted IS DISTINCT FROM true;
$$;

GRANT EXECUTE ON FUNCTION public.mark_ai_tag_suggestion_accepted(uuid) TO authenticated;
