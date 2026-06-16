-- 20260617000000_avatars_readd_select_policy.sql
-- =============================================================================
-- THE REAL avatar-upload fix. Symptom: EVERY avatar upload (profile AND local
-- contact, first-time AND overwrite) fails with
--   "new row violates row-level security policy"  (Postgres 42501)
-- shown to the user as "上傳失敗".
--
-- Root cause (proven empirically against the live DB on 2026-06-17 via the
-- Management API, in rolled-back transactions impersonating an authenticated
-- user):
--
--   The app uploads via raw fetch with header `x-upsert: true`
--   (EditProfileScreen.tsx:657, EditLocalContactScreen.tsx:305,
--    auth/OnboardingScreen.tsx:614), so storage-api runs
--      INSERT INTO storage.objects (...) ON CONFLICT (bucket_id, name) DO UPDATE
--   Postgres/Supabase require the SELECT **and** INSERT **and** UPDATE RLS
--   policies to ALL pass for an upsert — REGARDLESS of whether a conflicting
--   row exists. The avatars bucket's SELECT policy was dropped by
--   20260609000000 (#4 — removed avatars_public_select + avatars_public_read to
--   close a public-bucket-listing advisory) and never re-added. With no SELECT
--   policy, the upsert's SELECT check fails -> 42501 -> every upload breaks.
--
-- Why earlier fixes (20260429120000 / 20260612030000 / 20260612040000) did NOT
-- resolve it: they only ever touched INSERT/UPDATE/DELETE. A bare
--   INSERT INTO storage.objects(...)   -- no ON CONFLICT
-- (which is what the verification queries ran) only evaluates the INSERT WITH
-- CHECK and PASSED — masking the fact that the app's ON CONFLICT statement also
-- needs SELECT. Empirical proof captured today:
--   * upsert to a NEW path,   no SELECT policy  -> DENIED (42501)
--   * upsert to an EXISTING path, no SELECT policy -> DENIED (42501)
--   * same upserts WITH this SELECT policy        -> PASS (HTTP 201)
--   * cross-folder upsert WITH this policy        -> still DENIED (isolation OK)
--
-- The fix: re-add a SELECT policy. It is FOLDER-SCOPED + authenticated-only, so
-- it does NOT re-introduce the public-bucket-listing advisory that
-- 20260609000000 closed (that was a broad public/anon "list the whole bucket"
-- policy; this only lets a user read inside their own <uid>/ folder via the
-- authenticated API). Public-URL display reads go through /object/public on a
-- public bucket (RLS-bypassed) and are unaffected. The predicate is identical
-- to the INSERT policy (20260612040000) and contains NO metadata reference, so
-- it cannot repeat the metadata-size NULL re-break — it can only unblock
-- uploads, never break them.
--
-- Idempotent: drop-then-create.
-- =============================================================================

DROP POLICY IF EXISTS "avatars_owner_select"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
CREATE POLICY "avatars_owner_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    AND name LIKE auth.uid()::text || '/%'
  );
