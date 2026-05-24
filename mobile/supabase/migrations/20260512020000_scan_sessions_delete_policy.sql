-- 20260512020000_scan_sessions_delete_policy.sql
--
-- Two safety-net fixes for the persistent-group rewrite:
--
-- 1. Add a DELETE policy. QrGroupListScreen (Task 2 follow-up) now
--    lets the host delete a group via a trash button. Without an
--    explicit DELETE policy, RLS denies the operation silently —
--    the row stays in the DB and the optimistic UI lies to the user.
--
-- 2. Re-assert `expires_at` is nullable. The earlier migration
--    20260508130000_qr_groups.sql tried to drop the NOT NULL
--    constraint, but if that migration was never applied to a
--    given project (or applied partially), every INSERT that passes
--    `expires_at: null` from AddTagScreen.tsx fails with 23502 and
--    the row never gets written. Idempotent re-assertion here so
--    re-running this migration on a half-migrated DB recovers it.
--
-- 3. (Defensive) ensure `name` and `sort_position` columns exist.
--    Both should already be present from earlier migrations, but
--    `ADD COLUMN IF NOT EXISTS` is free insurance against half-
--    applied migration history.

-- ── 1. DELETE policy ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Host can delete own scan sessions" ON public.piktag_scan_sessions;
CREATE POLICY "Host can delete own scan sessions" ON public.piktag_scan_sessions
  FOR DELETE
  USING (auth.uid() = host_user_id);

-- ── 2. expires_at nullable (idempotent) ──────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'piktag_scan_sessions'
      AND column_name = 'expires_at'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.piktag_scan_sessions
      ALTER COLUMN expires_at DROP NOT NULL;
  END IF;
END $$;

-- ── 3. Defensive column ensures ──────────────────────────────────
ALTER TABLE public.piktag_scan_sessions
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.piktag_scan_sessions
  ADD COLUMN IF NOT EXISTS sort_position integer;
