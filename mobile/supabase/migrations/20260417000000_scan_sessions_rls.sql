-- 20260417_scan_sessions_rls.sql
--
-- piktag_scan_sessions needs RLS policies so the mobile app can
-- INSERT sessions (host creating QR) and SELECT them (scanner
-- fetching event_tags). Without these, RLS blocks both operations
-- and event_tags never transfer to the new connection.

ALTER TABLE piktag_scan_sessions ENABLE ROW LEVEL SECURITY;

-- Host can create sessions for themselves
DO $$ BEGIN
  CREATE POLICY "Users can insert own scan sessions" ON piktag_scan_sessions
    FOR INSERT WITH CHECK (auth.uid() = host_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Anyone authenticated can read active sessions (needed by scanner)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read active sessions" ON piktag_scan_sessions
    FOR SELECT USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Host can update their own sessions (scan_count, qr_code_data, is_active)
DO $$ BEGIN
  CREATE POLICY "Users can update own scan sessions" ON piktag_scan_sessions
    FOR UPDATE USING (auth.uid() = host_user_id)
    WITH CHECK (auth.uid() = host_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
