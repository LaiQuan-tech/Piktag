-- Pinned Tags: allow users to pin up to 2 tags to always show first
ALTER TABLE piktag_user_tags ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_piktag_user_tags_pinned ON piktag_user_tags(user_id, is_pinned) WHERE is_pinned = true;
