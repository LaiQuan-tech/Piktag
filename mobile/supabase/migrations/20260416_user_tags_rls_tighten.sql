-- 20260416_user_tags_rls_tighten.sql
--
-- Fix: piktag_user_tags SELECT was USING (true), meaning any authenticated
-- user could read another user's private profile tags. Tighten to:
--   * Public tags (is_private = false): visible to everyone (needed by
--     SearchScreen, FriendDetailScreen, tagDetail explore, etc.)
--   * Private tags (is_private = true): visible only to the owner.
--
-- The app code already added `.eq('is_private', false)` on every cross-user
-- query, so this migration doesn't change functional behavior — it just
-- enforces the same constraint at the DB layer so a direct API call can't
-- bypass the client-side filter.
--
-- Also adds a missing UPDATE policy so ManageTagsScreen can reorder/pin
-- tags via `.update({ position, is_pinned })`.

-- Drop the over-permissive SELECT policy.
DROP POLICY IF EXISTS "user_tags_select" ON piktag_user_tags;

-- Recreate with proper scoping: public tags are world-readable, private
-- tags are owner-only.
CREATE POLICY "user_tags_select" ON piktag_user_tags
  FOR SELECT
  USING (is_private = false OR auth.uid() = user_id);

-- Add UPDATE policy if it doesn't already exist (ManageTagsScreen uses
-- .update() for tag position and is_pinned changes). Some environments
-- already have this policy via Supabase Studio.
DO $$
BEGIN
  CREATE POLICY "user_tags_update" ON piktag_user_tags
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL; -- already exists, skip
END $$;
