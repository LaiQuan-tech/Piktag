-- 20260424_conversation_folder.sql
--
-- Per-participant folder override for the chat inbox.
--
-- Before this migration, which inbox tab a conversation appeared in
-- (主要 / 陌生訊息 / 一般) was computed purely client-side from
-- connection + reply state. That meant users couldn't manually pin
-- a chat to a different tab the way Instagram lets you demote a
-- Primary thread to General or accept a Request into Primary.
--
-- We add two nullable columns on piktag_conversations (`a_folder`
-- and `b_folder`) — one for each participant — mirroring the
-- existing `a_last_read_at` / `b_last_read_at` per-side pattern.
-- NULL means "no override, use the default computed bucket" so
-- existing rows are unaffected. Non-null pins the conversation to
-- the named folder from that viewer's POV only.
--
-- A new RPC `set_conversation_folder` writes the caller's own side
-- (chosen via auth.uid()), so we can't leak or write the
-- counterpart's preference. fetch_inbox() is re-created to expose
-- the caller's folder_override alongside the existing columns.

-- =============================================================================
-- Schema
-- =============================================================================

ALTER TABLE public.piktag_conversations
  ADD COLUMN IF NOT EXISTS a_folder text;

ALTER TABLE public.piktag_conversations
  ADD COLUMN IF NOT EXISTS b_folder text;

-- CHECK constraints added separately so re-running the migration is idempotent
-- (ADD COLUMN IF NOT EXISTS doesn't accept inline CHECK).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_conversations_a_folder_check'
  ) THEN
    ALTER TABLE public.piktag_conversations
      ADD CONSTRAINT piktag_conversations_a_folder_check
      CHECK (a_folder IS NULL OR a_folder IN ('primary', 'general', 'requests'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_conversations_b_folder_check'
  ) THEN
    ALTER TABLE public.piktag_conversations
      ADD CONSTRAINT piktag_conversations_b_folder_check
      CHECK (b_folder IS NULL OR b_folder IN ('primary', 'general', 'requests'));
  END IF;
END $$;

-- =============================================================================
-- RPC: set_conversation_folder
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_conversation_folder(
  p_conv_id uuid,
  p_folder text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.piktag_conversations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Accept NULL to clear override, or one of the three named folders.
  IF p_folder IS NOT NULL
     AND p_folder NOT IN ('primary', 'general', 'requests') THEN
    RAISE EXCEPTION 'invalid_folder';
  END IF;

  SELECT * INTO v_conv
  FROM public.piktag_conversations
  WHERE id = p_conv_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  IF v_uid <> v_conv.participant_a AND v_uid <> v_conv.participant_b THEN
    RAISE EXCEPTION 'not_participant';
  END IF;

  -- Write the caller's own side only — never the counterpart's.
  IF v_uid = v_conv.participant_a THEN
    UPDATE public.piktag_conversations
      SET a_folder = p_folder
      WHERE id = p_conv_id;
  ELSE
    UPDATE public.piktag_conversations
      SET b_folder = p_folder
      WHERE id = p_conv_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_conversation_folder(uuid, text) TO authenticated;

-- =============================================================================
-- fetch_inbox — re-created to expose folder_override
-- =============================================================================
-- DROP first because we're adding a new OUT parameter; Postgres won't let
-- CREATE OR REPLACE change the RETURNS TABLE shape.
DROP FUNCTION IF EXISTS public.fetch_inbox();

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
  i_have_replied boolean,
  folder_override text
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
    ) AS i_have_replied,
    CASE WHEN c.participant_a = me THEN c.a_folder ELSE c.b_folder END AS folder_override
  FROM public.piktag_conversations c
  LEFT JOIN public.piktag_profiles p
    ON p.id = CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END
  WHERE me IN (c.participant_a, c.participant_b)
  ORDER BY c.last_message_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_inbox() TO authenticated;
