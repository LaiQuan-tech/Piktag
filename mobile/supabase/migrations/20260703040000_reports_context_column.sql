-- 20260703040000_reports_context_column.sql
--
-- Admin audit finding M1 (2026-07-04): three mobile report entry points
-- send a `context` jsonb payload (cast `as any`) that piktag_reports has
-- no column for —
--   * mobile/src/screens/ChatThreadScreen.tsx  (chat message report)
--   * mobile/src/screens/NotificationsScreen.tsx (notification report)
--   * mobile/src/components/ask/AskStoryRow.tsx  (Ask report)
-- PostgREST rejects the insert with PGRST204 (column not found), but the
-- call sites don't check the error and still show a "Reported" success
-- alert. Net effect: chat / notification / Ask reports have NEVER landed
-- in the DB — the admin Reports page (the Apple Guideline 1.2 review
-- surface) can't see them. FriendDetail / UserDetail reports (which send
-- no context) were unaffected.
--
-- Fix: add the column the client already writes. Nullable jsonb, no
-- default — existing rows stay NULL, new context-bearing reports persist.
-- Idempotent.

ALTER TABLE public.piktag_reports
  ADD COLUMN IF NOT EXISTS context jsonb;

COMMENT ON COLUMN public.piktag_reports.context IS
  'Optional report context from the reporting surface, e.g. {kind:"chat_message", message_id, conversation_id}. Written by the mobile chat / notification / Ask report flows; NULL for profile reports.';
