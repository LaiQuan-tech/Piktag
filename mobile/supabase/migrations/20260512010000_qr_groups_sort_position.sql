-- 20260512010000_qr_groups_sort_position.sql
--
-- Adds a host-controllable sort position to piktag_scan_sessions so
-- users can drag-reorder their event groups on QrGroupListScreen.
--
-- Default sort stays "newest first" (created_at DESC) until the
-- user manually drags one — then we switch to sort_position ASC
-- with NULLS LAST (so untouched groups continue to fall back to
-- created_at order).

ALTER TABLE public.piktag_scan_sessions
  ADD COLUMN IF NOT EXISTS sort_position integer;

-- Index for the new ordering query path. Doesn't hurt the existing
-- created_at-based queries since they don't reference this column.
CREATE INDEX IF NOT EXISTS idx_scan_sessions_host_sort
  ON public.piktag_scan_sessions (host_user_id, sort_position NULLS LAST, created_at DESC);
