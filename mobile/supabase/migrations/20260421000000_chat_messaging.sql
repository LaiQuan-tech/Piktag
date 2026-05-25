-- 20260421_chat_messaging.sql
--
-- Chat / direct-messaging feature for PikTag.
--
-- Introduces two tables:
--   * piktag_conversations - one row per ordered pair (participant_a < participant_b).
--     Stores denormalized "last message" fields for inbox rendering and per-side
--     read cursors (a_last_read_at / b_last_read_at) for unread counting.
--   * piktag_messages - append-only message log, with a per-sender client_nonce
--     for idempotent retry from the mobile client.
--
-- Row-Level Security is enabled on both tables:
--   * Participants can SELECT their conversations and messages.
--   * Participants can bump their own read cursor via UPDATE (conv_update_read_cursor).
--   * Messages can only be inserted by the sender into a conversation they are
--     part of, and only if neither direction of piktag_blocks exists between
--     the two participants.
--   * There is intentionally NO INSERT policy on piktag_conversations; rows are
--     created exclusively via the SECURITY DEFINER RPC get_or_create_conversation.
--
-- RPCs:
--   * get_or_create_conversation(other_user_id) - canonical pair ordering + block guard.
--   * mark_conversation_read(conv_id) - updates the caller's read cursor.
--   * get_chat_unread_summary() - inbox badge counts split into primary / requests / general.
--   * fetch_inbox() - denormalized inbox list for the caller.
--
-- Realtime publication is extended so the mobile client can subscribe to
-- piktag_conversations and piktag_messages changes.

-- =============================================================================
-- Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.piktag_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  a_last_read_at timestamptz NOT NULL DEFAULT 'epoch',
  b_last_read_at timestamptz NOT NULL DEFAULT 'epoch',
  initiated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (participant_a < participant_b),
  UNIQUE (participant_a, participant_b)
);

CREATE TABLE IF NOT EXISTS public.piktag_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.piktag_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  client_nonce uuid
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_conv_a
  ON public.piktag_conversations (participant_a, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conv_b
  ON public.piktag_conversations (participant_b, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON public.piktag_messages (conversation_id, created_at DESC);

-- Partial unique index so a client can safely retry an insert with the same
-- client_nonce without producing a duplicate message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_nonce
  ON public.piktag_messages (sender_id, client_nonce)
  WHERE client_nonce IS NOT NULL;

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE public.piktag_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piktag_messages ENABLE ROW LEVEL SECURITY;

-- Conversations: participants can read.
DROP POLICY IF EXISTS "conv_select" ON public.piktag_conversations;
CREATE POLICY "conv_select" ON public.piktag_conversations
  FOR SELECT
  USING (auth.uid() IN (participant_a, participant_b));

-- Conversations: participants can UPDATE (intended for bumping their own read
-- cursor via mark_conversation_read, but scoped at the row level to participants).
DROP POLICY IF EXISTS "conv_update_read_cursor" ON public.piktag_conversations;
CREATE POLICY "conv_update_read_cursor" ON public.piktag_conversations
  FOR UPDATE
  USING (auth.uid() IN (participant_a, participant_b))
  WITH CHECK (auth.uid() IN (participant_a, participant_b));

-- NOTE: intentionally no INSERT policy on piktag_conversations.
-- All creation flows through get_or_create_conversation (SECURITY DEFINER).

-- Messages: can read if the parent conversation belongs to the caller.
DROP POLICY IF EXISTS "msg_select" ON public.piktag_messages;
CREATE POLICY "msg_select" ON public.piktag_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.piktag_conversations c
      WHERE c.id = piktag_messages.conversation_id
        AND auth.uid() IN (c.participant_a, c.participant_b)
    )
  );

-- Messages: can insert if the caller is the sender, participates in the
-- conversation, and there is no block in either direction between the two
-- participants.
DROP POLICY IF EXISTS "msg_insert" ON public.piktag_messages;
CREATE POLICY "msg_insert" ON public.piktag_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.piktag_conversations c
      WHERE c.id = piktag_messages.conversation_id
        AND auth.uid() IN (c.participant_a, c.participant_b)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.piktag_conversations c
      JOIN public.piktag_blocks b
        ON (b.blocker_id = c.participant_a AND b.blocked_id = c.participant_b)
        OR (b.blocker_id = c.participant_b AND b.blocked_id = c.participant_a)
      WHERE c.id = piktag_messages.conversation_id
    )
  );

-- =============================================================================
-- Trigger: keep denormalized last-message fields fresh
-- =============================================================================

CREATE OR REPLACE FUNCTION public.piktag_update_conv_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.piktag_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = left(NEW.body, 140),
      last_message_sender_id = NEW.sender_id
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_msg_update_conv ON public.piktag_messages;
CREATE TRIGGER trg_msg_update_conv
  AFTER INSERT ON public.piktag_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.piktag_update_conv_last_message();

-- =============================================================================
-- Realtime publication
-- =============================================================================

-- ALTER PUBLICATION errors if the table is already a member; wrap so repeated
-- migration runs stay idempotent.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.piktag_conversations;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.piktag_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- RPC: get_or_create_conversation
-- =============================================================================

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

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_conversation(uuid) TO authenticated;

-- =============================================================================
-- RPC: mark_conversation_read
-- =============================================================================

CREATE OR REPLACE FUNCTION public.mark_conversation_read(conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL OR conv_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.piktag_conversations
  SET a_last_read_at = CASE WHEN participant_a = me THEN now() ELSE a_last_read_at END,
      b_last_read_at = CASE WHEN participant_b = me THEN now() ELSE b_last_read_at END
  WHERE id = conv_id
    AND me IN (participant_a, participant_b);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;

-- =============================================================================
-- RPC: get_chat_unread_summary
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_chat_unread_summary()
RETURNS TABLE (
  total int,
  primary_count int,
  requests_count int,
  general_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  RETURN QUERY
  WITH unread AS (
    SELECT
      c.id,
      c.participant_a,
      c.participant_b,
      c.initiated_by,
      CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END AS other_id
    FROM public.piktag_conversations c
    WHERE me IN (c.participant_a, c.participant_b)
      AND c.last_message_at IS NOT NULL
      AND c.last_message_sender_id IS DISTINCT FROM me
      AND c.last_message_at > CASE
        WHEN c.participant_a = me THEN c.a_last_read_at
        ELSE c.b_last_read_at
      END
  ),
  classified AS (
    SELECT
      u.id,
      EXISTS (
        SELECT 1
        FROM public.piktag_connections pc
        WHERE (pc.user_id = me AND pc.connected_user_id = u.other_id)
           OR (pc.user_id = u.other_id AND pc.connected_user_id = me)
      ) AS is_connection,
      u.initiated_by,
      EXISTS (
        SELECT 1
        FROM public.piktag_messages m
        WHERE m.conversation_id = u.id
          AND m.sender_id = me
      ) AS i_have_replied
    FROM unread u
  )
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE is_connection)::int AS primary_count,
    COUNT(*) FILTER (
      WHERE NOT is_connection
        AND initiated_by IS DISTINCT FROM me
        AND NOT i_have_replied
    )::int AS requests_count,
    (
      COUNT(*)
      - COUNT(*) FILTER (WHERE is_connection)
      - COUNT(*) FILTER (
          WHERE NOT is_connection
            AND initiated_by IS DISTINCT FROM me
            AND NOT i_have_replied
        )
    )::int AS general_count
  FROM classified;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_unread_summary() TO authenticated;

-- =============================================================================
-- RPC: fetch_inbox
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fetch_inbox()
RETURNS TABLE (
  id uuid,
  other_user_id uuid,
  other_username text,
  other_full_name text,
  other_avatar_url text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid,
  last_read_at timestamptz,
  initiated_by uuid,
  is_connection boolean,
  i_have_replied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END AS other_user_id,
    p.username AS other_username,
    p.full_name AS other_full_name,
    p.avatar_url AS other_avatar_url,
    c.last_message_at,
    c.last_message_preview,
    c.last_message_sender_id,
    CASE WHEN c.participant_a = me THEN c.a_last_read_at ELSE c.b_last_read_at END AS last_read_at,
    c.initiated_by,
    EXISTS (
      SELECT 1
      FROM public.piktag_connections pc
      WHERE (pc.user_id = me AND pc.connected_user_id = (CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END))
         OR (pc.user_id = (CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END) AND pc.connected_user_id = me)
    ) AS is_connection,
    EXISTS (
      SELECT 1
      FROM public.piktag_messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id = me
    ) AS i_have_replied
  FROM public.piktag_conversations c
  LEFT JOIN public.piktag_profiles p
    ON p.id = CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END
  WHERE me IN (c.participant_a, c.participant_b)
  ORDER BY c.last_message_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_inbox() TO authenticated;
