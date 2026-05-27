-- 20260527010000_ask_response_tracking.sql
--
-- Ask Response Tracking: measure which Ask → tag combinations actually
-- produce real interactions (follow, chat, connection). Use this signal
-- to rank future Ask feed results — Asks with tags that historically
-- convert should surface higher.

-- Track when someone views an Ask author's profile and takes action
CREATE TABLE IF NOT EXISTS public.piktag_ask_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ask_id uuid NOT NULL REFERENCES public.piktag_asks(id) ON DELETE CASCADE,
  responder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('view', 'follow', 'chat', 'connect')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ask_id, responder_id, action)
);

CREATE INDEX IF NOT EXISTS idx_ask_responses_ask
  ON public.piktag_ask_responses (ask_id);
CREATE INDEX IF NOT EXISTS idx_ask_responses_action
  ON public.piktag_ask_responses (action, created_at DESC);

ALTER TABLE public.piktag_ask_responses ENABLE ROW LEVEL SECURITY;

-- Responder can insert their own responses
DROP POLICY IF EXISTS "ask_responses_insert" ON public.piktag_ask_responses;
CREATE POLICY "ask_responses_insert" ON public.piktag_ask_responses
  FOR INSERT WITH CHECK (responder_id = auth.uid());

-- Author can see responses to their asks
DROP POLICY IF EXISTS "ask_responses_select_author" ON public.piktag_ask_responses;
CREATE POLICY "ask_responses_select_author" ON public.piktag_ask_responses
  FOR SELECT USING (author_id = auth.uid());

-- Service role full access
DROP POLICY IF EXISTS "ask_responses_service" ON public.piktag_ask_responses;
CREATE POLICY "ask_responses_service" ON public.piktag_ask_responses
  FOR ALL TO service_role, postgres
  USING (true) WITH CHECK (true);

-- ── View: Ask tag effectiveness score ──
-- Shows which tags, when attached to Asks, lead to actual interactions.
-- Higher score = this tag is good at producing real connections via Ask.

CREATE OR REPLACE VIEW public.ask_tag_effectiveness AS
SELECT
  at.tag_id,
  t.name AS tag_name,
  COUNT(DISTINCT ar.ask_id) FILTER (WHERE ar.action = 'view') AS views,
  COUNT(DISTINCT ar.ask_id) FILTER (WHERE ar.action = 'follow') AS follows,
  COUNT(DISTINCT ar.ask_id) FILTER (WHERE ar.action = 'chat') AS chats,
  COUNT(DISTINCT ar.ask_id) FILTER (WHERE ar.action = 'connect') AS connections,
  COUNT(DISTINCT a.id) AS total_asks_with_tag,
  ROUND(
    100.0 * COUNT(DISTINCT ar.ask_id) FILTER (WHERE ar.action IN ('follow', 'chat', 'connect'))
    / NULLIF(COUNT(DISTINCT a.id), 0)
  , 1) AS conversion_rate_pct
FROM public.piktag_ask_tags at
JOIN public.piktag_tags t ON t.id = at.tag_id
JOIN public.piktag_asks a ON a.id = at.ask_id
LEFT JOIN public.piktag_ask_responses ar ON ar.ask_id = a.id
WHERE a.created_at > now() - interval '30 days'
GROUP BY at.tag_id, t.name
ORDER BY conversion_rate_pct DESC NULLS LAST;

GRANT SELECT ON public.ask_tag_effectiveness TO authenticated, service_role;

-- ── RPC: record_ask_response ──
-- Called by the client when a user taps an Ask and takes action.
-- Idempotent (UNIQUE constraint + ON CONFLICT DO NOTHING).

CREATE OR REPLACE FUNCTION public.record_ask_response(
  p_ask_id uuid,
  p_author_id uuid,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.piktag_ask_responses (ask_id, responder_id, author_id, action)
  VALUES (p_ask_id, auth.uid(), p_author_id, p_action)
  ON CONFLICT (ask_id, responder_id, action) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ask_response(uuid, uuid, text) TO authenticated;
