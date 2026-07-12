-- 20260612_follows_cleanup_cascade.sql
--
-- Fix orphaned follow records left behind by deleted accounts.
--
-- ROOT CAUSE: the delete-user edge function's CLEANUPS list omitted
-- piktag_follows, so a deleted user's follow/follower rows survived —
-- showing up as ghost "deleted account" entries in follower lists
-- (notably the PikTag official account).
--
-- This migration:
--   1. Purges existing orphaned rows (either endpoint no longer has a
--      profile).
--   2. Adds ON DELETE CASCADE foreign keys so future deletions clean
--      themselves up at the DB level — defense-in-depth even if the
--      edge function is bypassed.

-- ── 1. Purge existing orphans ──────────────────────────────────────
DELETE FROM public.piktag_follows
WHERE follower_id NOT IN (SELECT id FROM public.piktag_profiles)
   OR following_id NOT IN (SELECT id FROM public.piktag_profiles);

-- ── 2. Add CASCADE foreign keys (idempotent) ───────────────────────
-- Drop any existing FK first so re-runs don't error, then recreate
-- with ON DELETE CASCADE pointing at piktag_profiles.
DO $$
BEGIN
  -- follower_id → piktag_profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'piktag_follows_follower_id_fkey'
      AND table_name = 'piktag_follows'
  ) THEN
    ALTER TABLE public.piktag_follows DROP CONSTRAINT piktag_follows_follower_id_fkey;
  END IF;

  ALTER TABLE public.piktag_follows
    ADD CONSTRAINT piktag_follows_follower_id_fkey
    FOREIGN KEY (follower_id) REFERENCES public.piktag_profiles(id) ON DELETE CASCADE;

  -- following_id → piktag_profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'piktag_follows_following_id_fkey'
      AND table_name = 'piktag_follows'
  ) THEN
    ALTER TABLE public.piktag_follows DROP CONSTRAINT piktag_follows_following_id_fkey;
  END IF;

  ALTER TABLE public.piktag_follows
    ADD CONSTRAINT piktag_follows_following_id_fkey
    FOREIGN KEY (following_id) REFERENCES public.piktag_profiles(id) ON DELETE CASCADE;
END $$;
