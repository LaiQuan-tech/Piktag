-- security(storage): relax avatars INSERT/UPDATE RLS — drop metadata checks
--
-- The previous INSERT policy (20260428n) checked:
--   (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
--   AND ((metadata->>'size')::int) < 2097152
--
-- These were "defense in depth" on top of the bucket-level
-- file_size_limit + allowed_mime_types. In practice they cause legitimate
-- uploads to fail with:
--   "new row violates row-level security policy"
-- when the client uploads via React Native's fetch + FormData (rather
-- than supabase-js). The Storage backend doesn't always populate
-- `metadata->>'size'` as an int by the time the RLS WITH CHECK fires —
-- it can land as NULL or a string that won't cast — and any NULL in the
-- chain makes the whole WITH CHECK NULL (i.e. not TRUE) → INSERT denied.
--
-- The bucket config (storage.buckets.file_size_limit +
-- allowed_mime_types) is checked BEFORE the RLS policy runs, so MIME +
-- size are still enforced. Folder isolation (`<auth.uid()>/...`) stays
-- — that's the actual user-vs-user security boundary.
--
-- Idempotent: drop-then-create.

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid())
  WITH CHECK (
    bucket_id = 'avatars'
    AND owner = auth.uid()
    AND name LIKE auth.uid()::text || '/%'
  );
