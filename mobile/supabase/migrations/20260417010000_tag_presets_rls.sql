-- 20260417_tag_presets_rls.sql
--
-- piktag_tag_presets was created without RLS policies. If RLS is enabled
-- (Supabase Studio default), the table silently returns 0 rows for
-- authenticated users. This migration ensures users can CRUD their own
-- presets while preventing cross-user access.

-- Enable RLS (idempotent — no-op if already enabled)
ALTER TABLE piktag_tag_presets ENABLE ROW LEVEL SECURITY;

-- SELECT: users can only read their own presets
DO $$ BEGIN
  CREATE POLICY "Users can read own presets" ON piktag_tag_presets
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- INSERT: users can only insert presets for themselves
DO $$ BEGIN
  CREATE POLICY "Users can insert own presets" ON piktag_tag_presets
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- UPDATE: users can only update their own presets (last_used_at, name, etc.)
DO $$ BEGIN
  CREATE POLICY "Users can update own presets" ON piktag_tag_presets
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DELETE: users can only delete their own presets
DO $$ BEGIN
  CREATE POLICY "Users can delete own presets" ON piktag_tag_presets
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
