-- 20260612040000_avatars_insert_policy_rebuild.sql
-- =============================================================================
-- CRITICAL FIX: avatar upload fails for EVERY user with
-- "new row violates row-level security policy" — profile AND contact avatars.
--
-- Verified live (2026-06-16) by reproducing as a fresh authenticated user:
-- uploads to `<uid>/avatar.png`, `<uid>/x.png` AND root all return the SAME
-- RLS error, with a valid JWT (sub = uid, role = authenticated). So auth.uid()
-- is fine and the path is fine — the live INSERT policy denies regardless.
--
-- Root cause: the metadata-relax migration 20260429120000 evidently did NOT
-- take effect on remote, so the live `avatars_auth_insert` is still the
-- ORIGINAL 20260428080000 definition, whose WITH CHECK included:
--   (metadata->>'mimetype') IN ('image/jpeg','image/png','image/webp')
--   AND ((metadata->>'size')::int) < 2097152
-- React-Native fetch + FormData uploads do NOT populate `metadata->>'size'`
-- by the time the WITH CHECK evaluates, so `(NULL)::int < 2097152` is NULL →
-- the whole WITH CHECK is NULL (not TRUE) → INSERT denied for everyone.
--
-- This migration force-rebuilds ALL avatars write policies to clean
-- FOLDER-ISOLATION (the documented real boundary), with NO metadata checks.
-- MIME + size stay enforced by the bucket config (file_size_limit +
-- allowed_mime_types), which runs BEFORE RLS. Idempotent drop-then-create,
-- and drops every legacy policy name we've ever used so the live state
-- converges no matter which past migration is actually present.
-- =============================================================================

-- ── INSERT: authenticated user may upload into their own <uid>/ folder ──
DROP POLICY IF EXISTS "avatars_auth_insert"            ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload an avatar"    ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert"                 ON storage.objects;
CREATE POLICY "avatars_auth_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );

-- ── UPDATE: overwrite (upsert) within own folder — owner-independent ──
DROP POLICY IF EXISTS "avatars_owner_update"           ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update an avatar"    ON storage.objects;
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

-- ── DELETE: remove within own folder ──
DROP POLICY IF EXISTS "avatars_owner_delete"           ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete an avatar"    ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );
