-- security(storage): tighten avatars bucket — folder isolation + MIME + size limit
--
-- Hardens the `avatars` Supabase Storage bucket:
--   * Ensures the bucket exists (idempotent).
--   * Drops any pre-existing weak policies of the same names.
--   * SELECT: world-readable (avatars are public).
--   * INSERT: only authenticated users, only into `<auth.uid()>/...`,
--     restricted to image/jpeg|png|webp and < 2 MB.
--   * UPDATE / DELETE: only the object owner.
--
-- Idempotent: safe to re-run.

-- 1. Ensure bucket exists.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Drop any prior weak policies (names we manage).
DROP POLICY IF EXISTS "avatars_public_select"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert"    ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"   ON storage.objects;
-- Common Supabase-default permissive policy names some projects ship with:
DROP POLICY IF EXISTS "Avatar images are publicly accessible"      ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload an avatar"                ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update an avatar"                ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete an avatar"                ON storage.objects;

-- 3. SELECT — public read.
CREATE POLICY "avatars_public_select"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

-- 4. INSERT — authenticated users only, into their own UID-prefixed folder,
-- with MIME and size constraints enforced at the row level (defence in depth
-- on top of the bucket-level limits set above).
CREATE POLICY "avatars_auth_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
    AND (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
    AND ((metadata->>'size')::int) < 2097152
  );

-- 5. UPDATE — only the owner of the object.
CREATE POLICY "avatars_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid())
  WITH CHECK (
    bucket_id = 'avatars'
    AND owner = auth.uid()
    AND name LIKE auth.uid()::text || '/%'
    AND (metadata->>'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
    AND ((metadata->>'size')::int) < 2097152
  );

-- 6. DELETE — only the owner of the object.
CREATE POLICY "avatars_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());
