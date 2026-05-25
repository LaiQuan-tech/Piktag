-- 20260428l_rls_hardening.sql
-- Consolidated RLS hardening from security audit:
--   C2  : piktag_pending_connections INSERT was open to anon (WITH CHECK true)
--   H4  : piktag_scan_sessions SELECT exposed every active host's data
--   H10 : piktag_profiles missing length CHECK constraints on text columns
--   M5  : tag_concepts writes should be restricted to service_role / admins
--   M6  : piktag_close_friends had no SELECT/INSERT/DELETE policies
--
-- Idempotent: safe to re-run.

-- =====================================================================
-- C2: piktag_pending_connections — tighten INSERT
-- =====================================================================
-- Original policy "anon_insert_pending_connections" allowed anyone to
-- insert any row. Replace with auth-required check matching host_user_id.

DROP POLICY IF EXISTS "anon_insert_pending_connections" ON piktag_pending_connections;
DROP POLICY IF EXISTS "auth_insert_pending_connections" ON piktag_pending_connections;

CREATE POLICY "auth_insert_pending_connections"
  ON piktag_pending_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_user_id);

-- =====================================================================
-- H4: piktag_scan_sessions — restrict SELECT to host
-- =====================================================================
-- Original "Authenticated users can read active sessions" leaked every
-- active host's event data. The resolve_pending_connections() RPC is
-- SECURITY DEFINER so it still bypasses RLS for the scanner flow.

DROP POLICY IF EXISTS "Authenticated users can read active sessions" ON piktag_scan_sessions;
DROP POLICY IF EXISTS "Hosts can read own scan sessions" ON piktag_scan_sessions;

CREATE POLICY "Hosts can read own scan sessions"
  ON piktag_scan_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = host_user_id);

-- =====================================================================
-- H10: piktag_profiles — length CHECK constraints on text columns
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_profiles_bio_length_chk'
  ) THEN
    ALTER TABLE piktag_profiles
      ADD CONSTRAINT piktag_profiles_bio_length_chk
      CHECK (bio IS NULL OR char_length(bio) <= 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_profiles_full_name_length_chk'
  ) THEN
    ALTER TABLE piktag_profiles
      ADD CONSTRAINT piktag_profiles_full_name_length_chk
      CHECK (full_name IS NULL OR char_length(full_name) <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_profiles_headline_length_chk'
  ) THEN
    ALTER TABLE piktag_profiles
      ADD CONSTRAINT piktag_profiles_headline_length_chk
      CHECK (headline IS NULL OR char_length(headline) <= 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_profiles_username_length_chk'
  ) THEN
    ALTER TABLE piktag_profiles
      ADD CONSTRAINT piktag_profiles_username_length_chk
      CHECK (username IS NULL OR char_length(username) <= 30);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'piktag_profiles_avatar_url_length_chk'
  ) THEN
    ALTER TABLE piktag_profiles
      ADD CONSTRAINT piktag_profiles_avatar_url_length_chk
      CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 500);
  END IF;
END $$;

-- =====================================================================
-- M5: tag_concepts — restrict writes to service_role
-- =====================================================================
-- Previously authenticated users could INSERT freely. Tag concept
-- creation is an admin/service operation; client code should go through
-- the resolve_tag_alias / find_similar_concepts functions instead.

DROP POLICY IF EXISTS "tag_concepts_insert" ON tag_concepts;
DROP POLICY IF EXISTS "tag_concepts_update" ON tag_concepts;
DROP POLICY IF EXISTS "tag_concepts_delete" ON tag_concepts;
DROP POLICY IF EXISTS "tag_concepts_service_insert" ON tag_concepts;
DROP POLICY IF EXISTS "tag_concepts_service_update" ON tag_concepts;
DROP POLICY IF EXISTS "tag_concepts_service_delete" ON tag_concepts;

CREATE POLICY "tag_concepts_service_insert"
  ON tag_concepts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "tag_concepts_service_update"
  ON tag_concepts FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "tag_concepts_service_delete"
  ON tag_concepts FOR DELETE
  USING (auth.role() = 'service_role');

-- =====================================================================
-- M6: piktag_close_friends — add owner-only RLS
-- =====================================================================
-- Table had RLS enabled but no policies, effectively denying everything
-- to clients while leaving the door open if anyone re-enabled defaults.
-- Owner (user_id) can manage their own close-friends list.

ALTER TABLE piktag_close_friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "close_friends_owner_select" ON piktag_close_friends;
DROP POLICY IF EXISTS "close_friends_owner_insert" ON piktag_close_friends;
DROP POLICY IF EXISTS "close_friends_owner_delete" ON piktag_close_friends;

CREATE POLICY "close_friends_owner_select"
  ON piktag_close_friends FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "close_friends_owner_insert"
  ON piktag_close_friends FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "close_friends_owner_delete"
  ON piktag_close_friends FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
