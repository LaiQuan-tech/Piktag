-- 20260530060000_notification_is_dismissed.sql
--
-- Adds piktag_notifications.is_dismissed so users can hide individual
-- notification rows without permanently silencing the underlying
-- recommendation (the IG model: row-level "I saw this, hide it"
-- separate from person-level "stop suggesting them entirely").
--
-- Two-tier model from CLAUDE.md 2026-05-30 (see "Adding a new
-- ranking surface" checklist):
--   1) row-level dismiss  → piktag_notifications.is_dismissed
--      Hides ONE notification from the in-app feed. Doesn't affect
--      the underlying signal generator — the same friend may legit-
--      imately show up in next week's cron run.
--   2) person-level dismiss → piktag_match_dismissals (already
--      shipped in 20260530050000). Filters the candidate out of
--      future Recommended-side surfaces for 60 days.
--
-- The client triggers (1) on the long-press action sheet's "Hide
-- this notification" item, and BOTH (1)+(2) when the user picks
-- "Don't suggest [name] again" (since they don't want this row
-- either).
--
-- Partial index on (user_id, created_at) WHERE is_dismissed=false
-- so the active-feed query stays fast even after the table grows —
-- dismissed rows live forever for analytics but never get loaded
-- into the active feed.

ALTER TABLE public.piktag_notifications
  ADD COLUMN IF NOT EXISTS is_dismissed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_active
  ON public.piktag_notifications (user_id, created_at DESC)
  WHERE is_dismissed = false;

COMMENT ON COLUMN public.piktag_notifications.is_dismissed IS
  'Set true when the user explicitly hides this notification row '
  '(long-press → "Hide this notification" in NotificationsScreen). '
  'Does NOT affect the underlying signal generator — for that, see '
  'piktag_match_dismissals which is per-(viewer, target) and '
  '60-day scoped. Both flip together when the user picks '
  '"Don''t suggest [name] again".';
