-- 20260530020000_drop_notif_badge_column.sql
--
-- Drop the notif_badge column added in 20260530000000.
--
-- Founder call (2026-05-30): "要不要開 Badge，我覺得是多餘的問題，
-- 有開該分類通知就會有 Badge，都會在通知頁看到，只是要不要顯示 Badge"
--
-- Translation: a separate "should we show the badge?" toggle is
-- self-conflicting UX — if the user wants the notifications (any
-- of the three category flags is on), the badge follows naturally
-- from the unread count of those rows. A user asking "I want
-- notifications but no badge" is asking to optimize against
-- themselves; we shouldn't surface that decision.
--
-- The column shipped this morning, so there's no real data to
-- preserve — anyone who saw the toggle was a TestFlight tester
-- and is fine being reset to default-true. The column drops
-- cleanly; no triggers, RPCs, or RLS policies reference it.

ALTER TABLE public.piktag_profiles
  DROP COLUMN IF EXISTS notif_badge;
