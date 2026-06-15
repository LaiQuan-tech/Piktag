-- 20260612030000_avatars_folder_isolation_update_delete.sql
-- =============================================================================
-- Fix: "上傳失敗 / new row violates row-level security policy" when (re)uploading
-- a LOCAL-CONTACT avatar (EditLocalContactScreen), and any avatar re-upload.
--
-- Root cause: the avatars UPDATE/DELETE policies (20260428080000 +
-- 20260429120000) gate on `owner = auth.uid()`. Both EditProfile and
-- EditLocalContact upload via React-Native fetch + FormData to the Storage
-- REST endpoint with `x-upsert: true`. On an OVERWRITE, upsert becomes an
-- UPDATE — and the `owner` column on objects created through that REST path
-- is NOT reliably populated with the caller's uid (it can land NULL). When
-- owner is NULL, `owner = auth.uid()` is NULL (not TRUE) → the existing row
-- is invisible to the UPDATE → the upsert falls through to an INSERT on an
-- existing (bucket_id, name) → reported as
-- "new row violates row-level security policy".
--
-- The INSERT policy already uses FOLDER ISOLATION (`name LIKE <uid>/%`), and
-- 20260429120000 explicitly documents folder isolation as "the actual
-- user-vs-user security boundary". So make UPDATE + DELETE consistent with
-- INSERT: gate on the folder prefix, NOT the fragile `owner` column. A user
-- can still only touch files inside their own `<uid>/` folder — identical
-- security boundary, but it no longer depends on `owner` being set by the
-- REST uploader.
--
-- Idempotent: drop-then-create.
-- =============================================================================

-- UPDATE: allow overwriting any object inside the caller's own uid folder.
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );

-- DELETE: allow deleting any object inside the caller's own uid folder.
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );
