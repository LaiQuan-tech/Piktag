-- 20260513160000_notification_ref_columns.sql
--
-- Prerequisite for the magic-moment migrations
-- (20260513130000_on_this_day_and_tag_convergence,
--  20260513140000_ask_bridge_detection,
--  20260513150000_anniversary_reconnect).
--
-- Adds `ref_id` and `ref_type` columns to piktag_notifications.
-- The new notification types (on_this_day, tag_convergence,
-- ask_bridge, reconnect_suggest) all need a stable per-row
-- identifier so the unique index on
-- (user_id, type, ref_id) WHERE ref_id IS NOT NULL can prevent
-- duplicate fires of the same magic-moment trigger.
--
-- `ref_id` is text (not uuid) so it can hold:
--   • uuids of related entities (ask_id, scan_session_id, tag_id,
--     friend's user_id) — cast to text on insert
--   • synthetic composite keys later if needed
--
-- `ref_type` is the human-readable category ('ask', 'scan_session',
-- 'tag', 'user') purely for debugging — never indexed, never
-- queried by the client.
--
-- Both columns are nullable. Existing rows (created by older
-- notification triggers) stay NULL, and the partial unique index
-- only enforces on non-null rows — so legacy types like
-- 'birthday' / 'follow' that didn't set ref_id continue to work.

ALTER TABLE public.piktag_notifications
  ADD COLUMN IF NOT EXISTS ref_id text,
  ADD COLUMN IF NOT EXISTS ref_type text;

-- The partial unique index — previously declared in 20260513130000
-- but bailed because ref_id didn't exist yet. Idempotent via
-- IF NOT EXISTS so re-running this migration on a DB where the
-- index already landed is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_user_type_refid
  ON public.piktag_notifications (user_id, type, ref_id)
  WHERE ref_id IS NOT NULL;
