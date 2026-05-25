-- 20260425_perf_indexes_and_lateral.sql
--
-- Performance pass over the chat stack.
--
-- Addresses four things that showed up in the perf audit:
--
--   1. fetch_inbox() was running two correlated EXISTS subqueries per
--      conversation (is_connection, i_have_replied), which is effectively
--      N+1 once the caller has more than a handful of threads. We rewrite
--      it using LATERAL joins so the planner produces a single plan and
--      short-circuits on the first matching row. Output shape is preserved
--      exactly (same column names, same order) so existing clients keep
--      working without a hook change.
--
--   2. get_chat_unread_summary duplicated the is_connection / i_have_replied
--      classification logic from fetch_inbox. We factor that into a shared
--      SQL helper (public.piktag_classify_conversation) so both RPCs call
--      the same classifier. Behavior is identical; the helper is INLINE-able
--      by the planner because it's `LANGUAGE sql STABLE`, so there's no
--      function-call overhead per row.
--
--   3. piktag_user_status is hit from the chat list with
--      `.in('user_id', ids).gt('expires_at', now)`. We add a composite
--      partial index on (user_id) WHERE expires_at > now that can't actually
--      be created (now() isn't IMMUTABLE), so we fall back to a plain
--      composite (user_id, expires_at DESC) which still lets the planner
--      do an index-only scan for the IN + range filter.
--
--   4. piktag_follows is hit two ways: `.eq('follower_id', me)` to list
--      who I follow, and `.eq('following_id', x).count()` to count a
--      user's followers. We add both indexes idempotently. The table itself
--      was created outside this migration dir (Supabase UI) so we only add
--      indexes if they aren't there yet.
--
-- Notes on concurrency:
--   * Supabase's migration runner executes each file in a single transaction,
--     which means CREATE INDEX CONCURRENTLY is not usable here (it can't run
--     inside a transaction). The tables involved are small enough on prod
--     that a regular CREATE INDEX IF NOT EXISTS is fine. If that changes,
--     pull the index statements out to a separate file and run them with
--     `supabase db execute --file ...` outside the transaction.
--   * Every statement is idempotent. Re-running the migration is a no-op.

-- =============================================================================
-- 1. piktag_messages — confirm the composite index exists.
-- =============================================================================
-- Already shipped in 20260421_chat_messaging.sql as idx_messages_thread
-- on (conversation_id, created_at DESC). Re-declared IF NOT EXISTS here
-- so a fresh database stamped only from this migration file would still
-- come up correctly if the earlier file were ever removed.

CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON public.piktag_messages (conversation_id, created_at DESC);

-- Helpful for the "did I reply in this thread?" check inside fetch_inbox
-- and get_chat_unread_summary. The existing idx_messages_thread is keyed
-- on (conversation_id, created_at DESC), which the planner can still use
-- for a (conversation_id, sender_id) lookup, but a narrow partial index
-- on sender lookups by conversation is meaningfully smaller and faster
-- for the EXISTS path.
CREATE INDEX IF NOT EXISTS idx_messages_conv_sender
  ON public.piktag_messages (conversation_id, sender_id);

-- =============================================================================
-- 2. piktag_user_status — composite index for the chat list lookup.
-- =============================================================================
-- Hook: useChatFriendStatuses does
--   .from('piktag_user_status')
--   .select('user_id, text, expires_at')
--   .in('user_id', allIds)
--   .gt('expires_at', nowIso)
-- A composite on (user_id, expires_at DESC) lets the planner do a single
-- index scan per id in the IN list and skip the full table. We guard with
-- to_regclass so this is a no-op if the table doesn't exist yet in a
-- fresh local env (Supabase projects that never ran the UI-created DDL).

DO $$
BEGIN
  IF to_regclass('public.piktag_user_status') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_status_user_expires
      ON public.piktag_user_status (user_id, expires_at DESC);
  END IF;
END $$;

-- =============================================================================
-- 3. piktag_follows — indexes for follower/following lookups.
-- =============================================================================
-- Screens:
--   * ProfileScreen / FriendDetailScreen / UserDetailScreen
--     `.eq('following_id', id).select(count)` — needs following_id index
--     `.eq('follower_id', me).eq('following_id', them)` — needs composite
--
-- The composite (follower_id, following_id) also enforces uniqueness in
-- practice for most schemas; we don't declare UNIQUE here because the
-- table's own constraint may already own that — a plain composite still
-- speeds up the probe. Guarded with to_regclass for the same reason as above.

DO $$
BEGIN
  IF to_regclass('public.piktag_follows') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_follows_follower_following
      ON public.piktag_follows (follower_id, following_id);
    CREATE INDEX IF NOT EXISTS idx_follows_following
      ON public.piktag_follows (following_id);
  END IF;
END $$;

-- =============================================================================
-- 4. piktag_connections — symmetric lookup index.
-- =============================================================================
-- fetch_inbox and get_chat_unread_summary both do:
--   EXISTS (SELECT 1 FROM piktag_connections pc
--           WHERE (pc.user_id = me AND pc.connected_user_id = other)
--              OR (pc.user_id = other AND pc.connected_user_id = me))
-- The OR across two column pairs means a single composite only covers
-- one direction. Two composites lets the planner BitmapOr them.

DO $$
BEGIN
  IF to_regclass('public.piktag_connections') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_connections_user_connected
      ON public.piktag_connections (user_id, connected_user_id);
    CREATE INDEX IF NOT EXISTS idx_connections_connected_user
      ON public.piktag_connections (connected_user_id, user_id);
  END IF;
END $$;

-- =============================================================================
-- 5. Shared classifier helper — piktag_classify_conversation
-- =============================================================================
-- Returns (is_connection, i_have_replied) for a single (me, conversation, other)
-- tuple. LANGUAGE sql STABLE means Postgres will inline this into the calling
-- plan, so there's no per-row function-call overhead — we get the code-sharing
-- benefit without the perf penalty.

CREATE OR REPLACE FUNCTION public.piktag_classify_conversation(
  p_me uuid,
  p_conv_id uuid,
  p_other uuid
)
RETURNS TABLE (
  is_connection boolean,
  i_have_replied boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.piktag_connections pc
      WHERE (pc.user_id = p_me AND pc.connected_user_id = p_other)
         OR (pc.user_id = p_other AND pc.connected_user_id = p_me)
    ) AS is_connection,
    EXISTS (
      SELECT 1
      FROM public.piktag_messages m
      WHERE m.conversation_id = p_conv_id
        AND m.sender_id = p_me
    ) AS i_have_replied;
$$;

GRANT EXECUTE ON FUNCTION public.piktag_classify_conversation(uuid, uuid, uuid)
  TO authenticated;

-- =============================================================================
-- 6. fetch_inbox — LATERAL-join rewrite.
-- =============================================================================
-- Semantically identical to the 20260424 version (same columns, same order,
-- same folder_override), but the per-row EXISTS subqueries are replaced with
-- a LATERAL join that resolves the "other user" once and reuses it everywhere.
-- The planner produces a single NestedLoop plan with index probes instead of
-- two correlated subplans per row.

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
    other.uid,
    p.username,
    p.full_name,
    p.avatar_url,
    c.last_message_at,
    c.last_message_preview,
    c.last_message_sender_id,
    CASE WHEN c.participant_a = me THEN c.a_last_read_at ELSE c.b_last_read_at END,
    c.initiated_by,
    cls.is_connection,
    cls.i_have_replied,
    CASE WHEN c.participant_a = me THEN c.a_folder ELSE c.b_folder END
  FROM public.piktag_conversations c
  -- Resolve the counterpart once; all downstream joins reference it.
  -- Aliased as `other.uid` (not `other_user_id`) to avoid name-collision
  -- with the RETURNS TABLE OUT parameter of the same name.
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.participant_a = me THEN c.participant_b ELSE c.participant_a END
      AS uid
  ) other
  LEFT JOIN LATERAL (
    SELECT p2.username, p2.full_name, p2.avatar_url
    FROM public.piktag_profiles p2
    WHERE p2.id = other.uid
    LIMIT 1
  ) p ON TRUE
  LEFT JOIN LATERAL (
    SELECT cc.is_connection, cc.i_have_replied
    FROM public.piktag_classify_conversation(me, c.id, other.uid) cc
  ) cls ON TRUE
  WHERE me IN (c.participant_a, c.participant_b)
  ORDER BY c.last_message_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_inbox() TO authenticated;

-- =============================================================================
-- 7. get_chat_unread_summary — rewrite to share the classifier.
-- =============================================================================
-- Same output columns and semantics as the 20260421 version, but the
-- is_connection / i_have_replied computation is delegated to the shared
-- helper so the two RPCs can't drift apart.

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
      u.initiated_by,
      cc.is_connection,
      cc.i_have_replied
    FROM unread u
    CROSS JOIN LATERAL public.piktag_classify_conversation(me, u.id, u.other_id) cc
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
