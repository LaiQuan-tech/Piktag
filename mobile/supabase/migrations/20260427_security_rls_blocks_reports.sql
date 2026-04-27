-- 20260427_security_rls_blocks_reports.sql
--
-- Add RLS policies to piktag_blocks and piktag_reports tables
-- that were created without RLS in 20260330_blocks_reports.sql.

-- ── piktag_blocks ──

ALTER TABLE piktag_blocks ENABLE ROW LEVEL SECURITY;

-- Users can only see their own blocks (as blocker)
DROP POLICY IF EXISTS "blocks_select" ON piktag_blocks;
CREATE POLICY "blocks_select" ON piktag_blocks
  FOR SELECT USING (blocker_id = auth.uid());

-- Users can only block others (not themselves)
DROP POLICY IF EXISTS "blocks_insert" ON piktag_blocks;
CREATE POLICY "blocks_insert" ON piktag_blocks
  FOR INSERT WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());

-- Users can only unblock their own blocks
DROP POLICY IF EXISTS "blocks_delete" ON piktag_blocks;
CREATE POLICY "blocks_delete" ON piktag_blocks
  FOR DELETE USING (blocker_id = auth.uid());

-- ── piktag_reports ──

ALTER TABLE piktag_reports ENABLE ROW LEVEL SECURITY;

-- Users can only see their own reports
DROP POLICY IF EXISTS "reports_select" ON piktag_reports;
CREATE POLICY "reports_select" ON piktag_reports
  FOR SELECT USING (reporter_id = auth.uid());

-- Users can only report others (not themselves)
DROP POLICY IF EXISTS "reports_insert" ON piktag_reports;
CREATE POLICY "reports_insert" ON piktag_reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid() AND reported_id <> auth.uid());
